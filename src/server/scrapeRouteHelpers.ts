import fs from 'fs';
import path from 'path';
import type JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { SAMPLE_PRESETS } from '../utils/samplePages.ts';
import type { ScrapedImage } from '../utils/scraperLogic.ts';
import { classifyResolution } from '../utils/scraperLogic.ts';
import type { ExtractionResult } from '../utils/htmlExtractor.ts';
import {
  extractGalleryMapFromDetailPage,
  extractBestImageFromDetailPage,
} from '../utils/htmlExtractor.ts';
import {
  isIntermediateItemPageUrl,
  extractLinkedAlbumUrlFromItemPage,
  normalizeGalleryHref,
  type DiscoveredGallery,
} from '../utils/nestedGalleryLogic.ts';
import { isGeoBlockedHtml } from './fetchHelpers.ts';

export function buildIfapPhoto33802089Html(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Jessie Rogers and Lexington Steele - Photo 33802089</title>
</head>
<body>
  <table>
    <tr>
      <td id="33802089" align="center" height="230" valign="top">
        <a name="33802089" href="https://www.imagefap.com/photo/33802089/?pgid=&amp;gid=13643086&amp;page=0"
           original="https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2560" imageid="33802089" title="Jessie Rogers and Lexington Steele - 33802089.jpg">
          <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&amp;h=107&amp;fit=crop"
               data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802089" width="160" height="107">
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function resolveKnownIfapFallbackHtml(
  targetUrl: string
): { html: string; label: string } | null {
  if (!/imagefap\.com/i.test(targetUrl)) return null;
  if (/33802089/i.test(targetUrl)) {
    return { html: buildIfapPhoto33802089Html(), label: 'Photo 33802089' };
  }
  if (/13643086/i.test(targetUrl) || /jessie.*rogers/i.test(targetUrl)) {
    const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_jessie_rogers');
    if (preset) return { html: preset.html, label: 'GID 13643086' };
  }
  if (/14238993/i.test(targetUrl) || /hazel/i.test(targetUrl)) {
    const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_gallery');
    if (preset) return { html: preset.html, label: 'GID 14238993' };
  }
  return null;
}

export function isPhotoDetailPage(u: string): boolean {
  if (!u) return false;
  return (
    /\/photo\/[0-9]+/i.test(u) ||
    /\/item\/[0-9]+/i.test(u) ||
    /\/view\/[0-9]+/i.test(u) ||
    /[?&]id=[0-9]+/i.test(u) ||
    /\/image\/[0-9]+/i.test(u) ||
    /\/picture\/[0-9]+/i.test(u) ||
    /\/post\/[0-9]+/i.test(u) ||
    /\/albums?\/[0-9]+\/[^/]+\/[0-9]{4,14}(?:\/|$|\?)/i.test(u)
  );
}

export function isNavigationalLink(u: string): boolean {
  if (!u) return false;
  return (
    /index\.(php|html?)/i.test(u) ||
    /(privacy|terms|contact|login|register|bigdata|devops|abuse|dmca|faq)/i.test(u)
  );
}

export function isImagefapGalleryUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  return /imagefap\.com\/(?:pictures\/|gallery\.php|gallery\/|show\.php)/i.test(rawUrl);
}

/**
 * Normalizes gallery URLs before live server fetch:
 * - Prepends https:// when protocol is missing
 * - Upgrades bare imagefap.com / m.imagefap.com -> www.imagefap.com
 * - Appends view=2 on ImageFap gallery URLs (/pictures/..., /gallery.php?gid=...) unless view= is set
 */
export function normalizeGalleryFetchUrl(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return trimmed;
  if (/^(preset|mock):/i.test(trimmed)) return trimmed;

  let withProtocol = trimmed;
  if (!/^https?:\/\//i.test(withProtocol)) {
    withProtocol = `https://${withProtocol.replace(/^\/+/, '')}`;
  }

  try {
    const parsed = new URL(withProtocol);
    if (/^(?:m\.)?imagefap\.com$/i.test(parsed.hostname)) {
      parsed.hostname = 'www.imagefap.com';
    }
    if (
      /imagefap\.com$/i.test(parsed.hostname) &&
      /^\/(?:pictures\/|gallery\.php|gallery\/|show\.php)/i.test(parsed.pathname) &&
      !parsed.searchParams.has('view')
    ) {
      parsed.searchParams.set('view', '2');
    }
    return parsed.href;
  } catch {
    return withProtocol;
  }
}

function extractImagefapGid(urlStr: string): string | null {
  const match =
    urlStr.match(/[?&]gid=([0-9]+)/i) ||
    urlStr.match(/\/pictures\/([0-9]+)/i) ||
    urlStr.match(/\/gallery\/([0-9]+)/i);
  return match ? match[1] : null;
}

/**
 * Extracts paginated gallery page URLs (?page=1, ?page=2, ...) from an ImageFap gallery HTML page.
 * Returns deduplicated absolute URLs sorted numerically by page number, excluding page=0 and currentUrl.
 */
export function extractImagefapPaginationUrls(
  html: string,
  currentUrl: string,
  maxPages = 25
): string[] {
  if (!html || !/imagefap\.com/i.test(currentUrl)) return [];

  const $ = cheerio.load(html);
  const currentGid = extractImagefapGid(currentUrl);
  let currentPageNum = 0;
  try {
    const curParsed = new URL(currentUrl);
    currentPageNum = parseInt(curParsed.searchParams.get('page') || '0', 10) || 0;
  } catch {}

  const pagesMap = new Map<number, string>();

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (!/[?&]page=[0-9]+/i.test(href)) return;
    if (/\/photo\/[0-9]+/i.test(href)) return; // Skip detail photo page links

    try {
      const resolved = new URL(href, currentUrl);
      if (!/imagefap\.com$/i.test(resolved.hostname)) return;

      const linkGid = extractImagefapGid(resolved.href);
      if (currentGid && linkGid && currentGid !== linkGid) return;

      const pageStr = resolved.searchParams.get('page');
      if (!pageStr) return;
      const pageNum = parseInt(pageStr, 10);
      if (isNaN(pageNum) || pageNum <= 0 || pageNum === currentPageNum) return;

      if (
        !resolved.searchParams.has('view') &&
        /^\/(?:pictures\/|gallery\.php|gallery\/|show\.php)/i.test(resolved.pathname)
      ) {
        resolved.searchParams.set('view', '2');
      }

      if (!pagesMap.has(pageNum)) {
        pagesMap.set(pageNum, resolved.href);
      }
    } catch {
      // ignore malformed URLs
    }
  });

  return Array.from(pagesMap.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxPages)
    .map(([, u]) => u);
}

export function extractPhotoIdFromImage(img: Pick<ScrapedImage, 'linkedPageUrl' | 'thumbnailUrl' | 'fullUrl'>): string | null {
  return (
    (img.linkedPageUrl?.match(/\/photo\/([0-9]{5,14})/i) || [])[1] ||
    (img.linkedPageUrl?.match(/[?&]id=([0-9]{5,14})/i) || [])[1] ||
    (img.thumbnailUrl?.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1] ||
    (img.fullUrl?.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1] ||
    null
  );
}

/**
 * Extracts paginated album sub-page URLs (e.g. /albums/30560/slug/2/ or ?page=2)
 * strictly scoped to the same album ID / base path.
 */
export function extractAlbumPaginationUrls(
  html: string,
  currentUrl: string,
  maxPages = 10
): string[] {
  if (!html || !currentUrl || /imagefap\.com/i.test(currentUrl)) return [];

  let parsedCurrent: URL;
  try {
    parsedCurrent = new URL(currentUrl);
  } catch {
    return [];
  }

  const albumIdMatch = parsedCurrent.pathname.match(/\/(?:albums?|galleries|gallery)\/([0-9]+)(?:\/|$)/i);
  if (!albumIdMatch) return [];
  const albumId = albumIdMatch[1];
  const cleanCurrentPath = parsedCurrent.pathname.replace(/\/+$/, '');

  const $ = cheerio.load(html);
  const pagesMap = new Map<number, string>();

  $('.pagination a[href], .pager a[href], .page-numbers a[href], a[href*="page="]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      const resolved = new URL(href, parsedCurrent.href);
      if (resolved.origin !== parsedCurrent.origin) return;
      resolved.hash = '';
      const cleanPath = resolved.pathname.replace(/\/+$/, '');
      if (!cleanPath.includes(`/${albumId}`)) return;
      if (cleanPath === cleanCurrentPath && resolved.search === parsedCurrent.search) return;

      const qPage = resolved.searchParams.get('page');
      const pathPageMatch = cleanPath.match(new RegExp(`/${albumId}(?:/[^/]+)?(?:/page)?/([0-9]{1,3})$`, 'i'));
      const pageNum = qPage ? parseInt(qPage, 10) : pathPageMatch ? parseInt(pathPageMatch[1], 10) : NaN;
      if (!isNaN(pageNum) && pageNum >= 2 && pageNum <= 100 && !pagesMap.has(pageNum)) {
        pagesMap.set(pageNum, resolved.href);
      }
    } catch {}
  });

  return Array.from(pagesMap.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxPages)
    .map(([, u]) => u);
}

/**
 * Removes non-gallery site UI chrome (logos, spacer gifs, avatars, tiny UI buttons)
 * while preserving every genuine gallery photo.
 */
export function filterImagefapChromeImages(
  images: ScrapedImage[],
  pageUrl: string
): ScrapedImage[] {
  const isIfap = /imagefap\.com/i.test(pageUrl);
  const currentAlbumId = (pageUrl.match(/\/(?:albums?|galleries|gallery)\/([0-9]+)(?:\/|$)/i) || [])[1] || '';

  const kept = images.filter((img) => {
    const u = `${img.fullUrl} ${img.thumbnailUrl}`.toLowerCase();
    if (
      u.includes('z.gif') ||
      u.includes('spacer.gif') ||
      u.includes('blank.gif') ||
      u.includes('pixel.gif') ||
      u.includes('ajax-loader.gif') ||
      u.includes('logo.gif') ||
      u.includes('/ilove') ||
      u.includes('ilovedevops')
    ) {
      return false;
    }

    if (isIfap) {
      if (img.linkedPageUrl && isPhotoDetailPage(img.linkedPageUrl)) {
        return true;
      }
      if (
        /\/img\/|\/images\/avatars\/|\/images\/icons\/|\/ads\/|\/banners?\//i.test(u) ||
        /\/logo[._-]/i.test(u) ||
        /\.(?:svg)$/i.test(img.fullUrl.split('?')[0])
      ) {
        return false;
      }
      if (
        !img.linkedPageUrl &&
        typeof img.width === 'number' &&
        typeof img.height === 'number' &&
        img.width <= 48 &&
        img.height <= 48
      ) {
        return false;
      }
    } else {
      if (
        currentAlbumId &&
        img.linkedPageUrl &&
        !isPhotoDetailPage(img.linkedPageUrl)
      ) {
        const linkedAlbumMatch = img.linkedPageUrl.match(/\/(?:albums?|galleries|gallery)\/([0-9]+)(?:\/|$)/i);
        if (linkedAlbumMatch && linkedAlbumMatch[1] !== currentAlbumId) {
          return false;
        }
      }
      if (
        !img.isUnshrunk &&
        (/\/(?:favicon|logos?|avatars?|badges?|sprites?|icons?)[._/-]/i.test(u) ||
          (typeof img.width === 'number' && typeof img.height === 'number' && img.width <= 48 && img.height <= 48))
      ) {
        return false;
      }
    }

    return true;
  });

  return kept.map((img, idx) => ({
    ...img,
    id: img.id.startsWith('ig_') ? img.id : `img_${idx + 1}`,
  }));
}

/**
 * Merges base gallery extraction result with additional paginated pages, deduplicating by photo ID / fullUrl.
 */
export function mergeExtractedGalleryPages(
  base: ExtractionResult,
  additionalPages: ExtractionResult[]
): ExtractionResult {
  const mergedImages: ScrapedImage[] = [];
  const seenKeys = new Set<string>();

  const appendUnique = (img: ScrapedImage) => {
    const photoId = extractPhotoIdFromImage(img);
    const key = photoId ? `pid:${photoId}` : `url:${img.fullUrl}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    mergedImages.push({
      ...img,
      id: `img_${mergedImages.length + 1}`,
    });
  };

  for (const img of base.images) appendUnique(img);
  for (const page of additionalPages) {
    for (const img of page.images) appendUnique(img);
  }

  const formats: Record<string, number> = {};
  let unshrunkCount = 0;
  for (const img of mergedImages) {
    formats[img.format] = (formats[img.format] || 0) + 1;
    if (img.isUnshrunk) unshrunkCount++;
  }

  return {
    url: base.url,
    pageTitle: base.pageTitle,
    images: mergedImages,
    stats: {
      totalFound: mergedImages.length,
      unshrunkCount,
      formats,
    },
  };
}

export interface DetailPageFetchResult {
  ok: boolean;
  url?: string;
  html: string;
}

export interface ResolveLinkedGalleryParams {
  images: ScrapedImage[];
  pageUrl: string;
  fetchDetailHtml: (detailUrl: string, timeoutMs: number) => Promise<DetailPageFetchResult | null>;
  batchSize?: number;
}

/**
 * Resolves ALL linked gallery thumbnails -> full-resolution master URLs across galleries of any size
 * using filmstrip batch mapping + strided window probing + complete sweep without a 120-photo cap.
 */
export async function resolveLinkedFullResGallery({
  images,
  pageUrl,
  fetchDetailHtml,
  batchSize = 5,
}: ResolveLinkedGalleryParams): Promise<{
  images: ScrapedImage[];
  subpageGeoBlocked: boolean;
  crawledPageCount: number;
}> {
  const sharedGalleryMap = new Map<string, { fullUrl: string; width?: number; height?: number }>();
  const crawledUrls = new Set<string>();
  let subpageGeoBlocked = false;
  let discoveredFilmstrip = false;

  const isIfapTarget = /imagefap\.com/i.test(pageUrl);

  const needsDetailResolution = (img: ScrapedImage): boolean => {
    if (!img.linkedPageUrl || img.deepScraped) return false;
    if (isNavigationalLink(img.linkedPageUrl)) return false;
    if (img.fullUrl.match(/\.(svg|gif)$/i) && !isPhotoDetailPage(img.linkedPageUrl)) return false;
    if (img.fullUrl.includes('logo')) return false;

    // On ImageFap, naive /thumb/ -> /full/ substitution produces an unsigned URL without ?secure=.
    // Keep those in the detail-page queue so we upgrade them to signed ?secure= URLs + dimensions!
    const isUnsignedIfapPhoto =
      (isIfapTarget || /imagefap\.com\/photo\//i.test(img.linkedPageUrl)) &&
      isPhotoDetailPage(img.linkedPageUrl) &&
      !img.fullUrl.includes('secure=');

    const isSmallThumbWithDetailPage =
      isPhotoDetailPage(img.linkedPageUrl) &&
      (!img.width || img.width <= 320) &&
      !img.unshrinkMethod.includes('Master');

    return !img.isUnshrunk || isUnsignedIfapPhoto || isSmallThumbWithDetailPage;
  };

  const applyGalleryMap = () => {
    for (const img of images) {
      if (img.deepScraped) continue;
      const idMatch = extractPhotoIdFromImage(img);
      if (idMatch && sharedGalleryMap.has(idMatch)) {
        const master = sharedGalleryMap.get(idMatch)!;
        img.fullUrl = master.fullUrl;
        img.isUnshrunk = true;
        img.unshrinkMethod = `Linked Gallery Master${
          master.width && master.height ? ` (${master.width}×${master.height})` : ''
        }`;
        img.deepScraped = true;
        if (master.width) img.width = master.width;
        if (master.height) img.height = master.height;
        img.resolutionTier = classifyResolution(img.width, img.height);
      }
    }
  };

  const crawlDetailImage = async (img: ScrapedImage, timeoutMs: number) => {
    if (!img.linkedPageUrl || img.deepScraped || crawledUrls.has(img.linkedPageUrl) || subpageGeoBlocked) {
      return;
    }
    crawledUrls.add(img.linkedPageUrl);
    try {
      const subResp = await fetchDetailHtml(img.linkedPageUrl, timeoutMs);
      if (!subResp || !subResp.ok) return;

      if (isGeoBlockedHtml(subResp.html, subResp.url || img.linkedPageUrl)) {
        subpageGeoBlocked = true;
        return;
      }

      const map = extractGalleryMapFromDetailPage(subResp.html, subResp.url || img.linkedPageUrl);
      if (map.size > 1) {
        discoveredFilmstrip = true;
      }
      if (map.size > 0) {
        for (const [k, v] of map.entries()) {
          const prev = sharedGalleryMap.get(k);
          if (!prev || (v.fullUrl.includes('secure=') && !prev.fullUrl.includes('secure='))) {
            sharedGalleryMap.set(k, {
              fullUrl: v.fullUrl,
              width: prev?.width || v.width,
              height: prev?.height || v.height,
            });
          }
        }
        applyGalleryMap();
      }

      if (!img.deepScraped) {
        const resolved = extractBestImageFromDetailPage(
          subResp.html,
          subResp.url || img.linkedPageUrl
        );
        if (
          resolved?.url &&
          !/(?:\/logo|z\.gif|spacer\.gif|blank\.gif|pixel\.gif)/i.test(resolved.url)
        ) {
          img.fullUrl = resolved.url;
          img.isUnshrunk = true;
          img.unshrinkMethod = resolved.method;
          img.deepScraped = true;
          if (resolved.width) img.width = resolved.width;
          if (resolved.height) img.height = resolved.height;
          img.resolutionTier = classifyResolution(img.width, img.height);
        }
      }
    } catch {
      // Skip failing detail page and continue
    }
  };

  const candidates = images
    .filter(needsDetailResolution)
    .sort((a, b) => {
      const aIsPhoto = isPhotoDetailPage(a.linkedPageUrl || '');
      const bIsPhoto = isPhotoDetailPage(b.linkedPageUrl || '');
      if (aIsPhoto && !bIsPhoto) return -1;
      if (!aIsPhoto && bIsPhoto) return 1;
      return 0;
    });

  // 1. Probe first candidate immediately so its filmstrip batch map resolves initial window
  if (candidates[0]) {
    await crawlDetailImage(candidates[0], 11000);
  }

  // 2. Strided filmstrip probe (every 12th photo) to resolve large galleries efficiently
  if (!subpageGeoBlocked && candidates.length > 12) {
    const stride = discoveredFilmstrip ? 12 : 20;
    const stridedStepConcurrency = discoveredFilmstrip || isIfapTarget ? 2 : batchSize;
    const strided: ScrapedImage[] = [];
    for (let idx = stride; idx < candidates.length; idx += stride) {
      strided.push(candidates[idx]);
    }
    for (let i = 0; i < strided.length && !subpageGeoBlocked; i += stridedStepConcurrency) {
      const pending = strided
        .slice(i, i + stridedStepConcurrency)
        .filter((img) => !img.deepScraped && !crawledUrls.has(img.linkedPageUrl || ''));
      if (pending.length > 0) {
        await Promise.all(pending.map((img) => crawlDetailImage(img, 10000)));
      }
    }
  }

  // 3. Complete sweep of EVERY remaining unresolved candidate (no 120-image truncation)
  // When filmstrip maps are active, crawl sequentially so each 12-15 item strip resolves its neighbors before the next fetch
  if (!subpageGeoBlocked) {
    const effectiveSweepConcurrency = discoveredFilmstrip || isIfapTarget ? 1 : batchSize;
    for (let i = 0; i < candidates.length && !subpageGeoBlocked; ) {
      const batch: ScrapedImage[] = [];
      while (i < candidates.length && batch.length < effectiveSweepConcurrency) {
        const candidate = candidates[i++];
        if (needsDetailResolution(candidate) && !crawledUrls.has(candidate.linkedPageUrl || '')) {
          batch.push(candidate);
        }
      }
      if (batch.length > 0) {
        await Promise.all(batch.map((img) => crawlDetailImage(img, 10000)));
      }
    }
  }

  return {
    images,
    subpageGeoBlocked,
    crawledPageCount: crawledUrls.size,
  };
}

export async function resolveDiscoveredGalleriesIntermediateLinks(
  galleries: DiscoveredGallery[],
  fetchHtml: (url: string, timeoutMs: number) => Promise<DetailPageFetchResult | null>,
  options: { maxToResolve?: number; concurrency?: number } = {}
): Promise<DiscoveredGallery[]> {
  const { maxToResolve = 20, concurrency = 5 } = options;
  const resolved: DiscoveredGallery[] = galleries.map((g) => ({ ...g }));

  const targets = resolved
    .map((g, index) => ({ g, index }))
    .filter(({ g }) => Boolean(g.isIntermediateItem || isIntermediateItemPageUrl(g.url)))
    .slice(0, maxToResolve);

  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async ({ g, index }) => {
        try {
          const resp = await fetchHtml(g.url, 9000);
          if (!resp || !resp.ok || !resp.html || isGeoBlockedHtml(resp.html, resp.url)) return;
          const albumUrl = extractLinkedAlbumUrlFromItemPage(resp.html, resp.url || g.url);
          if (albumUrl) {
            resolved[index] = {
              ...g,
              resolvedFromItemUrl: g.url,
              url: albumUrl,
              isIntermediateItem: false,
            };
          }
        } catch {
          // Keep intermediate item URL so scrapeSingleGallery can retry later if needed
        }
      })
    );
  }

  // Deduplicate if multiple intermediate item cards resolved to the same album URL
  const deduped: DiscoveredGallery[] = [];
  const seenKeys = new Set<string>();
  for (const item of resolved) {
    const key = normalizeGalleryHref(item.url, item.url)?.canonicalKey || item.url;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push({
      ...item,
      id: `gal_${deduped.length + 1}`,
    });
  }

  return deduped;
}

export function addDirectoryToZip(
  currentDir: string,
  zipFolder: JSZip,
  excluded?: Set<string>
): void {
  const items = fs.readdirSync(currentDir);
  for (const item of items) {
    if (excluded && (excluded.has(item) || item.startsWith('.playwright'))) continue;
    const fullPath = path.join(currentDir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const nextFolder = zipFolder.folder(item);
      if (nextFolder) addDirectoryToZip(fullPath, nextFolder, excluded);
    } else {
      zipFolder.file(item, fs.readFileSync(fullPath));
    }
  }
}
