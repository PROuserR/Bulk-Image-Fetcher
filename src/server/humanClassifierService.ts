import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  buildClassificationManifest,
  ClassificationManifest,
  FolderNamingMode,
  HumanImageBiometricProfile,
  IdentityCluster,
  normalizeClusterAssignments,
  RawClusterAssignment,
  resolveUniqueFilenames,
  sanitizeFolderName,
} from '../utils/humanClassifierLogic.ts';
import { isWithinRoot } from './directoryImageService.ts';

export const GEMINI_CLASSIFIER_MODEL = 'gemini-4-hydrogen';

export interface AnalyzeBatchImageInput {
  imageId: string;
  filename: string;
  mimeType: string;
  base64Data: string;
}

export class GeminiClassifierError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'GeminiClassifierError';
    this.status = status;
  }
}

export function createGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new GeminiClassifierError(
      'GEMINI_API_KEY is not configured. Check your API key in Settings > Secrets.',
      400
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function mapGeminiError(err: unknown): GeminiClassifierError {
  if (err instanceof GeminiClassifierError) return err;
  const rawMessage = err instanceof Error ? err.message : String(err || 'Unknown AI error');
  const lower = rawMessage.toLowerCase();

  if (
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('403') ||
    lower.includes('401')
  ) {
    return new GeminiClassifierError(
      'Gemini API authentication failed. Please verify your API key in Settings > Secrets.',
      403
    );
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return new GeminiClassifierError(
      'Gemini API rate limit or quota reached (429). Wait briefly before retrying or check your quota in Settings > Secrets.',
      429
    );
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return new GeminiClassifierError(
      `Gemini model "${GEMINI_CLASSIFIER_MODEL}" returned not found (404): ${rawMessage}`,
      404
    );
  }
  return new GeminiClassifierError(rawMessage, 500);
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const mapped = mapGeminiError(err);
      const isTransient = mapped.status === 429 || mapped.status === 500;
      if (!isTransient || attempt === maxAttempts) {
        throw mapped;
      }
      const delayMs = 650 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw mapGeminiError(lastErr);
}

export async function analyzeHumanImageBatch(
  images: AnalyzeBatchImageInput[],
  aiClient?: GoogleGenAI
): Promise<HumanImageBiometricProfile[]> {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }

  const ai = aiClient ?? createGeminiClient();
  const safeBatch = images.slice(0, 8);

  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [
    {
      text: [
        'Analyze each numbered image below to extract invariant biometric descriptors of the primary human subject based strictly on FACIAL STRUCTURE and BODY PROPORTIONS.',
        'Ignore transient clothing colors, backgrounds, camera lighting, and temporary poses when describing identity anatomy.',
        'If two images inside this same batch appear to depict the exact same individual, give them the exact same short batchLocalGroupHint (e.g. "batch_person_A"); otherwise give unique hints.',
        'If an image contains no clear human (e.g., scenery, object, animal, blank), set hasHuman=false and visibility="no_human".',
        '',
        'Images in this batch:',
        ...safeBatch.map(
          (img, idx) => `Image ${idx + 1}: imageId="${img.imageId}", filename="${img.filename}"`
        ),
      ].join('\n'),
    },
  ];

  for (let idx = 0; idx < safeBatch.length; idx++) {
    const item = safeBatch[idx];
    const cleanBase64 = item.base64Data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    parts.push({
      text: `--- Image ${idx + 1} (imageId: ${item.imageId}, filename: ${item.filename}) ---`,
    });
    parts.push({
      inlineData: {
        mimeType: item.mimeType || 'image/jpeg',
        data: cleanBase64,
      },
    });
  }

  const response = await withGeminiRetry(() =>
    ai.models.generateContent({
      model: GEMINI_CLASSIFIER_MODEL,
      contents: { parts },
      config: {
        systemInstruction:
          'You are an anthropometric vision classifier analyzing facial structure and human body proportions. Return strictly structured JSON matching the schema with one entry per input imageId.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              imageId: { type: Type.STRING },
              hasHuman: { type: Type.BOOLEAN },
              faceCount: { type: Type.INTEGER },
              visibility: { type: Type.STRING },
              apparentPresentation: { type: Type.STRING },
              estimatedAgeRange: { type: Type.STRING },
              facialStructure: {
                type: Type.OBJECT,
                properties: {
                  faceShape: { type: Type.STRING },
                  jawline: { type: Type.STRING },
                  cheekbones: { type: Type.STRING },
                  foreheadHeight: { type: Type.STRING },
                  browAndEyes: { type: Type.STRING },
                  noseStructure: { type: Type.STRING },
                  facialHairOrMarks: { type: Type.STRING },
                },
                required: [
                  'faceShape',
                  'jawline',
                  'cheekbones',
                  'foreheadHeight',
                  'browAndEyes',
                  'noseStructure',
                  'facialHairOrMarks',
                ],
              },
              bodyProportions: {
                type: Type.OBJECT,
                properties: {
                  somatotype: { type: Type.STRING },
                  shoulderToHipRatio: { type: Type.STRING },
                  statureAndLimbRatio: { type: Type.STRING },
                  buildSummary: { type: Type.STRING },
                },
                required: [
                  'somatotype',
                  'shoulderToHipRatio',
                  'statureAndLimbRatio',
                  'buildSummary',
                ],
              },
              biometricSignature: { type: Type.STRING },
              batchLocalGroupHint: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
            },
            required: [
              'imageId',
              'hasHuman',
              'faceCount',
              'visibility',
              'apparentPresentation',
              'estimatedAgeRange',
              'facialStructure',
              'bodyProportions',
              'biometricSignature',
              'confidence',
            ],
          },
        },
      },
    })
  );

  const rawText = (response.text ?? '[]').trim();
  let parsed: any[] = [];
  try {
    const json = JSON.parse(rawText);
    if (Array.isArray(json)) parsed = json;
  } catch {
    parsed = [];
  }

  const parsedById = new Map<string, any>();
  for (const row of parsed) {
    if (row && typeof row.imageId === 'string') {
      parsedById.set(row.imageId, row);
    }
  }

  return safeBatch.map((input, idx) => {
    const matched = parsedById.get(input.imageId) || parsed[idx] || {};
    const hasHuman = typeof matched.hasHuman === 'boolean' ? matched.hasHuman : true;
    const rawConf = typeof matched.confidence === 'number' ? matched.confidence : 0.75;
    return {
      imageId: input.imageId,
      filename: input.filename,
      hasHuman,
      faceCount: typeof matched.faceCount === 'number' ? matched.faceCount : hasHuman ? 1 : 0,
      visibility: String(matched.visibility || (hasHuman ? 'upper_body' : 'no_human')),
      apparentPresentation: String(matched.apparentPresentation || 'unknown'),
      estimatedAgeRange: String(matched.estimatedAgeRange || 'unknown'),
      facialStructure: {
        faceShape: String(matched.facialStructure?.faceShape || 'obscured'),
        jawline: String(matched.facialStructure?.jawline || 'obscured'),
        cheekbones: String(matched.facialStructure?.cheekbones || 'obscured'),
        foreheadHeight: String(matched.facialStructure?.foreheadHeight || 'obscured'),
        browAndEyes: String(matched.facialStructure?.browAndEyes || 'obscured'),
        noseStructure: String(matched.facialStructure?.noseStructure || 'obscured'),
        facialHairOrMarks: String(matched.facialStructure?.facialHairOrMarks || 'none'),
      },
      bodyProportions: {
        somatotype: String(matched.bodyProportions?.somatotype || 'obscured'),
        shoulderToHipRatio: String(matched.bodyProportions?.shoulderToHipRatio || 'obscured'),
        statureAndLimbRatio: String(matched.bodyProportions?.statureAndLimbRatio || 'obscured'),
        buildSummary: String(matched.bodyProportions?.buildSummary || 'obscured'),
      },
      biometricSignature: String(
        matched.biometricSignature || 'Facial and somatic profile extracted from image.'
      ),
      batchLocalGroupHint: matched.batchLocalGroupHint
        ? String(matched.batchLocalGroupHint)
        : undefined,
      confidence: Math.max(0, Math.min(1, Number.isFinite(rawConf) ? rawConf : 0.75)),
    };
  });
}

export async function clusterHumanProfilesWithGemini(
  profiles: HumanImageBiometricProfile[],
  folderNamingMode: FolderNamingMode = 'indexed',
  aiClient?: GoogleGenAI
): Promise<{ clusters: IdentityCluster[]; manifest: ClassificationManifest }> {
  const humanProfiles = profiles.filter((p) => p.hasHuman);
  let rawClusters: RawClusterAssignment[] = [];

  if (humanProfiles.length > 0) {
    const ai = aiClient ?? createGeminiClient();
    const compactCatalog = humanProfiles.map((p) => ({
      imageId: p.imageId,
      filename: p.filename,
      presentation: p.apparentPresentation,
      age: p.estimatedAgeRange,
      visibility: p.visibility,
      face: p.facialStructure,
      body: p.bodyProportions,
      signature: p.biometricSignature,
      batchHint: p.batchLocalGroupHint,
    }));

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: GEMINI_CLASSIFIER_MODEL,
        contents: [
          'Group all imageIds below into unique human identity clusters so that photos of the SAME individual are placed together in one folder and DIFFERENT individuals are placed in separate folders.',
          'Match strictly by invariant facial structure (faceShape, jawline, cheekbones, foreheadHeight, browAndEyes, noseStructure, permanent marks/facial hair) AND body proportions (somatotype, shoulderToHipRatio, statureAndLimbRatio, buildSummary).',
          'Rules:',
          '1. Every single input imageId MUST appear in exactly one cluster.',
          '2. Do NOT merge distinct individuals simply because they share gender or age range — compare jawline, brow/eye/nose structure, cheekbones, and skeletal body frame carefully.',
          '3. Ignore batchHint numbers across different batches except to confirm same-batch matches.',
          '4. In matchRationale and summary, cite human-readable facial/body anatomy and filenames (never internal imageId keys).',
          '',
          JSON.stringify(compactCatalog),
        ].join('\n'),
        config: {
          systemInstruction:
            'You perform high-precision cross-image human identity clustering from structured facial geometry and body proportion profiles. Output valid JSON matching the schema.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                displayName: { type: Type.STRING },
                summary: { type: Type.STRING },
                dominantFaceShape: { type: Type.STRING },
                dominantSomatotype: { type: Type.STRING },
                matchRationale: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                imageIds: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'displayName',
                'summary',
                'dominantFaceShape',
                'dominantSomatotype',
                'matchRationale',
                'confidence',
                'imageIds',
              ],
            },
          },
        },
      })
    );

    const rawText = (response.text ?? '[]').trim();
    try {
      const parsed = JSON.parse(rawText);
      if (Array.isArray(parsed)) {
        rawClusters = parsed;
      }
    } catch {
      rawClusters = [];
    }
  }

  const clusters = normalizeClusterAssignments(profiles, rawClusters, folderNamingMode);
  const profileMap = new Map(profiles.map((p) => [p.imageId, p]));
  const manifest = buildClassificationManifest(clusters, profileMap);
  return { clusters, manifest };
}

export async function buildDiskImageThumbnail(
  absolutePath: string
): Promise<{ mimeType: string; base64Data: string }> {
  const buf = await sharp(absolutePath, { animated: false })
    .rotate()
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return {
    mimeType: 'image/jpeg',
    base64Data: buf.toString('base64'),
  };
}

export async function writeClassifiedDiskFolders(params: {
  sourceDir: string;
  outputDir?: string;
  clusters: IdentityCluster[];
  profiles: HumanImageBiometricProfile[];
  imageRelativePaths: Record<string, string>;
}): Promise<{
  resolvedSourceDir: string;
  resolvedOutputDir: string;
  manifest: ClassificationManifest;
  writtenFilesCount: number;
}> {
  const resolvedSourceDir = path.resolve((params.sourceDir || '').trim());
  if (!fs.existsSync(resolvedSourceDir) || !fs.statSync(resolvedSourceDir).isDirectory()) {
    throw new Error(`Source directory not found: ${resolvedSourceDir}`);
  }

  const resolvedOutputDir = path.resolve(
    /*turbopackIgnore: true*/ (params.outputDir || '').trim() ||
      path.join(resolvedSourceDir, 'classified_humans')
  );
  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const profileMap = new Map(params.profiles.map((p) => [p.imageId, p]));
  const manifest = buildClassificationManifest(params.clusters, profileMap);

  let writtenFilesCount = 0;

  for (const folder of manifest.folders) {
    const safeFolder = sanitizeFolderName(folder.folderName, folder.clusterId);
    const folderDir = path.resolve(resolvedOutputDir, safeFolder);
    if (!isWithinRoot(resolvedOutputDir, folderDir)) continue;
    fs.mkdirSync(folderDir, { recursive: true });

    const deduped = resolveUniqueFilenames(
      folder.files.map((f) => ({
        imageId: f.imageId,
        filename: path.basename(params.imageRelativePaths[f.imageId] || f.originalFilename),
        relPath: params.imageRelativePaths[f.imageId] || f.originalFilename,
      }))
    );

    for (const item of deduped) {
      const srcPath = path.resolve(resolvedSourceDir, item.relPath);
      if (!isWithinRoot(resolvedSourceDir, srcPath) || !fs.existsSync(srcPath)) continue;
      const destPath = path.resolve(folderDir, item.safeFilename);
      if (!isWithinRoot(folderDir, destPath)) continue;
      fs.copyFileSync(srcPath, destPath);
      writtenFilesCount++;
    }
  }

  const manifestPath = path.resolve(resolvedOutputDir, 'classification_manifest.json');
  if (isWithinRoot(resolvedOutputDir, manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  return {
    resolvedSourceDir,
    resolvedOutputDir,
    manifest,
    writtenFilesCount,
  };
}

export async function buildClassifiedDiskZip(params: {
  sourceDir: string;
  clusters: IdentityCluster[];
  profiles: HumanImageBiometricProfile[];
  imageRelativePaths: Record<string, string>;
}): Promise<Buffer> {
  const resolvedSourceDir = path.resolve((params.sourceDir || '').trim());
  if (!fs.existsSync(resolvedSourceDir) || !fs.statSync(resolvedSourceDir).isDirectory()) {
    throw new Error(`Source directory not found: ${resolvedSourceDir}`);
  }

  const profileMap = new Map(params.profiles.map((p) => [p.imageId, p]));
  const manifest = buildClassificationManifest(params.clusters, profileMap);
  const zip = new JSZip();

  for (const folder of manifest.folders) {
    const safeFolder = sanitizeFolderName(folder.folderName, folder.clusterId);
    const deduped = resolveUniqueFilenames(
      folder.files.map((f) => ({
        imageId: f.imageId,
        filename: path.basename(params.imageRelativePaths[f.imageId] || f.originalFilename),
        relPath: params.imageRelativePaths[f.imageId] || f.originalFilename,
      }))
    );

    for (const item of deduped) {
      const srcPath = path.resolve(resolvedSourceDir, item.relPath);
      if (!isWithinRoot(resolvedSourceDir, srcPath) || !fs.existsSync(srcPath)) continue;
      const data = fs.readFileSync(srcPath);
      zip.file(`${safeFolder}/${item.safeFilename}`, data);
    }
  }

  zip.file('classification_manifest.json', JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}
