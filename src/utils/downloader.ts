/**
 * Downloader & URL-builder utilities: enforces native disk downloads without
 * cross-origin browser tab popups and centralizes viewer/download route links.
 */

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
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 5000);
}

export function triggerTextDownload(
  content: string,
  filename: string,
  mimeType = 'text/plain'
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  triggerBlobDownload(blob, filename);
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
  const downloadUrl = buildDownloadFileUrl(url, filename, referer, options);

  // Strategy 1: Same-origin attachment proxy (supports Referer, linkedPageUrl, fallbackUrl, relayUrl)
  const proxyBlob = await fetchValidImageBlob(downloadUrl, { timeoutMs: 12000 });
  if (proxyBlob) {
    triggerBlobDownload(proxyBlob, filename);
    return true;
  }

  // Strategy 2: Direct browser CORS fetch (uses client IP/network if server was blocked)
  const directBlob = await fetchValidImageBlob(url, { mode: 'cors', timeoutMs: 10000 });
  if (directBlob) {
    triggerBlobDownload(directBlob, filename);
    return true;
  }

  // Strategy 3: Direct CORS fetch on fallbackUrl if provided
  if (options?.fallbackUrl && options.fallbackUrl !== url) {
    const fallbackBlob = await fetchValidImageBlob(options.fallbackUrl, {
      mode: 'cors',
      timeoutMs: 10000,
    });
    if (fallbackBlob) {
      triggerBlobDownload(fallbackBlob, filename);
      return true;
    }
  }

  return false;
}
