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
const REUSABLE_BLOB_URLS = new Map<string, string>();
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

export function isSameOriginOrLocalImageUrl(src: string): boolean {
  if (!src) return false;
  if (/^(blob:|data:)/i.test(src)) return true;
  if (src.startsWith('/') && !src.startsWith('//')) return true;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return src.startsWith(`${window.location.origin}/`);
  }
  return false;
}

export function isFullResProxyUrl(workingSrc: string, fullUrl: string): boolean {
  if (!workingSrc || !fullUrl) return false;
  let proxyPath = workingSrc;
  if (typeof window !== 'undefined' && window.location?.origin && workingSrc.startsWith(window.location.origin)) {
    proxyPath = workingSrc.slice(window.location.origin.length);
  }
  if (!proxyPath.startsWith('/api/proxy?')) return false;
  try {
    const query = proxyPath.slice('/api/proxy?'.length);
    const parsed = new URLSearchParams(query);
    return parsed.get('url') === fullUrl;
  } catch {
    return false;
  }
}

function revokeReusableBlobUrl(key: string): void {
  const existingUrl = REUSABLE_BLOB_URLS.get(key);
  if (!existingUrl) return;
  REUSABLE_BLOB_URLS.delete(key);
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(existingUrl);
    } catch {
      // ignore
    }
  }
}

function evictBlobKey(key: string): void {
  const existing = IMAGE_BLOB_CACHE.get(key);
  revokeReusableBlobUrl(key);
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

/**
 * Returns a managed `blob:` object URL backed by `IMAGE_BLOB_CACHE` so any component
 * or downstream studio can display/process an already-loaded image with 0 network requests.
 */
export function getOrCreateCachedBlobUrl(url: string): string | undefined {
  if (!url) return undefined;
  const blob = getCachedImageBlob(url);
  if (!blob) return undefined;

  const existing = REUSABLE_BLOB_URLS.get(url);
  if (existing) return existing;

  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return undefined;
  }
  const objectUrl = URL.createObjectURL(blob);
  REUSABLE_BLOB_URLS.set(url, objectUrl);
  return objectUrl;
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
  // Never overwrite permanent working URLs with ephemeral generated blob: URLs unless the source itself is a blob:
  if (workingSrc.startsWith('blob:') && !fullUrl.startsWith('blob:')) {
    return;
  }
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
  if (isFullResProxyUrl(working, fullUrl)) {
    return working;
  }
  return undefined;
}

function isFullResSrcMatch(candidateSrc: string, fullUrl: string): boolean {
  if (!candidateSrc || !fullUrl) return false;
  if (candidateSrc === fullUrl) return true;
  if (isFullResProxyUrl(candidateSrc, fullUrl)) return true;
  if (typeof window !== 'undefined' && window.location?.href) {
    try {
      const resolvedFull = new URL(fullUrl, window.location.href).href;
      if (candidateSrc === resolvedFull) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Lazily hydrates `IMAGE_BLOB_CACHE` from the browser's own HTTP cache when a full-res
 * same-origin/proxy/blob/data preview finishes loading in an `<img>` tag, avoiding any
 * cross-origin fetch errors or duplicate server downloads later.
 */
export async function warmImageBlobCacheFromLoadedPreview(
  fullUrl: string,
  workingSrc: string
): Promise<Blob | null> {
  if (!fullUrl || !workingSrc || typeof fetch !== 'function') return null;
  const existing = getCachedImageBlob(fullUrl);
  if (existing) return existing;

  if (!isSameOriginOrLocalImageUrl(workingSrc)) return null;
  if (!isFullResSrcMatch(workingSrc, fullUrl) && !workingSrc.startsWith('blob:') && !workingSrc.startsWith('data:')) {
    return null;
  }

  return dedupeImageBlobFetch(fullUrl, async () => {
    try {
      const resp = await fetch(workingSrc, { cache: 'force-cache' });
      if (!resp.ok) return null;
      const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        return null;
      }
      const blob = await resp.blob();
      return blob && blob.size > 0 ? blob : null;
    } catch {
      return null;
    }
  });
}

function inferExportMimeFromUrl(url: string): string {
  const clean = (url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export function findLoadedFullResDomImage(
  fullUrl: string,
  imageId?: string
): HTMLImageElement | null {
  if (
    typeof document === 'undefined' ||
    typeof document.querySelector !== 'function' ||
    typeof document.querySelectorAll !== 'function' ||
    !fullUrl
  ) {
    return null;
  }

  const isLoadedMatch = (el: HTMLImageElement | null): el is HTMLImageElement => {
    if (!el || !el.complete || el.naturalWidth <= 1 || el.naturalHeight <= 1) return false;
    const activeSrc = el.currentSrc || el.getAttribute('src') || '';
    if (!activeSrc) return false;
    if (isFullResSrcMatch(activeSrc, fullUrl)) return true;
    if (el.dataset?.fullUrl === fullUrl && (activeSrc.startsWith('blob:') || activeSrc.startsWith('data:'))) {
      return true;
    }
    return false;
  };

  if (imageId) {
    const escapedId =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(imageId)
        : imageId.replace(/"/g, '\\"');
    const byId = document.querySelector<HTMLImageElement>(`img[data-face-img-id="${escapedId}"]`);
    if (isLoadedMatch(byId)) return byId;
  }

  const escapedUrl =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(fullUrl)
      : fullUrl.replace(/"/g, '\\"');
  const candidates = document.querySelectorAll<HTMLImageElement>(`img[data-full-url="${escapedUrl}"]`);
  for (const el of candidates) {
    if (isLoadedMatch(el)) return el;
  }

  return null;
}

/**
 * Extracts a full-resolution `Blob` directly from an already-loaded `<img>` element
 * on the webpage (first reading exact original bytes via `force-cache` for same-origin,
 * blob, or data URLs; otherwise extracting from an untainted canvas without hitting
 * the network), and stores the result in `IMAGE_BLOB_CACHE`.
 */
export async function captureFullResBlobFromLoadedDomImage(
  fullUrl: string,
  imageId?: string
): Promise<Blob | null> {
  if (!fullUrl || typeof document === 'undefined') return null;

  const cached = getCachedImageBlob(fullUrl);
  if (cached) return cached;

  const domImg = findLoadedFullResDomImage(fullUrl, imageId);
  if (!domImg) return null;

  const activeSrc = domImg.currentSrc || domImg.getAttribute('src') || '';
  if (activeSrc && isSameOriginOrLocalImageUrl(activeSrc) && typeof fetch === 'function') {
    try {
      const resp = await fetch(activeSrc, { cache: 'force-cache' });
      if (resp.ok) {
        const contentType = (resp.headers?.get?.('content-type') || '').toLowerCase();
        if (!contentType.includes('text/html') && !contentType.includes('application/json')) {
          const blob = await resp.blob();
          if (blob && blob.size > 0) {
            setCachedImageBlob(fullUrl, blob);
            return blob;
          }
        }
      }
    } catch {
      // Fall through to canvas check
    }
  }

  // Never rasterize animated GIFs via single-frame canvas
  if (/\.gif(?:[?#]|$)/i.test(fullUrl)) {
    return null;
  }

  // Only works if the image is untainted (same-origin, blob, data, or CORS-enabled)
  try {
    const canvas = document.createElement('canvas');
    canvas.width = domImg.naturalWidth;
    canvas.height = domImg.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(domImg, 0, 0, domImg.naturalWidth, domImg.naturalHeight);
    const mime = inferExportMimeFromUrl(fullUrl);
    const canvasBlob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), mime, mime === 'image/png' ? undefined : 0.94);
      } catch {
        resolve(null);
      }
    });
    if (canvasBlob && canvasBlob.size > 0) {
      setCachedImageBlob(fullUrl, canvasBlob);
      return canvasBlob;
    }
  } catch {
    // Tainted cross-origin canvas — silently fall back to download strategies
    return null;
  }

  return null;
}

export function hasReusableBrowserImageData(fullUrl: string, imageId?: string): boolean {
  if (!fullUrl) return false;
  if (getCachedImageBlob(fullUrl)) return true;
  if (getFullResReusablePreviewUrl(fullUrl)) return true;
  if (findLoadedFullResDomImage(fullUrl, imageId)) return true;
  return false;
}

export function countReusableBrowserImages(
  images: Array<{ id?: string; fullUrl: string }>
): {
  total: number;
  memoryCount: number;
  previewCacheCount: number;
  domLoadedCount: number;
  reusableCount: number;
} {
  let memoryCount = 0;
  let previewCacheCount = 0;
  let domLoadedCount = 0;
  let reusableCount = 0;

  for (const img of images) {
    if (!img.fullUrl) continue;
    const inMemory = Boolean(getCachedImageBlob(img.fullUrl));
    const inPreview = Boolean(getFullResReusablePreviewUrl(img.fullUrl));
    const inDom = Boolean(findLoadedFullResDomImage(img.fullUrl, img.id));
    if (inMemory) memoryCount++;
    else if (inPreview) previewCacheCount++;
    else if (inDom) domLoadedCount++;

    if (inMemory || inPreview || inDom) {
      reusableCount++;
    }
  }

  return {
    total: images.length,
    memoryCount,
    previewCacheCount,
    domLoadedCount,
    reusableCount,
  };
}

export function clearClientImageCache(): void {
  for (const key of Array.from(REUSABLE_BLOB_URLS.keys())) {
    revokeReusableBlobUrl(key);
  }
  IMAGE_BLOB_CACHE.clear();
  INFLIGHT_BLOB_FETCHES.clear();
  WORKING_PREVIEW_URLS.clear();
  blobCacheTotalBytes = 0;
}

export function getClientImageCacheStats(): {
  entries: number;
  bytes: number;
  workingUrls: number;
  blobUrls: number;
} {
  return {
    entries: IMAGE_BLOB_CACHE.size,
    bytes: blobCacheTotalBytes,
    workingUrls: WORKING_PREVIEW_URLS.size,
    blobUrls: REUSABLE_BLOB_URLS.size,
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
    let domImg = document.querySelector<HTMLImageElement>(`img[data-face-img-id="${escapedId}"]`);
    if ((!domImg || !domImg.complete || domImg.naturalWidth <= 1) && params.fullUrl) {
      const escapedUrl =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(params.fullUrl)
          : params.fullUrl.replace(/"/g, '\\"');
      domImg = document.querySelector<HTMLImageElement>(`img[data-full-url="${escapedUrl}"]`);
    }
    if (domImg && domImg.complete && domImg.naturalWidth > 1 && domImg.naturalHeight > 1) {
      return renderElementToJpeg(domImg, domImg.naturalWidth, domImg.naturalHeight);
    }
  } catch {
    // Tainted cross-origin canvas or unreadable image element
    return undefined;
  }

  return undefined;
}
