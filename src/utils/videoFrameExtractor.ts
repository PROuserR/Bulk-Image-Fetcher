/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import {
  ClipExtractionPlan,
  DEFAULT_MAX_EXTRACTED_FRAMES,
  deriveClipBaseFilename,
  estimateClipExtractionPlan,
} from './videoClipLogic';

export interface VideoMetadataResult {
  durationSec: number;
  videoWidth: number;
  videoHeight: number;
}

export interface ExtractedVideoFrame {
  id: string;
  filename: string;
  previewUrl: string;
  objectUrlToRevoke: string;
  width: number;
  height: number;
  sizeBytes: number;
  timestampSec: number;
}

function attachCorsIfRemote(video: HTMLVideoElement, sourceUrl: string) {
  if (!sourceUrl.startsWith('blob:') && !sourceUrl.startsWith('data:')) {
    video.crossOrigin = 'anonymous';
  }
}

export function loadVideoMetadata(sourceUrl: string): Promise<VideoMetadataResult> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    attachCorsIfRemote(video, sourceUrl);

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out loading video metadata. Check the URL or try a local file.'));
    }, 15000);

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
      video.load();
    };

    const finishIfReady = () => {
      if (settled) return;
      const dur = video.duration;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (Number.isFinite(dur) && dur > 0 && w > 0 && h > 0) {
        settled = true;
        cleanup();
        resolve({
          durationSec: dur,
          videoWidth: w,
          videoHeight: h,
        });
      }
    };

    const onMeta = () => finishIfReady();
    const onReady = () => finishIfReady();
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new Error(
          'Could not decode this video in the browser. Try MP4 (H.264), WebM, or a local video file.'
        )
      );
    };

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
    video.src = sourceUrl;
    video.load();
  });
}

function seekVideoTo(video: HTMLVideoElement, timeSec: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Extraction cancelled', 'AbortError'));
      return;
    }

    const target = Math.max(0, timeSec);
    if (Math.abs(video.currentTime - target) < 0.004 && video.readyState >= 2) {
      resolve();
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, 2500);

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      requestAnimationFrame(() => resolve());
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException('Extraction cancelled', 'AbortError'));
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Video frame seek failed during clip extraction.'));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    signal?.addEventListener('abort', onAbort);
    video.currentTime = target;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode extracted video frame.'));
      },
      'image/png',
      1
    );
  });
}

export async function extractFramesFromVideo(options: {
  sourceUrl: string;
  sourceName: string;
  startSec: number;
  endSec: number;
  extractFps: number;
  speedMultiplier?: number;
  maxWorkingEdge?: number;
  maxFrames?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, currentSec: number) => void;
}): Promise<{
  frames: ExtractedVideoFrame[];
  videoWidth: number;
  videoHeight: number;
  plan: ClipExtractionPlan;
}> {
  const {
    sourceUrl,
    sourceName,
    startSec,
    endSec,
    extractFps,
    speedMultiplier = 1,
    maxWorkingEdge = 960,
    maxFrames = DEFAULT_MAX_EXTRACTED_FRAMES,
    signal,
    onProgress,
  } = options;

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  attachCorsIfRemote(video, sourceUrl);

  const createdUrls: string[] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Extraction cancelled', 'AbortError'));
        return;
      }

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timed out preparing video decoder.'));
      }, 15000);

      const onCanPlay = () => {
        if (settled) return;
        if (video.videoWidth > 0 && video.videoHeight > 0 && Number.isFinite(video.duration)) {
          settled = true;
          cleanup();
          resolve();
        }
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Could not load video for frame extraction.'));
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Extraction cancelled', 'AbortError'));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('loadeddata', onCanPlay);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };

      video.addEventListener('loadeddata', onCanPlay);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort);
      video.src = sourceUrl;
      video.load();
    });

    const natW = Math.max(1, video.videoWidth);
    const natH = Math.max(1, video.videoHeight);
    const durationSec = Math.max(0.1, video.duration);

    const plan = estimateClipExtractionPlan(
      startSec,
      endSec,
      durationSec,
      extractFps,
      speedMultiplier,
      maxFrames
    );

    const scale = Math.min(1, maxWorkingEdge / Math.max(natW, natH));
    const frameW = Math.max(2, Math.round((natW * scale) / 2) * 2);
    const frameH = Math.max(2, Math.round((natH * scale) / 2) * 2);

    const canvas = document.createElement('canvas');
    canvas.width = frameW;
    canvas.height = frameH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    const baseName = deriveClipBaseFilename(sourceName);
    const stamp = Date.now();
    const frames: ExtractedVideoFrame[] = [];

    for (let i = 0; i < plan.timestamps.length; i++) {
      if (signal?.aborted) {
        throw new DOMException('Extraction cancelled', 'AbortError');
      }

      const tSec = plan.timestamps[i];
      await seekVideoTo(video, tSec, signal);

      ctx.clearRect(0, 0, frameW, frameH);
      ctx.drawImage(video, 0, 0, frameW, frameH);

      let blob: Blob;
      try {
        blob = await canvasToBlob(canvas);
      } catch {
        throw new Error(
          'Browser security (CORS) blocked reading pixels from this remote video URL. Download the video locally and drop it directly into the studio.'
        );
      }

      const objectUrl = URL.createObjectURL(blob);
      createdUrls.push(objectUrl);

      frames.push({
        id: `vid_frame_${stamp}_${i}`,
        filename: `${baseName}_f${String(i + 1).padStart(3, '0')}_${tSec.toFixed(2)}s.png`,
        previewUrl: objectUrl,
        objectUrlToRevoke: objectUrl,
        width: frameW,
        height: frameH,
        sizeBytes: blob.size,
        timestampSec: tSec,
      });

      onProgress?.(i + 1, plan.timestamps.length, tSec);
    }

    return {
      frames,
      videoWidth: natW,
      videoHeight: natH,
      plan,
    };
  } catch (err) {
    for (const u of createdUrls) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
