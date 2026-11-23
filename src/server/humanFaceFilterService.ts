import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import sharp from 'sharp';
import { resolveImageBufferWithFallbacks } from './fetchHelpers';

export const HUMAN_FACE_FILTER_MODEL = 'gemini-4-hydrogen';

export interface HumanFaceScanInput {
  id: string;
  url: string;
  thumbnailUrl?: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  filename?: string;
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

export interface HumanFaceFilterDependencies {
  apiKey?: string;
  generateContentFn?: (params: {
    model: string;
    contents: unknown;
    config: unknown;
  }) => Promise<{ text?: string }>;
  fetchImageFn?: (item: HumanFaceScanInput) => Promise<{ buffer: Buffer; mimeType: string } | null>;
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

async function fetchAndNormalizeImageForVision(
  item: HumanFaceScanInput,
  referer?: string,
  relayUrl?: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // Prefer existing preview/thumbnail or full URL from shared server LRU cache
  const candidates = Array.from(
    new Set(
      [item.thumbnailUrl, item.url, item.fallbackUrl].filter(
        (u): u is string => Boolean(u && /^https?:\/\//i.test(u))
      )
    )
  );

  let rawBuffer: Buffer | null = null;
  for (const candidateUrl of candidates) {
    const res = await resolveImageBufferWithFallbacks({
      imageUrl: candidateUrl,
      explicitReferer: referer,
      relayUrl,
      fallbackUrl: item.fallbackUrl,
      linkedPageUrl: item.linkedPageUrl,
      minBytes: 256,
    });
    if (res?.buf && res.buf.byteLength >= 256) {
      rawBuffer = res.buf;
      break;
    }
  }

  if (!rawBuffer) return null;

  try {
    const resized = await sharp(rawBuffer, { animated: false })
      .rotate()
      .resize({
        width: 512,
        height: 512,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();

    return { buffer: resized, mimeType: 'image/jpeg' };
  } catch {
    // Fallback to raw buffer if sharp cannot decode exotic format (e.g. small WebP/PNG)
    return { buffer: rawBuffer, mimeType: 'image/jpeg' };
  }
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
}> {
  const { referer, relayUrl, deps } = options;
  const shouldUseCache = deps?.useCache !== undefined ? deps.useCache : !deps?.generateContentFn;

  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { results: [], cachedCount: 0, scannedCount: 0 };
  }

  const batch = inputs.slice(0, 12);
  const decisionsById = new Map<string, HumanFaceScanDecision>();
  const pendingToScan: HumanFaceScanInput[] = [];
  let cachedCount = 0;

  for (const item of batch) {
    if (shouldUseCache) {
      const cached = getCachedDecision(item.url);
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

    const readyItems = fetched.filter(
      (entry): entry is { item: HumanFaceScanInput; media: { buffer: Buffer; mimeType: string } } =>
        Boolean(entry.media && entry.media.buffer.byteLength > 0)
    );

    for (const entry of fetched) {
      if (!entry.media || entry.media.buffer.byteLength === 0) {
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
      const maxAttempts = deps?.generateContentFn ? 1 : 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const response = await callGenerate({
            model: HUMAN_FACE_FILTER_MODEL,
            contents: { parts },
            config: {
              responseMimeType: 'application/json',
              responseSchema: FACE_SCAN_RESPONSE_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
          responseText = (response.text ?? '').trim();
          lastGenerateErr = null;
          break;
        } catch (err) {
          lastGenerateErr = err;
          const mapped = mapGeminiFaceError(err);
          const isTransient = mapped.status === 503 || mapped.status === 429;
          if (!isTransient || attempt + 1 >= maxAttempts) {
            throw mapped;
          }
          await new Promise((r) => setTimeout(r, 1200));
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
        if (shouldUseCache) {
          setCachedDecision(item.url, {
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
  };
}
