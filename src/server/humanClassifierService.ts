import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import JSZip from 'jszip';
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
import {
  getPythonClassifierWorker,
  OfflineClassifierError,
} from './pythonClassifierWorker.ts';

export const OFFLINE_CLASSIFIER_ENGINE = 'python-offline-insightface-mediapipe';
export { OfflineClassifierError };

export interface AnalyzeBatchImageInput {
  imageId: string;
  filename: string;
  mimeType?: string;
  base64Data?: string;
  filePath?: string;
}

export interface OfflineRunnerLike {
  runCommand: <T = any>(
    cmd: 'analyze-batch' | 'cluster' | 'ping',
    payload: Record<string, unknown>,
    timeoutMs?: number
  ) => Promise<T>;
}

export function mapClassifierError(err: unknown): OfflineClassifierError {
  if (err instanceof OfflineClassifierError) return err;
  const rawMessage = err instanceof Error ? err.message : String(err || 'Unknown AI error');
  const lower = rawMessage.toLowerCase();

  if (lower.includes('no such file') || lower.includes('not found') || lower.includes('missing')) {
    return new OfflineClassifierError(
      `Offline Python AI runtime or model missing: ${rawMessage}`,
      500
    );
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return new OfflineClassifierError(
      `Offline Python AI processing timed out: ${rawMessage}`,
      504
    );
  }
  return new OfflineClassifierError(rawMessage, 500);
}

export async function analyzeHumanImageBatch(
  images: AnalyzeBatchImageInput[],
  workerRunner?: OfflineRunnerLike
): Promise<HumanImageBiometricProfile[]> {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }

  const worker = workerRunner ?? getPythonClassifierWorker();
  const safeBatch = images.slice(0, 16).map((item) => ({
    imageId: item.imageId,
    filename: item.filename,
    mimeType: item.mimeType || 'image/jpeg',
    ...(item.filePath ? { filePath: item.filePath } : { base64Data: item.base64Data || '' }),
  }));

  const data = await worker.runCommand<{ profiles?: HumanImageBiometricProfile[] }>(
    'analyze-batch',
    { images: safeBatch },
    180_000
  );

  const parsed = Array.isArray(data?.profiles) ? data.profiles : [];
  const parsedById = new Map<string, HumanImageBiometricProfile>();
  for (const row of parsed) {
    if (row && typeof row.imageId === 'string') {
      parsedById.set(row.imageId, row);
    }
  }

  return safeBatch.map((input, idx) => {
    const matched = parsedById.get(input.imageId) || parsed[idx];
    const hasHuman = typeof matched?.hasHuman === 'boolean' ? matched.hasHuman : false;
    const rawConf = typeof matched?.confidence === 'number' ? matched.confidence : 0.75;

    return {
      imageId: input.imageId,
      filename: input.filename,
      hasHuman,
      faceCount: typeof matched?.faceCount === 'number' ? matched.faceCount : hasHuman ? 1 : 0,
      visibility: String(matched?.visibility || (hasHuman ? 'upper_body' : 'no_human')),
      apparentPresentation: String(matched?.apparentPresentation || 'unknown'),
      estimatedAgeRange: String(matched?.estimatedAgeRange || 'unknown'),
      facialStructure: {
        faceShape: String(matched?.facialStructure?.faceShape || 'obscured'),
        jawline: String(matched?.facialStructure?.jawline || 'obscured'),
        cheekbones: String(matched?.facialStructure?.cheekbones || 'obscured'),
        foreheadHeight: String(matched?.facialStructure?.foreheadHeight || 'obscured'),
        browAndEyes: String(matched?.facialStructure?.browAndEyes || 'obscured'),
        noseStructure: String(matched?.facialStructure?.noseStructure || 'obscured'),
        facialHairOrMarks: String(matched?.facialStructure?.facialHairOrMarks || 'none'),
      },
      bodyProportions: {
        somatotype: String(matched?.bodyProportions?.somatotype || 'obscured'),
        shoulderToHipRatio: String(matched?.bodyProportions?.shoulderToHipRatio || 'obscured'),
        statureAndLimbRatio: String(matched?.bodyProportions?.statureAndLimbRatio || 'obscured'),
        buildSummary: String(matched?.bodyProportions?.buildSummary || 'obscured'),
      },
      biometricSignature: String(
        matched?.biometricSignature || 'Offline facial and skeletal profile extracted.'
      ),
      confidence: Math.max(0, Math.min(1, Number.isFinite(rawConf) ? rawConf : 0.75)),
      ...(Array.isArray(matched?.faceEmbedding) ? { faceEmbedding: matched.faceEmbedding } : {}),
      ...(Array.isArray(matched?.faceGeometryVector)
        ? { faceGeometryVector: matched.faceGeometryVector }
        : {}),
      ...(Array.isArray(matched?.bodyVector) ? { bodyVector: matched.bodyVector } : {}),
    };
  });
}

export async function clusterHumanProfilesOffline(
  profiles: HumanImageBiometricProfile[],
  folderNamingMode: FolderNamingMode = 'indexed',
  workerRunner?: OfflineRunnerLike
): Promise<{ clusters: IdentityCluster[]; manifest: ClassificationManifest }> {
  const humanProfiles = profiles.filter((p) => p.hasHuman);
  let rawClusters: RawClusterAssignment[] = [];

  if (humanProfiles.length > 0) {
    const worker = workerRunner ?? getPythonClassifierWorker();
    const data = await worker.runCommand<{ clusters?: RawClusterAssignment[] }>(
      'cluster',
      { profiles: humanProfiles },
      60_000
    );
    rawClusters = Array.isArray(data?.clusters) ? data.clusters : [];
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
