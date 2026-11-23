import { gotScraping } from 'got-scraping';
import pLimit from 'p-limit';
import {
  extractImagesFromHtml,
  parsePreviewUrlsOrManifest,
  type ExtractionResult,
} from '@/utils/htmlExtractor';
import {
  SAMPLE_PRESETS,
  NESTED_HUB_PRESET,
  NESTED_VIRTUAL_SUBPAGES,
} from '@/utils/samplePages';
import {
  DEFAULT_USER_AGENT,
  HTML_ACCEPT_HEADER,
  buildRelayTarget,
  isGeoBlockedHtml,
  isBotChallengeHtml,
  isDirectImageOrBatchInput,
  fetchHtmlViaNonUkRelay,
  type HtmlFetchResult,
} from './fetchHelpers';
import {
  discoverChildGalleryLinks,
  extractLinkedAlbumUrlFromItemPage,
  isIntermediateItemPageUrl,
  isHubOrSearchPageUrl,
} from '@/utils/nestedGalleryLogic';
import {
  resolveKnownIfapFallbackHtml,
  normalizeGalleryFetchUrl,
  extractImagefapPaginationUrls,
  extractAlbumPaginationUrls,
  mergeExtractedGalleryPages,
  filterImagefapChromeImages,
  resolveLinkedFullResGallery,
} from './scrapeRouteHelpers';

/**
 * Resolves built-in sample/nested hub virtual URLs and presets cleanly without external network calls.
 */
export function resolveVirtualPresetHtml(
  rawUrl: string
): { html: string; url: string; label?: string } | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  if (
    trimmed === 'preset:nested_galleries_hub' ||
    trimmed === 'mock:nested_galleries_hub'
  ) {
    return {
      html: NESTED_HUB_PRESET.html,
      url: NESTED_HUB_PRESET.url,
      label: NESTED_HUB_PRESET.name,
    };
  }

  if (trimmed.startsWith('preset:') || trimmed.startsWith('mock:')) {
    const presetId = trimmed.replace(/^(preset|mock):/, '');
    const matching = SAMPLE_PRESETS.find((p) => p.id === presetId || p.url === trimmed);
    if (matching) {
      return {
        html: matching.html,
        url: matching.url,
        label: matching.name,
      };
    }
    return null;
  }

  const normalized = normalizeGalleryFetchUrl(trimmed);
  const directMatch =
    NESTED_VIRTUAL_SUBPAGES[trimmed] ||
    NESTED_VIRTUAL_SUBPAGES[normalized] ||
    NESTED_VIRTUAL_SUBPAGES[normalized.replace(/\/+$/, '')];
  if (directMatch) {
    return {
      html: directMatch,
      url: normalized,
    };
  }

  return null;
}

const PAGE_HTML_CACHE = new Map<string, { expiresAt: number; result: HtmlFetchResult }>();
const INFLIGHT_PAGE_HTML = new Map<string, Promise<HtmlFetchResult>>();
const PAGE_CACHE_TTL_MS = 90_000;
const PAGE_CACHE_MAX_ENTRIES = 150;

function cachePageHtml(key: string, res: HtmlFetchResult) {
  if (
    !res.ok ||
    !res.html ||
    res.html.length > 2_000_000 ||
    isGeoBlockedHtml(res.html, res.url) ||
    isBotChallengeHtml(res.html)
  ) {
    return;
  }
  if (PAGE_HTML_CACHE.size >= PAGE_CACHE_MAX_ENTRIES) {
    const oldest = PAGE_HTML_CACHE.keys().next().value;
    if (oldest) PAGE_HTML_CACHE.delete(oldest);
  }
  PAGE_HTML_CACHE.set(key, {
    expiresAt: Date.now() + PAGE_CACHE_TTL_MS,
    result: res,
  });
}

export async function fetchHtmlWithFallback(
  rawTargetUrl: string,
  relayUrl?: string,
  timeoutMs = 15000,
  preferNonUkRelay = false
): Promise<HtmlFetchResult> {
  const virtualPreset = resolveVirtualPresetHtml(rawTargetUrl);
  if (virtualPreset) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      url: virtualPreset.url,
      html: virtualPreset.html,
    };
  }

  const cleanRelay = (relayUrl || '').trim();
  const cacheKey = `${preferNonUkRelay ? '1' : '0'}|${cleanRelay}|${rawTargetUrl}`;

  const cached = PAGE_HTML_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }
  if (cached) {
    PAGE_HTML_CACHE.delete(cacheKey);
  }

  const inflight = INFLIGHT_PAGE_HTML.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async (): Promise<HtmlFetchResult> => {
    try {
      if (preferNonUkRelay && !cleanRelay) {
        const res = await fetchHtmlViaNonUkRelay(rawTargetUrl, timeoutMs);
        cachePageHtml(cacheKey, res);
        return res;
      }

      const proxiedUrl = buildRelayTarget(rawTargetUrl, cleanRelay);
      const fetchResponse = await fetch(proxiedUrl, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: HTML_ACCEPT_HEADER,
          'Accept-Language': 'en-US,en;q=0.8',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const resolvedUrl = cleanRelay ? rawTargetUrl : fetchResponse.url || rawTargetUrl;
      const html = await fetchResponse.text();

      // If UK geo-block detected and no custom relay was provided, auto-retry via non-UK relay
      if (isGeoBlockedHtml(html, resolvedUrl)) {
        if (!cleanRelay) {
          const relayRes = await fetchHtmlViaNonUkRelay(rawTargetUrl, Math.max(timeoutMs, 15000));
          if (relayRes.ok && relayRes.html && !isGeoBlockedHtml(relayRes.html, relayRes.url)) {
            cachePageHtml(cacheKey, relayRes);
            return relayRes;
          }
        }
        return {
          ok: fetchResponse.ok,
          status: fetchResponse.status,
          statusText: fetchResponse.statusText,
          url: resolvedUrl,
          html,
        };
      }

      const hitChallenge = isBotChallengeHtml(html);

      // Fallback to TLS-fingerprinted Chrome request on Cloudflare / bot challenges (403, 429, 503, or JS challenge)
      if (
        hitChallenge ||
        (!fetchResponse.ok &&
          (fetchResponse.status === 403 || fetchResponse.status === 429 || fetchResponse.status === 503))
      ) {
        try {
          let originReferer = '';
          try {
            originReferer = `${new URL(rawTargetUrl).origin}/`;
          } catch {}

          const gotRes = await gotScraping({
            url: proxiedUrl,
            method: 'GET',
            throwHttpErrors: false,
            timeout: { request: Math.min(timeoutMs, 12000) },
            retry: { limit: 1 },
            headers: originReferer ? { Referer: originReferer } : undefined,
            headerGeneratorOptions: {
              browsers: [{ name: 'chrome', minVersion: 128 }],
              devices: ['desktop'],
              operatingSystems: ['windows', 'macos'],
              locales: ['en-US'],
            },
          });
          const gotBody =
            typeof gotRes.body === 'string' ? gotRes.body : String(gotRes.body ?? '');
          if (gotBody && isGeoBlockedHtml(gotBody, gotRes.url)) {
            if (!cleanRelay) {
              const relayRes = await fetchHtmlViaNonUkRelay(
                rawTargetUrl,
                Math.max(timeoutMs, 15000)
              );
              if (relayRes.ok && relayRes.html && !isGeoBlockedHtml(relayRes.html, relayRes.url)) {
                cachePageHtml(cacheKey, relayRes);
                return relayRes;
              }
            }
          }
          if (
            gotBody &&
            gotRes.statusCode >= 200 &&
            gotRes.statusCode < 300 &&
            !isBotChallengeHtml(gotBody)
          ) {
            const okRes: HtmlFetchResult = {
              ok: true,
              status: gotRes.statusCode,
              statusText: String(gotRes.statusMessage || ''),
              url: gotRes.url || resolvedUrl,
              html: gotBody,
            };
            cachePageHtml(cacheKey, okRes);
            return okRes;
          }
        } catch {
          // Keep original fetch response if gotScraping fails
        }

        if (!cleanRelay) {
          const relayRes = await fetchHtmlViaNonUkRelay(rawTargetUrl, Math.max(timeoutMs, 15000));
          if (
            relayRes.ok &&
            relayRes.html &&
            !isGeoBlockedHtml(relayRes.html, relayRes.url) &&
            !isBotChallengeHtml(relayRes.html)
          ) {
            cachePageHtml(cacheKey, relayRes);
            return relayRes;
          }
        }
      }

      const finalRes: HtmlFetchResult = {
        ok: fetchResponse.ok && !hitChallenge,
        status: hitChallenge ? 403 : fetchResponse.status,
        statusText: hitChallenge ? 'Bot Challenge' : fetchResponse.statusText,
        url: resolvedUrl,
        html,
      };
      cachePageHtml(cacheKey, finalRes);
      return finalRes;
    } finally {
      INFLIGHT_PAGE_HTML.delete(cacheKey);
    }
  })();

  INFLIGHT_PAGE_HTML.set(cacheKey, promise);
  return promise;
}

export interface ScrapeSingleGalleryParams {
  url: string;
  customHtml?: string;
  followLinkedPages?: boolean;
  relayUrl?: string;
  useCache?: boolean;
}

export interface ScrapeSingleGalleryResponse {
  ok: boolean;
  status: number;
  error?: string;
  geoBlocked?: boolean;
  notice?: string;
  suggestedNestedHub?: boolean;
  suggestedNestedCount?: number;
  result?: ExtractionResult;
}

const SCRAPE_RESULT_CACHE = new Map<
  string,
  { expiresAt: number; response: ScrapeSingleGalleryResponse }
>();
const INFLIGHT_SCRAPE_RESULT = new Map<string, Promise<ScrapeSingleGalleryResponse>>();
const SCRAPE_RESULT_TTL_MS = 90_000;
const SCRAPE_RESULT_MAX_ENTRIES = 60;

export function clearScrapeResultCache(): void {
  SCRAPE_RESULT_CACHE.clear();
  INFLIGHT_SCRAPE_RESULT.clear();
}

function getScrapeCacheKey(
  targetUrl: string,
  followLinkedPages: boolean,
  relayUrl?: string
): string {
  const normalized = normalizeGalleryFetchUrl(targetUrl);
  return `${followLinkedPages ? '1' : '0'}|${(relayUrl || '').trim()}|${normalized}`;
}

function cacheScrapeResult(key: string, response: ScrapeSingleGalleryResponse) {
  if (!response.ok || response.geoBlocked || !response.result) return;
  if (SCRAPE_RESULT_CACHE.size >= SCRAPE_RESULT_MAX_ENTRIES) {
    const oldest = SCRAPE_RESULT_CACHE.keys().next().value;
    if (oldest) SCRAPE_RESULT_CACHE.delete(oldest);
  }
  SCRAPE_RESULT_CACHE.set(key, {
    expiresAt: Date.now() + SCRAPE_RESULT_TTL_MS,
    response,
  });
}

/**
 * Full single-gallery extraction pipeline (live HTTP/relay fetch + ImageFap pagination + linked detail master crawling).
 * Deduplicates concurrent scrapes and caches clean live extraction results cleanly.
 */
export async function scrapeSingleGallery(
  params: ScrapeSingleGalleryParams
): Promise<ScrapeSingleGalleryResponse> {
  const { url: rawUrl, customHtml, followLinkedPages = true, relayUrl, useCache = true } = params;
  const targetUrl = String(rawUrl || '').trim();
  const hasCustomHtml = Boolean(customHtml && String(customHtml).trim());
  const isPreset = targetUrl.startsWith('preset:') || targetUrl.startsWith('mock:');

  if (!useCache || hasCustomHtml || isPreset || !targetUrl) {
    return executeScrapeSingleGallery(params);
  }

  const cacheKey = getScrapeCacheKey(targetUrl, followLinkedPages, relayUrl);
  const cached = SCRAPE_RESULT_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    // Refresh LRU recency
    SCRAPE_RESULT_CACHE.delete(cacheKey);
    SCRAPE_RESULT_CACHE.set(cacheKey, cached);
    return cached.response;
  }
  if (cached) {
    SCRAPE_RESULT_CACHE.delete(cacheKey);
  }

  const inflight = INFLIGHT_SCRAPE_RESULT.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    try {
      const response = await executeScrapeSingleGallery(params);
      cacheScrapeResult(cacheKey, response);
      return response;
    } finally {
      INFLIGHT_SCRAPE_RESULT.delete(cacheKey);
    }
  })();

  INFLIGHT_SCRAPE_RESULT.set(cacheKey, promise);
  return promise;
}

async function executeScrapeSingleGallery(
  params: ScrapeSingleGalleryParams
): Promise<ScrapeSingleGalleryResponse> {
  const { url: rawUrl, customHtml, followLinkedPages = true, relayUrl } = params;
  const targetUrl = String(rawUrl || '').trim();

  let htmlToParse = '';
  let finalUrl = targetUrl;
  let preExtracted: ExtractionResult | null = null;
  let geoBlocked = false;
  let notice: string | undefined;
  let isLiveFetch = false;
  let usedNonUkRelay = false;

  const virtualMatch = !customHtml ? resolveVirtualPresetHtml(targetUrl) : null;

  if (customHtml && String(customHtml).trim()) {
    finalUrl = targetUrl ? normalizeGalleryFetchUrl(targetUrl) : 'https://custom-page.local';
    const manifestOrUrls = parsePreviewUrlsOrManifest(customHtml, finalUrl);
    if (manifestOrUrls) {
      preExtracted = manifestOrUrls;
    } else {
      htmlToParse = customHtml;
    }
  } else if (virtualMatch) {
    htmlToParse = virtualMatch.html;
    finalUrl = virtualMatch.url;
  } else if (targetUrl.startsWith('preset:') || targetUrl.startsWith('mock:')) {
    const presetId = targetUrl.replace(/^(preset|mock):/, '');
    return {
      ok: false,
      status: 404,
      error: `Preset "${presetId}" not found.`,
    };
  } else if (isDirectImageOrBatchInput(targetUrl)) {
    const batchResult = parsePreviewUrlsOrManifest(targetUrl, targetUrl);
    if (batchResult) {
      preExtracted = batchResult;
    } else {
      return {
        ok: false,
        status: 400,
        error: 'Could not parse preview image URL(s).',
      };
    }
  } else {
    const normalizedUrl = normalizeGalleryFetchUrl(targetUrl);
    const fallbackPreset = resolveKnownIfapFallbackHtml(normalizedUrl);

    try {
      const fetchResult = await fetchHtmlWithFallback(normalizedUrl, relayUrl, 15000);
      usedNonUkRelay = Boolean(fetchResult.usedNonUkRelay);

      if (!fetchResult.ok) {
        if (fallbackPreset) {
          htmlToParse = fallbackPreset.html;
          finalUrl = normalizedUrl;
          geoBlocked = true;
          notice = `Live fetch returned HTTP ${fetchResult.status}; loaded preserved master dataset for ${fallbackPreset.label}.`;
        } else {
          return {
            ok: false,
            status: fetchResult.status || 502,
            error: `Remote webpage returned HTTP status ${fetchResult.status} ${fetchResult.statusText}`,
          };
        }
      } else {
        htmlToParse = fetchResult.html;
        finalUrl = fetchResult.url || normalizedUrl;
        isLiveFetch = true;

        if (/imagefap\.com/i.test(normalizedUrl) && isGeoBlockedHtml(htmlToParse, finalUrl)) {
          geoBlocked = true;
          isLiveFetch = false;
          if (fallbackPreset) {
            htmlToParse = fallbackPreset.html;
            finalUrl = normalizedUrl;
            notice = `Server egress IP is UK geo-blocked by ImageFap; loaded preserved exact master resolution for ${fallbackPreset.label}. Use Open-Tab Harvester or a non-UK Relay URL for arbitrary galleries.`;
          } else {
            return {
              ok: false,
              status: 403,
              geoBlocked: true,
              error:
                'ImageFap blocked this server’s UK IP (uk_ban_ifap). Open the "Open-Tab Harvester" panel or supply a non-UK Relay URL.',
            };
          }
        }
      }
    } catch (fetchErr: any) {
      if (fallbackPreset) {
        htmlToParse = fallbackPreset.html;
        finalUrl = normalizedUrl;
        geoBlocked = true;
        notice = `Live fetch failed (${fetchErr.message}); loaded preserved master dataset for ${fallbackPreset.label}.`;
      } else {
        return {
          ok: false,
          status: 502,
          error: `Failed to fetch webpage: ${fetchErr.message || 'Network timeout or unreachable host'}. Check the URL and try again.`,
        };
      }
    }
  }

  // If the target is an intermediate item page (e.g., /video/<slug>/) that links to its own /albums/<id>/<slug>/ gallery,
  // automatically follow that album link before extracting photos.
  if (followLinkedPages && !preExtracted && htmlToParse && isIntermediateItemPageUrl(finalUrl)) {
    const linkedAlbumUrl = extractLinkedAlbumUrlFromItemPage(htmlToParse, finalUrl);
    if (linkedAlbumUrl && linkedAlbumUrl !== finalUrl) {
      try {
        const albumRes = await fetchHtmlWithFallback(linkedAlbumUrl, relayUrl, 15000, usedNonUkRelay);
        if (albumRes.usedNonUkRelay) usedNonUkRelay = true;
        if (albumRes.ok && albumRes.html && !isGeoBlockedHtml(albumRes.html, albumRes.url)) {
          htmlToParse = albumRes.html;
          finalUrl = albumRes.url || linkedAlbumUrl;
          isLiveFetch = true;
          notice = notice || `Followed linked gallery album: ${finalUrl}`;
        }
      } catch {
        // Fall back to parsing the item page itself if album fetch fails
      }
    }
  }

  let suggestedNestedHub = false;
  let suggestedNestedCount = 0;
  if (!preExtracted && htmlToParse && isHubOrSearchPageUrl(finalUrl)) {
    const hubLinks = discoverChildGalleryLinks(htmlToParse, finalUrl, {
      maxGalleries: 50,
      sameOriginOnly: true,
    });
    if (hubLinks.length >= 2) {
      suggestedNestedHub = true;
      suggestedNestedCount = hubLinks.length;
    }
  }

  let extracted = preExtracted || extractImagesFromHtml(htmlToParse, finalUrl);

  // For live paginated galleries (ImageFap ?page=1..N OR generic /albums/<id>/slug/2/ pagination), crawl remaining pages
  if (isLiveFetch && htmlToParse) {
    const paginationUrls = /imagefap\.com/i.test(finalUrl)
      ? extractImagefapPaginationUrls(htmlToParse, finalUrl, 25)
      : extractAlbumPaginationUrls(htmlToParse, finalUrl, 10);
    if (paginationUrls.length > 0) {
      const pageLimit = pLimit(usedNonUkRelay ? 3 : 6);
      const settledPages = await Promise.all(
        paginationUrls.map((pageHref) =>
          pageLimit(async () => {
            try {
              const pageRes = await fetchHtmlWithFallback(
                pageHref,
                relayUrl,
                14000,
                usedNonUkRelay
              );
              if (pageRes.usedNonUkRelay) usedNonUkRelay = true;
              if (!pageRes.ok || isGeoBlockedHtml(pageRes.html, pageRes.url)) return null;
              return extractImagesFromHtml(pageRes.html, pageRes.url || pageHref);
            } catch {
              return null;
            }
          })
        )
      );
      const extraResults = settledPages.filter(
        (res): res is ExtractionResult => Boolean(res && res.images.length > 0)
      );
      if (extraResults.length > 0) {
        extracted = mergeExtractedGalleryPages(extracted, extraResults);
      }
    }
  }

  // Filter out non-gallery site UI chrome before linked detail-page crawling
  extracted.images = filterImagefapChromeImages(extracted.images, finalUrl);

  // Follow linked detail webpages to uncover full-sized original masters for ALL images
  if (followLinkedPages && extracted.images.length > 0) {
    const resolutionResult = await resolveLinkedFullResGallery({
      images: extracted.images,
      pageUrl: finalUrl,
      batchSize: usedNonUkRelay ? 3 : 8,
      fetchDetailHtml: async (detailUrl, timeoutMs) => {
        const res = await fetchHtmlWithFallback(detailUrl, relayUrl, timeoutMs, usedNonUkRelay);
        if (res.usedNonUkRelay) usedNonUkRelay = true;
        return {
          ok: res.ok,
          url: res.url,
          html: res.html,
        };
      },
    });

    extracted.images = filterImagefapChromeImages(resolutionResult.images, finalUrl);

    if (resolutionResult.subpageGeoBlocked) {
      geoBlocked = true;
      notice =
        notice ||
        'Synthesized Master Detail Webpage links for your preview URLs, but live subpage crawling hit UK geo-blocking (uk_ban_ifap). Run the Open-Tab Harvester script in your browser tab or configure a Relay URL to resolve live signed CDN tokens.';
    }
  }

  const formats: Record<string, number> = {};
  let unshrunkCount = 0;
  for (const img of extracted.images) {
    formats[img.format] = (formats[img.format] || 0) + 1;
    if (img.isUnshrunk) unshrunkCount++;
  }
  extracted.stats.totalFound = extracted.images.length;
  extracted.stats.unshrunkCount = unshrunkCount;
  extracted.stats.formats = formats;

  return {
    ok: true,
    status: 200,
    geoBlocked,
    notice,
    suggestedNestedHub,
    suggestedNestedCount,
    result: extracted,
  };
}
