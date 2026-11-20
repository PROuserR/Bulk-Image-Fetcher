import * as cheerio from 'cheerio';
import type { ExtractionResult } from './htmlExtractor.ts';
import type { ScrapedImage } from './scraperLogic.ts';
import { isBlankOrPlaceholderUrl } from './scraperLogic.ts';

export interface DiscoveredGallery {
  id: string;
  title: string;
  url: string;
  coverThumbnailUrl?: string;
  photoCountHint?: number;
  score: number;
  isIntermediateItem?: boolean;
  resolvedFromItemUrl?: string;
}

export interface NestedGalleryRunInput {
  gallery: DiscoveredGallery;
  result: ExtractionResult | null;
  error?: string;
  geoBlocked?: boolean;
}

export interface NestedGallerySummary {
  id: string;
  title: string;
  url: string;
  coverThumbnailUrl?: string;
  imageCount: number;
  unshrunkCount: number;
  status: 'completed' | 'failed' | 'geo-blocked';
  error?: string;
}

export interface DiscoverGalleryOptions {
  maxGalleries?: number;
  urlPatternFilter?: string;
  sameOriginOnly?: boolean;
}

const DIRECT_ASSET_EXT_REGEX =
  /\.(?:jpg|jpeg|png|webp|avif|gif|svg|bmp|ico|mp4|webm|mov|avi|mkv|pdf|zip|rar|7z|tar|gz|css|js|json|xml)(?:\?.*)?$/i;

const BOILERPLATE_PATH_REGEX =
  /\/(?:login|logout|signin|signup|register|auth|privacy|terms|tos|contact|about|faq|help|dmca|abuse|support|rss|feed|cart|checkout|account|settings|wp-admin|wp-login|cdn-cgi|cookies|legal|advertise|2257)(?:\/|$|\?)/i;

const NON_GALLERY_HARD_PATH_REGEX =
  /\/(?:tags?|categor(?:y|ies)|search|comments?|feeds?)(?:\/|$|\?)|^\/(?:videos?|watch|movies?|clips?|scenes?)(?:\/(?:page|latest|top-rated|most-viewed|popular|trending|new|best))?\/?$/i;

const INTERMEDIATE_ITEM_PATH_REGEX =
  /\/(?:videos?|watch|movies?|clips?|scenes?|episode)\/(?!page\/|latest\/|top-rated\/|most-viewed\/|popular\/|trending\/|new\/|best\/)[^/?#]{2,}(?:\/[^/?#]+)*\/?$/i;

const NON_GALLERY_SOFT_PATH_REGEX =
  /\/(?:models?|pornstars?|actors?|actress(?:es)?|channels?|studios?|users?|profiles?|members?|playlists?)(?:\/|$|\?)/i;

const SINGLE_PHOTO_PAGE_REGEX =
  /\/(?:photo|item|view|image|picture|pic|post)\/[0-9]+(?:\/|$|\?)|[?&](?:photo_?id|pic_?id|image_?id)=[0-9]+|\/albums?\/[0-9]+\/[^/]+\/[0-9]{4,14}(?:\/|$|\?)/i;

const GALLERY_URL_KEYWORD_REGEX =
  /(?:\/(?:gallery|galleries|pictures|picsets?|photosets?|photo-sets?|album|albums|collection|collections|set|sets|series|exhibit|exhibits|shoot|shoots|portfolio|showcase|g)\/|[?&]gid=[0-9]+|gallery\.php|show\.php)/i;

const PARENT_PAGINATION_REGEX =
  /(?:^|\/)(?:page\/)?[0-9]+\/?$|[?&](?:page|from|from_albums|p|offset)=[0-9]+/i;

export function isIntermediateItemPageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'https://placeholder.local');
    if (GALLERY_URL_KEYWORD_REGEX.test(parsed.pathname + parsed.search)) return false;
    if (DIRECT_ASSET_EXT_REGEX.test(parsed.pathname)) return false;
    return INTERMEDIATE_ITEM_PATH_REGEX.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isHubOrSearchPageUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'https://placeholder.local');
    if (GALLERY_URL_KEYWORD_REGEX.test(parsed.pathname + parsed.search)) return false;
    if (isIntermediateItemPageUrl(parsed.href)) return false;
    return /\/(?:search|tags?|categor(?:y|ies)|models?|pornstars?|channels?|studios?)(?:\/|$)/i.test(
      parsed.pathname
    );
  } catch {
    return false;
  }
}

/**
 * Sanitizes a child gallery title into a safe ZIP folder name.
 */
export function sanitizeGalleryFolderName(title: string, fallbackId = 'gallery'): string {
  const cleaned = (title || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 64);
  return cleaned || fallbackId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'gallery';
}

/**
 * Resolves a link relative to parentUrl and returns a canonical comparison key + clean href.
 */
export function normalizeGalleryHref(
  rawHref: string,
  baseUrl: string
): { href: string; canonicalKey: string } | null {
  const trimmed = (rawHref || '').trim();
  if (
    !trimmed ||
    trimmed.startsWith('#') ||
    /^(?:javascript|mailto|tel|data):/i.test(trimmed)
  ) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    parsed.hash = '';

    // Normalize ImageFap ?view=2 variant in canonical comparison while preserving full URL
    const canonical = new URL(parsed.href);
    if (/imagefap\.com$/i.test(canonical.hostname)) {
      canonical.hostname = 'www.imagefap.com';
      canonical.searchParams.delete('view');
      const gid =
        canonical.searchParams.get('gid') ||
        (canonical.pathname.match(/\/(?:pictures|gallery)\/([0-9]+)/i) || [])[1];
      if (gid && /^\/(?:pictures|gallery|gallery\.php)/i.test(canonical.pathname)) {
        return {
          href: parsed.href,
          canonicalKey: `ifap_gid:${gid}`,
        };
      }
    }

    // Deduplicate /albums/<id>/<slug>/ links with identical album ID on same host
    const albumIdMatch = canonical.pathname.match(/^\/albums?\/([0-9]+)(?:\/[^/]+)?\/?$/i);
    if (albumIdMatch) {
      return {
        href: parsed.href,
        canonicalKey: `${canonical.origin}:album:${albumIdMatch[1]}`.toLowerCase(),
      };
    }

    const cleanPath =
      canonical.pathname.length > 1 ? canonical.pathname.replace(/\/+$/, '') : canonical.pathname;
    canonical.pathname = cleanPath;

    return {
      href: parsed.href,
      canonicalKey: `${canonical.origin}${canonical.pathname}${canonical.search}`.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/**
 * Checks whether a URL or gallery title matches a user-supplied substring or /regex/ filter.
 */
export function matchesGalleryUrlFilter(
  url: string,
  title: string,
  pattern?: string
): boolean {
  const cleanPattern = (pattern || '').trim();
  if (!cleanPattern) return true;

  if (cleanPattern.startsWith('/') && cleanPattern.lastIndexOf('/') > 0) {
    const lastSlash = cleanPattern.lastIndexOf('/');
    const body = cleanPattern.slice(1, lastSlash);
    const flags = cleanPattern.slice(lastSlash + 1) || 'i';
    try {
      const rx = new RegExp(body, flags.includes('i') ? flags : `${flags}i`);
      return rx.test(url) || rx.test(title);
    } catch {
      // Fall back to substring match if regex syntax is invalid
    }
  }

  const needle = cleanPattern.toLowerCase();
  return url.toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
}

function getRootDomain(hostname: string): string {
  const clean = hostname.toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.');
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join('.');
}

function extractPhotoCountHint(text: string): number | undefined {
  if (!text) return undefined;
  const explicitMatch = text.match(/\b([0-9]{1,5})\s*(?:photos?|images?|pics?|pictures?|items?|files?)\b/i);
  if (explicitMatch) {
    const val = parseInt(explicitMatch[1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  const parenMatch = text.match(/[\(\[]([0-9]{1,5})[\)\]]/);
  if (parenMatch) {
    const val = parseInt(parenMatch[1], 10);
    if (!isNaN(val) && val > 0 && val < 50000) return val;
  }
  return undefined;
}

function formatSlugFallbackTitle(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = decodeURIComponent(segments[segments.length - 1] || parsed.hostname);
    return last
      .replace(/[-_]+/g, ' ')
      .replace(/\.[a-z0-9]+$/i, '')
      .trim() || urlStr;
  } catch {
    return urlStr;
  }
}

function extractBackgroundImageUrl(styleAttr?: string): string | undefined {
  if (!styleAttr) return undefined;
  const match = styleAttr.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Extracts pagination URLs for a parent hub/search/listing webpage (e.g., /search/topic/2/, ?page=2, ?from=2).
 */
export function extractParentHubPaginationUrls(
  html: string,
  parentUrl: string,
  maxPages = 4
): string[] {
  if (!html || !parentUrl || maxPages <= 0) return [];
  let parentParsed: URL;
  try {
    parentParsed = new URL(parentUrl);
  } catch {
    return [];
  }

  const $ = cheerio.load(html);
  const cleanParentPath = parentParsed.pathname.replace(/\/+$/, '');
  const parentRootDomain = getRootDomain(parentParsed.hostname);
  const seen = new Set<string>([parentParsed.href.replace(/\/+$/, '')]);
  const pages: { pageNum: number; href: string }[] = [];

  $(
    '.pagination a[href], .pager a[href], .paginator a[href], .page-numbers a[href], a[rel="next"], a[href*="page="], a[href*="from="]'
  ).each((_, el) => {
    const $a = $(el);
    const rawHref = ($a.attr('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
    try {
      const resolved = new URL(rawHref, parentParsed.href);
      if (getRootDomain(resolved.hostname) !== parentRootDomain) return;
      resolved.hash = '';
      const cleanResolvedPath = resolved.pathname.replace(/\/+$/, '');
      const key = `${resolved.origin}${cleanResolvedPath}${resolved.search}`;
      if (seen.has(key)) return;

      const queryPageStr =
        resolved.searchParams.get('page') ||
        resolved.searchParams.get('from') ||
        resolved.searchParams.get('from_albums') ||
        resolved.searchParams.get('p');
      const trailingPageMatch = cleanResolvedPath.match(
        new RegExp(`^${cleanParentPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/page)?/([0-9]+)$`, 'i')
      );

      let pageNum = queryPageStr ? parseInt(queryPageStr, 10) : NaN;
      if (isNaN(pageNum) && trailingPageMatch) {
        pageNum = parseInt(trailingPageMatch[1], 10);
      }
      if (isNaN(pageNum) && $a.attr('rel') === 'next') {
        pageNum = 2;
      }
      if (!isNaN(pageNum) && pageNum >= 2 && pageNum <= 50) {
        seen.add(key);
        pages.push({ pageNum, href: resolved.href });
      }
    } catch {}
  });

  return pages
    .sort((a, b) => a.pageNum - b.pageNum)
    .slice(0, maxPages)
    .map((p) => p.href);
}

/**
 * Extracts a dedicated linked album/gallery URL from an intermediate item page
 * (e.g., /video/post-workout-smoothie/ linking to /albums/20306/post-workout-smoothie/),
 * prioritizing slug similarity and main-content gallery buttons while excluding related grids.
 */
export function extractLinkedAlbumUrlFromItemPage(
  html: string,
  itemPageUrl: string
): string | null {
  if (!html || !itemPageUrl) return null;

  let itemParsed: URL;
  try {
    itemParsed = new URL(itemPageUrl);
  } catch {
    return null;
  }

  // Already a direct album/gallery page
  if (/\/(?:albums?|galleries|gallery|pictures)\/[0-9]+/i.test(itemParsed.pathname)) {
    return null;
  }

  const itemRootDomain = getRootDomain(itemParsed.hostname);
  const pathSegments = itemParsed.pathname.split('/').filter(Boolean);
  const rawSlug = decodeURIComponent(pathSegments[pathSegments.length - 1] || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '');
  const slugTokens = rawSlug
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^(?:the|and|for|with|from|part|ep|episode)$/i.test(t));

  const $ = cheerio.load(html);
  const candidates = new Map<string, number>();

  const scoreCandidate = (rawHref: string, baseScore: number, contextText: string, inRelatedOrChrome: boolean) => {
    const normalized = normalizeGalleryHref(rawHref, itemParsed.href);
    if (!normalized) return;

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(normalized.href);
    } catch {
      return;
    }

    if (getRootDomain(resolvedUrl.hostname) !== itemRootDomain) return;
    if (DIRECT_ASSET_EXT_REGEX.test(resolvedUrl.pathname)) return;
    if (SINGLE_PHOTO_PAGE_REGEX.test(resolvedUrl.pathname)) return;
    if (!GALLERY_URL_KEYWORD_REGEX.test(resolvedUrl.pathname + resolvedUrl.search)) return;
    // Ignore bare /albums/ or /galleries/ navigation index links without an album ID or slug
    if (/^\/(?:albums?|galleries|gallery|pictures)\/?$/i.test(resolvedUrl.pathname)) return;

    const candPathLower = resolvedUrl.pathname.toLowerCase();
    let score = baseScore;

    if (/\/(?:albums?|galleries|gallery|pictures)\/[0-9]+/i.test(candPathLower)) {
      score += 40;
    }

    if (rawSlug.length >= 4 && candPathLower.includes(rawSlug)) {
      score += 120;
    } else if (slugTokens.length > 0) {
      let matchedTokens = 0;
      for (const tok of slugTokens) {
        if (candPathLower.includes(tok)) matchedTokens++;
      }
      if (matchedTokens >= 2 || (slugTokens.length === 1 && matchedTokens === 1)) {
        score += 75;
      } else if (matchedTokens === 1 && slugTokens.length <= 3) {
        score += 30;
      }
    }

    if (/\b(?:album|gallery|photos?|pictures?|pics?|screenshots?|images?|stills?)\b/i.test(contextText)) {
      score += 35;
    }

    if (inRelatedOrChrome) {
      score -= 80;
    }

    const prev = candidates.get(resolvedUrl.href) ?? -999;
    if (score > prev) {
      candidates.set(resolvedUrl.href, score);
    }
  };

  $('a[href]').each((_, el) => {
    const $a = $(el);
    const rawHref = ($a.attr('href') || '').trim();
    if (!rawHref) return;

    const inChrome = $a.closest('header, nav, footer').length > 0;
    const inRelated =
      $a.closest(
        '[class*="related" i], [id*="related" i], [class*="recommend" i], [class*="similar" i], .sidebar, aside'
      ).length > 0;
    const inMainAction =
      $a.closest(
        'main, .video-info, .info, .details, .tabs, .actions, .buttons, [class*="album" i], [class*="gallery" i], [class*="photo" i]'
      ).length > 0;

    const contextText = `${$a.text()} ${$a.attr('title') || ''} ${$a.attr('aria-label') || ''} ${$a.attr('class') || ''}`
      .replace(/\s+/g, ' ')
      .trim();

    scoreCandidate(rawHref, inMainAction ? 25 : 5, contextText, inChrome || inRelated);
  });

  // Fallback: scan inline scripts / attributes for explicit album paths containing the item slug
  if (rawSlug.length >= 4) {
    const escapedMatches = html.match(/\/(?:albums?|galleries|gallery)\/[0-9]+\/[a-z0-9_-]+(?:\/)?/gi) || [];
    for (const m of escapedMatches) {
      if (m.toLowerCase().includes(rawSlug) || slugTokens.filter((t) => m.toLowerCase().includes(t)).length >= 2) {
        scoreCandidate(m, 30, 'inline album link', false);
      }
    }
  }

  let bestUrl: string | null = null;
  let bestScore = 54;
  for (const [href, score] of candidates.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestUrl = href;
    }
  }

  return bestUrl;
}

/**
 * Discovers child gallery URLs hosted on a parent / index / hub webpage.
 */
export function discoverChildGalleryLinks(
  html: string,
  parentUrl: string,
  options: DiscoverGalleryOptions = {}
): DiscoveredGallery[] {
  if (!html || !parentUrl) return [];

  const {
    maxGalleries = 50,
    urlPatternFilter = '',
    sameOriginOnly = true,
  } = options;

  const $ = cheerio.load(html);
  const effectiveParent =
    /^(?:preset|mock):/i.test(parentUrl)
      ? 'https://photography-archive.local/'
      : parentUrl;

  let parentParsed: URL | null = null;
  try {
    parentParsed = new URL(effectiveParent);
  } catch {
    return [];
  }

  const parentCanonical = normalizeGalleryHref(parentParsed.href, parentParsed.href);
  const parentRootDomain = getRootDomain(parentParsed.hostname);

  interface CandidateRecord {
    url: string;
    canonicalKey: string;
    title: string;
    coverThumbnailUrl?: string;
    photoCountHint?: number;
    baseScore: number;
    hasGalleryKeyword: boolean;
    pathPrefix: string;
    order: number;
  }

  const byKey = new Map<string, CandidateRecord>();
  const prefixCounts = new Map<string, number>();
  let orderCounter = 0;

  $('a[href]').each((_, el) => {
    const $a = $(el);
    const rawHref = $a.attr('href') || '';
    const resolved = normalizeGalleryHref(rawHref, effectiveParent);
    if (!resolved) return;

    // Exclude link to self
    if (parentCanonical && resolved.canonicalKey === parentCanonical.canonicalKey) return;

    let linkUrl: URL;
    try {
      linkUrl = new URL(resolved.href);
    } catch {
      return;
    }

    // Same-origin / same-root-domain guard
    if (sameOriginOnly) {
      const linkRoot = getRootDomain(linkUrl.hostname);
      if (linkRoot !== parentRootDomain) return;
    }

    // Skip direct image/asset links (these are single files, not a nested gallery webpage)
    if (DIRECT_ASSET_EXT_REGEX.test(linkUrl.pathname)) return;

    // Skip auth/legal/UI boilerplate links
    if (BOILERPLATE_PATH_REGEX.test(linkUrl.pathname)) return;

    // Skip pagination controls and parent-path numeric pagination (/search/topic/2/, ?page=2, ?from=2)
    const inPaginationContainer =
      $a.closest(
        '.pagination, .pager, .paginator, .page-numbers, .pages, [aria-label*="pagination" i], [class*="pagination" i]'
      ).length > 0 ||
      /^(?:next|prev)$/i.test(($a.attr('rel') || '').trim());
    if (inPaginationContainer && !urlPatternFilter.trim()) {
      return;
    }

    const cleanLinkPath = linkUrl.pathname.replace(/\/+$/, '');
    const cleanParentPath = parentParsed!.pathname.replace(/\/+$/, '');
    const isParentSubPagination =
      (cleanLinkPath === cleanParentPath ||
        (cleanParentPath.length > 1 && cleanLinkPath.startsWith(`${cleanParentPath}/`))) &&
      PARENT_PAGINATION_REGEX.test(resolved.href);
    if (isParentSubPagination && !urlPatternFilter.trim()) {
      return;
    }

    // Skip individual photo detail pages (/photo/123, /albums/30560/slug/1556864/) unless user pattern explicitly targets them
    if (
      (SINGLE_PHOTO_PAGE_REGEX.test(linkUrl.pathname) || SINGLE_PHOTO_PAGE_REGEX.test(resolved.href)) &&
      !urlPatternFilter.trim()
    ) {
      return;
    }

    const hasGalleryKeyword = GALLERY_URL_KEYWORD_REGEX.test(resolved.href);
    const isIntermediateItem = !hasGalleryKeyword && isIntermediateItemPageUrl(resolved.href);

    // Exclude non-gallery hub entity routes (/tags/, /categories/, /search/, bare /videos/) unless user filter targets them
    if (
      !urlPatternFilter.trim() &&
      !hasGalleryKeyword &&
      !isIntermediateItem &&
      NON_GALLERY_HARD_PATH_REGEX.test(linkUrl.pathname)
    ) {
      return;
    }

    // Check enclosing card/list item context for cover thumbnail & heading
    const $card = $a.closest(
      'article, figure, .gallery-card, .gallery-item, .album, .album-card, .album-item, .video-item, .thumb, .item, .box, .cell, .card, li, td'
    );
    const $thumbImg = $a.find('img').first().length
      ? $a.find('img').first()
      : $card.length
        ? $card.find('img').first()
        : $();

    let coverThumbnailUrl: string | undefined;
    if ($thumbImg.length > 0) {
      const rawThumb =
        $thumbImg.attr('data-original') ||
        $thumbImg.attr('data-src') ||
        $thumbImg.attr('data-lazy-src') ||
        $thumbImg.attr('data-lazy') ||
        $thumbImg.attr('data-echo') ||
        $thumbImg.attr('data-webp') ||
        $thumbImg.attr('data-thumb') ||
        $thumbImg.attr('data-preview') ||
        $thumbImg.attr('data-poster') ||
        $thumbImg.attr('data-img') ||
        $thumbImg.attr('data-bg') ||
        $thumbImg.attr('src') ||
        '';
      if (rawThumb && !isBlankOrPlaceholderUrl(rawThumb)) {
        try {
          coverThumbnailUrl = new URL(rawThumb, effectiveParent).href;
        } catch {
          coverThumbnailUrl = rawThumb;
        }
      }
    }

    if (!coverThumbnailUrl) {
      const posterAttr =
        $a.find('video[poster]').first().attr('poster') ||
        $card.find('video[poster]').first().attr('poster');
      if (posterAttr && !isBlankOrPlaceholderUrl(posterAttr)) {
        try {
          coverThumbnailUrl = new URL(posterAttr, effectiveParent).href;
        } catch {
          coverThumbnailUrl = posterAttr;
        }
      }
    }

    if (!coverThumbnailUrl) {
      const bgStyle =
        $a.attr('style') ||
        $a.find('[style*="background-image"]').first().attr('style') ||
        $card.find('[style*="background-image"]').first().attr('style');
      const bgRaw = extractBackgroundImageUrl(bgStyle);
      if (bgRaw && !isBlankOrPlaceholderUrl(bgRaw)) {
        try {
          coverThumbnailUrl = new URL(bgRaw, effectiveParent).href;
        } catch {
          coverThumbnailUrl = bgRaw;
        }
      }
    }

    const cardText = ($card.length ? $card.text() : $a.text()).replace(/\s+/g, ' ').trim();
    const headingText = $card.length
      ? $card
          .find('h1, h2, h3, h4, h5, figcaption, .title, .thumb-title, .gallery-title, .album-title')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    const linkText = $a.text().replace(/\s+/g, ' ').trim();
    const rawTitle =
      $a.attr('title')?.trim() ||
      $a.attr('aria-label')?.trim() ||
      headingText ||
      (linkText.length >= 2 && linkText.length <= 120 ? linkText : '') ||
      $thumbImg.attr('alt')?.trim() ||
      formatSlugFallbackTitle(resolved.href);

    let photoCountHint = extractPhotoCountHint(cardText);
    if (!photoCountHint && $card.length) {
      const badgeText = $card
        .find('.photos, .photo-count, .count, .total, .qty, .album-photos, [class*="photo" i], [class*="count" i]')
        .first()
        .text()
        .trim();
      if (/^[0-9]{1,4}$/.test(badgeText)) {
        const parsedCount = parseInt(badgeText, 10);
        if (parsedCount > 0 && parsedCount < 50000) {
          photoCountHint = parsedCount;
        }
      }
    }

    if (urlPatternFilter && !matchesGalleryUrlFilter(resolved.href, rawTitle, urlPatternFilter)) {
      return;
    }

    const inChromeNav =
      $a.closest('nav, header, footer').length > 0 && !coverThumbnailUrl;
    const isSoftNonGallery =
      !urlPatternFilter.trim() &&
      !hasGalleryKeyword &&
      !isIntermediateItem &&
      NON_GALLERY_SOFT_PATH_REGEX.test(linkUrl.pathname);

    let score = 0;
    if (hasGalleryKeyword) score += 45;
    if (isIntermediateItem) score += 25;
    if (/\/albums?\/[0-9]+/i.test(linkUrl.pathname)) score += 15;
    if (coverThumbnailUrl) score += 30;
    if (getRootDomain(linkUrl.hostname) === parentRootDomain) score += 15;
    if (photoCountHint) score += 10;
    if (
      $card.length > 0 &&
      ($card.is('article, figure') || /gallery|album|grid|item|card|thumb|video/i.test($card.attr('class') || ''))
    ) {
      score += 10;
    }
    if (urlPatternFilter.trim()) score += 25;
    if (inChromeNav) score -= 35;
    if (isSoftNonGallery) score -= 55;
    if (linkUrl.pathname === '/' && !linkUrl.search) score -= 35;

    const segments = linkUrl.pathname.split('/').filter(Boolean);
    const pathPrefix = segments.length > 0 ? `/${segments[0]}/:${segments.length}` : '/';

    const existing = byKey.get(resolved.canonicalKey);
    if (existing) {
      if (!existing.coverThumbnailUrl && coverThumbnailUrl) {
        existing.coverThumbnailUrl = coverThumbnailUrl;
        existing.baseScore += 20;
      }
      if ((!existing.title || existing.title === existing.url) && rawTitle) {
        existing.title = rawTitle;
      }
      if (!existing.photoCountHint && photoCountHint) {
        existing.photoCountHint = photoCountHint;
        existing.baseScore += 10;
      }
      if (resolved.href.length > existing.url.length && hasGalleryKeyword) {
        existing.url = resolved.href;
      }
      existing.baseScore = Math.max(existing.baseScore, score);
      return;
    }

    prefixCounts.set(pathPrefix, (prefixCounts.get(pathPrefix) || 0) + 1);
    byKey.set(resolved.canonicalKey, {
      url: resolved.href,
      canonicalKey: resolved.canonicalKey,
      title: rawTitle,
      coverThumbnailUrl,
      photoCountHint,
      baseScore: score,
      hasGalleryKeyword,
      isIntermediateItem,
      pathPrefix,
      order: orderCounter++,
    } as CandidateRecord & { isIntermediateItem: boolean });
  });

  // If the page primarily lists explicit gallery/album links (/albums/, /galleries/, etc.),
  // raise the threshold for generic/stray video links so sidebar promos don't pollute direct album lists.
  // When /video/<slug>/ cards are the primary listing (or outnumber albums), include them for album resolution.
  const allCandidates = Array.from(byKey.values()) as Array<
    CandidateRecord & { isIntermediateItem?: boolean }
  >;
  const explicitGalleryCount = allCandidates.filter((item) => item.hasGalleryKeyword).length;
  const intermediateItemCount = allCandidates.filter((item) => item.isIntermediateItem).length;
  const preferDirectGalleriesOnly =
    explicitGalleryCount >= 2 && explicitGalleryCount >= intermediateItemCount;

  const candidates: Array<DiscoveredGallery & { order: number }> = [];
  for (const typedItem of allCandidates) {
    if (preferDirectGalleriesOnly && typedItem.isIntermediateItem && !urlPatternFilter.trim()) {
      continue;
    }
    const siblingCount = prefixCounts.get(typedItem.pathPrefix) || 0;
    const finalScore = typedItem.baseScore + (siblingCount >= 2 && typedItem.pathPrefix !== '/' ? 15 : 0);
    const minScore =
      preferDirectGalleriesOnly &&
      !typedItem.hasGalleryKeyword &&
      !urlPatternFilter.trim()
        ? 65
        : 30;
    if (finalScore < minScore && !urlPatternFilter.trim()) continue;

    candidates.push({
      id: `gal_${candidates.length + 1}`,
      title: typedItem.title,
      url: typedItem.url,
      coverThumbnailUrl: typedItem.coverThumbnailUrl,
      photoCountHint: typedItem.photoCountHint,
      score: finalScore,
      isIntermediateItem: typedItem.isIntermediateItem || undefined,
      order: typedItem.order,
    });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.order - b.order;
  });

  return candidates.slice(0, Math.max(1, maxGalleries)).map(({ order: _order, ...rest }, idx) => ({
    ...rest,
    id: `gal_${idx + 1}`,
  }));
}

/**
 * Merges extraction results across multiple child galleries into a unified collection
 * with per-image gallery metadata and per-gallery summary telemetry.
 */
export function mergeNestedGalleryResults(
  parentUrl: string,
  parentTitle: string,
  runs: NestedGalleryRunInput[]
): {
  url: string;
  pageTitle: string;
  images: ScrapedImage[];
  galleries: NestedGallerySummary[];
  stats: {
    totalFound: number;
    unshrunkCount: number;
    formats: Record<string, number>;
    galleryCount: number;
    completedGalleries: number;
  };
} {
  const mergedImages: ScrapedImage[] = [];
  const galleries: NestedGallerySummary[] = [];
  const seenFullUrls = new Set<string>();
  const formats: Record<string, number> = {};
  let unshrunkCount = 0;
  let completedGalleries = 0;

  for (const run of runs) {
    const g = run.gallery;
    if (!run.result || run.error) {
      galleries.push({
        id: g.id,
        title: g.title,
        url: g.url,
        coverThumbnailUrl: g.coverThumbnailUrl,
        imageCount: 0,
        unshrunkCount: 0,
        status: run.geoBlocked ? 'geo-blocked' : 'failed',
        error: run.error || (run.geoBlocked ? 'Geo-blocked by remote host' : 'Failed to extract gallery'),
      });
      continue;
    }

    completedGalleries++;
    let galleryImgCount = 0;
    let galleryUnshrunk = 0;

    for (const img of run.result.images) {
      const dedupeKey = `${img.fullUrl}`;
      if (seenFullUrls.has(dedupeKey)) continue;
      seenFullUrls.add(dedupeKey);

      galleryImgCount++;
      if (img.isUnshrunk) {
        galleryUnshrunk++;
        unshrunkCount++;
      }
      formats[img.format] = (formats[img.format] || 0) + 1;

      mergedImages.push({
        ...img,
        id: `img_${mergedImages.length + 1}`,
        galleryId: g.id,
        galleryTitle: g.title || run.result.pageTitle || g.url,
        galleryUrl: g.url,
      });
    }

    galleries.push({
      id: g.id,
      title: g.title || run.result.pageTitle || g.url,
      url: g.url,
      coverThumbnailUrl: g.coverThumbnailUrl || run.result.images[0]?.thumbnailUrl,
      imageCount: galleryImgCount,
      unshrunkCount: galleryUnshrunk,
      status: run.geoBlocked ? 'geo-blocked' : 'completed',
    });
  }

  return {
    url: parentUrl,
    pageTitle: parentTitle || `Nested Multi-Gallery Archive (${galleries.length} galleries)`,
    images: mergedImages,
    galleries,
    stats: {
      totalFound: mergedImages.length,
      unshrunkCount,
      formats,
      galleryCount: galleries.length,
      completedGalleries,
    },
  };
}
