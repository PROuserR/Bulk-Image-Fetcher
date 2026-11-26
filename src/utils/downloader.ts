/**
 * Downloader & URL-builder utilities: enforces native disk downloads without
 * cross-origin browser tab popups and centralizes viewer/download route links.
 */

import {
  captureFullResBlobFromLoadedDomImage,
  dedupeImageBlobFetch,
  getCachedImageBlob,
  getFullResReusablePreviewUrl,
  isSameOriginOrLocalImageUrl,
} from './clientImageCache';

export interface DownloadUrlOptions {
  fallbackUrl?: string;
  linkedPageUrl?: string;
  relayUrl?: string;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const blobUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    if (typeof window !== 'undefined' && window.URL?.revokeObjectURL) {
      window.URL.revokeObjectURL(blobUrl);
    }
  }, 5000);
}

export function triggerTextDownload(
  content: string,
  filename: string,
  mimeType = 'text/plain'
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  triggerBlobDownload(blob, filename);
}

export type ArchiveFormat = '7z' | 'zip';

export const DEFAULT_ARCHIVE_FORMAT: ArchiveFormat = '7z';

export function normalizeArchiveFormat(raw?: unknown): ArchiveFormat {
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'zip') {
    return 'zip';
  }
  return '7z';
}

export function getArchiveContentType(format: ArchiveFormat): string {
  return format === 'zip' ? 'application/zip' : 'application/x-7z-compressed';
}

export function buildArchiveFilename(
  pageTitle?: string,
  fallbackUrl?: string,
  format: ArchiveFormat = DEFAULT_ARCHIVE_FORMAT,
  defaultName = 'scraped_images'
): string {
  const normalizedFormat = normalizeArchiveFormat(format);
  let raw = (pageTitle || '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) {
    const urlToParse = raw && /^https?:\/\//i.test(raw) ? raw : (fallbackUrl || '').trim();
    if (urlToParse) {
      try {
        const parsed = new URL(urlToParse);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const last = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : '';
        raw =
          last && !/^\d+$/.test(last)
            ? last.replace(/[-_]+/g, ' ')
            : parsed.hostname.replace(/^www\./i, '');
      } catch {
        // Keep raw fallback
      }
    }
  }

  let cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.(?:7z|zip)$/i, '')
    .replace(/^[._\s-]+|[._\s-]+$/g, '')
    .slice(0, 120)
    .trim();

  if (!cleaned) {
    cleaned = defaultName;
  }

  return `${cleaned}.${normalizedFormat}`;
}

export function buildZipFilename(
  pageTitle?: string,
  fallbackUrl?: string,
  defaultName = 'scraped_images'
): string {
  return buildArchiveFilename(pageTitle, fallbackUrl, 'zip', defaultName);
}

export function buildContentDispositionHeader(filename: string): string {
  const defaultFallback = filename.toLowerCase().endsWith('.7z') ? 'archive.7z' : 'archive.zip';
  const asciiFallback =
    filename
      .replace(/[^\x20-\x7e]/g, '-')
      .replace(/["\\;\r\n]/g, '_')
      .trim() || defaultFallback;
  const encodedUtf8 = encodeURIComponent(filename);
  return asciiFallback === filename
    ? `attachment; filename="${asciiFallback}"`
    : `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

export function buildDownloadFileUrl(
  url: string,
  filename: string,
  referer?: string,
  options?: DownloadUrlOptions
): string {
  const params = new URLSearchParams({
    url,
    filename,
    referer: referer || '',
  });
  if (options?.fallbackUrl) params.set('fallbackUrl', options.fallbackUrl);
  if (options?.linkedPageUrl) params.set('linkedPageUrl', options.linkedPageUrl);
  if (options?.relayUrl) params.set('relayUrl', options.relayUrl);
  return `/api/download-file?${params.toString()}`;
}

export function buildViewImageUrl(params: {
  fullUrl: string;
  title: string;
  sourcePage?: string;
  linkedPage?: string;
  method?: string;
}): string {
  const base = `/view-image?url=${encodeURIComponent(params.fullUrl)}&title=${encodeURIComponent(
    params.title
  )}&sourcePage=${encodeURIComponent(params.sourcePage || '')}&linkedPage=${encodeURIComponent(
    params.linkedPage || ''
  )}`;
  return params.method ? `${base}&method=${encodeURIComponent(params.method)}` : base;
}

async function fetchValidImageBlob(
  targetUrl: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Blob | null> {
  const { timeoutMs = 12000, signal: outerSignal, ...fetchInit } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);

  const onOuterAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal) {
    if (outerSignal.aborted) {
      clearTimeout(timer);
      return null;
    }
    outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const resp = await fetch(targetUrl, {
      ...fetchInit,
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      return null;
    }
    const blob = await resp.blob();
    if (!blob || blob.size === 0) return null;
    return blob;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (outerSignal) {
      outerSignal.removeEventListener('abort', onOuterAbort);
    }
  }
}

export async function downloadFileToDisk(
  url: string,
  filename: string,
  referer?: string,
  options?: DownloadUrlOptions
): Promise<boolean> {
  // Fast-path 0: Client in-memory LRU Blob cache (0 network round-trips)
  const cachedBlob = getCachedImageBlob(url);
  if (cachedBlob) {
    triggerBlobDownload(cachedBlob, filename);
    return true;
  }

  const resolvedBlob = await dedupeImageBlobFetch(url, async () => {
    // Fast-path 1: Reuse already-loaded full-res preview via browser HTTP cache
    const cachedPreviewUrl = getFullResReusablePreviewUrl(url);
    if (cachedPreviewUrl) {
      const isLocal = isSameOriginOrLocalImageUrl(cachedPreviewUrl);
      const cacheInit: RequestInit & { timeoutMs?: number } = isLocal
        ? { cache: 'force-cache', timeoutMs: 6000 }
        : { mode: 'cors', cache: 'force-cache', timeoutMs: 6000 };
      const reused = await fetchValidImageBlob(cachedPreviewUrl, cacheInit);
      if (reused) return reused;
    }

    // Fast-path 2: Harvest directly from already-loaded full-res DOM <img> element
    const domBlob = await captureFullResBlobFromLoadedDomImage(url);
    if (domBlob) return domBlob;

    // Strategy 3: Same-origin attachment proxy (supports Referer, linkedPageUrl, fallbackUrl, relayUrl)
    const downloadUrl = buildDownloadFileUrl(url, filename, referer, options);
    const proxyBlob = await fetchValidImageBlob(downloadUrl, { timeoutMs: 12000 });
    if (proxyBlob) return proxyBlob;

    // Strategy 3: Direct browser CORS fetch (uses client IP/network if server was blocked)
    const directBlob = await fetchValidImageBlob(url, { mode: 'cors', timeoutMs: 10000 });
    if (directBlob) return directBlob;

    // Strategy 4: Direct CORS fetch on fallbackUrl if provided
    if (options?.fallbackUrl && options.fallbackUrl !== url) {
      const fallbackBlob = await fetchValidImageBlob(options.fallbackUrl, {
        mode: 'cors',
        timeoutMs: 10000,
      });
      if (fallbackBlob) return fallbackBlob;
    }

    return null;
  });

  if (resolvedBlob) {
    triggerBlobDownload(resolvedBlob, filename);
    return true;
  }

  return false;
}
