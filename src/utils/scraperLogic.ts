/**
 * Scraper Logic & Full-Size Image Resolution Engine
 * Handles extraction, URL normalization, CDN un-shrinking, and metadata parsing.
 */

export interface ScrapedImage {
  id: string;
  thumbnailUrl: string;
  fullUrl: string;
  isUnshrunk: boolean;
  unshrinkMethod: string;
  altText: string;
  format: 'jpg' | 'png' | 'webp' | 'svg' | 'gif' | 'avif' | 'other';
  width?: number;
  height?: number;
  aspectRatio?: string;
  resolutionTier: '4k' | 'hd' | 'medium' | 'small' | 'unknown';
  filename: string;
  sourceContext?: string;
  linkedPageUrl?: string; // Webpage URL linked from the preview image (e.g. /photo/123)
  deepScraped?: boolean;  // Whether master image was resolved from linked detail webpage
  fallbackUrl?: string;   // High-res fallback mirror URL for expired CDN tokens
}

/**
 * Parses an HTML srcset attribute and returns the highest resolution URL.
 * e.g. "small.jpg 400w, medium.jpg 800w, large.jpg 2048w" -> "large.jpg"
 */
export function parseHighestSrcset(srcset: string, baseUrl: string): { url: string; width?: number } | null {
  if (!srcset || typeof srcset !== 'string') return null;

  const candidates: { url: string; value: number; type: 'w' | 'x' }[] = [];
  const entries = srcset.split(/,\s+(?=[^,]*\s+\d+[wx])/g);

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      candidates.push({ url: parts[0], value: 1, type: 'x' });
    } else {
      const url = parts[0];
      const descriptor = parts[1];
      if (descriptor.endsWith('w')) {
        const width = parseInt(descriptor.slice(0, -1), 10);
        if (!isNaN(width)) candidates.push({ url, value: width, type: 'w' });
      } else if (descriptor.endsWith('x')) {
        const density = parseFloat(descriptor.slice(0, -1));
        if (!isNaN(density)) candidates.push({ url, value: density * 1000, type: 'x' });
      } else {
        candidates.push({ url, value: 1, type: 'x' });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort candidates by highest value
  candidates.sort((a, b) => b.value - a.value);
  const best = candidates[0];

  try {
    const resolvedUrl = new URL(best.url, baseUrl).href;
    return {
      url: resolvedUrl,
      width: best.type === 'w' ? best.value : undefined,
    };
  } catch {
    return { url: best.url, width: best.type === 'w' ? best.value : undefined };
  }
}

/**
 * Resolves a thumbnail or preview image URL to its highest-resolution original version
 * using recognized CDN pattern transformations and un-shrinking rules.
 */
export function unshrinkImageUrl(url: string): { fullUrl: string; isUnshrunk: boolean; method: string } {
  if (!url || typeof url !== 'string') {
    return { fullUrl: url, isUnshrunk: false, method: 'none' };
  }

  let cleaned = url.trim();

  // 1. WordPress thumbnail pattern: photo-150x150.jpg, photo-300x200.png, photo-1024x768.jpeg
  const wpRegex = /(-[0-9]{2,4}x[0-9]{2,4})(\.(?:jpg|jpeg|png|webp|avif))(\?.*)?$/i;
  if (wpRegex.test(cleaned)) {
    const unshrink = cleaned.replace(wpRegex, '$2$3');
    return { fullUrl: unshrink, isUnshrunk: true, method: 'WordPress Dimensions Stripping' };
  }

  // 2. Unsplash thumbnail/preview pattern: w=400&fit=crop, q=80, etc.
  if (cleaned.includes('images.unsplash.com')) {
    try {
      const u = new URL(cleaned);
      const hadWidthLimit = u.searchParams.has('w') || u.searchParams.has('crop');
      if (hadWidthLimit) {
        u.searchParams.delete('w');
        u.searchParams.delete('h');
        u.searchParams.delete('fit');
        u.searchParams.delete('crop');
        u.searchParams.set('q', '100');
        return { fullUrl: u.href, isUnshrunk: true, method: 'Unsplash High-Res Query Optimization' };
      }
    } catch {
      // url parse error, fallback
    }
  }

  // 3. Wikipedia / Wikimedia thumbnail pattern:
  // e.g. https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/Photo.jpg/300px-Photo.jpg
  if (cleaned.includes('upload.wikimedia.org') && cleaned.includes('/thumb/')) {
    const wikiRegex = /\/wikipedia\/commons\/thumb\/([a-z0-9]+\/[a-z0-9]+\/[^/]+)\/[^/]+$/i;
    const match = cleaned.match(wikiRegex);
    if (match && match[1]) {
      const full = `https://upload.wikimedia.org/wikipedia/commons/${match[1]}`;
      return { fullUrl: full, isUnshrunk: true, method: 'Wikimedia Commons Original Extraction' };
    }
  }

  // 4. Cloudinary resizing transform: /c_scale,w_300/ or /w_400,h_300,c_fill/
  if (cleaned.includes('res.cloudinary.com')) {
    const cloudRegex = /\/upload\/([a-z0-9_,]+)\/(v[0-9]+\/.*)$/i;
    const match = cleaned.match(cloudRegex);
    if (match && (match[1].includes('w_') || match[1].includes('c_') || match[1].includes('h_'))) {
      const unshrink = cleaned.replace(cloudRegex, '/upload/q_auto,f_auto/$2');
      return { fullUrl: unshrink, isUnshrunk: true, method: 'Cloudinary Transformation Reset' };
    }
  }

  // 5. Shopify thumbnail pattern: _small.jpg, _medium.jpg, _100x100.png, _compact.jpg
  const shopifyRegex = /_(pico|icon|thumb|small|compact|medium|large|grande|[0-9]+x[0-9]*)\.(jpg|jpeg|png|webp)(\?.*)?$/i;
  if (shopifyRegex.test(cleaned)) {
    const unshrink = cleaned.replace(shopifyRegex, '_master.$2$3');
    return { fullUrl: unshrink, isUnshrunk: true, method: 'Shopify Master Resolution' };
  }

  // 6. Flickr thumbnail pattern: photo_m.jpg, photo_s.jpg, photo_t.jpg, photo_z.jpg -> photo_b.jpg
  if (cleaned.includes('staticflickr.com')) {
    const flickrRegex = /_([mstzqnc])\.(jpg|jpeg|png)$/i;
    if (flickrRegex.test(cleaned)) {
      const unshrink = cleaned.replace(flickrRegex, '_b.$2');
      return { fullUrl: unshrink, isUnshrunk: true, method: 'Flickr High-Res Substitution' };
    }
  }

  // 7. Pinterest thumbnail: /236x/ or /474x/ or /736x/ -> /originals/
  if (cleaned.includes('pinimg.com')) {
    const pinRegex = /\/(236x|474x|736x)\//;
    if (pinRegex.test(cleaned)) {
      const unshrink = cleaned.replace(pinRegex, '/originals/');
      return { fullUrl: unshrink, isUnshrunk: true, method: 'Pinterest Originals Resolution' };
    }
  }

  // 8. Blogger / Google Photos thumbnail pattern: /s320/ or /w400-h300/
  if (cleaned.includes('googleusercontent.com') || cleaned.includes('blogger.com') || cleaned.includes('blogspot.com')) {
    const gRegex = /\/(s[0-9]{2,4}|w[0-9]+-h[0-9]+(-[a-z])?)\//;
    if (gRegex.test(cleaned)) {
      const unshrink = cleaned.replace(gRegex, '/s0/');
      return { fullUrl: unshrink, isUnshrunk: true, method: 'Google / Blogger Max-Res Substitution' };
    }
  }

  // 9. YouTube thumbnail: hqdefault.jpg -> maxresdefault.jpg
  if (cleaned.includes('img.youtube.com') || cleaned.includes('i.ytimg.com')) {
    if (cleaned.includes('hqdefault.jpg') || cleaned.includes('mqdefault.jpg') || cleaned.includes('sddefault.jpg')) {
      const unshrink = cleaned.replace(/\/(hq|mq|sd)default\.jpg/, '/maxresdefault.jpg');
      return { fullUrl: unshrink, isUnshrunk: true, method: 'YouTube Maxres Thumbnail' };
    }
  }

  // 10. ImageFap & Gallery CDNs: /images/thumb/ or /images/mini/ or /images/frame-thumb/ -> /images/full/
  if (cleaned.includes('imagefap.com') && (cleaned.includes('/thumb/') || cleaned.includes('/mini/') || cleaned.includes('/frame-thumb/'))) {
    // CDN77 signs HMAC tokens specifically per path (/images/thumb/ vs /images/full/).
    // If the thumbnail URL contains ?secure=, naive URL replacement yields HTTP 403.
    // The master signed URL with valid token must be resolved via the photo detail page.
    if (cleaned.includes('secure=')) {
      return { fullUrl: cleaned, isUnshrunk: false, method: 'Direct Source' };
    }
    const ifRegex = /\/images\/(thumb|mini|frame-thumb)\/([0-9a-zA-Z/_-]+)\.(jpg|jpeg|png|webp)(\?.*)?$/i;
    if (ifRegex.test(cleaned)) {
      const unshrink = cleaned.replace(ifRegex, '/images/full/$2.$3$4');
      return { fullUrl: unshrink, isUnshrunk: true, method: 'ImageFap Master Resolution (/full/)' };
    }
  }

  // 11. Generic photo gallery thumbnails: /images/thumb/ or /images/preview/ -> /images/full/
  const genericThumbRegex = /\/images\/(thumb|thumbs|mini|preview|small)\/([0-9a-zA-Z_-]+)\.(jpg|jpeg|png|webp|avif)(\?.*)?$/i;
  if (genericThumbRegex.test(cleaned)) {
    const unshrink = cleaned.replace(genericThumbRegex, '/images/full/$2.$3$4');
    return { fullUrl: unshrink, isUnshrunk: true, method: 'Gallery Master Unshrinking (/full/)' };
  }

  return { fullUrl: cleaned, isUnshrunk: false, method: 'Direct Source' };
}

/**
 * Infers image format extension from a URL or content.
 */
export function detectFormat(url: string): ScrapedImage['format'] {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'jpg';
  if (clean.endsWith('.png')) return 'png';
  if (clean.endsWith('.webp')) return 'webp';
  if (clean.endsWith('.svg')) return 'svg';
  if (clean.endsWith('.gif')) return 'gif';
  if (clean.endsWith('.avif')) return 'avif';

  // Check query parameters (common in CDNs like Unsplash, Cloudinary, Imgix)
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('fm=webp') || lowerUrl.includes('format=webp')) return 'webp';
  if (lowerUrl.includes('fm=png') || lowerUrl.includes('format=png')) return 'png';
  if (lowerUrl.includes('fm=jpg') || lowerUrl.includes('format=jpg') || lowerUrl.includes('fm=jpeg')) return 'jpg';
  if (lowerUrl.includes('images.unsplash.com') || lowerUrl.includes('staticflickr.com') || lowerUrl.includes('imagefap.com')) return 'jpg';

  return 'other';
}

/**
 * Extracts a clean, sanitized filename from an image URL.
 */
export function extractFilename(url: string, index: number, format: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const parts = pathname.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1];

    if (lastPart) {
      // Strip query parameters and invalid characters
      const cleanName = lastPart.split('?')[0].replace(/[^a-zA-Z0-9._-]/g, '_');
      if (cleanName.includes('.')) {
        return cleanName;
      }
      return `${cleanName}.${format === 'other' ? 'jpg' : format}`;
    }
  } catch {
    // URL parsing failed
  }

  return `image_${String(index + 1).padStart(3, '0')}.${format === 'other' ? 'jpg' : format}`;
}

/**
 * Classifies image resolution tier based on width and height.
 */
export function classifyResolution(width?: number, height?: number): ScrapedImage['resolutionTier'] {
  if (!width && !height) return 'unknown';
  const w = width || 0;
  const h = height || 0;
  const maxDim = Math.max(w, h);

  if (maxDim >= 3840) return '4k';
  if (maxDim >= 1920) return 'hd';
  if (maxDim >= 800) return 'medium';
  return 'small';
}

/**
 * Checks if a URL represents a low-resolution preview or thumbnail.
 */
export function isLowResUrl(url?: string): boolean {
  if (!url) return false;
  return (
    /\/(thumb|thumbs|mini|frame-thumb|preview)\//i.test(url) ||
    /[_\-\.](150x150|300x200|160x107)\./i.test(url) ||
    /[?&]w=(160|300|400)(&|$)/i.test(url)
  );
}

/**
 * Evaluates whether a scraped image is a full master image (unshrunk, HD/4K, or non-thumbnail).
 */
export function isMasterImage(
  img: {
    isUnshrunk?: boolean;
    resolutionTier?: string;
    width?: number;
    height?: number;
    fullUrl?: string;
  },
  previewInfo?: PreviewStateInfo
): boolean {
  const effectiveWidth = img.width || previewInfo?.naturalWidth;
  const effectiveHeight = img.height || previewInfo?.naturalHeight;
  if (img.isUnshrunk) return true;
  if (img.resolutionTier === '4k' || img.resolutionTier === 'hd') return true;
  if (effectiveWidth && effectiveHeight && (effectiveWidth >= 1000 || effectiveHeight >= 1000)) return true;
  if (img.fullUrl && isLowResUrl(img.fullUrl)) return false;
  return Boolean(img.isUnshrunk || (img.resolutionTier && img.resolutionTier !== 'small'));
}

export type PreviewStatus = 'loading' | 'loaded' | 'broken';

export interface PreviewStateInfo {
  status: PreviewStatus;
  naturalWidth?: number;
  naturalHeight?: number;
}

export type OrientationFilter = 'all' | 'landscape' | 'portrait' | 'square';

export interface GalleryFilterState {
  onlyMasters: boolean;
  onlyPreviewable: boolean;
  onlyUnshrunk: boolean;
  onlyWithSubpage: boolean;
  onlyHighRes: boolean;
  excludeIconsAndSmall: boolean;
  format: string;
  resolution: string;
  orientation: OrientationFilter;
  searchQuery: string;
}

export const DEFAULT_GALLERY_FILTERS: GalleryFilterState = {
  onlyMasters: false,
  onlyPreviewable: false,
  onlyUnshrunk: false,
  onlyWithSubpage: false,
  onlyHighRes: false,
  excludeIconsAndSmall: false,
  format: 'all',
  resolution: 'all',
  orientation: 'all',
  searchQuery: '',
};

/**
 * Detects blank spacer URLs, 1x1 tracking pixels, or empty data URIs.
 */
export function isBlankOrPlaceholderUrl(url?: string): boolean {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim().toLowerCase();
  if (!trimmed || trimmed === 'about:blank' || trimmed.startsWith('javascript:')) return true;
  if (trimmed.startsWith('data:image/gif;base64,r0lgodlhaqab')) return true;
  if (trimmed.startsWith('data:image/svg+xml') && (trimmed.includes('width="1"') || trimmed.includes('viewbox="0 0 1 1"'))) {
    return true;
  }
  if (/\/(spacer|blank|pixel|1x1|clear|transparent|empty)\.(gif|png|jpg|svg)(\?|$)/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Checks whether an image is previewable (not a broken image, blank spacer, or 1x1 pixel).
 */
export function isPreviewableImage(
  img: Pick<ScrapedImage, 'thumbnailUrl' | 'fullUrl' | 'fallbackUrl'>,
  previewInfo?: PreviewStateInfo
): boolean {
  const hasUsableUrl =
    !isBlankOrPlaceholderUrl(img.thumbnailUrl) ||
    !isBlankOrPlaceholderUrl(img.fullUrl) ||
    !isBlankOrPlaceholderUrl(img.fallbackUrl);

  if (!hasUsableUrl) return false;

  if (previewInfo) {
    if (previewInfo.status === 'broken') return false;
    if (
      previewInfo.status === 'loaded' &&
      ((previewInfo.naturalWidth !== undefined && previewInfo.naturalWidth <= 1) ||
        (previewInfo.naturalHeight !== undefined && previewInfo.naturalHeight <= 1))
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Returns best known width, height, and resolution tier combining HTML metadata and live DOM dimensions.
 */
export function getEffectiveDimensions(
  img: Pick<ScrapedImage, 'width' | 'height' | 'resolutionTier'>,
  previewInfo?: PreviewStateInfo
): { width?: number; height?: number; tier: ScrapedImage['resolutionTier'] } {
  const metaW = img.width || 0;
  const metaH = img.height || 0;
  const liveW = previewInfo?.naturalWidth || 0;
  const liveH = previewInfo?.naturalHeight || 0;

  const useLive = liveW > 1 && liveH > 1 && liveW * liveH > metaW * metaH;
  const width = useLive ? liveW : metaW > 0 ? metaW : liveW > 1 ? liveW : undefined;
  const height = useLive ? liveH : metaH > 0 ? metaH : liveH > 1 ? liveH : undefined;
  const computedTier = width || height ? classifyResolution(width, height) : img.resolutionTier;

  return {
    width,
    height,
    tier: computedTier === 'unknown' ? img.resolutionTier : computedTier,
  };
}

/**
 * Classifies aspect orientation of an image.
 */
export function getImageOrientation(
  img: Pick<ScrapedImage, 'width' | 'height' | 'resolutionTier'>,
  previewInfo?: PreviewStateInfo
): 'landscape' | 'portrait' | 'square' | 'unknown' {
  const { width, height } = getEffectiveDimensions(img, previewInfo);
  if (!width || !height) return 'unknown';
  const ratio = width / height;
  if (ratio > 1.08) return 'landscape';
  if (ratio < 0.92) return 'portrait';
  return 'square';
}

/**
 * Evaluates whether an image is an icon, tiny graphic, or animated/spacer GIF.
 */
export function isIconOrSmallGraphic(
  img: Pick<
    ScrapedImage,
    'format' | 'width' | 'height' | 'resolutionTier' | 'filename' | 'fullUrl' | 'isUnshrunk'
  >,
  previewInfo?: PreviewStateInfo
): boolean {
  if (img.format === 'svg' || img.format === 'gif') return true;
  if (/\b(icon|favicon|logo|badge|avatar|emoji|spinner)\b/i.test(`${img.filename} ${img.fullUrl}`)) {
    return true;
  }
  if (!img.isUnshrunk) {
    const { width, height, tier } = getEffectiveDimensions(img, previewInfo);
    if (tier === 'small') return true;
    if (width && height && Math.max(width, height) < 400) return true;
  }
  return false;
}

/**
 * Filters scraped images using stackable high-level filter criteria.
 */
export function filterScrapedImages(
  images: ScrapedImage[],
  filters: GalleryFilterState,
  previewMap?: Record<string, PreviewStateInfo>
): ScrapedImage[] {
  const query = filters.searchQuery.trim().toLowerCase();

  return images.filter((img) => {
    const previewInfo = previewMap?.[img.id];
    const dims = getEffectiveDimensions(img, previewInfo);

    if (filters.onlyMasters && !isMasterImage(img, previewInfo)) return false;
    if (filters.onlyPreviewable && !isPreviewableImage(img, previewInfo)) return false;
    if (filters.onlyUnshrunk && !img.isUnshrunk) return false;
    if (filters.onlyWithSubpage && !img.linkedPageUrl) return false;
    if (filters.onlyHighRes) {
      const maxDim = Math.max(dims.width || 0, dims.height || 0);
      const isHdOr4k = dims.tier === '4k' || dims.tier === 'hd' || maxDim >= 1920;
      if (!isHdOr4k) return false;
    }
    if (filters.excludeIconsAndSmall && isIconOrSmallGraphic(img, previewInfo)) return false;

    if (filters.format !== 'all' && img.format !== filters.format) return false;

    if (filters.resolution === 'masters') {
      if (!isMasterImage(img, previewInfo)) return false;
    } else if (filters.resolution !== 'all' && dims.tier !== filters.resolution) {
      return false;
    }

    if (filters.orientation !== 'all') {
      const orient = getImageOrientation(img, previewInfo);
      if (orient !== filters.orientation) return false;
    }

    if (query) {
      const matchesName = img.filename.toLowerCase().includes(query);
      const matchesAlt = (img.altText || '').toLowerCase().includes(query);
      const matchesMethod = (img.unshrinkMethod || '').toLowerCase().includes(query);
      const matchesUrl = img.fullUrl.toLowerCase().includes(query);
      const matchesSubpage = (img.linkedPageUrl || '').toLowerCase().includes(query);
      if (!matchesName && !matchesAlt && !matchesMethod && !matchesUrl && !matchesSubpage) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Counts how many high-level filters are currently active/stacked.
 */
export function countActiveFilters(filters: GalleryFilterState): number {
  let count = 0;
  if (filters.onlyMasters) count++;
  if (filters.onlyPreviewable) count++;
  if (filters.onlyUnshrunk) count++;
  if (filters.onlyWithSubpage) count++;
  if (filters.onlyHighRes) count++;
  if (filters.excludeIconsAndSmall) count++;
  if (filters.format !== 'all') count++;
  if (filters.resolution !== 'all') count++;
  if (filters.orientation !== 'all') count++;
  if (filters.searchQuery.trim()) count++;
  return count;
}

/**
 * Computes facet counts across the image collection for live filter chip badges.
 */
export function getFilterFacetCounts(
  images: ScrapedImage[],
  previewMap?: Record<string, PreviewStateInfo>
) {
  let masters = 0;
  let previewable = 0;
  let broken = 0;
  let unshrunk = 0;
  let withSubpage = 0;
  let highRes = 0;
  let nonIcons = 0;
  let landscape = 0;
  let portrait = 0;
  let square = 0;

  for (const img of images) {
    const info = previewMap?.[img.id];
    const dims = getEffectiveDimensions(img, info);

    if (isMasterImage(img, info)) masters++;
    if (isPreviewableImage(img, info)) {
      previewable++;
    } else {
      broken++;
    }
    if (img.isUnshrunk) unshrunk++;
    if (img.linkedPageUrl) withSubpage++;
    if (dims.tier === '4k' || dims.tier === 'hd' || Math.max(dims.width || 0, dims.height || 0) >= 1920) {
      highRes++;
    }
    if (!isIconOrSmallGraphic(img, info)) nonIcons++;

    const orient = getImageOrientation(img, info);
    if (orient === 'landscape') landscape++;
    else if (orient === 'portrait') portrait++;
    else if (orient === 'square') square++;
  }

  return {
    masters,
    previewable,
    broken,
    unshrunk,
    withSubpage,
    highRes,
    nonIcons,
    landscape,
    portrait,
    square,
  };
}
