import * as cheerio from 'cheerio';
import type { ScrapedImage } from './scraperLogic.ts';
import {
  parseHighestSrcset,
  unshrinkImageUrl,
  detectFormat,
  extractFilename,
  classifyResolution,
} from './scraperLogic.ts';
import {
  extractInstagramMediaFromJson,
  extractInstagramMediaFromHtml,
} from './instagramExtractor.ts';

export interface ExtractionResult {
  url: string;
  pageTitle: string;
  images: ScrapedImage[];
  stats: {
    totalFound: number;
    unshrunkCount: number;
    formats: Record<string, number>;
  };
}

/**
 * Extracts and unshrinks all images from given HTML content and base URL.
 */
export function extractImagesFromHtml(html: string, pageUrl: string): ExtractionResult {
  if (
    (/instagram\.com/i.test(pageUrl) && !/uk_ban/i.test(html)) ||
    html.includes('edge_owner_to_timeline_media') ||
    html.includes('xdt_api__v1__feed__user_timeline_graphql_connection') ||
    html.includes('xdt_api__v1__clips__user_connection_v2') ||
    html.includes('contextJSON') ||
    html.includes('graphql_media')
  ) {
    const igResult = extractInstagramMediaFromHtml(html, pageUrl);
    if (igResult.images.length > 0) {
      const formats: Record<string, number> = {};
      for (const img of igResult.images) {
        formats[img.format] = (formats[img.format] || 0) + 1;
      }
      return {
        url: pageUrl,
        pageTitle: igResult.username
          ? `@${igResult.username}${igResult.fullName ? ` (${igResult.fullName})` : ''} — Instagram Photos`
          : pageUrl,
        images: igResult.images,
        stats: {
          totalFound: igResult.images.length,
          unshrunkCount: igResult.images.length,
          formats,
        },
      };
    }
  }

  const $ = cheerio.load(html);
  const pageTitle = $('title').first().text().trim() || pageUrl;
  const baseUrl =
    /\.local/i.test(pageUrl) && (/imagefap\.com/i.test(html) || /\/photo\/[0-9]{5,14}/i.test(html))
      ? 'https://www.imagefap.com/'
      : pageUrl;

  const foundImages: ScrapedImage[] = [];
  const seenUrls = new Set<string>();

  let idCounter = 1;

  function addImage(candidate: {
    thumb: string;
    full: string;
    isUnshrunk: boolean;
    method: string;
    alt?: string;
    width?: number;
    height?: number;
    context?: string;
    linkedPageUrl?: string;
    deepScraped?: boolean;
    fallbackUrl?: string;
  }) {
    if (!candidate.full) return;

    // Filter out data:image 1x1 spacer gifs and tracking pixels
    if (candidate.full.startsWith('data:') && candidate.full.length < 250) {
      return;
    }

    const lowerCandidate = (candidate.full + ' ' + (candidate.thumb || '')).toLowerCase();
    if (
      lowerCandidate.includes('/img/z.gif') ||
      lowerCandidate.includes('spacer.gif') ||
      lowerCandidate.includes('blank.gif') ||
      lowerCandidate.includes('pixel.gif') ||
      lowerCandidate.includes('ajax-loader.gif') ||
      lowerCandidate.includes('/captcha') ||
      (candidate.width && candidate.height && candidate.width <= 25 && candidate.height <= 25)
    ) {
      return;
    }

    // Resolve relative URLs to absolute
    let resolvedFull = candidate.full;
    let resolvedThumb = candidate.thumb || candidate.full;

    try {
      resolvedFull = new URL(candidate.full, baseUrl).href;
    } catch {
      // ignore
    }

    try {
      resolvedThumb = new URL(resolvedThumb, baseUrl).href;
    } catch {
      // ignore
    }

    let resolvedLinkedPage = candidate.linkedPageUrl;
    if (resolvedLinkedPage) {
      try {
        resolvedLinkedPage = new URL(resolvedLinkedPage, baseUrl).href;
      } catch {}
    }

    // Deduplicate on resolvedFull
    if (seenUrls.has(resolvedFull)) return;
    seenUrls.add(resolvedFull);

    const format = detectFormat(resolvedFull);
    const filename = extractFilename(resolvedFull, idCounter - 1, format);
    const resolutionTier = classifyResolution(candidate.width, candidate.height);

    let aspectRatio: string | undefined = undefined;
    if (candidate.width && candidate.height) {
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const divisor = gcd(candidate.width, candidate.height);
      aspectRatio = `${candidate.width / divisor}:${candidate.height / divisor}`;
    }

    foundImages.push({
      id: `img_${idCounter++}`,
      thumbnailUrl: resolvedThumb,
      fullUrl: resolvedFull,
      isUnshrunk: candidate.isUnshrunk,
      unshrinkMethod: candidate.method,
      altText: candidate.alt || filename,
      format,
      width: candidate.width,
      height: candidate.height,
      aspectRatio,
      resolutionTier,
      filename,
      sourceContext: candidate.context,
      linkedPageUrl: resolvedLinkedPage,
      deepScraped: candidate.deepScraped,
      fallbackUrl: candidate.fallbackUrl,
    });
  }

  // 1. Process <img> elements
  $('img').each((_, el) => {
    const $img = $(el);
    const rawSrc = $img.attr('src') || '';
    const dataSrc =
      $img.attr('data-original') ||
      $img.attr('data-high-res') ||
      $img.attr('data-full') ||
      $img.attr('data-zoom-image') ||
      $img.attr('data-large') ||
      $img.attr('data-max') ||
      $img.attr('data-src') ||
      $img.attr('data-desktop-src') ||
      $img.attr('data-orig-file') ||
      '';

    const srcset = $img.attr('srcset') || $img.attr('data-srcset') || '';
    const alt = $img.attr('alt') || '';
    const rawWidth = parseInt($img.attr('width') || '', 10);
    const rawHeight = parseInt($img.attr('height') || '', 10);

    // Check if image is wrapped in an anchor:
    // It can either point to a direct image file OR to a detail webpage!
    const $parentLink = $img.closest('a');
    let parentHref = $parentLink.attr('href') || '';
    const parentOriginal =
      $parentLink.attr('original') ||
      $parentLink.attr('data-original-url') ||
      $parentLink.attr('data-full-url') ||
      '';
    const parentDimension = $parentLink.attr('dimension') || '';
    let parentWidth: number | undefined;
    let parentHeight: number | undefined;
    if (parentDimension && parentDimension.includes('x')) {
      const parts = parentDimension.split('x');
      const pw = parseInt(parts[0], 10);
      const ph = parseInt(parts[1], 10);
      if (!isNaN(pw) && !isNaN(ph)) {
        parentWidth = pw;
        parentHeight = ph;
      }
    }

    let isAnchorImage = false;
    let linkedPageUrl: string | undefined = undefined;

    if (parentHref) {
      const lower = parentHref.toLowerCase().split('?')[0];
      if (
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.png') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.avif') ||
        lower.endsWith('.gif') ||
        lower.endsWith('.svg')
      ) {
        isAnchorImage = true;
      } else if (!parentHref.startsWith('#') && !parentHref.startsWith('javascript:')) {
        // Points to a linked detail webpage!
        linkedPageUrl = parentHref;
      }
    }

    // Check srcset first
    const bestSrcset = parseHighestSrcset(srcset, baseUrl);

    // Determine candidate thumb and full
    const thumbCandidate = rawSrc || dataSrc;
    let fullCandidate = thumbCandidate;
    let isUnshrunk = false;
    let method = 'Direct <img> src';

    if (parentOriginal && !parentOriginal.includes('z.gif') && !parentOriginal.includes('spacer.gif')) {
      fullCandidate = parentOriginal;
      isUnshrunk = true;
      method = `Enclosing Master Asset${parentWidth && parentHeight ? ` (${parentWidth}×${parentHeight})` : ''}`;
    } else if (isAnchorImage) {
      fullCandidate = parentHref;
      isUnshrunk = true;
      method = 'Enclosing Lightbox Link (<a> href)';
    } else if (bestSrcset && bestSrcset.url) {
      fullCandidate = bestSrcset.url;
      isUnshrunk = true;
      method = `Srcset Max Resolution (${bestSrcset.width ? bestSrcset.width + 'w' : 'Density'})`;
    } else if (dataSrc) {
      fullCandidate = dataSrc;
      isUnshrunk = true;
      method = 'LazyLoad Data Attribute (data-original / data-high-res)';
    }

    // Also run pattern unshrinker on the candidate
    const unshrinkResult = unshrinkImageUrl(fullCandidate);
    if (unshrinkResult.isUnshrunk) {
      fullCandidate = unshrinkResult.fullUrl;
      isUnshrunk = true;
      method = unshrinkResult.method;
    }

    const finalWidth = parentWidth || (!isNaN(rawWidth) ? rawWidth : bestSrcset?.width);
    const finalHeight = parentHeight || (!isNaN(rawHeight) ? rawHeight : undefined);
    const fallbackUrl =
      $parentLink.attr('data-fallback-url') ||
      $img.attr('data-fallback-url') ||
      undefined;

    if (fullCandidate) {
      addImage({
        thumb: thumbCandidate || fullCandidate,
        full: fullCandidate,
        isUnshrunk,
        method,
        alt,
        width: finalWidth,
        height: finalHeight,
        context: 'Image tag <img>',
        linkedPageUrl,
        fallbackUrl,
      });
    }
  });

  // 2. Process <picture> elements with <source>
  $('picture').each((_, pic) => {
    const $pic = $(pic);
    let bestSourceUrl: string | null = null;
    let maxWidth = 0;

    $pic.find('source').each((_, srcEl) => {
      const srcset = $(srcEl).attr('srcset') || '';
      const parsed = parseHighestSrcset(srcset, baseUrl);
      if (parsed) {
        if ((parsed.width || 0) > maxWidth || !bestSourceUrl) {
          maxWidth = parsed.width || 0;
          bestSourceUrl = parsed.url;
        }
      }
    });

    const fallbackImg = $pic.find('img').first();
    const fallbackSrc = fallbackImg.attr('src') || '';
    const alt = fallbackImg.attr('alt') || '';

    if (bestSourceUrl) {
      const unshrinkResult = unshrinkImageUrl(bestSourceUrl);
      addImage({
        thumb: fallbackSrc || unshrinkResult.fullUrl,
        full: unshrinkResult.fullUrl,
        isUnshrunk: true,
        method: unshrinkResult.isUnshrunk ? unshrinkResult.method : 'Picture <source> Max Resolution',
        alt,
        width: maxWidth || undefined,
        context: 'Picture tag <picture>',
      });
    }
  });

  // 2.5. Process gallery anchors with original full-size attribute: <a original="..." href="..." dimension="...">
  $('a[original], a[data-original-url], a[data-full-url]').each((_, aEl) => {
    const $a = $(aEl);
    const orig = $a.attr('original') || $a.attr('data-original-url') || $a.attr('data-full-url') || '';
    if (orig && !orig.includes('z.gif') && !orig.includes('spacer.gif')) {
      const dim = $a.attr('dimension') || '';
      let w: number | undefined;
      let h: number | undefined;
      if (dim && dim.includes('x')) {
        const parts = dim.split('x');
        const parsedW = parseInt(parts[0], 10);
        const parsedH = parseInt(parts[1], 10);
        if (!isNaN(parsedW) && !isNaN(parsedH)) {
          w = parsedW;
          h = parsedH;
        }
      }
      const childImg = $a.find('img').first();
      const thumb = childImg.attr('src') || orig;
      const alt = childImg.attr('alt') || $a.attr('title') || '';
      const fallbackUrl = $a.attr('data-fallback-url') || childImg.attr('data-fallback-url') || undefined;
      const href = $a.attr('href') || undefined;
      addImage({
        thumb,
        full: orig,
        isUnshrunk: true,
        method: `Original Master Asset${w && h ? ` (${w}×${h})` : ''}`,
        alt,
        width: w,
        height: h,
        context: 'Gallery Anchor original',
        linkedPageUrl: href,
        fallbackUrl,
      });
    }
  });

  // 3. Process standalone high-res image links: <a href="...photo.jpg">
  $('a[href]').each((_, aEl) => {
    const href = $(aEl).attr('href') || '';
    const lower = href.toLowerCase().split('?')[0];
    if (
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.avif')
    ) {
      const text = $(aEl).text().trim() || 'Standalone image link';
      const unshrink = unshrinkImageUrl(href);
      addImage({
        thumb: unshrink.fullUrl,
        full: unshrink.fullUrl,
        isUnshrunk: unshrink.isUnshrunk,
        method: unshrink.isUnshrunk ? unshrink.method : 'Direct Image Link',
        alt: text,
        context: 'Hyperlink <a>',
      });
    }
  });

  // 4. Meta tags: og:image, twitter:image
  $('meta[property="og:image"], meta[name="twitter:image"], meta[property="og:image:secure_url"]').each((_, el) => {
    const content = $(el).attr('content');
    if (content) {
      const unshrink = unshrinkImageUrl(content);
      addImage({
        thumb: unshrink.fullUrl,
        full: unshrink.fullUrl,
        isUnshrunk: unshrink.isUnshrunk,
        method: 'OpenGraph / Social Media Full-Res Meta',
        alt: pageTitle,
        context: 'Meta Tag <meta>',
      });
    }
  });

  // Compute stats
  const formats: Record<string, number> = {};
  let unshrunkCount = 0;

  for (const img of foundImages) {
    formats[img.format] = (formats[img.format] || 0) + 1;
    if (img.isUnshrunk) unshrunkCount++;
  }

  return {
    url: pageUrl,
    pageTitle,
    images: foundImages,
    stats: {
      totalFound: foundImages.length,
      unshrunkCount,
      formats,
    },
  };
}

export interface GalleryMapItem {
  fullUrl: string;
  width?: number;
  height?: number;
}

/**
 * Extracts a map of photo IDs to full-sized master URLs and dimensions from a gallery or detail webpage.
 */
export function extractGalleryMapFromDetailPage(
  html: string,
  pageUrl: string
): Map<string, GalleryMapItem> {
  const galleryMap = new Map<string, GalleryMapItem>();
  if (
    !html ||
    html.includes('uk_ban_ifap') ||
    html.includes('UK banned') ||
    html.includes('crime-and-policing')
  ) {
    return galleryMap;
  }
  const $ = cheerio.load(html);

  $('a[original], a[href*="/images/full/"], a[imageid], [data-full-url], [data-original-url]').each((_, el) => {
    const $a = $(el);
    const fullCandidate =
      $a.attr('original') ||
      $a.attr('data-full-url') ||
      $a.attr('data-original-url') ||
      $a.attr('href') ||
      '';
    const imageId = $a.attr('imageid') || '';
    const dim = $a.attr('dimension') || '';
    let width: number | undefined;
    let height: number | undefined;

    if (dim && dim.includes('x')) {
      const parts = dim.split('x');
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      if (!isNaN(w) && !isNaN(h)) {
        width = w;
        height = h;
      }
    }

    if (fullCandidate && !fullCandidate.includes('z.gif') && !fullCandidate.includes('spacer.gif')) {
      let resolvedFull = fullCandidate;
      try {
        resolvedFull = new URL(fullCandidate, pageUrl).href;
      } catch {}

      const idMatch =
        imageId ||
        (resolvedFull.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1] ||
        (resolvedFull.match(/[?&]id=([0-9]{5,14})/i) || [])[1];

      if (idMatch) {
        galleryMap.set(idMatch, {
          fullUrl: resolvedFull,
          width,
          height,
        });
      }
    }
  });

  // Also parse <script type="application/ld+json"> contentUrl / image entries
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const rawJson = $(el).text();
      if (!rawJson) return;
      const parsed = JSON.parse(rawJson);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const candidate = node?.contentUrl || (typeof node?.image === 'string' ? node.image : node?.image?.url);
        if (candidate && typeof candidate === 'string') {
          const idMatch = (candidate.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1];
          if (idMatch && !galleryMap.has(idMatch)) {
            galleryMap.set(idMatch, {
              fullUrl: new URL(candidate, pageUrl).href,
              width: typeof node?.width === 'number' ? node.width : undefined,
              height: typeof node?.height === 'number' ? node.height : undefined,
            });
          }
        }
      }
    } catch {}
  });

  // Also scan raw HTML/scripts for CDN /images/full/ master URLs (e.g. ImageFap filmstrip JSON)
  const fullCdnMatches = html.match(/https?:\/\/[^"'\s<>\\]+\/images\/full\/[0-9a-zA-Z/_-]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\s<>\\]*)?/gi);
  if (fullCdnMatches) {
    for (const rawMatch of fullCdnMatches) {
      const cleanUrl = rawMatch.replace(/&amp;/g, '&');
      const idMatch = (cleanUrl.match(/\/([0-9]{5,14})\.(?:jpg|jpeg|png|webp|avif)/i) || [])[1];
      if (idMatch && !galleryMap.has(idMatch)) {
        galleryMap.set(idMatch, { fullUrl: cleanUrl });
      }
    }
  }

  return galleryMap;
}

/**
 * Given the HTML of a target webpage linked from a preview thumbnail,
 * extracts the true full-size original master image hosted on that page.
 */
export function extractBestImageFromDetailPage(
  html: string,
  pageUrl: string
): { url: string; width?: number; height?: number; method: string } | null {
  if (
    !html ||
    html.includes('uk_ban_ifap') ||
    html.includes('UK banned') ||
    html.includes('crime-and-policing')
  ) {
    return null;
  }
  const $ = cheerio.load(html);

  // Extract target photo ID from pageUrl (e.g. /photo/1109704572/ or ?id=1109704572)
  const targetId = (pageUrl.match(/\/photo\/([0-9]+)/i) || [])[1] || (pageUrl.match(/[?&]id=([0-9]+)/i) || [])[1];

  // 1. Check for specific image ID match in gallery strip / anchors with original attribute or full URL
  if (targetId) {
    let matchedItem: { url: string; width?: number; height?: number } | null = null;
    $('a[original], a[href*="/images/full/"], a[imageid], img[src*="/images/full/"]').each((_, aEl) => {
      const $el = $(aEl);
      const id = $el.attr('imageid') || '';
      const href = $el.attr('href') || '';
      const src = $el.attr('src') || '';
      const orig = $el.attr('original') || '';
      if (id === targetId || href.includes(targetId) || orig.includes(targetId) || src.includes(targetId)) {
        const fullCandidate = orig || src || href;
        const dim = $el.attr('dimension') || '';
        let w: number | undefined = parseInt($el.attr('width') || '', 10) || undefined;
        let h: number | undefined = parseInt($el.attr('height') || '', 10) || undefined;
        if (dim && dim.includes('x')) {
          const parts = dim.split('x');
          const pw = parseInt(parts[0], 10);
          const ph = parseInt(parts[1], 10);
          if (!isNaN(pw) && !isNaN(ph)) {
            w = pw;
            h = ph;
          }
        }
        try {
          matchedItem = {
            url: new URL(fullCandidate, pageUrl).href,
            width: w,
            height: h,
          };
          return false; // break
        } catch {}
      }
    });

    if (matchedItem !== null) {
      const resolvedItem: { url: string; width?: number; height?: number } = matchedItem;
      const dimStr =
        resolvedItem.width && resolvedItem.height
          ? ` (${resolvedItem.width}×${resolvedItem.height})`
          : '';
      return {
        url: resolvedItem.url,
        width: resolvedItem.width,
        height: resolvedItem.height,
        method: `Linked Detail Master Asset${dimStr}`,
      };
    }
  }

  // 2. Check for main photo element (#mainPhoto, #mainImg, img.mainPhoto)
  const $mainPhoto = $('#mainPhoto, #mainImg, img.mainPhoto, img.main-image, img[itemprop="contentUrl"]').first();
  if ($mainPhoto.length > 0) {
    const parentA = $mainPhoto.closest('a');
    const parentOriginal = parentA.attr('original') || parentA.attr('href') || '';
    const mainWidth = parseInt($mainPhoto.attr('width') || '', 10);
    const mainHeight = parseInt($mainPhoto.attr('height') || '', 10);
    const rawSrc = parentOriginal || $mainPhoto.attr('data-src') || $mainPhoto.attr('src') || '';

    if (rawSrc && !rawSrc.includes('z.gif') && !rawSrc.includes('spacer.gif')) {
      const unshrink = unshrinkImageUrl(rawSrc);
      try {
        const resolved = new URL(unshrink.fullUrl, pageUrl).href;
        return {
          url: resolved,
          width: !isNaN(mainWidth) ? mainWidth : undefined,
          height: !isNaN(mainHeight) ? mainHeight : undefined,
          method: `Linked Detail Main Image (${!isNaN(mainWidth) && !isNaN(mainHeight) ? `${mainWidth}×${mainHeight}` : unshrink.method})`,
        };
      } catch {}
    }
  }

  // 2.5. Check <script type="application/ld+json"> contentUrl / image
  let ldResult: { url: string; width?: number; height?: number; method: string } | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const rawJson = $(el).text();
      if (!rawJson) return;
      const parsed = JSON.parse(rawJson);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const candidate = node?.contentUrl || (typeof node?.image === 'string' ? node.image : node?.image?.url);
        if (candidate && typeof candidate === 'string' && !candidate.includes('logo')) {
          if (!targetId || candidate.includes(targetId) || !ldResult) {
            ldResult = {
              url: new URL(candidate, pageUrl).href,
              width: typeof node?.width === 'number' ? node.width : undefined,
              height: typeof node?.height === 'number' ? node.height : undefined,
              method: 'Linked Detail JSON-LD Master',
            };
          }
        }
      }
    } catch {}
  });
  if (ldResult) return ldResult;

  // 2.75. Scan raw HTML/scripts for explicit /images/full/ CDN URL matching targetId
  const fullCdnMatches = html.match(/https?:\/\/[^"'\s<>\\]+\/images\/full\/[0-9a-zA-Z/_-]+\.(?:jpg|jpeg|png|webp|avif)(?:\?[^"'\s<>\\]*)?/gi);
  if (fullCdnMatches && fullCdnMatches.length > 0) {
    const preferred =
      (targetId && fullCdnMatches.find((u) => u.includes(targetId))) || fullCdnMatches[0];
    if (preferred) {
      return {
        url: preferred.replace(/&amp;/g, '&'),
        method: 'Linked Detail CDN Full Master',
      };
    }
  }

  // 3. Check for any anchor with original attribute or /images/full/
  let firstOriginal: { url: string; width?: number; height?: number } | null = null;
  $('a[original], a[href*="/images/full/"]').each((_, aEl) => {
    const $a = $(aEl);
    const orig = $a.attr('original') || $a.attr('href') || '';
    if (orig && !orig.includes('z.gif')) {
      const dim = $a.attr('dimension') || '';
      let w: number | undefined;
      let h: number | undefined;
      if (dim && dim.includes('x')) {
        const parts = dim.split('x');
        w = parseInt(parts[0], 10);
        h = parseInt(parts[1], 10);
      }
      try {
        firstOriginal = {
          url: new URL(orig, pageUrl).href,
          width: w,
          height: h,
        };
        return false;
      } catch {}
    }
  });

  if (firstOriginal !== null) {
    const resolvedOriginal: { url: string; width?: number; height?: number } = firstOriginal;
    return {
      url: resolvedOriginal.url,
      width: resolvedOriginal.width,
      height: resolvedOriginal.height,
      method: 'Linked Detail Master Asset (original)',
    };
  }

  // 4. Check OpenGraph / Twitter meta image tags on the detail page
  const ogImg =
    $('meta[property="og:image:secure_url"]').attr('content') ||
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content');

  if (ogImg && !ogImg.includes('logo') && !ogImg.includes('z.gif') && !ogImg.includes('spacer.gif')) {
    const unshrink = unshrinkImageUrl(ogImg);
    try {
      return {
        url: new URL(unshrink.fullUrl, pageUrl).href,
        method: 'Linked Webpage (OpenGraph Master)',
      };
    } catch {}
  }

  // 5. Check for explicit high-res download or master view links
  let downloadCandidate: { url: string; method: string } | null = null;
  $('a[href]').each((_, aEl) => {
    const href = $(aEl).attr('href') || '';
    const lower = href.toLowerCase().split('?')[0];
    if (
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.avif')
    ) {
      const text = $(aEl).text().toLowerCase();
      if (
        text.includes('download') ||
        text.includes('original') ||
        text.includes('full') ||
        text.includes('high res') ||
        text.includes('master')
      ) {
        try {
          downloadCandidate = {
            url: new URL(href, pageUrl).href,
            method: 'Linked Webpage (Download Master Link)',
          };
          return false; // break loop
        } catch {}
      }
    }
  });

  if (downloadCandidate) return downloadCandidate;

  // 6. Scan images on detail page for highest width srcset
  let bestCandidate: { url: string; width?: number; height?: number; method: string } | null = null;
  let maxWidth = 0;

  $('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src') || '';
    const dataSrc =
      $img.attr('data-original') ||
      $img.attr('data-high-res') ||
      $img.attr('data-full') ||
      $img.attr('data-zoom-image') ||
      src;

    if (
      !dataSrc ||
      dataSrc.includes('z.gif') ||
      dataSrc.includes('spacer.gif') ||
      dataSrc.includes('blank.gif') ||
      dataSrc.includes('pixel.gif') ||
      dataSrc.includes('ajax-loader.gif')
    ) {
      return;
    }

    const srcset = $img.attr('srcset') || $img.attr('data-srcset') || '';
    const parsed = parseHighestSrcset(srcset, pageUrl);
    if (parsed && (parsed.width || 0) > maxWidth) {
      maxWidth = parsed.width || 0;
      bestCandidate = {
        url: parsed.url,
        width: parsed.width,
        method: `Linked Webpage (Srcset ${parsed.width}w)`,
      };
    }

    if (dataSrc && !bestCandidate) {
      const unshrink = unshrinkImageUrl(dataSrc);
      try {
        bestCandidate = {
          url: new URL(unshrink.fullUrl, pageUrl).href,
          method: 'Linked Webpage (Main Image)',
        };
      } catch {}
    }
  });

  return bestCandidate;
}

/**
 * Parses a Browser Harvester JSON manifest OR a raw list of preview/photo URLs into an ExtractionResult.
 */
export function parsePreviewUrlsOrManifest(
  rawInput: string,
  pageUrl = 'https://preview-batch.local'
): ExtractionResult | null {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) return null;

  // 1. Try JSON manifest (e.g. from Browser Harvester script, Instagram API JSON, or exported JSON)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      // Check for raw Instagram web_profile_info / v1 feed / GraphQL timeline JSON
      if (
        !Array.isArray(parsed) &&
        (parsed?.data?.user?.edge_owner_to_timeline_media ||
          parsed?.graphql?.user?.edge_owner_to_timeline_media ||
          parsed?.data?.xdt_api__v1__feed__user_timeline_graphql_connection ||
          parsed?.data?.xdt_api__v1__clips__user_connection_v2 ||
          parsed?.context?.graphql_media ||
          parsed?.gql_data?.shortcode_media ||
          parsed?.data?.shortcode_media ||
          (Array.isArray(parsed?.items) && parsed.items.some((it: any) => it?.image_versions2 || it?.carousel_media)))
      ) {
        const igPage = extractInstagramMediaFromJson(parsed);
        if (igPage.images.length > 0) {
          const formats: Record<string, number> = {};
          for (const img of igPage.images) {
            formats[img.format] = (formats[img.format] || 0) + 1;
          }
          return {
            url: igPage.username ? `https://www.instagram.com/${igPage.username}/` : pageUrl,
            pageTitle: igPage.username
              ? `@${igPage.username}${igPage.fullName ? ` (${igPage.fullName})` : ''} — Instagram Full-Res Photos`
              : 'Instagram Profile Full-Res Photos',
            images: igPage.images,
            stats: {
              totalFound: igPage.images.length,
              unshrunkCount: igPage.images.length,
              formats,
            },
          };
        }
      }

      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.images) ? parsed.images : null;
      if (list && list.length > 0) {
        const images: ScrapedImage[] = [];
        const formats: Record<string, number> = {};
        let unshrunkCount = 0;

        list.forEach((item: any, idx: number) => {
          const fullUrl = item.fullUrl || item.masterDirectDownloadUrl || item.url || item.original || item.thumbnailUrl;
          if (!fullUrl || typeof fullUrl !== 'string') return;
          const thumbUrl = item.thumbnailUrl || item.thumb || fullUrl;
          const unshrink = unshrinkImageUrl(fullUrl);
          const finalFull = unshrink.isUnshrunk ? unshrink.fullUrl : fullUrl;
          const fmt = item.format || detectFormat(finalFull);
          const width = typeof item.width === 'number' ? item.width : undefined;
          const height = typeof item.height === 'number' ? item.height : undefined;
          const isUnshrunk = Boolean(item.isUnshrunk ?? (unshrink.isUnshrunk || finalFull !== thumbUrl));
          if (isUnshrunk) unshrunkCount++;
          formats[fmt] = (formats[fmt] || 0) + 1;

          images.push({
            id: item.id || `img_${idx + 1}`,
            thumbnailUrl: thumbUrl,
            fullUrl: finalFull,
            isUnshrunk,
            unshrinkMethod: item.unshrinkMethod || (isUnshrunk ? unshrink.method : 'Harvester Manifest'),
            altText: item.altText || item.title || extractFilename(finalFull, idx, fmt),
            format: fmt,
            width,
            height,
            resolutionTier: item.resolutionTier || classifyResolution(width, height),
            filename: item.filename || extractFilename(finalFull, idx, fmt),
            linkedPageUrl: item.linkedPageUrl || item.masterWebpageUrl || undefined,
            deepScraped: Boolean(item.deepScraped || isUnshrunk),
            fallbackUrl: item.fallbackUrl,
          });
        });

        if (images.length > 0) {
          return {
            url: (!Array.isArray(parsed) && parsed.sourceUrl) || pageUrl,
            pageTitle: (!Array.isArray(parsed) && parsed.pageTitle) || 'Imported Gallery Master Manifest',
            images,
            stats: { totalFound: images.length, unshrunkCount, formats },
          };
        }
      }
    } catch {
      // Not valid JSON, continue to URL list check
    }
  }

  // 2. Plain list of URLs (preview image URLs or photo detail webpage URLs, no HTML tags)
  if (!trimmed.includes('<') && /^https?:\/\//im.test(trimmed)) {
    const lines = trimmed
      .split(/[\r\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));

    if (lines.length === 0) return null;

    // Only treat as preview/URL list if multiple URLs OR single direct image/photo URL
    const gidMatch = (pageUrl.match(/[?&]gid=([0-9]+)/i) || pageUrl.match(/\/pictures\/([0-9]+)/i) || [])[1] || '';
    const images: ScrapedImage[] = [];
    const formats: Record<string, number> = {};
    let unshrunkCount = 0;

    lines.forEach((rawUrl, idx) => {
      const isPhotoPage = /imagefap\.com\/photo\/([0-9]+)/i.test(rawUrl);
      const photoIdFromUrl = (rawUrl.match(/\/(?:photo\/)?([0-9]{6,14})(?:\/|\.(?:jpg|jpeg|png|webp|avif))/i) || [])[1];
      const unshrink = unshrinkImageUrl(rawUrl);
      const isIfapThumb =
        /imagefap\.com/i.test(rawUrl) && /\/(thumb|mini|frame-thumb)\//i.test(rawUrl);

      let linkedPageUrl: string | undefined = isPhotoPage ? rawUrl : undefined;
      if (!linkedPageUrl && isIfapThumb && photoIdFromUrl) {
        linkedPageUrl = `https://www.imagefap.com/photo/${photoIdFromUrl}/?pgid=&gid=${gidMatch}&page=0`;
      }

      const fmt = detectFormat(unshrink.fullUrl);
      const filename = extractFilename(unshrink.fullUrl, idx, fmt);
      const pendingMasterCrawl = Boolean(linkedPageUrl && isIfapThumb);
      const isUnshrunk = pendingMasterCrawl ? false : unshrink.isUnshrunk;
      if (isUnshrunk) unshrunkCount++;
      formats[fmt] = (formats[fmt] || 0) + 1;

      images.push({
        id: `img_${idx + 1}`,
        thumbnailUrl: rawUrl,
        fullUrl: pendingMasterCrawl ? rawUrl : unshrink.fullUrl,
        isUnshrunk,
        unshrinkMethod: pendingMasterCrawl
          ? 'Linked Master Webpage Pending Crawl'
          : unshrink.isUnshrunk
            ? unshrink.method
            : linkedPageUrl
              ? 'Linked Master Webpage Pending Crawl'
              : 'Direct Preview URL',
        altText: filename,
        format: fmt,
        resolutionTier: 'unknown',
        filename,
        linkedPageUrl,
      });
    });

    if (images.length > 0) {
      return {
        url: pageUrl,
        pageTitle: `Preview URL Batch (${images.length} items)`,
        images,
        stats: { totalFound: images.length, unshrunkCount, formats },
      };
    }
  }

  return null;
}

