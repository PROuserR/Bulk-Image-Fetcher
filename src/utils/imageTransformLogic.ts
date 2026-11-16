export type AspectRatioPreset = 'free' | '1:1' | '16:9' | '4:3' | '3:2' | '4:5' | '9:16';

export type ResizeMode = 'original' | 'exact' | 'maxEdge' | 'percent';

export type ResizeFit = 'cover' | 'contain' | 'fill';

export type OutputFormat = 'keep' | 'jpeg' | 'png' | 'webp';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedCropRect {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
}

export interface ResizeConfig {
  mode: ResizeMode;
  width: number;
  height: number;
  maxEdge: number;
  percent: number;
  lockAspect: boolean;
  fit: ResizeFit;
}

export interface OutputConfig {
  format: OutputFormat;
  quality: number; // 50 - 100
  suffix: string;
  preserveSubfolders: boolean;
}

export const ASPECT_RATIO_VALUES: Record<AspectRatioPreset, number | null> = {
  free: null,
  '1:1': 1,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '3:2': 3 / 2,
  '4:5': 4 / 5,
  '9:16': 9 / 16,
};

export function clampCropRect(rect: CropRect, sourceW: number, sourceH: number): CropRect {
  const safeSrcW = Math.max(1, Math.round(sourceW));
  const safeSrcH = Math.max(1, Math.round(sourceH));

  const width = Math.max(1, Math.min(safeSrcW, Math.round(rect.width)));
  const height = Math.max(1, Math.min(safeSrcH, Math.round(rect.height)));
  const x = Math.max(0, Math.min(safeSrcW - width, Math.round(rect.x)));
  const y = Math.max(0, Math.min(safeSrcH - height, Math.round(rect.y)));

  return { x, y, width, height };
}

export function computeAspectLockedCrop(
  sourceW: number,
  sourceH: number,
  preset: AspectRatioPreset
): CropRect {
  const safeW = Math.max(1, Math.round(sourceW));
  const safeH = Math.max(1, Math.round(sourceH));
  const targetRatio = ASPECT_RATIO_VALUES[preset];

  if (!targetRatio) {
    return { x: 0, y: 0, width: safeW, height: safeH };
  }

  const currentRatio = safeW / safeH;
  let cropW = safeW;
  let cropH = safeH;

  if (currentRatio > targetRatio) {
    cropH = safeH;
    cropW = Math.max(1, Math.round(safeH * targetRatio));
  } else {
    cropW = safeW;
    cropH = Math.max(1, Math.round(safeW / targetRatio));
  }

  return clampCropRect(
    {
      x: Math.round((safeW - cropW) / 2),
      y: Math.round((safeH - cropH) / 2),
      width: cropW,
      height: cropH,
    },
    safeW,
    safeH
  );
}

export function normalizeCropRect(
  rect: CropRect,
  sourceW: number,
  sourceH: number
): NormalizedCropRect {
  const safeW = Math.max(1, sourceW);
  const safeH = Math.max(1, sourceH);
  const clamped = clampCropRect(rect, safeW, safeH);
  return {
    xRatio: clamped.x / safeW,
    yRatio: clamped.y / safeH,
    widthRatio: clamped.width / safeW,
    heightRatio: clamped.height / safeH,
  };
}

export function denormalizeCropRect(
  norm: NormalizedCropRect,
  targetW: number,
  targetH: number
): CropRect {
  const safeW = Math.max(1, Math.round(targetW));
  const safeH = Math.max(1, Math.round(targetH));
  return clampCropRect(
    {
      x: Math.round(norm.xRatio * safeW),
      y: Math.round(norm.yRatio * safeH),
      width: Math.round(norm.widthRatio * safeW),
      height: Math.round(norm.heightRatio * safeH),
    },
    safeW,
    safeH
  );
}

export function computeTargetDimensions(
  croppedW: number,
  croppedH: number,
  config: ResizeConfig
): { width: number; height: number; fit: ResizeFit } {
  const srcW = Math.max(1, Math.round(croppedW));
  const srcH = Math.max(1, Math.round(croppedH));

  if (config.mode === 'original') {
    return { width: srcW, height: srcH, fit: 'fill' };
  }

  if (config.mode === 'percent') {
    const scale = Math.max(1, Math.min(400, Number(config.percent) || 100)) / 100;
    return {
      width: Math.max(1, Math.round(srcW * scale)),
      height: Math.max(1, Math.round(srcH * scale)),
      fit: 'fill',
    };
  }

  if (config.mode === 'maxEdge') {
    const limit = Math.max(1, Math.round(Number(config.maxEdge) || Math.max(srcW, srcH)));
    const longest = Math.max(srcW, srcH);
    if (longest <= limit) {
      return { width: srcW, height: srcH, fit: 'contain' };
    }
    const ratio = limit / longest;
    return {
      width: Math.max(1, Math.round(srcW * ratio)),
      height: Math.max(1, Math.round(srcH * ratio)),
      fit: 'contain',
    };
  }

  // mode === 'exact'
  const reqW = Math.max(1, Math.round(Number(config.width) || srcW));
  const reqH = Math.max(1, Math.round(Number(config.height) || srcH));

  if (config.lockAspect) {
    const aspect = srcW / srcH;
    return {
      width: reqW,
      height: Math.max(1, Math.round(reqW / aspect)),
      fit: 'fill',
    };
  }

  return {
    width: reqW,
    height: reqH,
    fit: config.fit || 'cover',
  };
}

export function resolveOutputExtension(
  originalFilename: string,
  format: OutputFormat
): { ext: string; mime: string } {
  if (format === 'jpeg') return { ext: 'jpg', mime: 'image/jpeg' };
  if (format === 'png') return { ext: 'png', mime: 'image/png' };
  if (format === 'webp') return { ext: 'webp', mime: 'image/webp' };

  const match = originalFilename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const origExt = match ? match[1] : 'jpg';
  if (origExt === 'png') return { ext: 'png', mime: 'image/png' };
  if (origExt === 'webp') return { ext: 'webp', mime: 'image/webp' };
  if (origExt === 'gif') return { ext: 'png', mime: 'image/png' };
  return { ext: 'jpg', mime: 'image/jpeg' };
}

export function buildOutputFilename(relativePath: string, options: OutputConfig): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  const rawName = parts.pop() || 'image.jpg';
  const dotIdx = rawName.lastIndexOf('.');
  const baseName = dotIdx > 0 ? rawName.slice(0, dotIdx) : rawName;
  const cleanSuffix = (options.suffix || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const { ext } = resolveOutputExtension(rawName, options.format);
  const finalFilename = `${baseName}${cleanSuffix}.${ext}`;

  if (options.preserveSubfolders && parts.length > 0) {
    return `${parts.join('/')}/${finalFilename}`;
  }
  return finalFilename;
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}
