export type ColorPresetId =
  | 'original'
  | 'bw_noir'
  | 'vintage_sepia'
  | 'golden_hour'
  | 'crisp_vivid'
  | 'matte_film'
  | 'cool_nordic'
  | 'cyber_neon';

export type SnapLensId =
  | 'none'
  | 'puppy'
  | 'flower_crown'
  | 'heart_blush'
  | 'rainbow_mouth'
  | 'cool_shades'
  | 'butterfly_crown'
  | 'vhs_cam'
  | 'big_head'
  | 'comic_pop';

export interface ImageAdjustmentState {
  brightness: number; // -100 .. 100
  contrast: number; // -100 .. 100
  saturation: number; // -100 .. 100
  exposure: number; // -100 .. 100
  warmth: number; // -100 .. 100
  tint: number; // -100 .. 100
  grayscale: number; // 0 .. 100
  sepia: number; // 0 .. 100
  hueRotate: number; // -180 .. 180
  blur: number; // 0 .. 20 px
  sharpen: number; // 0 .. 100
  vignette: number; // 0 .. 100
  grain: number; // 0 .. 100
  invert: number; // 0 .. 100
}

export interface FaceAnchor {
  /** Normalized 0..1 face center X relative to image width */
  centerX: number;
  /** Normalized 0..1 face center Y relative to image height */
  centerY: number;
  /** Normalized face width relative to image width (0.12 .. 0.9) */
  widthRatio: number;
  /** Roll tilt angle in degrees (-45 .. 45) */
  tiltDeg: number;
  /** How anchor was produced */
  source: 'auto' | 'manual' | 'default';
}

export interface SnapLensState {
  lensId: SnapLensId;
  intensity: number; // 0 .. 100
  faceAnchor: FaceAnchor;
}

export interface FilterRecipe {
  presetId: ColorPresetId;
  adjustments: ImageAdjustmentState;
  lens: SnapLensState;
}

export const DEFAULT_ADJUSTMENTS: ImageAdjustmentState = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  warmth: 0,
  tint: 0,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  invert: 0,
};

export const DEFAULT_FACE_ANCHOR: FaceAnchor = {
  centerX: 0.5,
  centerY: 0.36,
  widthRatio: 0.38,
  tiltDeg: 0,
  source: 'default',
};

export const DEFAULT_FILTER_RECIPE: FilterRecipe = {
  presetId: 'original',
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  lens: {
    lensId: 'none',
    intensity: 90,
    faceAnchor: { ...DEFAULT_FACE_ANCHOR },
  },
};

export interface ColorPresetMeta {
  id: ColorPresetId;
  label: string;
  tagline: string;
  swatch: [string, string];
  values: Partial<ImageAdjustmentState>;
}

export const COLOR_PRESETS: ColorPresetMeta[] = [
  {
    id: 'original',
    label: 'Original',
    tagline: 'Neutral balanced output',
    swatch: ['#52525b', '#a1a1aa'],
    values: {},
  },
  {
    id: 'bw_noir',
    label: 'B&W Noir',
    tagline: 'High-contrast monochrome + grain',
    swatch: ['#09090b', '#e4e4e7'],
    values: { grayscale: 100, contrast: 28, brightness: -4, vignette: 35, grain: 18 },
  },
  {
    id: 'vintage_sepia',
    label: 'Vintage Sepia',
    tagline: 'Warm archival silver print',
    swatch: ['#78350f', '#fde68a'],
    values: { sepia: 82, warmth: 24, contrast: -8, brightness: 4, vignette: 38, grain: 15 },
  },
  {
    id: 'golden_hour',
    label: 'Golden Hour',
    tagline: 'Sunlit amber & vivid warmth',
    swatch: ['#d97706', '#fef08a'],
    values: { warmth: 38, saturation: 22, exposure: 10, contrast: 12, vignette: 18 },
  },
  {
    id: 'crisp_vivid',
    label: 'Crisp Vivid',
    tagline: 'Punchy clarity & rich color',
    swatch: ['#2563eb', '#38bdf8'],
    values: { contrast: 20, saturation: 26, sharpen: 42, exposure: 6 },
  },
  {
    id: 'matte_film',
    label: 'Matte Film',
    tagline: 'Faded cinema stocks & soft grain',
    swatch: ['#475569', '#cbd5e1'],
    values: { contrast: -18, brightness: 10, saturation: -14, warmth: 12, grain: 24, vignette: 24 },
  },
  {
    id: 'cool_nordic',
    label: 'Cool Nordic',
    tagline: 'Crisp winter slate & teal',
    swatch: ['#0e7490', '#bae6fd'],
    values: { warmth: -34, tint: -10, contrast: 14, saturation: -8, sharpen: 20 },
  },
  {
    id: 'cyber_neon',
    label: 'Cyber Neon',
    tagline: 'Electric hue shift & deep punch',
    swatch: ['#7c3aed', '#ec4899'],
    values: { contrast: 32, saturation: 46, hueRotate: -22, tint: 28, vignette: 34 },
  },
];

export interface SnapLensMeta {
  id: SnapLensId;
  label: string;
  category: 'Face AR' | 'Optical FX';
  description: string;
  needsFaceAnchor: boolean;
  accentColor: string;
}

export const SNAP_LENSES: SnapLensMeta[] = [
  {
    id: 'none',
    label: 'No Lens',
    category: 'Optical FX',
    description: 'Color & tone adjustments only',
    needsFaceAnchor: false,
    accentColor: '#71717a',
  },
  {
    id: 'puppy',
    label: 'Puppy Ears',
    category: 'Face AR',
    description: 'Floppy ears, nose bridge & warm glow',
    needsFaceAnchor: true,
    accentColor: '#d97706',
  },
  {
    id: 'flower_crown',
    label: 'Flower Crown',
    category: 'Face AR',
    description: 'Blooming halo crown & sunlit bokeh',
    needsFaceAnchor: true,
    accentColor: '#ec4899',
  },
  {
    id: 'heart_blush',
    label: 'Heart Blush',
    category: 'Face AR',
    description: 'Rosy cheeks, heart eyes & sparkles',
    needsFaceAnchor: true,
    accentColor: '#e11d48',
  },
  {
    id: 'rainbow_mouth',
    label: 'Rainbow Aura',
    category: 'Face AR',
    description: 'Cascading prism ribbon & star eyes',
    needsFaceAnchor: true,
    accentColor: '#2563eb',
  },
  {
    id: 'cool_shades',
    label: 'Cool Shades',
    category: 'Face AR',
    description: 'Reflective aviators & retro grade',
    needsFaceAnchor: true,
    accentColor: '#0284c7',
  },
  {
    id: 'butterfly_crown',
    label: 'Gold Butterflies',
    category: 'Face AR',
    description: 'Golden crown arc & luminous motes',
    needsFaceAnchor: true,
    accentColor: '#f59e0b',
  },
  {
    id: 'vhs_cam',
    label: '90s VHS',
    category: 'Optical FX',
    description: 'Chromatic shift, scanlines & REC HUD',
    needsFaceAnchor: false,
    accentColor: '#dc2626',
  },
  {
    id: 'big_head',
    label: 'Fisheye Bulge',
    category: 'Face AR',
    description: 'Spherical wide-angle bulge distortion',
    needsFaceAnchor: true,
    accentColor: '#7c3aed',
  },
  {
    id: 'comic_pop',
    label: 'Comic Pop',
    category: 'Optical FX',
    description: 'Bold ink edges, poster color & halftone',
    needsFaceAnchor: false,
    accentColor: '#0d9488',
  },
];

export function clampNum(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function buildPresetAdjustments(presetId: ColorPresetId): ImageAdjustmentState {
  const preset = COLOR_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { ...DEFAULT_ADJUSTMENTS };
  return sanitizeAdjustments({
    ...DEFAULT_ADJUSTMENTS,
    ...preset.values,
  });
}

export function sanitizeAdjustments(
  input: Partial<ImageAdjustmentState>
): ImageAdjustmentState {
  return {
    brightness: Math.round(clampNum(input.brightness ?? 0, -100, 100)),
    contrast: Math.round(clampNum(input.contrast ?? 0, -100, 100)),
    saturation: Math.round(clampNum(input.saturation ?? 0, -100, 100)),
    exposure: Math.round(clampNum(input.exposure ?? 0, -100, 100)),
    warmth: Math.round(clampNum(input.warmth ?? 0, -100, 100)),
    tint: Math.round(clampNum(input.tint ?? 0, -100, 100)),
    grayscale: Math.round(clampNum(input.grayscale ?? 0, 0, 100)),
    sepia: Math.round(clampNum(input.sepia ?? 0, 0, 100)),
    hueRotate: Math.round(clampNum(input.hueRotate ?? 0, -180, 180)),
    blur: Math.round(clampNum(input.blur ?? 0, 0, 20) * 10) / 10,
    sharpen: Math.round(clampNum(input.sharpen ?? 0, 0, 100)),
    vignette: Math.round(clampNum(input.vignette ?? 0, 0, 100)),
    grain: Math.round(clampNum(input.grain ?? 0, 0, 100)),
    invert: Math.round(clampNum(input.invert ?? 0, 0, 100)),
  };
}

export function sanitizeFaceAnchor(anchor: Partial<FaceAnchor>): FaceAnchor {
  return {
    centerX: clampNum(anchor.centerX ?? DEFAULT_FACE_ANCHOR.centerX, 0.05, 0.95),
    centerY: clampNum(anchor.centerY ?? DEFAULT_FACE_ANCHOR.centerY, 0.05, 0.95),
    widthRatio: clampNum(anchor.widthRatio ?? DEFAULT_FACE_ANCHOR.widthRatio, 0.12, 0.9),
    tiltDeg: Math.round(clampNum(anchor.tiltDeg ?? 0, -45, 45)),
    source: anchor.source || 'manual',
  };
}

export function hasActiveAdjustments(adj: ImageAdjustmentState): boolean {
  return (Object.keys(DEFAULT_ADJUSTMENTS) as (keyof ImageAdjustmentState)[]).some(
    (k) => adj[k] !== DEFAULT_ADJUSTMENTS[k]
  );
}

export function countActiveEffects(recipe: FilterRecipe): number {
  let count = 0;
  for (const k of Object.keys(DEFAULT_ADJUSTMENTS) as (keyof ImageAdjustmentState)[]) {
    if (recipe.adjustments[k] !== DEFAULT_ADJUSTMENTS[k]) count++;
  }
  if (recipe.lens.lensId !== 'none' && recipe.lens.intensity > 0) count++;
  return count;
}

/**
 * Builds an accurate CSS `filter` string covering tone, grayscale, sepia, contrast,
 * brightness, saturation, hue-rotate, invert, and gaussian blur.
 */
export function buildCssFilterString(
  adj: ImageAdjustmentState,
  blurScale = 1
): string {
  const parts: string[] = [];

  // Combine brightness + exposure cleanly
  const brightFactor = clampNum(1 + adj.brightness / 100 + adj.exposure / 160, 0.15, 2.5);
  if (Math.abs(brightFactor - 1) > 0.005) {
    parts.push(`brightness(${brightFactor.toFixed(3)})`);
  }

  const contrastFactor = clampNum(1 + adj.contrast / 100, 0.2, 2.5);
  if (Math.abs(contrastFactor - 1) > 0.005) {
    parts.push(`contrast(${contrastFactor.toFixed(3)})`);
  }

  const satFactor = clampNum(1 + adj.saturation / 100, 0, 2.5);
  if (Math.abs(satFactor - 1) > 0.005) {
    parts.push(`saturate(${satFactor.toFixed(3)})`);
  }

  if (adj.grayscale > 0) {
    parts.push(`grayscale(${clampNum(adj.grayscale / 100, 0, 1).toFixed(3)})`);
  }
  if (adj.sepia > 0) {
    parts.push(`sepia(${clampNum(adj.sepia / 100, 0, 1).toFixed(3)})`);
  }
  if (adj.hueRotate !== 0) {
    parts.push(`hue-rotate(${Math.round(adj.hueRotate)}deg)`);
  }
  if (adj.invert > 0) {
    parts.push(`invert(${clampNum(adj.invert / 100, 0, 1).toFixed(3)})`);
  }
  if (adj.blur > 0) {
    const px = clampNum(adj.blur * blurScale, 0, 40);
    parts.push(`blur(${px.toFixed(2)}px)`);
  }

  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * Deterministic per-pixel adjustment shader applied cleanly on RGBA buffers
 * (handles Grayscale, Sepia, Brightness, Contrast, Saturation, Exposure, Warmth,
 * Tint, Invert, and optional Film Grain). Pure function so both browser Canvas and
 * unit tests verify exact pixel math.
 */
export function applyPixelAdjustmentsToRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  adj: ImageAdjustmentState
): void {
  const len = width * height * 4;
  const expGain = Math.pow(2, clampNum(adj.exposure, -100, 100) / 100);
  const brightOffset = clampNum(adj.brightness, -100, 100) * 1.45;
  const contrastFactor = Math.pow((100 + clampNum(adj.contrast, -95, 100)) / 100, 1.35);
  const satFactor = clampNum(1 + adj.saturation / 100, 0, 2.5);
  const warmthR = clampNum(adj.warmth, -100, 100) * 0.42;
  const warmthB = -warmthR;
  const tintG = -clampNum(adj.tint, -100, 100) * 0.32;
  const grayMix = clampNum(adj.grayscale / 100, 0, 1);
  const sepiaMix = clampNum(adj.sepia / 100, 0, 1);
  const invertMix = clampNum(adj.invert / 100, 0, 1);
  const hueRad = (clampNum(adj.hueRotate, -180, 180) * Math.PI) / 180;
  const applyHue = Math.abs(adj.hueRotate) >= 1;
  const cosH = Math.cos(hueRad);
  const sinH = Math.sin(hueRad);

  const grainAmp = clampNum(adj.grain, 0, 100) * 0.45;

  for (let i = 0; i < len; i += 4) {
    let r = rgba[i];
    let g = rgba[i + 1];
    let b = rgba[i + 2];

    // 1. Exposure + Brightness
    if (adj.exposure !== 0 || adj.brightness !== 0) {
      r = r * expGain + brightOffset;
      g = g * expGain + brightOffset;
      b = b * expGain + brightOffset;
    }

    // 2. Warmth & Tint
    if (adj.warmth !== 0 || adj.tint !== 0) {
      r += warmthR;
      g += tintG;
      b += warmthB;
    }

    // 3. Contrast around midpoint 128
    if (adj.contrast !== 0) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }

    // 4. Hue Rotate (3x3 YIQ/luminance-preserving rotation matrix)
    if (applyHue) {
      const m00 = 0.213 + cosH * 0.787 - sinH * 0.213;
      const m01 = 0.715 - cosH * 0.715 - sinH * 0.715;
      const m02 = 0.072 - cosH * 0.072 + sinH * 0.928;
      const m10 = 0.213 - cosH * 0.213 + sinH * 0.143;
      const m11 = 0.715 + cosH * 0.285 + sinH * 0.14;
      const m12 = 0.072 - cosH * 0.072 - sinH * 0.283;
      const m20 = 0.213 - cosH * 0.213 - sinH * 0.787;
      const m21 = 0.715 - cosH * 0.715 + sinH * 0.715;
      const m22 = 0.072 + cosH * 0.928 + sinH * 0.072;

      const nr = r * m00 + g * m01 + b * m02;
      const ng = r * m10 + g * m11 + b * m12;
      const nb = r * m20 + g * m21 + b * m22;
      r = nr;
      g = ng;
      b = nb;
    }

    // 5. Saturation
    if (adj.saturation !== 0) {
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * satFactor;
      g = lum + (g - lum) * satFactor;
      b = lum + (b - lum) * satFactor;
    }

    // 6. Grayscale
    if (grayMix > 0) {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = r * (1 - grayMix) + lum * grayMix;
      g = g * (1 - grayMix) + lum * grayMix;
      b = b * (1 - grayMix) + lum * grayMix;
    }

    // 7. Sepia
    if (sepiaMix > 0) {
      const sr = r * 0.393 + g * 0.769 + b * 0.189;
      const sg = r * 0.349 + g * 0.686 + b * 0.168;
      const sb = r * 0.272 + g * 0.534 + b * 0.131;
      r = r * (1 - sepiaMix) + sr * sepiaMix;
      g = g * (1 - sepiaMix) + sg * sepiaMix;
      b = b * (1 - sepiaMix) + sb * sepiaMix;
    }

    // 8. Invert
    if (invertMix > 0) {
      r = r * (1 - invertMix) + (255 - r) * invertMix;
      g = g * (1 - invertMix) + (255 - g) * invertMix;
      b = b * (1 - invertMix) + (255 - b) * invertMix;
    }

    // 9. Deterministic Film Grain (hash on pixel index -> reproducible across frames/exports)
    if (grainAmp > 0) {
      const pxIdx = i >> 2;
      const hash = (((pxIdx * 1103515245 + 12345) >>> 16) & 0xff) / 255 - 0.5;
      const delta = hash * grainAmp;
      r += delta;
      g += delta;
      b += delta;
    }

    rgba[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    rgba[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    rgba[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

/**
 * Crisp 3x3 unsharp-mask clarity kernel applied cleanly to RGBA buffer.
 */
export function applyUnsharpSharpenToRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  amountPercent: number
): void {
  const strength = clampNum(amountPercent / 100, 0, 1) * 0.9;
  if (strength <= 0.01 || width < 3 || height < 3) return;

  const src = new Uint8ClampedArray(rgba);
  const stride = width * 4;

  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * stride;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOff + x * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const blur =
          (src[idx - stride + c] +
            src[idx + stride + c] +
            src[idx - 4 + c] +
            src[idx + 4 + c]) *
          0.25;
        const val = center + (center - blur) * strength;
        rgba[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
    }
  }
}

/**
 * Snapchat-style radial spherical bulge ("Fisheye / Big Head") distortion around the face anchor.
 */
export function applyRadialBulgeWarpToRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  anchor: FaceAnchor,
  intensityPercent: number
): void {
  const k = clampNum(intensityPercent / 100, 0, 1);
  if (k <= 0.01 || width < 16 || height < 16) return;

  const src = new Uint8ClampedArray(rgba);
  const cx = clampNum(anchor.centerX, 0.1, 0.9) * width;
  const cy = clampNum(anchor.centerY, 0.1, 0.9) * height;
  const radius = Math.max(24, clampNum(anchor.widthRatio, 0.15, 0.85) * width * 1.15);
  const radiusSq = radius * radius;
  const strength = 0.52 * k;

  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    const dySq = dy * dy;
    if (Math.abs(dy) >= radius) continue;

    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const distSq = dx * dx + dySq;
      if (distSq >= radiusSq || distSq === 0) continue;

      const dist = Math.sqrt(distSq);
      const norm = dist / radius;
      // Smooth dome magnification inside the anchor circle
      const factor = Math.pow(norm, 1 + strength) / norm;
      const sx = Math.max(0, Math.min(width - 1, Math.round(cx + dx * factor)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(cy + dy * factor)));

      const dstIdx = (y * width + x) * 4;
      const srcIdx = (sy * width + sx) * 4;
      rgba[dstIdx] = src[srcIdx];
      rgba[dstIdx + 1] = src[srcIdx + 1];
      rgba[dstIdx + 2] = src[srcIdx + 2];
      rgba[dstIdx + 3] = src[srcIdx + 3];
    }
  }
}

/**
 * Authentic 90s VHS horizontal R/B chromatic aberration + subtle scanline dim.
 */
export function applyVhsEffectToRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  intensityPercent: number
): void {
  const k = clampNum(intensityPercent / 100, 0, 1);
  if (k <= 0.01 || width < 8 || height < 8) return;

  const src = new Uint8ClampedArray(rgba);
  const shiftPx = Math.max(1, Math.round(width * 0.008 * k));

  for (let y = 0; y < height; y++) {
    const rowOff = y * width * 4;
    // Analog horizontal jitter band every ~47 lines
    const bandJitter = y % 47 < 2 ? Math.round(shiftPx * 0.6) : 0;
    const scanDim = y % 3 === 0 ? 1 - 0.14 * k : 1;

    for (let x = 0; x < width; x++) {
      const idx = rowOff + x * 4;
      const rx = Math.max(0, Math.min(width - 1, x - shiftPx + bandJitter));
      const gx = Math.max(0, Math.min(width - 1, x + bandJitter));
      const bx = Math.max(0, Math.min(width - 1, x + shiftPx + bandJitter));

      const r = src[rowOff + rx * 4] * scanDim;
      const g = src[rowOff + gx * 4 + 1] * scanDim;
      const b = src[rowOff + bx * 4 + 2] * scanDim;

      rgba[idx] = r < 0 ? 0 : r > 255 ? 255 : r;
      rgba[idx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      rgba[idx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }
}

/**
 * Comic / Pop-Art filter: quantized color levels + crisp Sobel ink contours + halftone modulation.
 */
export function applyComicPopEffectToRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  intensityPercent: number
): void {
  const k = clampNum(intensityPercent / 100, 0, 1);
  if (k <= 0.01 || width < 4 || height < 4) return;

  const src = new Uint8ClampedArray(rgba);
  const stride = width * 4;
  const levels = 5;
  const step = 255 / (levels - 1);
  const dotPitch = Math.max(4, Math.round(Math.min(width, height) / 90));

  for (let y = 1; y < height - 1; y++) {
    const rowOff = y * stride;
    for (let x = 1; x < width - 1; x++) {
      const idx = rowOff + x * 4;

      const lumaLeft =
        src[idx - 4] * 0.299 + src[idx - 3] * 0.587 + src[idx - 2] * 0.114;
      const lumaRight =
        src[idx + 4] * 0.299 + src[idx + 5] * 0.587 + src[idx + 6] * 0.114;
      const lumaUp =
        src[idx - stride] * 0.299 + src[idx - stride + 1] * 0.587 + src[idx - stride + 2] * 0.114;
      const lumaDown =
        src[idx + stride] * 0.299 + src[idx + stride + 1] * 0.587 + src[idx + stride + 2] * 0.114;

      const edgeMag = Math.abs(lumaRight - lumaLeft) + Math.abs(lumaDown - lumaUp);
      const isInk = edgeMag > 68;

      if (isInk) {
        const inkFactor = 1 - 0.88 * k;
        rgba[idx] = src[idx] * inkFactor;
        rgba[idx + 1] = src[idx + 1] * inkFactor;
        rgba[idx + 2] = src[idx + 2] * inkFactor;
        continue;
      }

      // Posterize RGB + halftone micro-grid
      const qr = Math.round(src[idx] / step) * step;
      const qg = Math.round(src[idx + 1] / step) * step;
      const qb = Math.round(src[idx + 2] / step) * step;

      const gx = (x % dotPitch) / dotPitch - 0.5;
      const gy = (y % dotPitch) / dotPitch - 0.5;
      const dotDist = Math.sqrt(gx * gx + gy * gy);
      const lum = (qr + qg + qb) / (3 * 255);
      const dotShade = dotDist < (1 - lum) * 0.36 ? 0.82 : 1.04;

      const outR = src[idx] * (1 - k) + qr * dotShade * k;
      const outG = src[idx + 1] * (1 - k) + qg * dotShade * k;
      const outB = src[idx + 2] * (1 - k) + qb * dotShade * k;

      rgba[idx] = outR < 0 ? 0 : outR > 255 ? 255 : outR;
      rgba[idx + 1] = outG < 0 ? 0 : outG > 255 ? 255 : outG;
      rgba[idx + 2] = outB < 0 ? 0 : outB > 255 ? 255 : outB;
    }
  }
}

/**
 * Offline skin-chrominance portrait detector using YCbCr skin-tone rules.
 * Isolates the uppermost connected head cluster (ignoring lower bare arms/hands
 * in 3/4 portraits) so Snapchat-style lenses lock cleanly onto the face/eyes.
 */
export function estimateSkinPortraitAnchor(
  rgba: Uint8ClampedArray,
  width: number,
  height: number
): FaceAnchor {
  if (width < 8 || height < 8 || rgba.length < width * height * 4) {
    return { ...DEFAULT_FACE_ANCHOR };
  }

  const skinMask = new Uint8Array(width * height);
  let totalSkin = 0;

  const yStart = Math.floor(height * 0.03);
  const yEnd = Math.ceil(height * 0.85);
  const xStart = Math.floor(width * 0.06);
  const xEnd = Math.ceil(width * 0.94);

  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];

      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;

      if (
        luma > 42 &&
        luma < 245 &&
        cb >= 77 &&
        cb <= 129 &&
        cr >= 132 &&
        cr <= 176
      ) {
        skinMask[y * width + x] = 1;
        totalSkin++;
      }
    }
  }

  if (totalSkin < Math.max(10, width * height * 0.01)) {
    return { ...DEFAULT_FACE_ANCHOR };
  }

  const minRowPx = Math.max(3, Math.round(width * 0.035));
  const rowCounts = new Int32Array(height);
  const rowAvgX = new Float32Array(height);

  for (let y = yStart; y < yEnd; y++) {
    let cnt = 0;
    let sumX = 0;
    for (let x = xStart; x < xEnd; x++) {
      if (skinMask[y * width + x]) {
        cnt++;
        sumX += x;
      }
    }
    rowCounts[y] = cnt;
    rowAvgX[y] = cnt > 0 ? sumX / cnt : -1;
  }

  // Locate topmost contiguous skin cluster in upper 58% of frame (the head)
  const headSearchLimit = Math.ceil(height * 0.58);
  let headTop = -1;
  for (let y = yStart; y < headSearchLimit; y++) {
    if (rowCounts[y] >= minRowPx) {
      headTop = y;
      break;
    }
  }

  if (headTop === -1) {
    return { ...DEFAULT_FACE_ANCHOR };
  }

  // Initial head horizontal center from top 18% slice starting at headTop
  const seedEnd = Math.min(headSearchLimit, headTop + Math.max(6, Math.round(height * 0.18)));
  let seedSumX = 0;
  let seedWeight = 0;
  for (let y = headTop; y < seedEnd; y++) {
    if (rowCounts[y] >= minRowPx) {
      seedSumX += rowAvgX[y] * rowCounts[y];
      seedWeight += rowCounts[y];
    }
  }
  const initialCx = seedWeight > 0 ? seedSumX / seedWeight : width * 0.5;

  // Measure only within a +/- 24% column window around initialCx so lower arms don't leak in
  const colWinHalf = Math.max(8, Math.round(width * 0.24));
  const winLeft = Math.max(xStart, Math.floor(initialCx - colWinHalf));
  const winRight = Math.min(xEnd, Math.ceil(initialCx + colWinHalf));

  let peakRowWidth = 0;
  let peakRowY = headTop;
  let headBottom = headTop;
  const maxHeadHeight = Math.max(10, Math.round(height * 0.42));
  let zeroRun = 0;

  let headSumX = 0;
  let headPxCount = 0;
  const localRowWidths: number[] = [];

  for (let y = headTop; y < Math.min(yEnd, headTop + maxHeadHeight); y++) {
    let rowW = 0;
    let rowSum = 0;
    for (let x = winLeft; x < winRight; x++) {
      if (skinMask[y * width + x]) {
        rowW++;
        rowSum += x;
      }
    }

    if (rowW < minRowPx) {
      zeroRun++;
      if (zeroRun >= 2 && y - headTop >= Math.max(6, Math.round(height * 0.08))) {
        break;
      }
      continue;
    }

    zeroRun = 0;
    // Detect neck pinch / collar transition once below main cheek peak
    const pastTopHalf = y - headTop > Math.max(6, Math.round(height * 0.12));
    if (pastTopHalf && peakRowWidth > 0 && rowW < peakRowWidth * 0.52) {
      break;
    }

    if (rowW > peakRowWidth) {
      peakRowWidth = rowW;
      peakRowY = y;
    }
    headBottom = y;
    headSumX += rowSum;
    headPxCount += rowW;
    localRowWidths.push(rowW);
  }

  if (headPxCount === 0 || peakRowWidth <= 0) {
    return { ...DEFAULT_FACE_ANCHOR };
  }

  // Center eye/face anchor cleanly inside the upper head span
  const spanH = Math.max(peakRowWidth * 1.15, headBottom - headTop + 1);
  const cx = clampNum(headSumX / headPxCount / width, 0.15, 0.85);
  const cy = clampNum(
    (headTop + spanH * 0.45) / height * 0.65 + (peakRowY / height) * 0.35,
    0.12,
    0.68
  );
  const widthRatio = clampNum((peakRowWidth / width) * 1.16, 0.18, 0.62);

  return {
    centerX: Math.round(cx * 1000) / 1000,
    centerY: Math.round(cy * 1000) / 1000,
    widthRatio: Math.round(widthRatio * 1000) / 1000,
    tiltDeg: 0,
    source: 'auto',
  };
}

