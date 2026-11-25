/**
 * @module imageProcessService
 * Stateless server-side image processing pipeline backing `POST /api/process`.
 * Combines `sharp` orientation/crop/resize/encode with `imageFilterLogic` color grading
 * (8 studio presets + 14 tone/clarity/grain adjustments), strict SSRF-safe URL validation,
 * and optional Gemini AI human-face detection.
 */
import net from 'net';
import sharp, { type Metadata, type Sharp } from 'sharp';
import {
  buildPresetAdjustments,
  clampNum,
  COLOR_PRESETS,
  DEFAULT_ADJUSTMENTS,
  hasActiveAdjustments,
  sanitizeAdjustments,
  applyPixelAdjustmentsToRgba,
  applyUnsharpSharpenToRgba,
  type ColorPresetId,
  type ImageAdjustmentState,
} from '../utils/imageFilterLogic.ts';
import {
  clampCropRect,
  computeTargetDimensions,
  denormalizeCropRect,
  type CropRect,
  type NormalizedCropRect,
  type ResizeConfig,
  type ResizeFit,
  type ResizeMode,
} from '../utils/imageTransformLogic.ts';
import {
  analyzeImagesForHumanFaces,
  decodeBase64DataImage,
  type HumanFaceScanDecision,
} from './humanFaceFilterService.ts';
import { DEFAULT_USER_AGENT, IMAGE_ACCEPT_HEADER } from './fetchHelpers.ts';

/** Maximum accepted remote or uploaded input payload size (25 MB). */
export const MAX_PROCESS_IMAGE_BYTES = 25 * 1024 * 1024;
/** Maximum allowed output pixel dimension on either axis. */
export const MAX_PROCESS_DIMENSION = 8192;

export type ProcessOutputFormat = 'keep' | 'jpeg' | 'png' | 'webp' | 'avif';

/** Structured error thrown with HTTP status code on invalid input or upstream fetch failure. */
export class ImageProcessError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ProcessCropInput {
  /** Pixel coordinates on the source image */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Normalized 0..1 coordinates relative to the source image */
  xRatio?: number;
  yRatio?: number;
  widthRatio?: number;
  heightRatio?: number;
}

export interface ProcessResizeInput {
  mode?: ResizeMode;
  width?: number;
  height?: number;
  maxEdge?: number;
  percent?: number;
  lockAspect?: boolean;
  fit?: ResizeFit;
}

export interface ProcessImageRequestOptions {
  preset: ColorPresetId;
  adjustments: ImageAdjustmentState;
  crop?: ProcessCropInput;
  resize: ResizeConfig;
  format: ProcessOutputFormat;
  quality: number;
  responseType: 'binary' | 'json';
  detectFaces: boolean;
}

export interface ProcessImageOutput {
  buffer: Buffer;
  format: Exclude<ProcessOutputFormat, 'keep'>;
  mimeType: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sizeBytes: number;
  appliedPreset: ColorPresetId;
  faceDetection?: HumanFaceScanDecision | null;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // Multicast & reserved
  return false;
}

function isPrivateOrReservedIp(hostname: string): boolean {
  const cleaned = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!cleaned) return true;
  if (cleaned === 'localhost' || cleaned.endsWith('.localhost') || cleaned.endsWith('.local') || cleaned.endsWith('.internal')) {
    return true;
  }
  const ipVer = net.isIP(cleaned);
  if (ipVer === 4) {
    return isPrivateOrReservedIpv4(cleaned);
  }
  if (ipVer === 6) {
    if (cleaned === '::1' || cleaned === '::' || cleaned.startsWith('fc') || cleaned.startsWith('fd') || cleaned.startsWith('fe80')) {
      return true;
    }
    const v4Mapped = cleaned.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped) {
      return isPrivateOrReservedIpv4(v4Mapped[1]);
    }
  }
  return false;
}

/**
 * Validates that a remote image URL uses `http:` or `https:` and does not target
 * loopback, link-local metadata, or private RFC1918 networks.
 */
export function assertSafePublicHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL((rawUrl || '').trim());
  } catch {
    throw new ImageProcessError('Invalid imageUrl supplied.', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ImageProcessError('imageUrl must use http:// or https:// protocol.', 400);
  }
  if (parsed.username || parsed.password) {
    throw new ImageProcessError('Embedded credentials in imageUrl are not allowed.', 400);
  }
  if (isPrivateOrReservedIp(parsed.hostname)) {
    throw new ImageProcessError('imageUrl targeting private or loopback network addresses is not permitted.', 400);
  }
  return parsed;
}

/**
 * Validates and normalizes request parameters for `POST /api/process`.
 */
export function parseProcessRequestOptions(raw: Record<string, any> = {}): ProcessImageRequestOptions {
  const rawPreset = typeof raw.preset === 'string' ? raw.preset.trim() : 'original';
  const validPresetIds = new Set<string>(COLOR_PRESETS.map((p) => p.id));
  const preset: ColorPresetId = validPresetIds.has(rawPreset)
    ? (rawPreset as ColorPresetId)
    : 'original';

  const baseFromPreset = buildPresetAdjustments(preset);
  const rawAdj = raw.adjustments && typeof raw.adjustments === 'object' ? raw.adjustments : {};
  const adjustments = sanitizeAdjustments({
    ...baseFromPreset,
    ...rawAdj,
  });

  const rawFormat = typeof raw.format === 'string' ? raw.format.toLowerCase().trim() : 'keep';
  const formatMap: Record<string, ProcessOutputFormat> = {
    keep: 'keep',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    avif: 'avif',
  };
  const format: ProcessOutputFormat = formatMap[rawFormat] || 'keep';

  const quality = Math.round(clampNum(Number(raw.quality ?? 90), 40, 100));

  const rawResize: ProcessResizeInput =
    raw.resize && typeof raw.resize === 'object' ? raw.resize : {};
  const allowedModes = new Set<ResizeMode>(['original', 'exact', 'maxEdge', 'percent']);
  const mode: ResizeMode =
    typeof rawResize.mode === 'string' && allowedModes.has(rawResize.mode as ResizeMode)
      ? (rawResize.mode as ResizeMode)
      : rawResize.maxEdge
        ? 'maxEdge'
        : rawResize.width || rawResize.height
          ? 'exact'
          : rawResize.percent
            ? 'percent'
            : 'original';

  const allowedFits = new Set<ResizeFit>(['cover', 'contain', 'fill']);
  const fit: ResizeFit =
    typeof rawResize.fit === 'string' && allowedFits.has(rawResize.fit as ResizeFit)
      ? (rawResize.fit as ResizeFit)
      : 'cover';

  const resize: ResizeConfig = {
    mode,
    width: Math.round(clampNum(Number(rawResize.width ?? 1200), 1, MAX_PROCESS_DIMENSION)),
    height: Math.round(clampNum(Number(rawResize.height ?? 1200), 1, MAX_PROCESS_DIMENSION)),
    maxEdge: Math.round(clampNum(Number(rawResize.maxEdge ?? 1600), 1, MAX_PROCESS_DIMENSION)),
    percent: Math.round(clampNum(Number(rawResize.percent ?? 100), 1, 400)),
    lockAspect: rawResize.lockAspect !== undefined ? Boolean(rawResize.lockAspect) : !(rawResize.width && rawResize.height),
    fit,
  };

  let crop: ProcessCropInput | undefined;
  if (raw.crop && typeof raw.crop === 'object') {
    crop = raw.crop as ProcessCropInput;
  }

  const responseType =
    typeof raw.responseType === 'string' && raw.responseType.toLowerCase() === 'json'
      ? 'json'
      : 'binary';

  return {
    preset,
    adjustments,
    crop,
    resize,
    format,
    quality,
    responseType,
    detectFaces: Boolean(raw.detectFaces),
  };
}

/**
 * Fetches an external image buffer safely after verifying public URL rules and size limits.
 */
export async function fetchPublicImageBuffer(rawUrl: string): Promise<Buffer> {
  const safeUrl = assertSafePublicHttpUrl(rawUrl);
  const resp = await fetch(safeUrl.href, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: IMAGE_ACCEPT_HEADER,
      Referer: `${safeUrl.origin}/`,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });

  if (resp.url) {
    assertSafePublicHttpUrl(resp.url);
  }

  if (!resp.ok) {
    throw new ImageProcessError(`Upstream image host returned HTTP ${resp.status}.`, 502);
  }

  const lenHeader = Number(resp.headers.get('content-length') || 0);
  if (lenHeader > MAX_PROCESS_IMAGE_BYTES) {
    throw new ImageProcessError('Remote image exceeds the 25 MB processing limit.', 413);
  }

  const arrayBuf = await resp.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  if (buf.byteLength === 0) {
    throw new ImageProcessError('Remote image response was empty.', 422);
  }
  if (buf.byteLength > MAX_PROCESS_IMAGE_BYTES) {
    throw new ImageProcessError('Remote image exceeds the 25 MB processing limit.', 413);
  }
  return buf;
}

/** Decodes an inline `data:image/*;base64,...` or raw base64 string into an image Buffer. */
export function decodeInputBase64Image(rawBase64: string): Buffer {
  const trimmed = (rawBase64 || '').trim();
  if (!trimmed) {
    throw new ImageProcessError('Empty imageBase64 payload.', 400);
  }
  const fromDataUri = decodeBase64DataImage(trimmed);
  const buffer = fromDataUri ? fromDataUri.buffer : Buffer.from(trimmed, 'base64');
  if (!buffer || buffer.byteLength === 0) {
    throw new ImageProcessError('Could not decode base64 image payload.', 400);
  }
  if (buffer.byteLength > MAX_PROCESS_IMAGE_BYTES) {
    throw new ImageProcessError('Input image exceeds the 25 MB processing limit.', 413);
  }
  return buffer;
}

function applyRadialVignetteToRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  vignettePercent: number
): void {
  const strength = clampNum(vignettePercent / 100, 0, 1) * 0.78;
  if (strength <= 0.01) return;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const normDist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const falloff = Math.max(0, (normDist - 0.35) / 0.65);
      const factor = 1 - strength * falloff * falloff;
      const idx = (y * width + x) * 4;
      rgba[idx] = Math.max(0, Math.round(rgba[idx] * factor));
      rgba[idx + 1] = Math.max(0, Math.round(rgba[idx + 1] * factor));
      rgba[idx + 2] = Math.max(0, Math.round(rgba[idx + 2] * factor));
    }
  }
}

function resolvePixelOrNormalizedCrop(
  crop: ProcessCropInput,
  srcW: number,
  srcH: number
): CropRect {
  if (
    crop.xRatio !== undefined ||
    crop.yRatio !== undefined ||
    crop.widthRatio !== undefined ||
    crop.heightRatio !== undefined
  ) {
    const norm: NormalizedCropRect = {
      xRatio: clampNum(Number(crop.xRatio ?? 0), 0, 0.99),
      yRatio: clampNum(Number(crop.yRatio ?? 0), 0, 0.99),
      widthRatio: clampNum(Number(crop.widthRatio ?? 1), 0.01, 1),
      heightRatio: clampNum(Number(crop.heightRatio ?? 1), 0.01, 1),
    };
    return denormalizeCropRect(norm, srcW, srcH);
  }

  return clampCropRect(
    {
      x: Number(crop.x ?? 0),
      y: Number(crop.y ?? 0),
      width: Number(crop.width ?? srcW),
      height: Number(crop.height ?? srcH),
    },
    srcW,
    srcH
  );
}

/**
 * Executes crop, resize, color grading, sharpening/blur/vignette, output encoding,
 * and optional Gemini AI face inspection on an input image buffer.
 */
export async function processImageBuffer(
  inputBuffer: Buffer,
  options: ProcessImageRequestOptions,
  deps?: {
    analyzeFacesFn?: typeof analyzeImagesForHumanFaces;
  }
): Promise<ProcessImageOutput> {
  if (!inputBuffer || inputBuffer.byteLength === 0) {
    throw new ImageProcessError('Input image buffer is empty.', 400);
  }

  let baseSharp: Sharp;
  let orientedMeta: Metadata;
  try {
    baseSharp = sharp(inputBuffer, { animated: false }).rotate();
    orientedMeta = await baseSharp.clone().metadata();
  } catch {
    throw new ImageProcessError('Unsupported or corrupted image payload.', 422);
  }

  const isRotatedExif =
    orientedMeta.orientation && [5, 6, 7, 8].includes(orientedMeta.orientation);
  const rawW = orientedMeta.width || 0;
  const rawH = orientedMeta.height || 0;
  const srcW = isRotatedExif ? rawH : rawW;
  const srcH = isRotatedExif ? rawW : rawH;
  if (!srcW || !srcH) {
    throw new ImageProcessError('Unable to determine image dimensions.', 422);
  }

  let pipeline = baseSharp;
  let workingW = srcW;
  let workingH = srcH;

  if (options.crop) {
    const resolvedCrop = resolvePixelOrNormalizedCrop(options.crop, srcW, srcH);
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
  const clampedW = Math.min(MAX_PROCESS_DIMENSION, Math.max(1, targetDims.width));
  const clampedH = Math.min(MAX_PROCESS_DIMENSION, Math.max(1, targetDims.height));

  if (clampedW !== workingW || clampedH !== workingH) {
    pipeline = pipeline.resize({
      width: clampedW,
      height: clampedH,
      fit:
        targetDims.fit === 'cover'
          ? 'cover'
          : targetDims.fit === 'contain'
            ? 'inside'
            : 'fill',
      withoutEnlargement: options.resize.mode === 'maxEdge',
    });
  }

  // Apply Gaussian blur via sharp if requested
  if (options.adjustments.blur > 0) {
    const sigma = clampNum(options.adjustments.blur, 0.3, 20);
    pipeline = pipeline.blur(sigma);
  }

  // Apply deterministic pixel shader when any non-blur adjustment is active
  const needsPixelPass = hasActiveAdjustments({
    ...options.adjustments,
    blur: 0,
  });

  if (needsPixelPass) {
    let rawDecoded: { data: Buffer; info: { width: number; height: number } };
    try {
      rawDecoded = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new ImageProcessError('Unsupported or corrupted image payload.', 422);
    }
    const { data, info } = rawDecoded;

    const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    applyPixelAdjustmentsToRgba(rgba, info.width, info.height, {
      ...DEFAULT_ADJUSTMENTS,
      ...options.adjustments,
      blur: 0,
    });
    if (options.adjustments.sharpen > 0) {
      applyUnsharpSharpenToRgba(rgba, info.width, info.height, options.adjustments.sharpen);
    }
    if (options.adjustments.vignette > 0) {
      applyRadialVignetteToRgba(rgba, info.width, info.height, options.adjustments.vignette);
    }

    pipeline = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    });
  }

  let targetFmt: Exclude<ProcessOutputFormat, 'keep'>;
  if (options.format === 'keep') {
    const origFmt = (orientedMeta.format || 'jpeg').toLowerCase();
    if (origFmt === 'png') targetFmt = 'png';
    else if (origFmt === 'webp') targetFmt = 'webp';
    else if (origFmt === 'avif') targetFmt = 'avif';
    else targetFmt = 'jpeg';
  } else {
    targetFmt = options.format;
  }

  if (targetFmt === 'png') {
    pipeline = pipeline.png({ compressionLevel: 8 });
  } else if (targetFmt === 'webp') {
    pipeline = pipeline.webp({ quality: options.quality });
  } else if (targetFmt === 'avif') {
    pipeline = pipeline.avif({ quality: Math.min(90, options.quality) });
  } else {
    pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: options.quality, mozjpeg: true });
  }

  let finalOutput: { data: Buffer; info: { width: number; height: number } };
  try {
    finalOutput = await pipeline.toBuffer({ resolveWithObject: true });
  } catch {
    throw new ImageProcessError('Unsupported or corrupted image payload.', 422);
  }
  const { data: outputBuffer, info: outputInfo } = finalOutput;
  const mimeMap: Record<Exclude<ProcessOutputFormat, 'keep'>, string> = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
  };

  let faceDetection: HumanFaceScanDecision | null | undefined;
  if (options.detectFaces) {
    const faceFn = deps?.analyzeFacesFn || analyzeImagesForHumanFaces;
    const dataUri = `data:${mimeMap[targetFmt]};base64,${outputBuffer.toString('base64')}`;
    const scanOutcome = await faceFn([
      {
        id: 'processed_image',
        url: 'inline://processed-image',
        previewDataUrl: dataUri,
        filename: `processed.${targetFmt === 'jpeg' ? 'jpg' : targetFmt}`,
      },
    ]);
    faceDetection = scanOutcome.results[0] || null;
  }

  return {
    buffer: outputBuffer,
    format: targetFmt,
    mimeType: mimeMap[targetFmt],
    width: outputInfo.width,
    height: outputInfo.height,
    sourceWidth: srcW,
    sourceHeight: srcH,
    sizeBytes: outputBuffer.byteLength,
    appliedPreset: options.preset,
    faceDetection,
  };
}
