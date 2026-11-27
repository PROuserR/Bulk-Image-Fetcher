/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FolderGalleryItem,
  clampLightboxZoom,
  clampPanOffset,
  classifyItemOrientation,
  computeSteppedZoom,
  extractImageFormat,
  extractSubfolderPath,
  filterFolderGalleryItems,
  formatGalleryDate,
  formatMegapixels,
  getGridColumnClasses,
  isSupportedGalleryImageFile,
  resolveSeededPreviewUrl,
  sortFolderGalleryItems,
  summarizeSubfolders,
} from './folderGalleryLogic';

const SAMPLE_ITEMS: FolderGalleryItem[] = [
  {
    id: '1',
    filename: 'img_10.jpg',
    relativePath: 'MyShoot/Portraits/img_10.jpg',
    subfolder: 'Portraits',
    previewUrl: '/a.jpg',
    width: 1200,
    height: 1800,
    sizeBytes: 420_000,
    lastModified: 1_700_000_000_000,
    format: 'JPG',
    starred: true,
    rotationDeg: 0,
  },
  {
    id: '2',
    filename: 'img_2.png',
    relativePath: 'MyShoot/img_2.png',
    subfolder: 'Root',
    previewUrl: '/b.png',
    width: 3840,
    height: 2160,
    sizeBytes: 1_850_000,
    lastModified: 1_700_500_000_000,
    format: 'PNG',
    starred: false,
    rotationDeg: 0,
  },
  {
    id: '3',
    filename: 'alpha_square.webp',
    relativePath: 'MyShoot/Studio/Lighting/alpha_square.webp',
    subfolder: 'Studio/Lighting',
    previewUrl: '/c.webp',
    width: 1000,
    height: 1000,
    sizeBytes: 180_000,
    lastModified: 1_699_000_000_000,
    format: 'WEBP',
    starred: false,
    rotationDeg: 0,
  },
];

test('isSupportedGalleryImageFile and extractImageFormat detect image formats accurately', () => {
  assert.equal(isSupportedGalleryImageFile({ name: 'photo.JPG', type: '' }), true);
  assert.equal(isSupportedGalleryImageFile({ name: 'render.avif', type: 'image/avif' }), true);
  assert.equal(isSupportedGalleryImageFile({ name: 'clip.mp4', type: 'video/mp4' }), false);
  assert.equal(extractImageFormat('frame.jpeg'), 'JPG');
  assert.equal(extractImageFormat('noext', 'image/webp'), 'WEBP');
});

test('extractSubfolderPath and summarizeSubfolders organize nested folder trees', () => {
  assert.equal(extractSubfolderPath('photo.jpg'), 'Root');
  assert.equal(extractSubfolderPath('Vacation/photo.jpg'), 'Root');
  assert.equal(extractSubfolderPath('Vacation/Day1/photo.jpg'), 'Day1');
  assert.equal(extractSubfolderPath('Vacation/Day1/Beach/photo.jpg'), 'Day1/Beach');

  const summary = summarizeSubfolders(SAMPLE_ITEMS);
  assert.deepEqual(summary, [
    { name: 'Root', count: 1 },
    { name: 'Portraits', count: 1 },
    { name: 'Studio/Lighting', count: 1 },
  ]);
});

test('sortFolderGalleryItems supports natural filename, size, resolution, date, and aspect sorting', () => {
  const byNameAsc = sortFolderGalleryItems(SAMPLE_ITEMS, 'name', 'asc');
  assert.deepEqual(
    byNameAsc.map((i) => i.filename),
    ['alpha_square.webp', 'img_2.png', 'img_10.jpg'] // natural numeric: 2 before 10
  );

  const bySizeDesc = sortFolderGalleryItems(SAMPLE_ITEMS, 'size', 'desc');
  assert.deepEqual(
    bySizeDesc.map((i) => i.id),
    ['2', '1', '3']
  );

  const byResolutionDesc = sortFolderGalleryItems(SAMPLE_ITEMS, 'resolution', 'desc');
  assert.deepEqual(
    byResolutionDesc.map((i) => i.id),
    ['2', '1', '3']
  );

  const byDateAsc = sortFolderGalleryItems(SAMPLE_ITEMS, 'date', 'asc');
  assert.deepEqual(
    byDateAsc.map((i) => i.id),
    ['3', '1', '2']
  );

  const byAspectAsc = sortFolderGalleryItems(SAMPLE_ITEMS, 'aspect', 'asc');
  assert.deepEqual(
    byAspectAsc.map((i) => i.id),
    ['1', '3', '2'] // 0.67 portrait -> 1.0 square -> 1.78 landscape
  );
});

test('filterFolderGalleryItems filters by search query, subfolder, orientation, and favorites', () => {
  assert.equal(
    filterFolderGalleryItems(SAMPLE_ITEMS, {
      query: 'lighting',
      subfolder: 'all',
      orientation: 'all',
      favoritesOnly: false,
    }).length,
    1
  );

  assert.equal(
    filterFolderGalleryItems(SAMPLE_ITEMS, {
      query: '',
      subfolder: 'Portraits',
      orientation: 'portrait',
      favoritesOnly: true,
    })[0].id,
    '1'
  );

  assert.equal(classifyItemOrientation(1920, 1080), 'landscape');
  assert.equal(classifyItemOrientation(1080, 1920), 'portrait');
  assert.equal(classifyItemOrientation(1000, 1020), 'square');
});

test('zoom stepping, clamping, pan limits, formatting, and grid density work cleanly', () => {
  assert.equal(clampLightboxZoom(10), 6);
  assert.equal(clampLightboxZoom(0.05), 0.25);
  assert.equal(computeSteppedZoom(1, 'in'), 1.25);
  assert.equal(computeSteppedZoom(1, 'out'), 0.75);
  assert.equal(computeSteppedZoom(6, 'in'), 6);

  assert.deepEqual(clampPanOffset(500, -500, 1, 1000, 800), { x: 0, y: 0 });
  const panned = clampPanOffset(5000, -5000, 2, 1000, 800);
  assert.ok(panned.x > 0 && panned.x < 5000);
  assert.ok(panned.y < 0 && panned.y > -5000);

  assert.equal(formatMegapixels(3840, 2160), '8.29 MP');
  assert.equal(formatGalleryDate(Date.UTC(2026, 4, 15, 12, 0, 0)), '2026-05-15');
  assert.ok(getGridColumnClasses(1).includes('lg:grid-cols-2'));
  assert.ok(getGridColumnClasses(5).includes('xl:grid-cols-7'));
});

test('resolveSeededPreviewUrl passes local, blob, and data URLs directly while proxying remote URLs', () => {
  assert.equal(resolveSeededPreviewUrl('blob:http://localhost:3000/123'), 'blob:http://localhost:3000/123');
  assert.equal(resolveSeededPreviewUrl('/samples/humans/random_001.jpg'), '/samples/humans/random_001.jpg');
  assert.equal(resolveSeededPreviewUrl('data:image/png;base64,abc'), 'data:image/png;base64,abc');
  assert.equal(
    resolveSeededPreviewUrl('https://example.com/photo.jpg', 'https://example.com/'),
    '/api/proxy?url=https%3A%2F%2Fexample.com%2Fphoto.jpg&referer=https%3A%2F%2Fexample.com%2F'
  );
});

import {
  clearClientImageCache,
  registerWorkingPreviewUrl,
  setCachedImageBlob,
} from './clientImageCache.ts';

test('resolveSeededPreviewUrl reuses already-loaded blob cache and working proxy URLs before building a new proxy URL', () => {
  clearClientImageCache();
  const remoteUrl = 'https://cdn.example.com/cached-hero.jpg';
  const existingWorkingProxy = '/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fcached-hero.jpg&referer=https%3A%2F%2Fgallery.org%2Fsub';

  // 1. Working same-origin proxy URL with gallery referer is preserved instead of mismatched referer
  registerWorkingPreviewUrl(remoteUrl, existingWorkingProxy);
  assert.equal(
    resolveSeededPreviewUrl(remoteUrl, 'https://hub.org/'),
    existingWorkingProxy
  );

  // 2. In-memory Blob cache takes top priority with a zero-network blob: URL
  setCachedImageBlob(remoteUrl, new Blob([new Uint8Array(64)], { type: 'image/jpeg' }));
  const resolvedBlobUrl = resolveSeededPreviewUrl(remoteUrl, 'https://hub.org/');
  assert.ok(resolvedBlobUrl.startsWith('blob:'));

  clearClientImageCache();
});

import {
  buildFolderFileSignature,
  buildUniqueFolderArchivePaths,
  computeProgressiveRenderCount,
  computeThumbnailDimensions,
  shouldStoreArchiveEntry,
} from './folderGalleryLogic';

test('buildFolderFileSignature, computeThumbnailDimensions, and computeProgressiveRenderCount optimize Folder Gallery', () => {
  assert.equal(
    buildFolderFileSignature('\\Shoot\\Day1\\IMG_01.jpg', 204800, 1700000000000),
    'Shoot/Day1/IMG_01.jpg::204800::1700000000000'
  );

  assert.deepEqual(computeThumbnailDimensions(4000, 3000, 480), { width: 480, height: 360 });
  assert.deepEqual(computeThumbnailDimensions(1080, 1920, 480), { width: 270, height: 480 });
  // Never upscale small images
  assert.deepEqual(computeThumbnailDimensions(320, 240, 480), { width: 320, height: 240 });

  assert.equal(computeProgressiveRenderCount(0, 60, 60), 0);
  assert.equal(computeProgressiveRenderCount(25, 60, 60), 25);
  assert.equal(computeProgressiveRenderCount(250, 60, 60), 60);
  assert.equal(computeProgressiveRenderCount(250, 180, 60), 180);
  assert.equal(computeProgressiveRenderCount(250, 500, 60), 250);
});

test('shouldStoreArchiveEntry and buildUniqueFolderArchivePaths handle compression hints and duplicates', () => {
  assert.equal(shouldStoreArchiveEntry('Portraits/IMG_01.jpg'), true);
  assert.equal(shouldStoreArchiveEntry('renders/hero.webp'), true);
  assert.equal(shouldStoreArchiveEntry('vector/icon.svg'), false);
  assert.equal(shouldStoreArchiveEntry('SHA256SUMS.txt'), false);

  const paths = buildUniqueFolderArchivePaths([
    { filename: 'photo.jpg', relativePath: 'Trip/photo.jpg' },
    { filename: 'photo.jpg', relativePath: 'Trip/photo.jpg' },
    { filename: 'photo.jpg', relativePath: 'Trip/Sub/photo.jpg' },
  ]);
  assert.deepEqual(paths, [
    'Trip/photo.jpg',
    'Trip/photo_1.jpg',
    'Trip/Sub/photo.jpg',
  ]);
});


