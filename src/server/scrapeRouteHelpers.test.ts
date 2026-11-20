import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGalleryFetchUrl,
  extractImagefapPaginationUrls,
  mergeExtractedGalleryPages,
  filterImagefapChromeImages,
  resolveLinkedFullResGallery,
} from './scrapeRouteHelpers';
import { extractImagesFromHtml } from '../utils/htmlExtractor';

test('normalizeGalleryFetchUrl handles ImageFap URL shapes and adds view=2', () => {
  assert.equal(
    normalizeGalleryFetchUrl('https://www.imagefap.com/pictures/13643086/test-gallery'),
    'https://www.imagefap.com/pictures/13643086/test-gallery?view=2'
  );
  assert.equal(
    normalizeGalleryFetchUrl('m.imagefap.com/gallery.php?gid=14238993'),
    'https://www.imagefap.com/gallery.php?gid=14238993&view=2'
  );
  assert.equal(
    normalizeGalleryFetchUrl('https://www.imagefap.com/pictures/14238993/?view=1&page=2'),
    'https://www.imagefap.com/pictures/14238993/?view=1&page=2'
  );
  assert.equal(
    normalizeGalleryFetchUrl('preset:imagefap_gallery'),
    'preset:imagefap_gallery'
  );
});

test('extractImagefapPaginationUrls finds sorted pagination URLs matching current gallery', () => {
  const html = `
    <div class="pagination">
      <a href="/pictures/14238993/gallery?gid=14238993&page=0">1</a>
      <a href="/pictures/14238993/gallery?gid=14238993&page=2">3</a>
      <a href="/pictures/14238993/gallery?gid=14238993&page=1">2</a>
      <a href="/pictures/99999999/other?gid=99999999&page=1">Other Gallery</a>
      <a href="/photo/1109704572/?gid=14238993&page=1">Photo Link</a>
    </div>
  `;

  const pages = extractImagefapPaginationUrls(
    html,
    'https://www.imagefap.com/pictures/14238993/gallery?gid=14238993&view=2'
  );

  assert.deepEqual(pages, [
    'https://www.imagefap.com/pictures/14238993/gallery?gid=14238993&page=1&view=2',
    'https://www.imagefap.com/pictures/14238993/gallery?gid=14238993&page=2&view=2',
  ]);
});

test('mergeExtractedGalleryPages merges multi-page ImageFap results and deduplicates overlap', () => {
  const page0 = extractImagesFromHtml(
    `
      <a href="/photo/1000001/?gid=55&page=0"><img src="https://cdnc.imagefap.com/images/thumb/1/2/1000001.jpg"></a>
      <a href="/photo/1000002/?gid=55&page=0"><img src="https://cdnc.imagefap.com/images/thumb/1/2/1000002.jpg"></a>
    `,
    'https://www.imagefap.com/pictures/55/test?view=2'
  );
  const page1 = extractImagesFromHtml(
    `
      <a href="/photo/1000002/?gid=55&page=1"><img src="https://cdnc.imagefap.com/images/thumb/1/2/1000002.jpg"></a>
      <a href="/photo/1000003/?gid=55&page=1"><img src="https://cdnc.imagefap.com/images/thumb/1/2/1000003.jpg"></a>
    `,
    'https://www.imagefap.com/pictures/55/test?page=1&view=2'
  );

  const merged = mergeExtractedGalleryPages(page0, [page1]);
  assert.equal(merged.images.length, 3);
  assert.equal(merged.stats.totalFound, 3);
});

test('filterImagefapChromeImages keeps gallery photos and drops ImageFap UI chrome', () => {
  const html = `
    <div>
      <img src="/img/logo_main.png" width="180" height="40" alt="Logo">
      <img src="/images/avatars/user1.jpg" width="60" height="60" alt="Avatar">
      <img src="/img/spacer.gif" width="1" height="1">
      <a href="/photo/1109704572/?gid=14238993&page=0">
        <img src="https://cdnc.imagefap.com/images/thumb/122/110/1109704572.jpg" alt="Gallery Photo" width="200" height="150">
      </a>
    </div>
  `;
  const extracted = extractImagesFromHtml(html, 'https://www.imagefap.com/pictures/14238993/test');
  const filtered = filterImagefapChromeImages(extracted.images, 'https://www.imagefap.com/pictures/14238993/test');
  assert.equal(filtered.length, 1);
  assert.ok(filtered[0].linkedPageUrl?.includes('/photo/1109704572/'));
});

test('resolveLinkedFullResGallery resolves ALL 165 gallery thumbnails to signed full-res without 120 cap', async () => {
  const totalCount = 165;
  const htmlItems = Array.from({ length: totalCount }, (_, i) => {
    const pid = String(20000000 + i);
    return `<a href="/photo/${pid}/?gid=999999&page=0"><img src="https://cdnc.imagefap.com/images/thumb/99/200/${pid}.jpg" alt="Photo ${i}"></a>`;
  }).join('\n');

  const extracted = extractImagesFromHtml(htmlItems, 'https://www.imagefap.com/pictures/999999/big?view=2');
  assert.equal(extracted.images.length, totalCount);

  let fetchCalls = 0;
  const res = await resolveLinkedFullResGallery({
    images: extracted.images,
    pageUrl: 'https://www.imagefap.com/pictures/999999/big?view=2',
    fetchDetailHtml: async (detailUrl) => {
      fetchCalls++;
      const idMatch = detailUrl.match(/\/photo\/([0-9]+)/);
      const centerIdx = idMatch ? parseInt(idMatch[1], 10) - 20000000 : 0;
      const windowStart = Math.max(0, centerIdx - 12);
      const windowEnd = Math.min(totalCount - 1, centerIdx + 12);

      const filmstripLinks: string[] = [];
      for (let j = windowStart; j <= windowEnd; j++) {
        const pid = String(20000000 + j);
        filmstripLinks.push(
          `<a imageid="${pid}" original="https://cdnc.imagefap.com/images/full/99/200/${pid}.jpg?secure=sig_${pid}" dimension="3000x2000" href="/photo/${pid}/"><img src="https://cdnc.imagefap.com/images/mini/99/200/${pid}.jpg"></a>`
        );
      }

      return {
        ok: true,
        url: detailUrl,
        html: `<html><body><div class="filmstrip">${filmstripLinks.join('\n')}</div></body></html>`,
      };
    },
  });

  assert.equal(res.subpageGeoBlocked, false);
  assert.equal(res.images.length, totalCount);
  assert.ok(res.images.every((img) => img.deepScraped === true));
  assert.ok(res.images.every((img) => img.fullUrl.includes('/images/full/') && img.fullUrl.includes('?secure=sig_')));
  assert.ok(res.images.every((img) => img.width === 3000 && img.height === 2000));
  assert.ok(fetchCalls < 20, `Expected strided filmstrip to resolve 165 photos in <20 requests, got ${fetchCalls}`);
});

test('extractAlbumPaginationUrls and isPhotoDetailPage support /albums/<id>/<slug>/ structures', async () => {
  const { extractAlbumPaginationUrls, isPhotoDetailPage } = await import('./scrapeRouteHelpers');
  assert.equal(
    isPhotoDetailPage('https://archive.example/albums/30560/wlt-s02e01/1556864/'),
    true
  );
  assert.equal(
    isPhotoDetailPage('https://archive.example/albums/30560/wlt-s02e01/'),
    false
  );

  const albumHtml = `
    <div class="pagination">
      <a href="/albums/30560/wlt-s02e01/2/">2</a>
      <a href="/albums/30560/wlt-s02e01/3/">3</a>
      <a href="/albums/99999/other-album/2/">Other Album</a>
    </div>
  `;
  const pages = extractAlbumPaginationUrls(
    albumHtml,
    'https://archive.example/albums/30560/wlt-s02e01/'
  );
  assert.deepEqual(pages, [
    'https://archive.example/albums/30560/wlt-s02e01/2/',
    'https://archive.example/albums/30560/wlt-s02e01/3/',
  ]);
});

test('resolveDiscoveredGalleriesIntermediateLinks upgrades /video/<slug>/ items to /albums/<id>/<slug>/ and deduplicates', async () => {
  const { resolveDiscoveredGalleriesIntermediateLinks } = await import('./scrapeRouteHelpers');
  const upgraded = await resolveDiscoveredGalleriesIntermediateLinks(
    [
      {
        id: 'gal_1',
        title: 'Post Workout Smoothie',
        url: 'https://archive.example/video/post-workout-smoothie/',
        score: 80,
        isIntermediateItem: true,
      },
      {
        id: 'gal_2',
        title: 'Duplicate Mirror',
        url: 'https://archive.example/watch/post-workout-smoothie/',
        score: 75,
        isIntermediateItem: true,
      },
    ],
    async (url) => ({
      ok: true,
      url,
      html: `<main class="details"><a href="/albums/20306/post-workout-smoothie/">Album Photos</a></main>`,
    })
  );

  assert.equal(upgraded.length, 1);
  assert.equal(upgraded[0].url, 'https://archive.example/albums/20306/post-workout-smoothie/');
  assert.equal(upgraded[0].resolvedFromItemUrl, 'https://archive.example/video/post-workout-smoothie/');
  assert.equal(upgraded[0].isIntermediateItem, false);
});


