/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure TypeScript clip timing, trimming, timestamp formatting, and extraction plan math
 * for Video-to-GIF conversion. Zero DOM dependencies so all calculations run cleanly
 * under `tsx --test` / `node:test`.
 */

import { clampFps } from './gifMakerLogic';

export const DEFAULT_MIN_CLIP_SEC = 0.2;
export const DEFAULT_MAX_CLIP_SEC = 30;
export const DEFAULT_MAX_EXTRACTED_FRAMES = 120;

export const VIDEO_EXTRACT_FPS_OPTIONS = [4, 6, 8, 10, 12, 15] as const;
export const VIDEO_SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

export interface VideoTimeRangeOptions {
  minClipSec?: number;
  maxClipSec?: number;
  anchor?: 'start' | 'end';
}

export interface VideoTimeRange {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface ClipExtractionPlan {
  startSec: number;
  endSec: number;
  clipDurationSec: number;
  requestedExtractFps: number;
  effectiveExtractFps: number;
  speedMultiplier: number;
  outputGifFps: number;
  frameCount: number;
  estimatedOutputDurationMs: number;
  timestamps: number[];
  wasCapped: boolean;
}

const SUPPORTED_VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i;

export function isSupportedVideoFile(file: { name: string; type?: string }): boolean {
  if (file.type && file.type.toLowerCase().startsWith('video/')) {
    return true;
  }
  return SUPPORTED_VIDEO_EXT_RE.test(file.name || '');
}

export function isValidVideoUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }
  if (trimmed.startsWith('blob:')) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatVideoTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const clamped = Math.round(seconds * 10) / 10;
  const mins = Math.floor(clamped / 60);
  const rem = clamped - mins * 60;
  const wholeSecs = Math.floor(rem);
  const tenths = Math.round((rem - wholeSecs) * 10);
  const normalizedWhole = tenths === 10 ? wholeSecs + 1 : wholeSecs;
  const normalizedTenths = tenths === 10 ? 0 : tenths;
  const finalMins = normalizedWhole >= 60 ? mins + 1 : mins;
  const finalSecs = normalizedWhole >= 60 ? 0 : normalizedWhole;
  return `${finalMins}:${String(finalSecs).padStart(2, '0')}.${normalizedTenths}`;
}

export function parseVideoTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Accept "MM:SS.t", "HH:MM:SS.t", or plain numeric seconds like "12.5"
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? Math.round(val * 100) / 100 : null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  if (parts.length === 2) {
    const [mins, secs] = nums;
    if (secs >= 60) return null;
    return Math.round((mins * 60 + secs) * 100) / 100;
  }

  const [hours, mins, secs] = nums;
  if (mins >= 60 || secs >= 60) return null;
  return Math.round((hours * 3600 + mins * 60 + secs) * 100) / 100;
}

export function sanitizeVideoTimeRange(
  rawStartSec: number,
  rawEndSec: number,
  totalDurationSec: number,
  options: VideoTimeRangeOptions = {}
): VideoTimeRange {
  if (!Number.isFinite(totalDurationSec) || totalDurationSec <= 0) {
    return { startSec: 0, endSec: 0, durationSec: 0 };
  }

  const minClipSec = Math.min(
    totalDurationSec,
    Math.max(0.05, options.minClipSec ?? DEFAULT_MIN_CLIP_SEC)
  );
  const maxClipSec = Math.min(
    totalDurationSec,
    Math.max(minClipSec, options.maxClipSec ?? DEFAULT_MAX_CLIP_SEC)
  );
  const anchor = options.anchor ?? 'start';

  let start = Number.isFinite(rawStartSec) ? rawStartSec : 0;
  let end = Number.isFinite(rawEndSec) ? rawEndSec : totalDurationSec;

  start = Math.max(0, Math.min(totalDurationSec, start));
  end = Math.max(0, Math.min(totalDurationSec, end));

  if (end < start) {
    if (anchor === 'start') {
      end = Math.min(totalDurationSec, start + minClipSec);
    } else {
      start = Math.max(0, end - minClipSec);
    }
  }

  if (end - start < minClipSec) {
    if (anchor === 'start') {
      end = Math.min(totalDurationSec, start + minClipSec);
      if (end - start < minClipSec) {
        start = Math.max(0, end - minClipSec);
      }
    } else {
      start = Math.max(0, end - minClipSec);
      if (end - start < minClipSec) {
        end = Math.min(totalDurationSec, start + minClipSec);
      }
    }
  }

  if (end - start > maxClipSec) {
    if (anchor === 'start') {
      end = start + maxClipSec;
    } else {
      start = end - maxClipSec;
    }
  }

  const roundedStart = Math.round(start * 100) / 100;
  const roundedEnd = Math.round(end * 100) / 100;
  return {
    startSec: roundedStart,
    endSec: roundedEnd,
    durationSec: Math.round((roundedEnd - roundedStart) * 100) / 100,
  };
}

export function resolveOutputGifFps(extractFps: number, speedMultiplier = 1): number {
  const safeExtract = Number.isFinite(extractFps) && extractFps > 0 ? extractFps : 8;
  const safeSpeed =
    Number.isFinite(speedMultiplier) && speedMultiplier > 0
      ? Math.max(0.25, Math.min(4, speedMultiplier))
      : 1;
  return clampFps(Math.round(safeExtract * safeSpeed));
}

export function computeClipTimestamps(
  startSec: number,
  endSec: number,
  extractFps: number,
  maxFrames: number = DEFAULT_MAX_EXTRACTED_FRAMES
): { timestamps: number[]; effectiveExtractFps: number; wasCapped: boolean } {
  const safeStart = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const safeEnd = Math.max(safeStart, Number.isFinite(endSec) ? endSec : safeStart);
  const span = safeEnd - safeStart;
  if (span <= 0) {
    return {
      timestamps: [Math.round(safeStart * 1000) / 1000],
      effectiveExtractFps: 1,
      wasCapped: false,
    };
  }

  const safeFps = Math.max(1, Math.min(30, Number.isFinite(extractFps) ? extractFps : 8));
  const safeMaxFrames = Math.max(2, Math.round(maxFrames));

  const idealCount = Math.max(2, Math.round(span * safeFps));
  const wasCapped = idealCount > safeMaxFrames;
  const count = wasCapped ? safeMaxFrames : idealCount;
  const effectiveExtractFps = count / span;

  const timestamps: number[] = [];
  // Space evenly across [start, end - tiny epsilon] so final seek stays inside clip bounds
  const endPadding = Math.min(0.02, span * 0.02);
  const effectiveSpan = Math.max(0.01, span - endPadding);

  for (let i = 0; i < count; i++) {
    const ratio = count === 1 ? 0 : i / (count - 1);
    const t = safeStart + ratio * effectiveSpan;
    timestamps.push(Math.round(t * 1000) / 1000);
  }

  return {
    timestamps,
    effectiveExtractFps: Math.round(effectiveExtractFps * 100) / 100,
    wasCapped,
  };
}

export function estimateClipExtractionPlan(
  startSec: number,
  endSec: number,
  totalDurationSec: number,
  extractFps: number,
  speedMultiplier = 1,
  maxFrames: number = DEFAULT_MAX_EXTRACTED_FRAMES
): ClipExtractionPlan {
  const range = sanitizeVideoTimeRange(startSec, endSec, totalDurationSec);
  const { timestamps, effectiveExtractFps, wasCapped } = computeClipTimestamps(
    range.startSec,
    range.endSec,
    extractFps,
    maxFrames
  );
  const outputGifFps = resolveOutputGifFps(effectiveExtractFps, speedMultiplier);
  const stepDelayMs = Math.max(40, Math.round(1000 / outputGifFps / 10) * 10);
  return {
    startSec: range.startSec,
    endSec: range.endSec,
    clipDurationSec: range.durationSec,
    requestedExtractFps: extractFps,
    effectiveExtractFps,
    speedMultiplier,
    outputGifFps,
    frameCount: timestamps.length,
    estimatedOutputDurationMs: timestamps.length * stepDelayMs,
    timestamps,
    wasCapped,
  };
}

export function deriveClipBaseFilename(sourceLabel: string): string {
  const stripped = (sourceLabel || 'video_clip')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return stripped || 'video_clip';
}
