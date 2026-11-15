import path from 'path';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const IMAGE_ACCEPT_HEADER =
  'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

export const HTML_ACCEPT_HEADER =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

export const IFAP_MIRROR_FALLBACKS: Record<string, string> = {
  '33802089':
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&auto=format&fit=crop&q=90',
  '33802090':
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=3840&auto=format&fit=crop&q=90',
  '33802091':
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=4090&auto=format&fit=crop&q=90',
  '33802092':
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=3840&auto=format&fit=crop&q=90',
};

/**
 * Formats an optional CORS/geo-bypass relay URL template around a target URL.
 */
export function buildRelayTarget(targetUrl: string, relayUrl?: string): string {
  const cleanRelay = (relayUrl || '').trim();
  if (!cleanRelay) return targetUrl;
  if (cleanRelay.includes('{url}')) {
    return cleanRelay.replace('{url}', encodeURIComponent(targetUrl));
  }
  if (cleanRelay.includes('url=')) {
    return `${cleanRelay}${encodeURIComponent(targetUrl)}`;
  }
  const sep = cleanRelay.includes('?') ? '&' : '?';
  return `${cleanRelay}${sep}url=${encodeURIComponent(targetUrl)}`;
}

/**
 * Detects UK geo-blocking interstitial responses from ImageFap.
 */
export function isGeoBlockedHtml(html: string, responseUrl?: string): boolean {
  if (!html && !responseUrl) return false;
  return (
    (responseUrl || '').includes('uk_ban_ifap') ||
    html.includes('uk_ban_ifap') ||
    html.includes('UK banned') ||
    html.includes('crime-and-policing')
  );
}

/**
 * Determines whether the submitted URL string is a direct image URL or multi-line batch.
 */
export function isDirectImageOrBatchInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/[\r\n]/.test(trimmed) && /^https?:\/\//im.test(trimmed)) return true;
  const pathOnly = trimmed.split('?')[0].toLowerCase();
  if (/\.(jpg|jpeg|png|webp|avif|gif)$/.test(pathOnly)) return true;
  if (/\/images\/(thumb|mini|frame-thumb)\//i.test(trimmed)) return true;
  return false;
}

/**
 * Resolves the appropriate HTTP Referer header for fetching a remote CDN image.
 */
export function resolveImageReferer(imageUrl: string, explicitReferer?: string): string {
  const cleanExplicit = (explicitReferer || '').trim();
  if (cleanExplicit) return cleanExplicit;
  try {
    if (imageUrl.includes('imagefap')) return 'https://www.imagefap.com/';
    if (imageUrl.includes('cdninstagram.com') || imageUrl.includes('fbcdn.net')) {
      return 'https://www.instagram.com/';
    }
    return new URL(imageUrl).origin;
  } catch {
    return imageUrl;
  }
}

/**
 * Sanitizes a download filename and derives a sensible fallback from the image URL if empty.
 */
export function sanitizeDownloadFilename(rawName?: string, fallbackUrl?: string): string {
  let filename = (rawName || '').trim();
  if (!filename && fallbackUrl) {
    try {
      const parsed = new URL(fallbackUrl);
      filename = path.basename(parsed.pathname) || 'master_image.jpg';
    } catch {
      filename = 'master_image.jpg';
    }
  }
  if (!filename) filename = 'master_image.jpg';
  if (!path.extname(filename)) {
    filename += '.jpg';
  }
  return filename.replace(/["\r\n\\]/g, '_');
}

/**
 * Generates a collision-free filename within a ZIP archive.
 */
export function ensureUniqueFilename(filename: string, seenNames: Set<string>): string {
  const ext = path.extname(filename) || '.jpg';
  const base = path.basename(filename, ext);
  let uniqueName = filename;
  let counter = 1;
  while (seenNames.has(uniqueName)) {
    uniqueName = `${base}_${counter}${ext}`;
    counter++;
  }
  seenNames.add(uniqueName);
  return uniqueName;
}

/**
 * Escapes HTML special characters for safe server-side template rendering.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Fetches an image URL with custom Referer and retries without Referer on HTTP 401/403.
 */
export async function fetchImageWithRefererFallback(
  imageUrl: string,
  referer: string,
  timeoutMs = 8500
): Promise<globalThis.Response> {
  const response = await fetch(imageUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: IMAGE_ACCEPT_HEADER,
      Referer: referer,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok && (response.status === 403 || response.status === 401)) {
    return fetch(imageUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: IMAGE_ACCEPT_HEADER,
      },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 6000)),
    });
  }

  return response;
}
