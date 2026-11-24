import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import sharp from 'sharp';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import { fetchDetailPageHtmlSmart, resolveImageBufferWithFallbacks } from './fetchHelpers';

export const HUMAN_FACE_FILTER_MODEL = 'gemini-3.1-flash-lite';
export const HUMAN_FACE_FILTER_FALLBACK_MODEL = 'gemini-4-hydrogen';

export interface HumanFaceScanInput {
  id: string;
  url: string;
  thumbnailUrl?: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  filename?: string;
  referer?: string;
  previewDataUrl?: string;
}

export interface HumanFaceScanDecision {
  id: string;
  hasHumanFace: boolean;
  faceCount: number;
  confidence: number;
  subjectSummary: string;
  cached?: boolean;
  error?: string;
}

export type FetchedVisionMedia =
  | { buffer: Buffer; mimeType: string; skippedReason?: undefined }
  | { buffer?: undefined; mimeType?: undefined; skippedReason: string };

export interface HumanFaceFilterDependencies {
  apiKey?: string;
  generateContentFn?: (params: {
    model: string;
    contents: unknown;
    config: unknown;
  }) => Promise<{ text?: string }>;
  fetchImageFn?: (item: HumanFaceScanInput) => Promise<FetchedVisionMedia | null>;
  useCache?: boolean;
}

const FACE_CACHE_MAX_ENTRIES = 600;
const FACE_CACHE_TTL_MS = 30 * 60 * 1000;

interface CachedFaceEntry {
  hasHumanFace: boolean;
  faceCount: number;
  confidence: number;
  subjectSummary: string;
  expiresAt: number;
}

const HUMAN_FACE_CACHE = new Map<string, CachedFaceEntry>();

export function clearHumanFaceFilterCache(): void {
  HUMAN_FACE_CACHE.clear();
}

export function getHumanFaceFilterCacheStats(): { entries: number } {
  return { entries: HUMAN_FACE_CACHE.size };
}

function getCacheKey(url: string): string {
  return (url || '').trim();
}

function getCachedDecision(url: string): CachedFaceEntry | null {
  const key = getCacheKey(url);
  if (!key) return null;
  const entry = HUMAN_FACE_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    HUMAN_FACE_CACHE.delete(key);
    return null;
  }
  HUMAN_FACE_CACHE.delete(key);
  HUMAN_FACE_CACHE.set(key, entry);
  return entry;
}

function setCachedDecision(
  url: string,
  decision: Omit<CachedFaceEntry, 'expiresAt'>
): void {
  const key = getCacheKey(url);
  if (!key) return;
  if (HUMAN_FACE_CACHE.size >= FACE_CACHE_MAX_ENTRIES) {
    const oldest = HUMAN_FACE_CACHE.keys().next().value;
    if (oldest) HUMAN_FACE_CACHE.delete(oldest);
  }
  HUMAN_FACE_CACHE.set(key, {
    ...decision,
    expiresAt: Date.now() + FACE_CACHE_TTL_MS,
  });
}

let cachedAiClient: { apiKey: string; client: GoogleGenAI } | null = null;

function getGeminiClient(apiKey: string): GoogleGenAI {
  if (cachedAiClient && cachedAiClient.apiKey === apiKey) {
    return cachedAiClient.client;
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  cachedAiClient = { apiKey, client };
  return client;
}

export function decodeBase64DataImage(dataUri?: string): { buffer: Buffer; mimeType: string } | null {
  if (!dataUri || typeof dataUri !== 'string') return null;
  const match = dataUri
    .trim()
    .match(/^data:(image\/(?:jpeg|jpg|png|webp|gif|svg\+xml|avif));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  try {
    const mimeRaw = match[1].toLowerCase();
    const mimeType = mimeRaw === 'image/jpg' ? 'image/jpeg' : mimeRaw;
    const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (buffer.byteLength === 0) return null;
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export function detectSupportedVisionMimeFromBytes(buf: Buffer): string | null {
  if (!buf || buf.byteLength < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function isSvgOrXmlPayload(buf: Buffer, sourceUrl?: string): boolean {
  if (sourceUrl && /\.svg(?:$|\?)/i.test(sourceUrl)) {
    const head = buf.subarray(0, 128).toString('utf8').trimStart().toLowerCase();
    if (head.startsWith('<svg') || head.startsWith('<?xml')) return true;
  }
  const head = buf.subarray(0, 200).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

export async function normalizeBufferForFaceVision(
  rawBuffer: Buffer,
  sourceHint?: string
): Promise<FetchedVisionMedia | null> {
  if (!rawBuffer || rawBuffer.byteLength === 0) return null;

  // Reject HTML/JSON/plain-text error payloads early
  const headText = rawBuffer.subarray(0, 128).toString('utf8').trimStart().toLowerCase();
  if (
    headText.startsWith('<!doc') ||
    headText.startsWith('<html') ||
    headText.startsWith('{') ||
    headText.startsWith('[')
  ) {
    return null;
  }

  try {
    const instance = sharp(rawBuffer, { animated: false });
    const meta = await instance.metadata().catch(() => null);

    // 1x1 tracking pixels or tiny < 16px UI badges cannot contain a visible human face
    if (
      meta &&
      typeof meta.width === 'number' &&
      typeof meta.height === 'number' &&
      meta.width > 0 &&
      meta.height > 0 &&
      Math.max(meta.width, meta.height) < 16
    ) {
      return { skippedReason: 'Tiny UI icon or spacer' };
    }

    const resized = await instance
      .rotate()
      .resize({
        width: 384,
        height: 384,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 76, mozjpeg: true })
      .toBuffer();

    return { buffer: resized, mimeType: 'image/jpeg' };
  } catch {
    // If sharp failed to decode (e.g., malformed SVG/ICO/corrupt payload),
    // never pass arbitrary bytes labeled as JPEG to Gemini—only pass verified raster magic bytes.
    if (isSvgOrXmlPayload(rawBuffer, sourceHint)) {
      return { skippedReason: 'Vector graphic / icon' };
    }
    const verifiedMime = detectSupportedVisionMimeFromBytes(rawBuffer);
    if (!verifiedMime) {
      return null;
    }
    return { buffer: rawBuffer, mimeType: verifiedMime };
  }
}

async function fetchAndNormalizeImageForVision(
  item: HumanFaceScanInput,
  referer?: string,
  relayUrl?: string
): Promise<FetchedVisionMedia | null> {
  // 1. Check client-supplied previewDataUrl or inline data:image URI first
  const inlineCandidates = [item.previewDataUrl, item.thumbnailUrl, item.url, item.fallbackUrl];
  for (const candidate of inlineCandidates) {
    const decoded = decodeBase64DataImage(candidate);
    if (decoded) {
      const normalized = await normalizeBufferForFaceVision(decoded.buffer, candidate);
      if (normalized) return normalized;
    }
  }

  const effectiveReferer = (item.referer || referer || '').trim() || undefined;

  // 2. Try HTTP/HTTPS candidates via shared server LRU cache + detail-page fallback
  const candidates = Array.from(
    new Set(
      [item.thumbnailUrl, item.url, item.fallbackUrl].filter(
        (u): u is string => Boolean(u && /^https?:\/\//i.test(u))
      )
    )
  );

  const resolveDetailPageUrl = item.linkedPageUrl
    ? async (detailUrl: string) => {
        const subResp = await fetchDetailPageHtmlSmart(detailUrl, {
          relayUrl: relayUrl && detailUrl.includes(relayUrl) ? '' : relayUrl,
          timeoutMs: 9000,
        });
        if (!subResp.ok) return null;
        return extractBestImageFromDetailPage(subResp.html, subResp.url || detailUrl)?.url || null;
      }
    : undefined;

  for (let i = 0; i < candidates.length; i++) {
    const candidateUrl = candidates[i];
    const res = await resolveImageBufferWithFallbacks({
      imageUrl: candidateUrl,
      explicitReferer: effectiveReferer,
      relayUrl,
      fallbackUrl: item.fallbackUrl,
      linkedPageUrl: i === candidates.length - 1 || candidateUrl === item.url ? item.linkedPageUrl : undefined,
      minBytes: 64,
      resolveDetailPageUrl,
    });
    if (res?.buf && res.buf.byteLength >= 64) {
      const normalized = await normalizeBufferForFaceVision(res.buf, candidateUrl);
      if (normalized) return normalized;
    }
  }

  // 3. Last-resort detail-page lookup even if no direct HTTP thumbnail/full URL worked
  if (candidates.length === 0 && item.linkedPageUrl && resolveDetailPageUrl) {
    const resolvedUrl = await resolveDetailPageUrl(item.linkedPageUrl).catch(() => null);
    if (resolvedUrl && /^https?:\/\//i.test(resolvedUrl)) {
      const res = await resolveImageBufferWithFallbacks({
        imageUrl: resolvedUrl,
        explicitReferer: effectiveReferer,
        relayUrl,
        minBytes: 64,
      });
      if (res?.buf && res.buf.byteLength >= 64) {
        return normalizeBufferForFaceVision(res.buf, resolvedUrl);
      }
    }
  }

  return null;
}

export class HumanFaceFilterError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

export function mapGeminiFaceError(err: unknown): HumanFaceFilterError {
  if (err instanceof HumanFaceFilterError) return err;
  const raw = err instanceof Error ? err.message : String(err || 'Gemini AI vision error');
  const lower = raw.toLowerCase();

  if (lower.includes('api_key_invalid') || lower.includes('api key not valid')) {
    return new HumanFaceFilterError(
      'Gemini API key is invalid or missing. Check GEMINI_API_KEY in Settings > Secrets.',
      400
    );
  }
  if (lower.includes('permission_denied') || lower.includes('403')) {
    return new HumanFaceFilterError(
      'Gemini API permission denied. Check your API key permissions in Settings > Secrets.',
      403
    );
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return new HumanFaceFilterError(
      'Gemini API rate limit or quota reached. Please wait a moment and retry.',
      429
    );
  }
  if (
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('503') ||
    lower.includes('overloaded')
  ) {
    return new HumanFaceFilterError(
      'Gemini AI vision service is temporarily busy due to high demand. Please retry in a few seconds.',
      503
    );
  }
  return new HumanFaceFilterError(`AI face filter error: ${raw}`, 500);
}

const FACE_SCAN_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'Exact image ID provided in the prompt label.',
          },
          hasHumanFace: {
            type: Type.BOOLEAN,
            description:
              'True ONLY if at least one clearly visible human face (eyes, nose, mouth, or facial portrait) is present. False for nature landscapes, scenery, flowers, animals, objects, buildings, or images with no visible face.',
          },
          faceCount: {
            type: Type.INTEGER,
            description: 'Estimated number of visible human faces (0 if none).',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence score from 0.0 to 1.0.',
          },
          subjectSummary: {
            type: Type.STRING,
            description:
              'Very concise 2-5 word label of the image subject (e.g., "Portrait with face", "Mountain nature landscape", "Forest waterfall").',
          },
        },
        required: ['id', 'hasHumanFace', 'faceCount', 'confidence', 'subjectSummary'],
      },
    },
  },
  required: ['results'],
};

/**
 * Analyzes a batch of scraped images with Gemini 4 Hydrogen multimodal vision
 * to determine which images contain at least one human face vs. non-face backgrounds.
 */
export async function analyzeImagesForHumanFaces(
  inputs: HumanFaceScanInput[],
  options: {
    referer?: string;
    relayUrl?: string;
    deps?: HumanFaceFilterDependencies;
  } = {}
): Promise<{
  results: HumanFaceScanDecision[];
  cachedCount: number;
  scannedCount: number;
  errorCount: number;
}> {
  const { referer, relayUrl, deps } = options;
  const shouldUseCache = deps?.useCache !== undefined ? deps.useCache : !deps?.generateContentFn;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { results: [], cachedCount: 0, scannedCount: 0, errorCount: 0 };
  }

  const batch = inputs.slice(0, 12);
  const decisionsById = new Map<string, HumanFaceScanDecision>();
  const pendingToScan: HumanFaceScanInput[] = [];
  let cachedCount = 0;

  for (const item of batch) {
    const cacheKey = item.url || item.thumbnailUrl || '';
    if (shouldUseCache && cacheKey) {
      const cached = getCachedDecision(cacheKey);
      if (cached) {
        decisionsById.set(item.id, {
          id: item.id,
          hasHumanFace: cached.hasHumanFace,
          faceCount: cached.faceCount,
          confidence: cached.confidence,
          subjectSummary: cached.subjectSummary,
          cached: true,
        });
        cachedCount++;
        continue;
      }
    }
    pendingToScan.push(item);
  }

  let scannedCount = 0;
  let errorCount = 0;

  if (pendingToScan.length > 0) {
    const resolvedKey = (deps?.apiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
    if (!deps?.generateContentFn && !resolvedKey) {
      throw new HumanFaceFilterError(
        'GEMINI_API_KEY is not configured. Add it in Settings > Secrets to enable AI face filtering.',
        400
      );
    }

    const fetchImg =
      deps?.fetchImageFn ||
      ((item: HumanFaceScanInput) => fetchAndNormalizeImageForVision(item, referer, relayUrl));

    const fetched = await Promise.all(
      pendingToScan.map(async (item) => ({
        item,
        media: await fetchImg(item).catch(() => null),
      }))
    );

    const readyItems: Array<{ item: HumanFaceScanInput; media: { buffer: Buffer; mimeType: string } }> = [];

    for (const entry of fetched) {
      const m = entry.media;
      if (m && m.skippedReason) {
        const decision: HumanFaceScanDecision = {
          id: entry.item.id,
          hasHumanFace: false,
          faceCount: 0,
          confidence: 0.99,
          subjectSummary: m.skippedReason,
          cached: false,
        };
        decisionsById.set(entry.item.id, decision);
        const cacheKey = entry.item.url || entry.item.thumbnailUrl || '';
        if (shouldUseCache && cacheKey) {
          setCachedDecision(cacheKey, {
            hasHumanFace: decision.hasHumanFace,
            faceCount: decision.faceCount,
            confidence: decision.confidence,
            subjectSummary: decision.subjectSummary,
          });
        }
        scannedCount++;
      } else if (m && !m.skippedReason && m.buffer && m.buffer.byteLength > 0) {
        readyItems.push({
          item: entry.item,
          media: { buffer: m.buffer, mimeType: m.mimeType },
        });
      } else {
        errorCount++;
        decisionsById.set(entry.item.id, {
          id: entry.item.id,
          hasHumanFace: false,
          faceCount: 0,
          confidence: 0,
          subjectSummary: 'Image fetch unavailable',
          error: 'Could not download preview for inspection',
        });
      }
    }

    if (readyItems.length > 0) {
      const parts: Array<
        { text: string } | { inlineData: { mimeType: string; data: string } }
      > = [
        {
          text:
            'Inspect each labeled image below and determine whether it shows at least one visible human face. ' +
            'Return strict JSON matching the schema with an entry for every Image ID.\n' +
            'Rules:\n' +
            '- hasHumanFace = true ONLY when at least one human face (facial features/portrait/profile) is visible.\n' +
            '- hasHumanFace = false for nature backgrounds, landscapes, mountains, beaches, trees, flowers, skies, animals, abstract textures, food, vehicles, buildings, icons, or photos with no visible human face.\n' +
            '- Keep subjectSummary concise (2-5 words).',
        },
      ];

      for (const { item, media } of readyItems) {
        parts.push({
          text: `Image ID: "${item.id}" (filename: "${item.filename || 'image.jpg'}")`,
        });
        parts.push({
          inlineData: {
            mimeType: media.mimeType || 'image/jpeg',
            data: media.buffer.toString('base64'),
          },
        });
      }

      const callGenerate =
        deps?.generateContentFn ||
        (async (reqParams: { model: string; contents: unknown; config: unknown }) => {
          const ai = getGeminiClient(resolvedKey);
          return ai.models.generateContent(reqParams as any);
        });

      let responseText = '';
      let lastGenerateErr: unknown = null;
      const attempts = deps?.generateContentFn
        ? [{ model: HUMAN_FACE_FILTER_MODEL, thinkingLevel: ThinkingLevel.MINIMAL }]
        : [
            { model: HUMAN_FACE_FILTER_MODEL, thinkingLevel: ThinkingLevel.MINIMAL },
            { model: HUMAN_FACE_FILTER_MODEL, thinkingLevel: ThinkingLevel.MINIMAL },
            { model: HUMAN_FACE_FILTER_FALLBACK_MODEL, thinkingLevel: ThinkingLevel.LOW },
          ];
      for (let attempt = 0; attempt < attempts.length; attempt++) {
        const currentAttempt = attempts[attempt];
        try {
          const response = await callGenerate({
            model: currentAttempt.model,
            contents: { parts },
            config: {
              responseMimeType: 'application/json',
              responseSchema: FACE_SCAN_RESPONSE_SCHEMA,
              thinkingConfig: { thinkingLevel: currentAttempt.thinkingLevel },
            },
          });
          responseText = (response.text ?? '').trim();
          lastGenerateErr = null;
          break;
        } catch (err) {
          lastGenerateErr = err;
          const mapped = mapGeminiFaceError(err);
          const isTransient = mapped.status === 503 || mapped.status === 429;
          if (!isTransient || attempt + 1 >= attempts.length) {
            throw mapped;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      if (lastGenerateErr) {
        throw mapGeminiFaceError(lastGenerateErr);
      }

      let parsedResults: Array<Partial<HumanFaceScanDecision>> = [];
      try {
        const parsed = JSON.parse(responseText || '{}');
        if (Array.isArray(parsed?.results)) {
          parsedResults = parsed.results;
        }
      } catch {
        throw new HumanFaceFilterError(
          'Gemini returned malformed JSON for face detection batch.',
          502
        );
      }

      const byId = new Map<string, Partial<HumanFaceScanDecision>>();
      for (const row of parsedResults) {
        if (row && typeof row.id === 'string') {
          byId.set(row.id, row);
        }
      }

      readyItems.forEach(({ item }, idx) => {
        const matched = byId.get(item.id) || parsedResults[idx];
        const hasHumanFace = Boolean(matched?.hasHumanFace);
        const rawCount = Number(matched?.faceCount ?? (hasHumanFace ? 1 : 0));
        const rawConf = Number(matched?.confidence ?? 0.85);
        const summary =
          typeof matched?.subjectSummary === 'string' && matched.subjectSummary.trim()
            ? matched.subjectSummary.trim().slice(0, 60)
            : hasHumanFace
              ? 'Human face detected'
              : 'No human face';

        const decision: HumanFaceScanDecision = {
          id: item.id,
          hasHumanFace,
          faceCount: Number.isFinite(rawCount) ? Math.max(0, Math.round(rawCount)) : hasHumanFace ? 1 : 0,
          confidence: Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0.85,
          subjectSummary: summary,
          cached: false,
        };

        decisionsById.set(item.id, decision);
        const cacheKey = item.url || item.thumbnailUrl || '';
        if (shouldUseCache && cacheKey) {
          setCachedDecision(cacheKey, {
            hasHumanFace: decision.hasHumanFace,
            faceCount: decision.faceCount,
            confidence: decision.confidence,
            subjectSummary: decision.subjectSummary,
          });
        }
        scannedCount++;
      });
    }
  }

  return {
    results: batch.map(
      (item) =>
        decisionsById.get(item.id) || {
          id: item.id,
          hasHumanFace: false,
          faceCount: 0,
          confidence: 0,
          subjectSummary: 'Not classified',
        }
    ),
    cachedCount,
    scannedCount,
    errorCount,
  };
}
