/**
 * Client-side in-memory LRU Blob cache, in-flight fetch deduplication,
 * and working preview URL registry so viewed gallery images are not
 * downloaded a second time when inspecting in Lightbox or saving to disk.
 */

const BLOB_CACHE_MAX_ENTRIES = 80;
const BLOB_CACHE_MAX_BYTES = 120 * 1024 * 1024; // 120 MB
const BLOB_CACHE_MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const BLOB_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PREVIEW_URL_MAX_ENTRIES = 500;

interface BlobCacheEntry {
  blob: Blob;
  expiresAt: number;
}

const IMAGE_BLOB_CACHE = new Map<string, BlobCacheEntry>();
const INFLIGHT_BLOB_FETCHES = new Map<string, Promise<Blob | null>>();
const WORKING_PREVIEW_URLS = new Map<string, string>();
let blobCacheTotalBytes = 0;

export function buildProxyImageUrl(
  targetUrl: string,
  referer?: string,
  relayUrl?: string
): string {
  const params = new URLSearchParams({
    url: targetUrl,
    referer: referer || '',
  });
  if (relayUrl && relayUrl.trim()) {
    params.set('relayUrl', relayUrl.trim());
  }
  return `/api/proxy?${params.toString()}`;
}

function evictBlobKey(key: string): void {
  const existing = IMAGE_BLOB_CACHE.get(key);
  if (!existing) return;
  IMAGE_BLOB_CACHE.delete(key);
  blobCacheTotalBytes = Math.max(0, blobCacheTotalBytes - existing.blob.size);
}

export function getCachedImageBlob(url: string): Blob | null {
  if (!url) return null;
  const entry = IMAGE_BLOB_CACHE.get(url);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    evictBlobKey(url);
    return null;
  }
  // Refresh LRU recency
  IMAGE_BLOB_CACHE.delete(url);
  IMAGE_BLOB_CACHE.set(url, entry);
  return entry.blob;
}

export function setCachedImageBlob(url: string, blob: Blob): void {
  if (!url || !blob || blob.size <= 0 || blob.size > BLOB_CACHE_MAX_SINGLE_FILE_BYTES) {
    return;
  }
  evictBlobKey(url);
  while (
    IMAGE_BLOB_CACHE.size >= BLOB_CACHE_MAX_ENTRIES ||
    (blobCacheTotalBytes + blob.size > BLOB_CACHE_MAX_BYTES && IMAGE_BLOB_CACHE.size > 0)
  ) {
    const oldestKey = IMAGE_BLOB_CACHE.keys().next().value;
    if (!oldestKey) break;
    evictBlobKey(oldestKey);
  }
  IMAGE_BLOB_CACHE.set(url, {
    blob,
    expiresAt: Date.now() + BLOB_CACHE_TTL_MS,
  });
  blobCacheTotalBytes += blob.size;
}

export async function dedupeImageBlobFetch(
  url: string,
  fetcher: () => Promise<Blob | null>
): Promise<Blob | null> {
  if (!url) return null;
  const cached = getCachedImageBlob(url);
  if (cached) return cached;

  const inflight = INFLIGHT_BLOB_FETCHES.get(url);
  if (inflight) {
    return inflight;
  }

  const task = (async () => {
    try {
      const blob = await fetcher();
      if (blob && blob.size > 0) {
        setCachedImageBlob(url, blob);
        return blob;
      }
      return null;
    } finally {
      INFLIGHT_BLOB_FETCHES.delete(url);
    }
  })();

  INFLIGHT_BLOB_FETCHES.set(url, task);
  return task;
}

export function registerWorkingPreviewUrl(fullUrl: string, workingSrc: string): void {
  if (!fullUrl || !workingSrc) return;
  if (WORKING_PREVIEW_URLS.size >= PREVIEW_URL_MAX_ENTRIES) {
    const oldestKey = WORKING_PREVIEW_URLS.keys().next().value;
    if (oldestKey) WORKING_PREVIEW_URLS.delete(oldestKey);
  }
  WORKING_PREVIEW_URLS.delete(fullUrl);
  WORKING_PREVIEW_URLS.set(fullUrl, workingSrc);
}

export function getWorkingPreviewUrl(fullUrl: string): string | undefined {
  if (!fullUrl) return undefined;
  return WORKING_PREVIEW_URLS.get(fullUrl);
}

/**
 * Returns a cached browser preview URL only if it points to the full-res asset
 * (either directly or via our /api/proxy), avoiding accidentally serving a low-res
 * thumbnail in place of the requested master image during downloads.
 */
export function getFullResReusablePreviewUrl(fullUrl: string): string | undefined {
  const working = getWorkingPreviewUrl(fullUrl);
  if (!working) return undefined;
  if (working === fullUrl) return working;
  if (working.startsWith('/api/proxy?')) {
    try {
      const query = working.slice('/api/proxy?'.length);
      const parsed = new URLSearchParams(query);
      if (parsed.get('url') === fullUrl) {
        return working;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function clearClientImageCache(): void {
  IMAGE_BLOB_CACHE.clear();
  INFLIGHT_BLOB_FETCHES.clear();
  WORKING_PREVIEW_URLS.clear();
  blobCacheTotalBytes = 0;
}

export function getClientImageCacheStats(): {
  entries: number;
  bytes: number;
  workingUrls: number;
} {
  return {
    entries: IMAGE_BLOB_CACHE.size,
    bytes: blobCacheTotalBytes,
    workingUrls: WORKING_PREVIEW_URLS.size,
  };
}

/**
 * Attempts to build a compact (<=512px) JPEG data URL from already-cached browser Blob data
 * or a readable loaded <img> element so AI face scanning can inspect hotlink/cookie-protected
 * scraped images even when server egress IP fetching fails.
 */
export async function tryCaptureBrowserPreviewDataUrl(params: {
  id: string;
  fullUrl?: string;
  thumbnailUrl?: string;
  fallbackUrl?: string;
}): Promise<string | undefined> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return undefined;
  }

  const cachedBlob =
    (params.thumbnailUrl ? getCachedImageBlob(params.thumbnailUrl) : null) ||
    (params.fullUrl ? getCachedImageBlob(params.fullUrl) : null) ||
    (params.fallbackUrl ? getCachedImageBlob(params.fallbackUrl) : null);

  const renderElementToJpeg = (
    source: CanvasImageSource,
    srcW: number,
    srcH: number
  ): string | undefined => {
    if (!srcW || !srcH || Math.max(srcW, srcH) < 16) return undefined;
    const scale = Math.min(1, 512 / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(source, 0, 0, targetW, targetH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    return dataUrl.startsWith('data:image/jpeg') ? dataUrl : undefined;
  };

  if (cachedBlob && cachedBlob.size > 0) {
    const objectUrl = URL.createObjectURL(cachedBlob);
    try {
      const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
        const imgEl = new Image();
        imgEl.onload = () => resolve(imgEl);
        imgEl.onerror = () => resolve(null);
        imgEl.src = objectUrl;
      });
      if (loaded) {
        return renderElementToJpeg(loaded, loaded.naturalWidth, loaded.naturalHeight);
      }
    } catch {
      return undefined;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  try {
    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(params.id)
        : params.id.replace(/"/g, '\\"');
    const domImg = document.querySelector<HTMLImageElement>(`img[data-face-img-id="${escapedId}"]`);
    if (domImg && domImg.complete && domImg.naturalWidth > 1 && domImg.naturalHeight > 1) {
      return renderElementToJpeg(domImg, domImg.naturalWidth, domImg.naturalHeight);
    }
  } catch {
    // Tainted cross-origin canvas or unreadable image element
    return undefined;
  }

  return undefined;
}
