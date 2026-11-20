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
 * Detects Cloudflare or JavaScript anti-bot challenge interstitial pages.
 */
export function isBotChallengeHtml(html: string): boolean {
  if (!html) return false;
  return (
    html.includes('cf-browser-verification') ||
    html.includes('_cf_chl_opt') ||
    html.includes('/cdn-cgi/challenge-platform') ||
    /<title>\s*(?:Just a moment\.\.\.|Attention Required!\s*\|\s*Cloudflare)\s*<\/title>/i.test(html) ||
    html.includes('Enable JavaScript and cookies to continue')
  );
}

/**
 * Builds a non-UK HTML reader-relay URL for pages that geo-block server egress IPs.
 */
export function buildNonUkHtmlRelayUrl(targetUrl: string): string {
  return `https://r.jina.ai/${targetUrl.trim()}`;
}

export interface HtmlFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  html: string;
  usedNonUkRelay?: boolean;
}

/**
 * Fetches raw HTML for a URL via a non-UK HTTP relay (preserves canonical url for relative links).
 */
export async function fetchHtmlViaNonUkRelay(
  rawTargetUrl: string,
  timeoutMs = 15000
): Promise<HtmlFetchResult> {
  const relayEndpoint = buildNonUkHtmlRelayUrl(rawTargetUrl);
  let lastStatus = 502;
  let lastText = '';

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(relayEndpoint, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          'x-respond-with': 'html',
          'x-no-cache': 'true',
          Accept: HTML_ACCEPT_HEADER,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = resp.status;
      lastText = resp.statusText;
      const body = await resp.text();
      if (resp.ok && body && body.includes('<') && !isGeoBlockedHtml(body, rawTargetUrl)) {
        return {
          ok: true,
          status: resp.status,
          statusText: resp.statusText,
          url: rawTargetUrl,
          html: body,
          usedNonUkRelay: true,
        };
      }
      if (resp.status !== 429 && resp.status !== 502 && resp.status !== 503) {
        return {
          ok: false,
          status: resp.status,
          statusText: resp.statusText,
          url: rawTargetUrl,
          html: body,
          usedNonUkRelay: true,
        };
      }
    } catch (err: any) {
      lastText = err?.message || 'Relay timeout';
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    statusText: lastText,
    url: rawTargetUrl,
    html: '',
    usedNonUkRelay: true,
  };
}

/**
 * Fetches a detail or gallery HTML page directly (or via explicit relayUrl),
 * automatically falling back to the non-UK HTML relay if UK geo-blocking is detected.
 */
export async function fetchDetailPageHtmlSmart(
  rawTargetUrl: string,
  options: {
    relayUrl?: string;
    preferNonUkRelay?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<HtmlFetchResult> {
  const { relayUrl = '', preferNonUkRelay = false, timeoutMs = 10000 } = options;
  const cleanRelay = relayUrl.trim();

  if (preferNonUkRelay && !cleanRelay) {
    return fetchHtmlViaNonUkRelay(rawTargetUrl, timeoutMs);
  }

  const target = cleanRelay ? buildRelayTarget(rawTargetUrl, cleanRelay) : rawTargetUrl;
  const resp = await fetch(target, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: HTML_ACCEPT_HEADER,
      'Accept-Language': 'en-US,en;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const html = await resp.text();
  const resolvedUrl = cleanRelay ? rawTargetUrl : resp.url || rawTargetUrl;

  if (!cleanRelay && isGeoBlockedHtml(html, resolvedUrl)) {
    return fetchHtmlViaNonUkRelay(rawTargetUrl, Math.max(timeoutMs, 12000));
  }

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    url: resolvedUrl,
    html,
  };
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
    const parsed = new URL(imageUrl);
    if (/^(?:pics-storage|storage|media-storage)[-.0-9a-z]*\./i.test(parsed.hostname)) {
      const parts = parsed.hostname.split('.');
      if (parts.length >= 2) {
        return `https://www.${parts.slice(-2).join('.')}/`;
      }
    }
    return parsed.origin;
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

/**
 * Validates that a downloaded payload is non-empty binary image data rather than an HTML/JSON error page.
 */
export function isValidImageBuffer(
  buf: Buffer,
  contentType = 'image/jpeg',
  minBytes = 1
): boolean {
  if (buf.byteLength < minBytes) return false;
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('text/html') || lowerType.includes('application/json')) {
    return false;
  }
  const headStr = buf.subarray(0, 32).toString('ascii').toLowerCase();
  if (headStr.includes('<!doc') || headStr.includes('<html')) {
    return false;
  }
  return true;
}

export async function fetchValidImageBuffer(
  targetUrl: string,
  options: {
    explicitReferer?: string;
    relayUrl?: string;
    timeoutMs?: number;
    minBytes?: number;
    fetcher?: (url: string, referer: string, timeoutMs: number) => Promise<globalThis.Response>;
  } = {}
): Promise<{ buf: Buffer; contentType: string } | null> {
  if (!targetUrl) return null;
  const {
    explicitReferer,
    relayUrl = '',
    timeoutMs = 8500,
    minBytes = 1,
    fetcher = fetchImageWithRefererFallback,
  } = options;
  const referer = resolveImageReferer(targetUrl, explicitReferer);
  const fetchTarget = relayUrl ? buildRelayTarget(targetUrl, relayUrl) : targetUrl;
  try {
    const resp = await fetcher(fetchTarget, referer, timeoutMs);
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!isValidImageBuffer(buf, contentType, minBytes)) return null;
    return { buf, contentType };
  } catch {
    return null;
  }
}

export interface ImageBufferFallbackParams {
  imageUrl: string;
  explicitReferer?: string;
  relayUrl?: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  minBytes?: number;
  allowFallbackUrl?: boolean;
  resolveDetailPageUrl?: (detailUrl: string) => Promise<string | null>;
  fetcher?: (url: string, referer: string, timeoutMs: number) => Promise<globalThis.Response>;
}

/**
 * Fetches an image buffer with ordered fallbacks: primary URL -> linked detail page -> fallbackUrl -> ImageFap mirror.
 */
export async function resolveImageBufferWithFallbacks(
  params: ImageBufferFallbackParams
): Promise<{ buf: Buffer; contentType: string } | null> {
  const {
    imageUrl,
    explicitReferer,
    relayUrl = '',
    fallbackUrl = '',
    linkedPageUrl = '',
    minBytes = 1,
    allowFallbackUrl = true,
    resolveDetailPageUrl,
    fetcher,
  } = params;

  let result = await fetchValidImageBuffer(imageUrl, {
    explicitReferer,
    relayUrl,
    timeoutMs: 8500,
    minBytes,
    fetcher,
  });

  if (!result && linkedPageUrl && resolveDetailPageUrl) {
    try {
      const resolvedUrl = await resolveDetailPageUrl(
        relayUrl ? buildRelayTarget(linkedPageUrl, relayUrl) : linkedPageUrl
      );
      if (resolvedUrl && resolvedUrl !== imageUrl) {
        result = await fetchValidImageBuffer(resolvedUrl, {
          explicitReferer,
          relayUrl,
          timeoutMs: 8000,
          minBytes,
          fetcher,
        });
      }
    } catch {
      // ignore detail page fallback failure
    }
  }

  if (!result && allowFallbackUrl && fallbackUrl && fallbackUrl !== imageUrl) {
    result = await fetchValidImageBuffer(fallbackUrl, {
      explicitReferer,
      relayUrl,
      timeoutMs: 6000,
      minBytes,
      fetcher,
    });
  }

  if (!result && /imagefap/i.test(imageUrl)) {
    const idMatch =
      (imageUrl.match(/\/([0-9]{8,12})\.(?:jpg|jpeg)/i) || [])[1] ||
      (linkedPageUrl.match(/\/photo\/([0-9]{8,12})/i) || [])[1];
    if (idMatch && IFAP_MIRROR_FALLBACKS[idMatch]) {
      result = await fetchValidImageBuffer(IFAP_MIRROR_FALLBACKS[idMatch], {
        explicitReferer,
        relayUrl: '',
        timeoutMs: 6000,
        minBytes,
        fetcher,
      });
    }
  }

  return result;
}

