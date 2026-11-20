import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImagesFromHtml } from './htmlExtractor';
import { SAMPLE_PRESETS } from './samplePages';

test('extractImagesFromHtml extracts and unshrinks images from Yosemite sample', () => {
  const preset = SAMPLE_PRESETS[0];
  const result = extractImagesFromHtml(preset.html, preset.url);

  assert.equal(result.images.length >= 8, true);
  assert.equal(result.stats.unshrunkCount >= 6, true);

  // Check the first image with enclosing <a>
  const first = result.images[0];
  assert.equal(first.isUnshrunk, true);
  assert.ok(first.fullUrl.includes('q=100'));

  // Check that Wikimedia image has thumb removed
  const wikiImg = result.images.find(img => img.fullUrl.includes('wikimedia.org'));
  assert.ok(wikiImg);
  assert.ok(!wikiImg?.fullUrl.includes('/320px-'));
});

test('extractImagesFromHtml extracts architecture sample with picture and srcset', () => {
  const preset = SAMPLE_PRESETS[1];
  const result = extractImagesFromHtml(preset.html, preset.url);

  assert.equal(result.images.length >= 6, true);
  // Unsplash unshrinking removes width caps and sets q=100 for maximum resolution
  const optimized = result.images.filter(img => img.isUnshrunk || img.fullUrl.includes('q=100') || img.fullUrl.includes('q=95'));
  assert.ok(optimized.length >= 4);
});

test('extractImagesFromHtml captures linkedPageUrl when preview img links to subpage', () => {
  const html = `
    <div class="gallery">
      <a href="/photos/everest-summit-view" class="photo-link">
        <img src="https://example.com/thumbnails/everest_thumb.jpg" alt="Everest Preview">
      </a>
    </div>
  `;
  const result = extractImagesFromHtml(html, 'https://example.com/mountains/');
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].linkedPageUrl, 'https://example.com/photos/everest-summit-view');
});

test('extractBestImageFromDetailPage extracts master full-size image from linked detail HTML', async () => {
  const { extractBestImageFromDetailPage } = await import('./htmlExtractor');
  const detailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta property="og:image" content="https://example.com/masters/everest_4k_ultra.jpg">
      </head>
      <body>
        <main>
          <h1>Mount Everest Summit</h1>
          <a href="/download/everest_original.jpg" class="download-btn">Download Full Original Image</a>
        </main>
      </body>
    </html>
  `;
  const best = extractBestImageFromDetailPage(detailHtml, 'https://example.com/photos/everest');
  assert.ok(best !== null);
  assert.equal(best?.url, 'https://example.com/masters/everest_4k_ultra.jpg');
});

test('extractGalleryMapFromDetailPage extracts master URLs and dimensions for all gallery items', async () => {
  const { extractGalleryMapFromDetailPage } = await import('./htmlExtractor');
  const html = `
    <div>
      <a href="https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg?secure=token1" 
         original="https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg?secure=token1" 
         dimension="4090x2727" imageid="1109704572">
        <img src="https://cdnc.imagefap.com/images/mini/122/110/1109704572.jpg">
      </a>
      <a href="https://cdnc.imagefap.com/images/full/119/646/646270480.jpg?secure=token2" 
         original="https://cdnc.imagefap.com/images/full/119/646/646270480.jpg?secure=token2" 
         dimension="1360x765" imageid="646270480">
        <img src="https://cdnc.imagefap.com/images/mini/119/646/646270480.jpg">
      </a>
    </div>
  `;
  const map = extractGalleryMapFromDetailPage(html, 'https://www.imagefap.com/photo/1109704572/?gid=14238993');
  assert.equal(map.size, 2);
  const item1 = map.get('1109704572');
  assert.ok(item1);
  assert.equal(item1?.fullUrl, 'https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg?secure=token1');
  assert.equal(item1?.width, 4090);
  assert.equal(item1?.height, 2727);

  const item2 = map.get('646270480');
  assert.ok(item2);
  assert.equal(item2?.width, 1360);
  assert.equal(item2?.height, 765);
});

test('extractBestImageFromDetailPage prioritizes matching target photo ID with master dimensions', async () => {
  const { extractBestImageFromDetailPage } = await import('./htmlExtractor');
  const html = `
    <html>
      <body>
        <img src="/img/z.gif" id="captcha">
        <img id="mainPhoto" width="4090" height="2727" data-src="https://cdnc.imagefap.com/images/frame-thumb/122/110/1109704572.jpg">
        <a original="https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg?secure=mastertoken" dimension="4090x2727" imageid="1109704572">
          <img src="thumb.jpg">
        </a>
      </body>
    </html>
  `;
  const res = extractBestImageFromDetailPage(html, 'https://www.imagefap.com/photo/1109704572/?gid=14238993');
  assert.ok(res !== null);
  assert.equal(res?.url, 'https://cdnc.imagefap.com/images/full/122/110/1109704572.jpg?secure=mastertoken');
  assert.equal(res?.width, 4090);
  assert.equal(res?.height, 2727);
});

test('extractImagesFromHtml ignores spacer gifs and logo icons', () => {
  const html = `
    <div>
      <img src="/img/z.gif" width="63" height="25" alt="z.gif">
      <img src="/img/ajax-loader.gif" alt="loader">
      <a href="/photo/1109704572/">
        <img src="https://cdnc.imagefap.com/images/thumb/122/110/1109704572.jpg" alt="Real Photo" width="400" height="267">
      </a>
    </div>
  `;
  const result = extractImagesFromHtml(html, 'https://www.imagefap.com/pictures/14238993/test');
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].altText, 'Real Photo');
});

test('extractGalleryMapFromDetailPage handles 8-digit photo IDs like 33802089 and CDN links', async () => {
  const { extractGalleryMapFromDetailPage, extractBestImageFromDetailPage } = await import('./htmlExtractor');
  const html = `
    <table>
      <tr>
        <td id="33802089">
          <a name="33802089" href="https://www.imagefap.com/photo/33802089/?pgid=&amp;gid=13643086&amp;page=0" 
             original="https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
             dimension="3000x2000" imageid="33802089">
            <img src="https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg">
          </a>
        </td>
      </tr>
    </table>
  `;
  const map = extractGalleryMapFromDetailPage(html, 'https://www.imagefap.com/pictures/13643086/?view=2');
  assert.equal(map.size, 1);
  const photo = map.get('33802089');
  assert.ok(photo);
  assert.equal(photo?.fullUrl, 'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374');
  assert.equal(photo?.width, 3000);
  assert.equal(photo?.height, 2000);

  const best = extractBestImageFromDetailPage(html, 'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0');
  assert.ok(best !== null);
  assert.equal(best?.url, 'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374');
});

test('parsePreviewUrlsOrManifest parses Browser Harvester JSON manifest accurately', async () => {
  const { parsePreviewUrlsOrManifest } = await import('./htmlExtractor');
  const manifest = JSON.stringify({
    sourceUrl: 'https://www.imagefap.com/pictures/13643086/Jessie%20Rogers%20and%20Lexington%20Steele%20Anal?gid=13643086&view=2',
    pageTitle: 'Jessie Rogers Gallery',
    images: [
      {
        id: 'img_1',
        thumbnailUrl: 'https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg',
        fullUrl: 'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374',
        linkedPageUrl: 'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0',
        width: 3840,
        height: 2560,
        isUnshrunk: true,
        unshrinkMethod: 'Open-Tab Live Harvester',
      },
    ],
  });

  const result = parsePreviewUrlsOrManifest(manifest);
  assert.ok(result !== null);
  assert.equal(result?.pageTitle, 'Jessie Rogers Gallery');
  assert.equal(result?.images.length, 1);
  assert.equal(
    result?.images[0].fullUrl,
    'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374'
  );
  assert.equal(
    result?.images[0].linkedPageUrl,
    'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0'
  );
  assert.equal(result?.images[0].resolutionTier, '4k');
});

test('parsePreviewUrlsOrManifest synthesizes ImageFap master /photo/ link from preview thumbnail URL', async () => {
  const { parsePreviewUrlsOrManifest } = await import('./htmlExtractor');
  const rawList = [
    'https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg',
    'https://example.com/uploads/sunset-300x200.jpg',
  ].join('\n');

  const result = parsePreviewUrlsOrManifest(
    rawList,
    'https://www.imagefap.com/pictures/13643086/Jessie%20Rogers?gid=13643086&view=2'
  );
  assert.ok(result !== null);
  assert.equal(result?.images.length, 2);
  assert.equal(
    result?.images[0].linkedPageUrl,
    'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0'
  );
  assert.equal(result?.images[1].fullUrl, 'https://example.com/uploads/sunset.jpg');
  assert.equal(result?.images[1].isUnshrunk, true);
});

test('extractBestImageFromDetailPage & extractGalleryMapFromDetailPage parse JSON-LD and inline CDN URLs', async () => {
  const { extractBestImageFromDetailPage, extractGalleryMapFromDetailPage } = await import('./htmlExtractor');
  const detailHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          {"@type":"ImageObject","contentUrl":"https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=freshToken==,1795000000","width":3840,"height":2560}
        </script>
      </head>
      <body>
        <script>var nextUrl = "https://cdnc.imagefap.com/images/full/118/338/33802090.jpg?secure=secondToken==,1795000000";</script>
      </body>
    </html>
  `;
  const map = extractGalleryMapFromDetailPage(
    detailHtml,
    'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0'
  );
  assert.equal(map.get('33802089')?.fullUrl, 'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=freshToken==,1795000000');
  assert.equal(map.get('33802090')?.fullUrl, 'https://cdnc.imagefap.com/images/full/118/338/33802090.jpg?secure=secondToken==,1795000000');

  const best = extractBestImageFromDetailPage(
    detailHtml,
    'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0'
  );
  assert.equal(best?.url, 'https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=freshToken==,1795000000');
  assert.equal(best?.width, 3840);
});

test('extractImagesFromHtml resolves relative /photo/ links against imagefap.com when pageUrl is .local', () => {
  const snippet = `<a href="/photo/33802089/?pgid=&gid=13643086&page=0"><img src="https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg"></a>`;
  const result = extractImagesFromHtml(snippet, 'https://custom-html-snippet.local');
  assert.equal(result.images.length, 1);
  assert.equal(
    result.images[0].linkedPageUrl,
    'https://www.imagefap.com/photo/33802089/?pgid=&gid=13643086&page=0'
  );
});

test('extractGalleryMapFromDetailPage & extractBestImageFromDetailPage handle JSON-escaped /images/full/ URLs', async () => {
  const { extractBestImageFromDetailPage, extractGalleryMapFromDetailPage } = await import('./htmlExtractor');
  const html = `
    <html>
      <body>
        <a href="/photo/44556677/">
          <img id="mainPhoto" src="https://cdnc.imagefap.com/images/full/12/445/44556677.jpg?secure=abc\\u0026v=2" width="2400" height="1600">
        </a>
        <script>
          window.__strip = ["https:\\/\\/cdnc.imagefap.com\\/images\\/full\\/12\\/445\\/44556678.jpg?secure=xyz\\u0026v=2"];
        </script>
      </body>
    </html>
  `;
  const map = extractGalleryMapFromDetailPage(html, 'https://www.imagefap.com/photo/44556677/?gid=123');
  assert.equal(
    map.get('44556678')?.fullUrl,
    'https://cdnc.imagefap.com/images/full/12/445/44556678.jpg?secure=xyz&v=2'
  );

  const best = extractBestImageFromDetailPage(html, 'https://www.imagefap.com/photo/44556677/?gid=123');
  assert.ok(best !== null);
  assert.ok(best?.url.includes('/images/full/12/445/44556677.jpg'));
  assert.equal(best?.width, 2400);
});

test('extractImagesFromHtml captures lazy-loaded ImageFap thumbnails with placeholder blank.gif src', () => {
  const html = `
    <a href="/photo/77889900/?gid=555&page=0">
      <img src="/img/blank.gif" data-original="https://cdnc.imagefap.com/images/thumb/77/889/77889900.jpg" alt="Lazy Thumb">
    </a>
  `;
  const result = extractImagesFromHtml(html, 'https://www.imagefap.com/pictures/555/lazy?view=2');
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].thumbnailUrl, 'https://cdnc.imagefap.com/images/thumb/77/889/77889900.jpg');
  assert.equal(result.images[0].linkedPageUrl, 'https://www.imagefap.com/photo/77889900/?gid=555&page=0');
});

test('extractImagesFromHtml extracts album 1920x1080 CDN masters and excludes related-album / video teasers', () => {
  const albumHtml = `<!DOCTYPE html>
  <html>
    <head><title>WLT S02E01 New Place New Personalities</title></head>
    <body>
      <main>
        <div class="album-images">
          <a href="https://pics-storage-1.archive.example/contents/albums/main/1920x1080/30000/30560/1556864.jpg" data-fancybox="gallery">
            <img src="https://pics-storage-1.archive.example/contents/albums/main/200x150/30000/30560/1556864.jpg" width="200" height="150" alt="Photo 1">
          </a>
          <a href="#" data-src="https://pics-storage-1.archive.example/contents/albums/main/1920x1080/30000/30560/1556865.jpg">
            <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-webp="https://pics-storage-1.archive.example/contents/albums/main/200x150/30000/30560/1556865.jpg" alt="Photo 2">
          </a>
        </div>
        <section class="related-albums">
          <a href="/albums/99001/unrelated-other-album/">
            <img src="https://pics-storage-1.archive.example/contents/albums/main/200x150/99000/99001/111111.jpg" alt="Other Album">
          </a>
          <a href="/videos/77777/some-clip/">
            <img src="https://pics-storage-1.archive.example/contents/videos_screenshots/77000/77777/preview.jpg" alt="Related Video">
          </a>
        </section>
      </main>
    </body>
  </html>`;

  const result = extractImagesFromHtml(
    albumHtml,
    'https://archive.example/albums/30560/wlt-s02e01-new-place-new-personalities/'
  );
  assert.equal(result.images.length, 2);
  assert.equal(
    result.images[0].fullUrl,
    'https://pics-storage-1.archive.example/contents/albums/main/1920x1080/30000/30560/1556864.jpg'
  );
  assert.equal(result.images[0].width, 1920);
  assert.equal(result.images[0].height, 1080);
  assert.equal(result.images[0].resolutionTier, 'hd');
  assert.equal(
    result.images[1].fullUrl,
    'https://pics-storage-1.archive.example/contents/albums/main/1920x1080/30000/30560/1556865.jpg'
  );
  assert.equal(result.images[1].isUnshrunk, true);
});




