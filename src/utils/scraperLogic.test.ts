import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHighestSrcset,
  unshrinkImageUrl,
  detectFormat,
  extractFilename,
  classifyResolution,
  isLowResUrl,
  isMasterImage,
  isBlankOrPlaceholderUrl,
  isPreviewableImage,
  filterScrapedImages,
  countActiveFilters,
  getFilterFacetCounts,
  DEFAULT_GALLERY_FILTERS,
  type ScrapedImage,
  type PreviewStateInfo,
} from './scraperLogic';
import { extractImagesFromHtml } from './htmlExtractor';
import { SAMPLE_PRESETS } from './samplePages';

test('unshrinkImageUrl correctly un-shrinks WordPress thumbnails', () => {
  const thumbnail = 'https://example.com/wp-content/uploads/2026/03/landscape-300x200.jpg';
  const result = unshrinkImageUrl(thumbnail);
  assert.equal(result.isUnshrunk, true);
  assert.equal(result.fullUrl, 'https://example.com/wp-content/uploads/2026/03/landscape.jpg');
  assert.equal(result.method, 'WordPress Dimensions Stripping');
});

test('unshrinkImageUrl correctly un-shrinks Wikimedia Commons thumbnails', () => {
  const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/b4/Mount_Everest.jpg/320px-Mount_Everest.jpg';
  const result = unshrinkImageUrl(thumb);
  assert.equal(result.isUnshrunk, true);
  assert.equal(result.fullUrl, 'https://upload.wikimedia.org/wikipedia/commons/a/b4/Mount_Everest.jpg');
});

test('unshrinkImageUrl strips restrictive width parameters on Unsplash', () => {
  const thumb = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=500&auto=format&fit=crop&q=60';
  const result = unshrinkImageUrl(thumb);
  assert.equal(result.isUnshrunk, true);
  assert.ok(!result.fullUrl.includes('w=500'));
  assert.ok(!result.fullUrl.includes('fit=crop'));
  assert.ok(result.fullUrl.includes('q=100'));
});

test('unshrinkImageUrl resolves ImageFap thumbnails and frame-thumbs to /full/ master resolution', () => {
  const thumb = 'https://cdnc.imagefap.com/images/thumb/122/110/1109704572.jpg';
  const result = unshrinkImageUrl(thumb);
  assert.equal(result.isUnshrunk, true);
  assert.equal(result.fullUrl, 'https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg');

  const frameThumb = 'https://cdnc.imagefap.com/images/frame-thumb/122/110/1109704572.jpg';
  const result2 = unshrinkImageUrl(frameThumb);
  assert.equal(result2.isUnshrunk, true);
  assert.equal(result2.fullUrl, 'https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg');
});

test('unshrinkImageUrl defers signed ImageFap URLs to detail page crawler to obtain valid HMAC master tokens', () => {
  const signedThumb = 'https://cdnc.imagefap.com/images/thumb/122/110/1109704572.jpg?secure=xyz123';
  const result = unshrinkImageUrl(signedThumb);
  assert.equal(result.isUnshrunk, false);
  assert.equal(result.fullUrl, signedThumb);
});


test('parseHighestSrcset picks the highest width descriptor candidate', () => {
  const srcset = 'thumb.jpg 320w, med.jpg 768w, hero-large.jpg 2048w, hd.jpg 1200w';
  const result = parseHighestSrcset(srcset, 'https://mysite.com/blog/');
  assert.ok(result !== null);
  assert.equal(result?.url, 'https://mysite.com/blog/hero-large.jpg');
  assert.equal(result?.width, 2048);
});

test('detectFormat correctly infers image extension', () => {
  assert.equal(detectFormat('https://example.com/photo.png?token=123'), 'png');
  assert.equal(detectFormat('https://example.com/photo.WEBP'), 'webp');
  assert.equal(detectFormat('https://example.com/icon.svg'), 'svg');
  assert.equal(detectFormat('https://example.com/banner.jpeg'), 'jpg');
});

test('extractFilename sanitizes filenames properly', () => {
  const name1 = extractFilename('https://example.com/images/mountain_view.jpg?v=1', 0, 'jpg');
  assert.equal(name1, 'mountain_view.jpg');

  const name2 = extractFilename('https://example.com/stream/abc123', 4, 'png');
  assert.equal(name2, 'abc123.png');
});

test('classifyResolution classifies dimensions into appropriate tiers', () => {
  assert.equal(classifyResolution(3840, 2160), '4k');
  assert.equal(classifyResolution(1920, 1080), 'hd');
  assert.equal(classifyResolution(800, 600), 'medium');
  assert.equal(classifyResolution(300, 200), 'small');
  assert.equal(classifyResolution(undefined, undefined), 'unknown');
});

test('isLowResUrl correctly flags low-res thumbnails and allows master images', () => {
  assert.equal(isLowResUrl('https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg'), true);
  assert.equal(isLowResUrl('https://cdnc.imagefap.com/images/mini/118/338/33802089.jpg'), true);
  assert.equal(isLowResUrl('https://cdnc.imagefap.com/images/frame-thumb/118/338/33802089.jpg'), true);
  assert.equal(isLowResUrl('https://example.com/photo-300x200.jpg'), true);
  assert.equal(isLowResUrl('https://example.com/photo-160x107.jpg'), true);
  assert.equal(isLowResUrl('https://images.unsplash.com/photo?w=400&q=80'), true);

  // Master URLs must NOT be flagged as low-res
  assert.equal(isLowResUrl('https://cdnc.imagefap.com/images/full/118/338/33802089.jpg'), false);
  assert.equal(isLowResUrl('https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=xyz,123'), false);
  assert.equal(isLowResUrl('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840'), false);
  assert.equal(isLowResUrl('https://example.com/uploads/photo.jpg'), false);
});

test('isMasterImage accurately recognizes full-resolution master images and rejects thumbnails', () => {
  // Unshrunk images are masters
  assert.equal(isMasterImage({ isUnshrunk: true, fullUrl: 'https://cdnc.imagefap.com/images/full/1.jpg' }), true);

  // 4K and HD images are masters
  assert.equal(isMasterImage({ resolutionTier: '4k', fullUrl: 'https://example.com/photo.jpg' }), true);
  assert.equal(isMasterImage({ resolutionTier: 'hd', fullUrl: 'https://example.com/photo.jpg' }), true);
  assert.equal(isMasterImage({ width: 3840, height: 2160, fullUrl: 'https://example.com/photo.jpg' }), true);

  // Low res thumbnails are rejected
  assert.equal(isMasterImage({ isUnshrunk: false, fullUrl: 'https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg' }), false);
  assert.equal(isMasterImage({ isUnshrunk: false, fullUrl: 'https://cdnc.imagefap.com/images/mini/118/338/33802089.jpg' }), false);
  assert.equal(isMasterImage({ isUnshrunk: false, resolutionTier: 'small', fullUrl: 'https://example.com/photo-160x107.jpg' }), false);
});

test('ImageFap gallery 13643086 extracts master photo webpage and direct CDN link for 33802089', () => {
  const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_jessie_rogers');
  assert.ok(preset, 'Jessie Rogers preset should exist');

  const result = extractImagesFromHtml(preset.html, preset.url);
  assert.equal(result.images.length, 4);

  const photo33802089 = result.images.find((img: any) => img.fullUrl.includes('33802089'));
  assert.ok(photo33802089, 'Photo 33802089 must be present');
  assert.equal(
    photo33802089.fullUrl,
    'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374'
  );
  assert.equal(
    photo33802089.linkedPageUrl,
    'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0'
  );
  assert.equal(photo33802089.isUnshrunk, true);
  assert.equal(isMasterImage(photo33802089), true);
});

test('isBlankOrPlaceholderUrl and isPreviewableImage reject blank, 1x1, and broken previews', () => {
  assert.equal(isBlankOrPlaceholderUrl(''), true);
  assert.equal(isBlankOrPlaceholderUrl('https://cdn.example.com/images/spacer.gif'), true);
  assert.equal(isBlankOrPlaceholderUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), true);
  assert.equal(isBlankOrPlaceholderUrl('https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1920'), false);

  const validImg = {
    thumbnailUrl: 'https://example.com/thumb.jpg',
    fullUrl: 'https://example.com/full.jpg',
  };
  assert.equal(isPreviewableImage(validImg, { status: 'loaded', naturalWidth: 1920, naturalHeight: 1080 }), true);
  assert.equal(isPreviewableImage(validImg, { status: 'broken' }), false);
  assert.equal(isPreviewableImage(validImg, { status: 'loaded', naturalWidth: 1, naturalHeight: 1 }), false);
  assert.equal(
    isPreviewableImage({ thumbnailUrl: 'https://example.com/spacer.gif', fullUrl: '' }),
    false
  );
});

test('filterScrapedImages supports stacking full masters, previewable (no blanks), subpage, HD/4K, icon exclusion, and orientation', () => {
  const sampleImages: ScrapedImage[] = [
    {
      id: '1',
      thumbnailUrl: 'https://cdn.site/thumb1.jpg',
      fullUrl: 'https://cdn.site/full1.jpg',
      isUnshrunk: true,
      unshrinkMethod: 'CDN Full',
      altText: 'Landscape mountain master',
      format: 'jpg',
      width: 3840,
      height: 2160,
      resolutionTier: '4k',
      filename: 'mountain_4k.jpg',
      linkedPageUrl: 'https://site/photo/1',
    },
    {
      id: '2',
      thumbnailUrl: 'https://cdn.site/broken_thumb.jpg',
      fullUrl: 'https://cdn.site/broken_master.jpg',
      isUnshrunk: true,
      unshrinkMethod: 'CDN Full',
      altText: 'Broken preview master',
      format: 'jpg',
      width: 3840,
      height: 2160,
      resolutionTier: '4k',
      filename: 'broken_master.jpg',
      linkedPageUrl: 'https://site/photo/2',
    },
    {
      id: '3',
      thumbnailUrl: 'https://cdn.site/portrait_thumb.jpg',
      fullUrl: 'https://cdn.site/portrait_full.jpg',
      isUnshrunk: true,
      unshrinkMethod: 'CDN Full',
      altText: 'Portrait studio shot',
      format: 'png',
      width: 1200,
      height: 2000,
      resolutionTier: 'hd',
      filename: 'portrait.png',
    },
    {
      id: '4',
      thumbnailUrl: 'https://cdn.site/small_thumb.jpg',
      fullUrl: 'https://cdn.site/small_thumb.jpg',
      isUnshrunk: false,
      unshrinkMethod: 'Direct Source',
      altText: 'Small preview icon',
      format: 'svg',
      width: 120,
      height: 120,
      resolutionTier: 'small',
      filename: 'logo_icon.svg',
    },
  ];

  const previewMap: Record<string, PreviewStateInfo> = {
    '1': { status: 'loaded', naturalWidth: 3840, naturalHeight: 2160 },
    '2': { status: 'broken' },
    '3': { status: 'loaded', naturalWidth: 1200, naturalHeight: 2000 },
    '4': { status: 'loaded', naturalWidth: 120, naturalHeight: 120 },
  };

  // Facets count accurately
  const facets = getFilterFacetCounts(sampleImages, previewMap);
  assert.equal(facets.masters, 3);
  assert.equal(facets.previewable, 3);
  assert.equal(facets.broken, 1);
  assert.equal(facets.withSubpage, 2);
  assert.equal(facets.landscape, 2);
  assert.equal(facets.portrait, 1);
  assert.equal(facets.square, 1);

  // Stack: Full Masters + Previewable (No Blank) -> excludes #2 (broken) and #4 (small svg)
  const cleanMasters = filterScrapedImages(
    sampleImages,
    { ...DEFAULT_GALLERY_FILTERS, onlyMasters: true, onlyPreviewable: true },
    previewMap
  );
  assert.deepEqual(
    cleanMasters.map((i) => i.id),
    ['1', '3']
  );

  // Further stack: Has Subpage + Landscape -> narrows down to #1 only
  const stackedFilters = {
    ...DEFAULT_GALLERY_FILTERS,
    onlyMasters: true,
    onlyPreviewable: true,
    onlyWithSubpage: true,
    onlyHighRes: true,
    excludeIconsAndSmall: true,
    orientation: 'landscape' as const,
  };
  assert.equal(countActiveFilters(stackedFilters), 6);
  const stackedResult = filterScrapedImages(sampleImages, stackedFilters, previewMap);
  assert.deepEqual(
    stackedResult.map((i) => i.id),
    ['1']
  );
});

test('unshrinkImageUrl and extractDimensionsFromUrl handle dimension-segmented album storage CDNs', async () => {
  const { extractDimensionsFromUrl } = await import('./scraperLogic');
  const smallThumb =
    'https://pics-storage-1.gallery-cdn.example/contents/albums/main/200x150/30000/30560/1556864.jpg';
  const unshrunk = unshrinkImageUrl(smallThumb);
  assert.equal(unshrunk.isUnshrunk, true);
  assert.equal(
    unshrunk.fullUrl,
    'https://pics-storage-1.gallery-cdn.example/contents/albums/main/1920x1080/30000/30560/1556864.jpg'
  );
  assert.equal(isLowResUrl(smallThumb), true);
  assert.equal(isLowResUrl(unshrunk.fullUrl), false);

  // Already 1920x1080 stays untouched and classifies as HD master
  const alreadyHd = unshrinkImageUrl(unshrunk.fullUrl);
  assert.equal(alreadyHd.isUnshrunk, false);
  assert.equal(alreadyHd.fullUrl, unshrunk.fullUrl);
  assert.deepEqual(extractDimensionsFromUrl(unshrunk.fullUrl), { width: 1920, height: 1080 });
  assert.equal(isMasterImage({ fullUrl: unshrunk.fullUrl }), true);
});

test('filterScrapedImages and getFilterFacetCounts exclude images without human faces', async () => {
  const { getFilterFacetCounts } = await import('./scraperLogic');
  const mixedImages = [
    {
      id: 'portrait',
      thumbnailUrl: 'https://cdn.example.com/p.jpg',
      fullUrl: 'https://cdn.example.com/p.jpg',
      altText: 'Portrait',
      filename: 'portrait.jpg',
      format: 'jpg' as const,
      isUnshrunk: true,
      unshrinkMethod: 'Direct Full Resolution',
      resolutionTier: 'hd' as const,
      width: 1920,
      height: 1080,
    },
    {
      id: 'forest',
      thumbnailUrl: 'https://cdn.example.com/forest.jpg',
      fullUrl: 'https://cdn.example.com/forest.jpg',
      altText: 'Nature forest',
      filename: 'forest.jpg',
      format: 'jpg' as const,
      isUnshrunk: true,
      unshrinkMethod: 'Direct Full Resolution',
      resolutionTier: 'hd' as const,
      width: 1920,
      height: 1080,
    },
  ];

  const faceScanMap = {
    portrait: {
      hasHumanFace: true,
      faceCount: 1,
      confidence: 0.95,
      subjectSummary: 'Person portrait',
    },
    forest: {
      hasHumanFace: false,
      faceCount: 0,
      confidence: 0.98,
      subjectSummary: 'Pine forest landscape',
    },
  };

  const facets = getFilterFacetCounts(mixedImages, {}, faceScanMap);
  assert.equal(facets.faceScanned, 2);
  assert.equal(facets.humanFaces, 1);
  assert.equal(facets.noFaceExcluded, 1);

  const faceFilters = { ...DEFAULT_GALLERY_FILTERS, onlyHumanFaces: true };
  assert.equal(countActiveFilters(faceFilters), 1);
  const filtered = filterScrapedImages(mixedImages, faceFilters, {}, faceScanMap);
  assert.deepEqual(
    filtered.map((img) => img.id),
    ['portrait']
  );
});

