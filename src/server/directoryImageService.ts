/**
 * @module directoryImageService
 * Path-confined server filesystem image scanner and native `sharp` batch processor
 * backing `/api/crop-resize/*` endpoints.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  CropRect,
  NormalizedCropRect,
  ResizeConfig,
  OutputConfig,
  clampCropRect,
  denormalizeCropRect,
  computeTargetDimensions,
  buildOutputFilename,
} from '../utils/imageTransformLogic.ts';

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.tif',
  '.tiff',
  '.gif',
]);

const SKIPPED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'dist',
  '.playwright-cli',
  'output_cropped_resized',
  'cropped_resized',
]);

export interface ScannedDirectoryImage {
  relativePath: string;
  filename: string;
  sizeBytes: number;
  width: number;
  height: number;
  format: string;
}

export interface DirectoryProcessItem {
  relativePath: string;
  cropEnabled?: boolean;
  cropRect?: CropRect;
  normalizedCrop?: NormalizedCropRect;
}

export interface DirectoryProcessResultItem {
  relativePath: string;
  outputRelativePath: string;
  outputPath: string;
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
}

export function isSupportedImageFilename(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.has(ext);
}

export function isWithinRoot(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(candidatePath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export async function scanDirectoryImages(
  rootDir: string,
  options?: { recursive?: boolean; limit?: number }
): Promise<{ resolvedRoot: string; images: ScannedDirectoryImage[] }> {
  const trimmed = (rootDir || '').trim();
  if (!trimmed) {
    throw new Error('Directory path is required.');
  }

  const resolvedRoot = path.resolve(trimmed);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Directory not found: ${resolvedRoot}`);
  }

  const rootStat = fs.statSync(resolvedRoot);
  if (!rootStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedRoot}`);
  }

  const recursive = options?.recursive ?? true;
  const limit = Math.max(1, Math.min(500, options?.limit ?? 250));
  const candidateFiles: string[] = [];

  const walk = (currentDir: string) => {
    if (candidateFiles.length >= limit) return;
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (candidateFiles.length >= limit) break;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !SKIPPED_DIR_NAMES.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile() && isSupportedImageFilename(entry.name)) {
        candidateFiles.push(fullPath);
      }
    }
  };

  walk(resolvedRoot);

  const images: ScannedDirectoryImage[] = [];
  for (const fullPath of candidateFiles) {
    try {
      const stat = fs.statSync(fullPath);
      const metadata = await sharp(fullPath).metadata();
      const isRotatedExif =
        metadata.orientation && [5, 6, 7, 8].includes(metadata.orientation);
      const rawW = metadata.width || 0;
      const rawH = metadata.height || 0;
      const width = isRotatedExif ? rawH : rawW;
      const height = isRotatedExif ? rawW : rawH;
      if (!width || !height) continue;

      const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
      images.push({
        relativePath,
        filename: path.basename(fullPath),
        sizeBytes: stat.size,
        width,
        height,
        format: (metadata.format || path.extname(fullPath).slice(1) || 'jpeg').toLowerCase(),
      });
    } catch {
      // Skip unreadable or corrupted image files
    }
  }

  return { resolvedRoot, images };
}

export async function processSingleServerImage(
  inputPath: string,
  options: {
    cropEnabled?: boolean;
    cropRect?: CropRect;
    normalizedCrop?: NormalizedCropRect;
    resize: ResizeConfig;
    output: OutputConfig;
  }
): Promise<{ buffer: Buffer; width: number; height: number; format: string }> {
  const baseSharp = sharp(inputPath, { animated: false }).rotate();
  const orientedMeta = await baseSharp.clone().metadata();
  const isRotatedExif =
    orientedMeta.orientation && [5, 6, 7, 8].includes(orientedMeta.orientation);
  const rawW = orientedMeta.width || 1;
  const rawH = orientedMeta.height || 1;
  const srcW = isRotatedExif ? rawH : rawW;
  const srcH = isRotatedExif ? rawW : rawH;

  let pipeline = baseSharp;
  let workingW = srcW;
  let workingH = srcH;

  if (options.cropEnabled && (options.cropRect || options.normalizedCrop)) {
    const resolvedCrop = options.cropRect
      ? clampCropRect(options.cropRect, srcW, srcH)
      : denormalizeCropRect(options.normalizedCrop!, srcW, srcH);

    if (
      resolvedCrop.width > 0 &&
      resolvedCrop.height > 0 &&
      (resolvedCrop.x > 0 ||
        resolvedCrop.y > 0 ||
        resolvedCrop.width < srcW ||
        resolvedCrop.height < srcH)
    ) {
      pipeline = pipeline.extract({
        left: resolvedCrop.x,
        top: resolvedCrop.y,
        width: resolvedCrop.width,
        height: resolvedCrop.height,
      });
      workingW = resolvedCrop.width;
      workingH = resolvedCrop.height;
    }
  }

  const targetDims = computeTargetDimensions(workingW, workingH, options.resize);
  if (targetDims.width !== workingW || targetDims.height !== workingH) {
    pipeline = pipeline.resize({
      width: targetDims.width,
      height: targetDims.height,
      fit:
        targetDims.fit === 'cover'
          ? 'cover'
          : targetDims.fit === 'contain'
            ? 'inside'
            : 'fill',
      withoutEnlargement: options.resize.mode === 'maxEdge',
    });
  }

  const quality = Math.max(40, Math.min(100, Math.round(options.output.quality || 90)));
  let targetFmt = options.output.format;
  if (targetFmt === 'keep') {
    const origFmt = (orientedMeta.format || 'jpeg').toLowerCase();
    if (origFmt === 'png') targetFmt = 'png';
    else if (origFmt === 'webp') targetFmt = 'webp';
    else targetFmt = 'jpeg';
  }

  if (targetFmt === 'png') {
    pipeline = pipeline.png({ compressionLevel: 8 });
  } else if (targetFmt === 'webp') {
    pipeline = pipeline.webp({ quality });
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    width: info.width,
    height: info.height,
    format: info.format,
  };
}

export async function processDirectoryImages(params: {
  sourceDir: string;
  outputDir?: string;
  items: DirectoryProcessItem[];
  resize: ResizeConfig;
  output: OutputConfig;
  overwrite?: boolean;
}): Promise<{
  resolvedSourceDir: string;
  resolvedOutputDir: string;
  processed: DirectoryProcessResultItem[];
  errors: { relativePath: string; error: string }[];
}> {
  const resolvedSourceDir = path.resolve((params.sourceDir || '').trim());
  if (!fs.existsSync(resolvedSourceDir) || !fs.statSync(resolvedSourceDir).isDirectory()) {
    throw new Error(`Source directory not found: ${resolvedSourceDir}`);
  }

  const resolvedOutputDir = params.overwrite
    ? resolvedSourceDir
    : path.resolve(
        /*turbopackIgnore: true*/ (params.outputDir || '').trim() ||
          path.join(resolvedSourceDir, 'output_cropped_resized')
      );

  fs.mkdirSync(resolvedOutputDir, { recursive: true });

  const processed: DirectoryProcessResultItem[] = [];
  const errors: { relativePath: string; error: string }[] = [];

  for (const item of params.items) {
    try {
      const inputPath = path.resolve(resolvedSourceDir, item.relativePath);
      if (!isWithinRoot(resolvedSourceDir, inputPath) || !fs.existsSync(inputPath)) {
        errors.push({ relativePath: item.relativePath, error: 'File outside directory or missing' });
        continue;
      }

      const result = await processSingleServerImage(inputPath, {
        cropEnabled: item.cropEnabled,
        cropRect: item.cropRect,
        normalizedCrop: item.normalizedCrop,
        resize: params.resize,
        output: params.output,
      });

      const outRel = buildOutputFilename(item.relativePath, params.output);
      const outPath = path.resolve(resolvedOutputDir, outRel);
      if (!isWithinRoot(resolvedOutputDir, outPath)) {
        errors.push({ relativePath: item.relativePath, error: 'Invalid output relative path' });
        continue;
      }

      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, result.buffer);

      processed.push({
        relativePath: item.relativePath,
        outputRelativePath: outRel,
        outputPath: outPath,
        width: result.width,
        height: result.height,
        sizeBytes: result.buffer.length,
        format: result.format,
      });
    } catch (err: any) {
      errors.push({
        relativePath: item.relativePath,
        error: err?.message || 'Processing failed',
      });
    }
  }

  return {
    resolvedSourceDir,
    resolvedOutputDir,
    processed,
    errors,
  };
}
