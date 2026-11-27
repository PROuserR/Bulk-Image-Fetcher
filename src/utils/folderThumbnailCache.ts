/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bounded LRU thumbnail + dimension cache and local File/Blob registry for Folder Gallery.
 * Prevents full-resolution 12–48 MP photos from decoding repeatedly in Grid/Masonry/List views,
 * remembers probed dimensions + thumbnails across folder re-picks, and supplies original
 * File/Blob bytes directly to downloads without redundant `fetch()` round-trips.
 */

import {
  dedupeImageBlobFetch,
  getCachedImageBlob,
  setCachedImageBlob,
} from './clientImageCache';
import { computeThumbnailDimensions } from './folderGalleryLogic';

export interface CachedThumbnailMeta {
  width: number;
  height: number;
  thumbnailUrl?: string;
  thumbBytes: number;
  isObjectUrl: boolean;
}

const THUMB_CACHE_MAX_ENTRIES = 500;
const THUMB_CACHE_MAX_BYTES = 48 * 1024 * 1024; // 48 MB total compact thumbnails
const THUMB_MAX_EDGE = 480;

const THUMBNAIL_LRU_CACHE = new Map<string, CachedThumbnailMeta>();
const LOCAL_FOLDER_BLOB_MAP = new Map<string, Blob>();
let thumbnailCacheTotalBytes = 0;

function revokeThumbIfOwned(entry?: CachedThumbnailMeta): void {
  if (!entry || !entry.isObjectUrl || !entry.thumbnailUrl) return;
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(entry.thumbnailUrl);
    } catch {
      // ignore
    }
  }
}

export function registerLocalFolderBlob(itemId: string, blob: Blob): void {
  if (!itemId || !blob) return;
  LOCAL_FOLDER_BLOB_MAP.set(itemId, blob);
}

export function getLocalFolderBlob(itemId: string): Blob | null {
  if (!itemId) return null;
  return LOCAL_FOLDER_BLOB_MAP.get(itemId) || null;
}

export function clearLocalFolderBlobs(): void {
  LOCAL_FOLDER_BLOB_MAP.clear();
}

export function getCachedThumbnailMeta(signature: string): CachedThumbnailMeta | null {
  if (!signature) return null;
  const entry = THUMBNAIL_LRU_CACHE.get(signature);
  if (!entry) return null;
  // Refresh LRU recency
  THUMBNAIL_LRU_CACHE.delete(signature);
  THUMBNAIL_LRU_CACHE.set(signature, entry);
  return entry;
}

export function setCachedThumbnailMeta(
  signature: string,
  meta: CachedThumbnailMeta
): void {
  if (!signature) return;
  const existing = THUMBNAIL_LRU_CACHE.get(signature);
  if (existing) {
    thumbnailCacheTotalBytes = Math.max(0, thumbnailCacheTotalBytes - existing.thumbBytes);
    if (existing.thumbnailUrl !== meta.thumbnailUrl) {
      revokeThumbIfOwned(existing);
    }
    THUMBNAIL_LRU_CACHE.delete(signature);
  }

  const safeBytes = Math.max(0, meta.thumbBytes || 0);
  while (
    THUMBNAIL_LRU_CACHE.size >= THUMB_CACHE_MAX_ENTRIES ||
    (thumbnailCacheTotalBytes + safeBytes > THUMB_CACHE_MAX_BYTES &&
      THUMBNAIL_LRU_CACHE.size > 0)
  ) {
    const oldestKey = THUMBNAIL_LRU_CACHE.keys().next().value;
    if (!oldestKey) break;
    const evicted = THUMBNAIL_LRU_CACHE.get(oldestKey);
    THUMBNAIL_LRU_CACHE.delete(oldestKey);
    if (evicted) {
      thumbnailCacheTotalBytes = Math.max(0, thumbnailCacheTotalBytes - evicted.thumbBytes);
      revokeThumbIfOwned(evicted);
    }
  }

  THUMBNAIL_LRU_CACHE.set(signature, {
    ...meta,
    thumbBytes: safeBytes,
  });
  thumbnailCacheTotalBytes += safeBytes;
}

export function clearThumbnailCache(): void {
  for (const entry of THUMBNAIL_LRU_CACHE.values()) {
    revokeThumbIfOwned(entry);
  }
  THUMBNAIL_LRU_CACHE.clear();
  thumbnailCacheTotalBytes = 0;
}

export function getThumbnailCacheStats(): {
  entries: number;
  bytes: number;
  localBlobs: number;
} {
  return {
    entries: THUMBNAIL_LRU_CACHE.size,
    bytes: thumbnailCacheTotalBytes,
    localBlobs: LOCAL_FOLDER_BLOB_MAP.size,
  };
}

function encodeCanvasThumbnail(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  originalBytes: number
): Promise<{ blob: Blob | null }> {
  if (
    typeof document === 'undefined' ||
    srcWidth <= 0 ||
    srcHeight <= 0 ||
    Math.max(srcWidth, srcHeight) <= THUMB_MAX_EDGE
  ) {
    return Promise.resolve({ blob: null });
  }

  const target = computeThumbnailDimensions(srcWidth, srcHeight, THUMB_MAX_EDGE);
  if (target.width <= 0 || target.height <= 0) {
    return Promise.resolve({ blob: null });
  }

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve({ blob: null });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, target.width, target.height);

  return new Promise((resolve) => {
    const tryFormat = (mime: string, fallbackMime?: string) => {
      try {
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 0 && (originalBytes <= 0 || blob.size < originalBytes * 0.9)) {
              resolve({ blob });
              return;
            }
            if (fallbackMime) {
              tryFormat(fallbackMime);
              return;
            }
            resolve({ blob: null });
          },
          mime,
          0.82
        );
      } catch {
        if (fallbackMime) {
          tryFormat(fallbackMime);
        } else {
          resolve({ blob: null });
        }
      }
    };
    tryFormat('image/webp', 'image/jpeg');
  });
}

function probeDimensionsViaHtmlImage(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined' || !src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 6000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Decodes a local image File/Blob once to read `{ width, height }` and generate a compact
 * <=480px thumbnail `blob:` URL (preserving GIF animations & SVGs without rasterizing).
 */
export async function extractDimensionsAndThumbnail(params: {
  file?: Blob;
  previewUrl: string;
  filename: string;
  signature: string;
}): Promise<CachedThumbnailMeta> {
  const { file, previewUrl, filename, signature } = params;

  const cached = getCachedThumbnailMeta(signature);
  if (cached && cached.width > 0 && cached.height > 0) {
    return cached;
  }

  const isAnimatedOrVector = /\.(?:gif|svg)(?:[?#]|$)/i.test(filename || '') ||
    (file?.type && /image\/(gif|svg)/i.test(file.type));

  // Fast path: off-thread createImageBitmap when decoding local File/Blob
  if (file && typeof createImageBitmap === 'function' && !isAnimatedOrVector) {
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width || 0;
      const height = bitmap.height || 0;
      let thumbnailUrl: string | undefined;
      let thumbBytes = 0;

      if (width > 0 && height > 0 && typeof URL?.createObjectURL === 'function') {
        const { blob: thumbBlob } = await encodeCanvasThumbnail(
          bitmap,
          width,
          height,
          file.size || 0
        );
        if (thumbBlob && thumbBlob.size > 0) {
          thumbnailUrl = URL.createObjectURL(thumbBlob);
          thumbBytes = thumbBlob.size;
        }
      }

      bitmap.close?.();

      if (width > 0 && height > 0) {
        const meta: CachedThumbnailMeta = {
          width,
          height,
          thumbnailUrl,
          thumbBytes,
          isObjectUrl: Boolean(thumbnailUrl),
        };
        setCachedThumbnailMeta(signature, meta);
        return meta;
      }
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  const imgEl = await probeDimensionsViaHtmlImage(previewUrl);
  if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) {
    return { width: 0, height: 0, thumbBytes: 0, isObjectUrl: false };
  }

  const width = imgEl.naturalWidth;
  const height = imgEl.naturalHeight;
  let thumbnailUrl: string | undefined;
  let thumbBytes = 0;

  if (!isAnimatedOrVector && typeof URL?.createObjectURL === 'function') {
    try {
      const { blob: thumbBlob } = await encodeCanvasThumbnail(
        imgEl,
        width,
        height,
        file?.size || 0
      );
      if (thumbBlob && thumbBlob.size > 0) {
        thumbnailUrl = URL.createObjectURL(thumbBlob);
        thumbBytes = thumbBlob.size;
      }
    } catch {
      // Cross-origin or canvas error — fall back cleanly to original previewUrl
    }
  }

  const meta: CachedThumbnailMeta = {
    width,
    height,
    thumbnailUrl,
    thumbBytes,
    isObjectUrl: Boolean(thumbnailUrl),
  };
  setCachedThumbnailMeta(signature, meta);
  return meta;
}

/**
 * Resolves the original `Blob` for a Folder Gallery item using zero-network caches first:
 * 1) Direct local File/Blob reference, 2) `clientImageCache` RAM cache,
 * 3) `fetch(..., { cache: 'force-cache' })` which also warms `clientImageCache` for later reuse.
 */
export async function resolveFolderItemBlob(
  itemId: string,
  previewUrl: string
): Promise<Blob | null> {
  const localBlob = getLocalFolderBlob(itemId);
  if (localBlob && localBlob.size > 0) {
    return localBlob;
  }

  const ramBlob = getCachedImageBlob(previewUrl);
  if (ramBlob && ramBlob.size > 0) {
    return ramBlob;
  }

  if (!previewUrl || typeof fetch !== 'function') return null;

  return dedupeImageBlobFetch(previewUrl, async () => {
    try {
      const resp = await fetch(previewUrl, { cache: 'force-cache' });
      if (!resp.ok) return null;
      const blob = await resp.blob();
      if (blob && blob.size > 0) {
        setCachedImageBlob(previewUrl, blob);
        return blob;
      }
      return null;
    } catch {
      return null;
    }
  });
}
