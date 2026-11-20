/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure TypeScript sequence, framing, and timing logic for GIF Maker Studio.
 * Zero DOM dependencies so all calculations are unit-testable via `node --test`.
 */

export type GifPlaybackOrder = 'forward' | 'reverse' | 'boomerang';

export type GifAspectPreset =
  | 'original'
  | 'square'
  | 'landscape'
  | 'portrait'
  | 'story'
  | 'custom';

export type GifFitMode = 'cover' | 'contain';

export type GifCaptionPosition = 'none' | 'bottom' | 'top';

export interface GifFrameItemMeta {
  id: string;
  filename: string;
  width: number;
  height: number;
  included: boolean;
}

export interface GifMakerConfig {
  fps: number;
  playbackOrder: GifPlaybackOrder;
  loopCount: number; // 0 = infinite, >= 1 finite
  aspectPreset: GifAspectPreset;
  maxEdge: number; // 240..960
  customWidth: number;
  customHeight: number;
  fitMode: GifFitMode;
  backgroundColor: string;
  crossfadeFrames: number; // 0..3 intermediate blend frames between slides
  dither: boolean;
  captionText: string;
  captionPosition: GifCaptionPosition;
}

export interface GifSequenceStep {
  primaryIndex: number;
  secondaryIndex: number | null;
  blendFactor: number; // 0 = 100% primary, >0 = blend toward secondary
  delayMs: number;
}

export interface GifDrawRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export const DEFAULT_GIF_CONFIG: GifMakerConfig = {
  fps: 6,
  playbackOrder: 'forward',
  loopCount: 0,
  aspectPreset: 'square',
  maxEdge: 480,
  customWidth: 480,
  customHeight: 480,
  fitMode: 'cover',
  backgroundColor: '#090A0F',
  crossfadeFrames: 0,
  dither: true,
  captionText: '',
  captionPosition: 'bottom',
};

export function clampFps(fps: number): number {
  if (!Number.isFinite(fps)) return DEFAULT_GIF_CONFIG.fps;
  return Math.max(1, Math.min(24, Math.round(fps)));
}

export function fpsToDelayMs(fps: number): number {
  const safeFps = clampFps(fps);
  // Snap to clean 10ms (1 centisecond) boundary >= 40ms
  return Math.max(40, Math.round(1000 / safeFps / 10) * 10);
}

export function clampLoopCount(loopCount: number): number {
  if (!Number.isFinite(loopCount) || loopCount <= 0) return 0;
  return Math.min(100, Math.round(loopCount));
}

export function computeGifCanvasDimensions(
  config: Pick<GifMakerConfig, 'aspectPreset' | 'maxEdge' | 'customWidth' | 'customHeight'>,
  referenceDimensions?: { width: number; height: number } | null
): { width: number; height: number } {
  const maxEdge = Math.max(120, Math.min(1200, Math.round(config.maxEdge || 480)));
  let width = maxEdge;
  let height = maxEdge;

  switch (config.aspectPreset) {
    case 'square': {
      width = maxEdge;
      height = maxEdge;
      break;
    }
    case 'landscape': {
      width = maxEdge;
      height = Math.round((maxEdge * 9) / 16);
      break;
    }
    case 'portrait': {
      height = maxEdge;
      width = Math.round((maxEdge * 4) / 5);
      break;
    }
    case 'story': {
      height = maxEdge;
      width = Math.round((maxEdge * 9) / 16);
      break;
    }
    case 'custom': {
      width = Math.max(64, Math.min(1200, Math.round(config.customWidth || maxEdge)));
      height = Math.max(64, Math.min(1200, Math.round(config.customHeight || maxEdge)));
      break;
    }
    case 'original':
    default: {
      const refW = Math.max(1, referenceDimensions?.width || 4);
      const refH = Math.max(1, referenceDimensions?.height || 3);
      if (refW >= refH) {
        width = maxEdge;
        height = Math.max(64, Math.round((maxEdge * refH) / refW));
      } else {
        height = maxEdge;
        width = Math.max(64, Math.round((maxEdge * refW) / refH));
      }
      break;
    }
  }

  // Keep even pixel dimensions for crisp rendering across encoders
  return {
    width: width % 2 === 0 ? width : width + 1,
    height: height % 2 === 0 ? height : height + 1,
  };
}

export function computeFrameDrawRect(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
  fitMode: GifFitMode
): GifDrawRect {
  const safeSw = Math.max(1, srcWidth);
  const safeSh = Math.max(1, srcHeight);
  const safeDw = Math.max(1, dstWidth);
  const safeDh = Math.max(1, dstHeight);

  const scale =
    fitMode === 'cover'
      ? Math.max(safeDw / safeSw, safeDh / safeSh)
      : Math.min(safeDw / safeSw, safeDh / safeSh);

  const dw = safeSw * scale;
  const dh = safeSh * scale;
  const dx = (safeDw - dw) / 2;
  const dy = (safeDh - dh) / 2;

  return { dx, dy, dw, dh };
}

/**
 * Builds the exact ordered frame & crossfade timeline given N included frames.
 * - `forward`: [0, 1, 2, ...]
 * - `reverse`: [..., 2, 1, 0]
 * - `boomerang`: [0, 1, 2, 1] (omits duplicate endpoints when N >= 3)
 */
export function buildGifSequence(
  frameCount: number,
  config: Pick<GifMakerConfig, 'fps' | 'playbackOrder' | 'crossfadeFrames'>
): GifSequenceStep[] {
  if (frameCount <= 0) return [];

  let baseOrder: number[] = [];
  if (config.playbackOrder === 'reverse') {
    for (let i = frameCount - 1; i >= 0; i--) {
      baseOrder.push(i);
    }
  } else if (config.playbackOrder === 'boomerang') {
    for (let i = 0; i < frameCount; i++) {
      baseOrder.push(i);
    }
    if (frameCount >= 3) {
      for (let i = frameCount - 2; i >= 1; i--) {
        baseOrder.push(i);
      }
    } else if (frameCount === 2) {
      baseOrder.push(1);
    }
  } else {
    for (let i = 0; i < frameCount; i++) {
      baseOrder.push(i);
    }
  }

  const baseDelayMs = fpsToDelayMs(config.fps);
  const crossfades =
    frameCount > 1
      ? Math.max(0, Math.min(3, Math.round(config.crossfadeFrames || 0)))
      : 0;

  if (crossfades === 0) {
    return baseOrder.map((idx) => ({
      primaryIndex: idx,
      secondaryIndex: null,
      blendFactor: 0,
      delayMs: baseDelayMs,
    }));
  }

  // Split crossfade delay smoothly between main hold and blend sub-steps
  const blendStepDelayMs = Math.max(40, Math.round(baseDelayMs / (crossfades + 1) / 10) * 10);
  const holdDelayMs = Math.max(40, Math.round((baseDelayMs * 0.65) / 10) * 10);

  const steps: GifSequenceStep[] = [];
  for (let i = 0; i < baseOrder.length; i++) {
    const currentIdx = baseOrder[i];
    const nextIdx = baseOrder[(i + 1) % baseOrder.length];

    steps.push({
      primaryIndex: currentIdx,
      secondaryIndex: null,
      blendFactor: 0,
      delayMs: holdDelayMs,
    });

    if (currentIdx !== nextIdx) {
      for (let c = 1; c <= crossfades; c++) {
        steps.push({
          primaryIndex: currentIdx,
          secondaryIndex: nextIdx,
          blendFactor: c / (crossfades + 1),
          delayMs: blendStepDelayMs,
        });
      }
    }
  }

  return steps;
}

export function estimateTotalGifDurationMs(steps: GifSequenceStep[]): number {
  let total = 0;
  for (const step of steps) {
    total += step.delayMs;
  }
  return total;
}

export function formatGifDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0.0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
