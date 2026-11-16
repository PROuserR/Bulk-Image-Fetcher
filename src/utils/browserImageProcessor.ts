import {
  CropRect,
  ResizeConfig,
  OutputConfig,
  clampCropRect,
  computeTargetDimensions,
  resolveOutputExtension,
} from './imageTransformLogic';

export interface BrowserProcessedResult {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image for canvas processing.'));
    img.src = src;
  });
}

export async function processImageInBrowser(
  srcUrl: string,
  originalFilename: string,
  options: {
    cropEnabled: boolean;
    cropRect?: CropRect;
    resize: ResizeConfig;
    output: OutputConfig;
  }
): Promise<BrowserProcessedResult> {
  const img = await loadHtmlImage(srcUrl);
  const naturalW = Math.max(1, img.naturalWidth || img.width);
  const naturalH = Math.max(1, img.naturalHeight || img.height);

  const crop =
    options.cropEnabled && options.cropRect
      ? clampCropRect(options.cropRect, naturalW, naturalH)
      : { x: 0, y: 0, width: naturalW, height: naturalH };

  const target = computeTargetDimensions(crop.width, crop.height, options.resize);

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const { mime } = resolveOutputExtension(originalFilename, options.output.format);
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, target.width, target.height);
  }

  if (options.resize.mode === 'exact' && !options.resize.lockAspect && target.fit === 'cover') {
    const cropAspect = crop.width / crop.height;
    const targetAspect = target.width / target.height;
    let drawSrcX = crop.x;
    let drawSrcY = crop.y;
    let drawSrcW = crop.width;
    let drawSrcH = crop.height;

    if (cropAspect > targetAspect) {
      drawSrcW = Math.max(1, Math.round(crop.height * targetAspect));
      drawSrcX = crop.x + Math.round((crop.width - drawSrcW) / 2);
    } else if (cropAspect < targetAspect) {
      drawSrcH = Math.max(1, Math.round(crop.width / targetAspect));
      drawSrcY = crop.y + Math.round((crop.height - drawSrcH) / 2);
    }
    ctx.drawImage(img, drawSrcX, drawSrcY, drawSrcW, drawSrcH, 0, 0, target.width, target.height);
  } else if (
    options.resize.mode === 'exact' &&
    !options.resize.lockAspect &&
    target.fit === 'contain'
  ) {
    const scale = Math.min(target.width / crop.width, target.height / crop.height);
    const drawW = Math.max(1, Math.round(crop.width * scale));
    const drawH = Math.max(1, Math.round(crop.height * scale));
    const offsetX = Math.round((target.width - drawW) / 2);
    const offsetY = Math.round((target.height - drawH) / 2);
    ctx.drawImage(
      img,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      offsetX,
      offsetY,
      drawW,
      drawH
    );
  } else {
    ctx.drawImage(
      img,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      target.width,
      target.height
    );
  }

  const quality = Math.max(0.4, Math.min(1, (options.output.quality || 90) / 100));
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode processed image.'));
      },
      mime,
      mime === 'image/png' ? undefined : quality
    );
  });

  return {
    blob,
    width: target.width,
    height: target.height,
    mime,
  };
}

export interface SampleDirectoryAsset {
  relativePath: string;
  filename: string;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
}

/**
 * Generates deterministic local-folder sample plates offline (no external URL dependencies)
 * so users can immediately test folder structure, crop handles, and batch resize exports.
 */
export async function generateSampleDirectoryPlates(): Promise<SampleDirectoryAsset[]> {
  const specs = [
    {
      relativePath: 'landscape/alpine_horizon.jpg',
      width: 1600,
      height: 1066,
      mime: 'image/jpeg',
      format: 'jpeg',
      palette: ['#0f172a', '#1d4ed8', '#38bdf8', '#f8fafc'],
      label: 'ALPINE HORIZON',
    },
    {
      relativePath: 'portraits/editorial_frame.jpg',
      width: 1080,
      height: 1350,
      mime: 'image/jpeg',
      format: 'jpeg',
      palette: ['#18181b', '#52525b', '#e4e4e7', '#2563eb'],
      label: 'EDITORIAL STUDY',
    },
    {
      relativePath: 'architecture/concrete_grid.png',
      width: 1200,
      height: 1200,
      mime: 'image/png',
      format: 'png',
      palette: ['#090a0f', '#27272a', '#71717a', '#f4f4f5'],
      label: 'CONCRETE STUDY',
    },
    {
      relativePath: 'panoramas/coastal_dusk.webp',
      width: 1920,
      height: 1080,
      mime: 'image/webp',
      format: 'webp',
      palette: ['#0c1222', '#1e3a8a', '#f59e0b', '#fef3c7'],
      label: 'COASTAL DUSK',
    },
  ];

  const assets: SampleDirectoryAsset[] = [];

  for (const spec of specs) {
    const canvas = document.createElement('canvas');
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    const grad = ctx.createLinearGradient(0, 0, spec.width, spec.height);
    grad.addColorStop(0, spec.palette[0]);
    grad.addColorStop(0.55, spec.palette[1]);
    grad.addColorStop(1, spec.palette[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, spec.width, spec.height);

    // Subtle geometric darkroom composition elements
    ctx.fillStyle = spec.palette[3];
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.arc(spec.width * 0.68, spec.height * 0.36, Math.min(spec.width, spec.height) * 0.28, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.22;
    ctx.fillRect(spec.width * 0.08, spec.height * 0.62, spec.width * 0.84, spec.height * 0.24);

    // Crisp calibration grid & dimensions
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(32, 32, spec.width - 64, spec.height - 64);

    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(spec.width * 0.036)}px "Plus Jakarta Sans", system-ui, sans-serif`;
    ctx.fillText(spec.label, 64, Math.round(spec.height * 0.73));

    ctx.globalAlpha = 0.72;
    ctx.font = `500 ${Math.round(spec.width * 0.02)}px monospace`;
    ctx.fillText(`${spec.width} × ${spec.height} · ${spec.relativePath}`, 64, Math.round(spec.height * 0.79));

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b || new Blob()), spec.mime, 0.92)
    );
    const previewUrl = URL.createObjectURL(blob);
    const parts = spec.relativePath.split('/');
    assets.push({
      relativePath: spec.relativePath,
      filename: parts[parts.length - 1],
      previewUrl,
      width: spec.width,
      height: spec.height,
      sizeBytes: blob.size,
      format: spec.format,
    });
  }

  return assets;
}
