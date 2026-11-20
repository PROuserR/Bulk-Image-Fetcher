import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverChildGalleryLinks,
  mergeNestedGalleryResults,
  sanitizeGalleryFolderName,
  matchesGalleryUrlFilter,
} from './nestedGalleryLogic.ts';
import {
  filterScrapedImages,
  DEFAULT_GALLERY_FILTERS,
  countActiveFilters,
  type ScrapedImage,
} from './scraperLogic.ts';
import type { ExtractionResult } from './htmlExtractor.ts';

test('discoverChildGalleryLinks extracts nested gallery cards while excluding nav, footer, direct images, and single-photo links', () => {
  const hubHtml = `<!DOCTYPE html>
  <html>
    <head><title>Editorial Photography Index</title></head>
    <body>
      <header>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/login">Member Login</a>
          <a href="/privacy">Privacy Policy</a>
        </nav>
      </header>
      <main>
        <section class="hub-grid">
          <article class="gallery-card">
            <a href="/galleries/alpine-dawn" title="Alpine Dawn Series">
              <img src="/thumbs/alpine-cover.jpg" alt="Alpine Dawn Cover">
              <h3>Alpine Dawn Series</h3>
            </a>
            <span>12 photos</span>
          </article>
          <article class="gallery-card">
            <a href="https://editorial-hub.com/galleries/coastal-mist/">
              <img data-src="https://editorial-hub.com/thumbs/coastal-cover.jpg" src="/img/spacer.gif" alt="Coastal Mist Cover">
              <h3>Coastal Mist Study</h3>
            </a>
            <span>(8 photos)</span>
          </article>
          <article class="gallery-card">
            <a href="/albums/nordic-concrete">
              <img src="/thumbs/nordic-cover.jpg" alt="Nordic Concrete">
              <h3>Nordic Concrete Pavilions</h3>
            </a>
          </article>
        </section>
        <div class="ignored-links">
          <a href="/photo/990123">Single Photo View</a>
          <a href="/assets/banner.jpg">Download Banner</a>
          <a href="/?page=2">Next Hub Page</a>
          <a href="https://external-sponsor.example.net/galleries/ad">Sponsored Link</a>
        </div>
      </main>
      <footer>
        <a href="/terms">Terms</a>
        <a href="/dmca">DMCA</a>
      </footer>
    </body>
  </html>`;

  const discovered = discoverChildGalleryLinks(hubHtml, 'https://editorial-hub.com/archives/');
  assert.equal(discovered.length, 3);

  assert.equal(discovered[0].url, 'https://editorial-hub.com/galleries/alpine-dawn');
  assert.equal(discovered[0].title, 'Alpine Dawn Series');
  assert.equal(discovered[0].coverThumbnailUrl, 'https://editorial-hub.com/thumbs/alpine-cover.jpg');
  assert.equal(discovered[0].photoCountHint, 12);

  assert.equal(discovered[1].url, 'https://editorial-hub.com/galleries/coastal-mist/');
  assert.equal(discovered[1].coverThumbnailUrl, 'https://editorial-hub.com/thumbs/coastal-cover.jpg');
  assert.equal(discovered[1].photoCountHint, 8);

  assert.equal(discovered[2].url, 'https://editorial-hub.com/albums/nordic-concrete');
});

test('discoverChildGalleryLinks deduplicates ImageFap gallery links with ?view=2 variants and skips /photo/ links', () => {
  const html = `
    <div class="gallery-list">
      <a href="/pictures/13643086/Series-One"><img src="/t1.jpg" alt="Series One"></a>
      <a href="https://www.imagefap.com/pictures/13643086/Series-One?view=2">Series One All</a>
      <a href="/gallery/14385550"><img src="/t2.jpg" alt="Series Two"></a>
      <a href="/photo/1167859873/?gid=14385550"><img src="/p1.jpg" alt="Photo 1"></a>
      <a href="/login">Login</a>
    </div>
  `;

  const discovered = discoverChildGalleryLinks(html, 'https://www.imagefap.com/profile/creator/galleries');
  assert.equal(discovered.length, 2);
  assert.ok(discovered[0].url.includes('13643086'));
  assert.ok(discovered[1].url.includes('14385550'));
});

test('discoverChildGalleryLinks supports URL/title pattern filters and cross-origin toggle', () => {
  const html = `
    <div class="hub">
      <article class="card">
        <a href="/galleries/winter-2026"><img src="/w.jpg" alt="Winter 2026"><span>Winter 2026</span></a>
      </article>
      <article class="card">
        <a href="/galleries/summer-2026"><img src="/s.jpg" alt="Summer 2026"><span>Summer 2026</span></a>
      </article>
      <article class="card">
        <a href="https://partner-studio.org/galleries/collab-set"><img src="/c.jpg" alt="Collab Set"><span>Partner Collab</span></a>
      </article>
    </div>
  `;

  const filtered = discoverChildGalleryLinks(html, 'https://myhub.com/', {
    urlPatternFilter: '/winter/i',
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].url, 'https://myhub.com/galleries/winter-2026');

  const crossOrigin = discoverChildGalleryLinks(html, 'https://myhub.com/', {
    sameOriginOnly: false,
  });
  assert.equal(crossOrigin.length, 3);
  assert.equal(matchesGalleryUrlFilter('https://myhub.com/galleries/summer-2026', 'Summer', 'summer'), true);
});

test('mergeNestedGalleryResults merges all child galleries with unique IDs, gallery metadata, and failure tracking', () => {
  const makeImg = (url: string, unshrunk: boolean): ScrapedImage => ({
    id: 'img_1',
    thumbnailUrl: url + '?w=200',
    fullUrl: url,
    isUnshrunk: unshrunk,
    unshrinkMethod: unshrunk ? 'Master' : 'Direct',
    altText: 'Photo',
    format: 'jpg',
    resolutionTier: unshrunk ? '4k' : 'small',
    filename: url.split('/').pop() || 'photo.jpg',
  });

  const run1: ExtractionResult = {
    url: 'https://hub.com/galleries/one',
    pageTitle: 'Gallery One',
    images: [makeImg('https://cdn.hub.com/one/01.jpg', true), makeImg('https://cdn.hub.com/one/02.jpg', true)],
    stats: { totalFound: 2, unshrunkCount: 2, formats: { jpg: 2 } },
  };
  const run2: ExtractionResult = {
    url: 'https://hub.com/galleries/two',
    pageTitle: 'Gallery Two',
    images: [
      makeImg('https://cdn.hub.com/two/01.jpg', true),
      // duplicate across galleries should be deduplicated cleanly
      makeImg('https://cdn.hub.com/one/01.jpg', true),
    ],
    stats: { totalFound: 2, unshrunkCount: 2, formats: { jpg: 2 } },
  };

  const merged = mergeNestedGalleryResults('https://hub.com/', 'Main Hub', [
    {
      gallery: { id: 'gal_1', title: 'One', url: 'https://hub.com/galleries/one', score: 85 },
      result: run1,
    },
    {
      gallery: { id: 'gal_2', title: 'Two', url: 'https://hub.com/galleries/two', score: 85 },
      result: run2,
    },
    {
      gallery: { id: 'gal_3', title: 'Three', url: 'https://hub.com/galleries/three', score: 70 },
      result: null,
      error: 'HTTP 403',
    },
  ]);

  assert.equal(merged.images.length, 3);
  assert.deepEqual(
    merged.images.map((i) => i.id),
    ['img_1', 'img_2', 'img_3']
  );
  assert.equal(merged.images[0].galleryId, 'gal_1');
  assert.equal(merged.images[0].galleryTitle, 'One');
  assert.equal(merged.images[2].galleryId, 'gal_2');
  assert.equal(merged.galleries.length, 3);
  assert.equal(merged.galleries[0].imageCount, 2);
  assert.equal(merged.galleries[1].imageCount, 1);
  assert.equal(merged.galleries[2].status, 'failed');
  assert.equal(merged.stats.completedGalleries, 2);
});

test('filterScrapedImages supports filtering by child galleryId and sanitizeGalleryFolderName cleans paths', () => {
  const imgs: ScrapedImage[] = [
    {
      id: 'img_1',
      thumbnailUrl: 'https://cdn.hub.com/a/1_t.jpg',
      fullUrl: 'https://cdn.hub.com/a/1.jpg',
      isUnshrunk: true,
      unshrinkMethod: 'CDN',
      altText: 'A1',
      format: 'jpg',
      resolutionTier: '4k',
      filename: 'a1.jpg',
      galleryId: 'gal_1',
      galleryTitle: 'Alpine Dawn: 2026/01',
    },
    {
      id: 'img_2',
      thumbnailUrl: 'https://cdn.hub.com/b/1_t.jpg',
      fullUrl: 'https://cdn.hub.com/b/1.jpg',
      isUnshrunk: true,
      unshrinkMethod: 'CDN',
      altText: 'B1',
      format: 'jpg',
      resolutionTier: '4k',
      filename: 'b1.jpg',
      galleryId: 'gal_2',
      galleryTitle: 'Coastal Mist',
    },
  ];

  const onlyGal2 = filterScrapedImages(imgs, { ...DEFAULT_GALLERY_FILTERS, galleryId: 'gal_2' });
  assert.equal(onlyGal2.length, 1);
  assert.deepEqual(onlyGal2.map((i) => i.id), ['img_2']);
  assert.equal(countActiveFilters({ ...DEFAULT_GALLERY_FILTERS, galleryId: 'gal_2' }), 1);
  assert.equal(countActiveFilters(DEFAULT_GALLERY_FILTERS), 0);

  assert.equal(sanitizeGalleryFolderName('Alpine Dawn: 2026/01', 'gal_1'), 'Alpine_Dawn_2026_01');
});

test('discoverChildGalleryLinks accurately isolates /albums/<id>/<slug>/ cards on search hubs and ignores videos/tags/models/pagination', async () => {
  const { extractParentHubPaginationUrls } = await import('./nestedGalleryLogic.ts');
  const searchHubHtml = `<!DOCTYPE html>
  <html>
    <head><title>Search Results - Editorial Architecture</title></head>
    <body>
      <main>
        <div class="list-albums">
          <div class="item">
            <a href="/albums/30560/wlt-s02e01-new-place-new-personalities/" title="WLT S02E01 New Place New Personalities">
              <div class="img">
                <img src="/img/spacer.gif" data-original="https://pics-storage-1.archive.example/contents/albums/main/200x150/30000/30560/1556864.jpg" alt="WLT S02E01">
              </div>
              <div class="title">WLT S02E01 New Place New Personalities</div>
            </a>
            <div class="photos">18</div>
          </div>
          <div class="item">
            <a href="/albums/30561/studio-session-two/">
              <div class="img">
                <img src="https://pics-storage-1.archive.example/contents/albums/main/200x150/30000/30561/1556900.jpg" alt="Studio Session Two">
              </div>
              <div class="title">Studio Session Two</div>
            </a>
            <div class="photos">24</div>
          </div>
          <div class="item">
            <a href="/videos/8801/behind-the-scenes-reel/">
              <img src="https://pics-storage-1.archive.example/contents/videos/8801/thumb.jpg" alt="Video Reel">
              <div class="title">Behind the Scenes Video</div>
            </a>
          </div>
          <div class="item">
            <a href="/models/elena-vance/">
              <img src="https://pics-storage-1.archive.example/contents/models/elena.jpg" alt="Elena Vance">
              <div class="title">Elena Vance Profile</div>
            </a>
          </div>
          <div class="item">
            <a href="/tags/editorial/">
              <img src="/thumbs/tag-editorial.jpg" alt="Editorial Tag">
              <div class="title">Editorial Tag</div>
            </a>
          </div>
        </div>
        <div class="pagination">
          <a href="/search/editorial-architecture/2/">2</a>
          <a href="/search/editorial-architecture/3/" rel="next">Next</a>
        </div>
      </main>
    </body>
  </html>`;

  const discovered = discoverChildGalleryLinks(
    searchHubHtml,
    'https://archive.example/search/editorial-architecture/'
  );
  assert.equal(discovered.length, 2);
  assert.equal(
    discovered[0].url,
    'https://archive.example/albums/30560/wlt-s02e01-new-place-new-personalities/'
  );
  assert.equal(
    discovered[0].coverThumbnailUrl,
    'https://pics-storage-1.archive.example/contents/albums/main/200x150/30000/30560/1556864.jpg'
  );
  assert.equal(discovered[0].photoCountHint, 18);
  assert.equal(discovered[1].url, 'https://archive.example/albums/30561/studio-session-two/');
  assert.equal(discovered[1].photoCountHint, 24);

  const hubPages = extractParentHubPaginationUrls(
    searchHubHtml,
    'https://archive.example/search/editorial-architecture/'
  );
  assert.deepEqual(hubPages, [
    'https://archive.example/search/editorial-architecture/2/',
    'https://archive.example/search/editorial-architecture/3/',
  ]);
});

test('discoverChildGalleryLinks discovers /video/<slug>/ cards on search hubs and extractLinkedAlbumUrlFromItemPage resolves their linked /albums/<id>/<slug>/ URL', async () => {
  const {
    discoverChildGalleryLinks,
    extractLinkedAlbumUrlFromItemPage,
    isIntermediateItemPageUrl,
    isHubOrSearchPageUrl,
  } = await import('./nestedGalleryLogic.ts');

  assert.equal(isHubOrSearchPageUrl('https://archive.example/search/studio-showcase/'), true);
  assert.equal(isIntermediateItemPageUrl('https://archive.example/video/post-workout-smoothie/'), true);
  assert.equal(isIntermediateItemPageUrl('https://archive.example/videos/'), false);
  assert.equal(isIntermediateItemPageUrl('https://archive.example/albums/20306/post-workout-smoothie/'), false);

  const searchVideoHubHtml = `<!DOCTYPE html>
  <html>
    <head><title>Search: Studio Showcase</title></head>
    <body>
      <header>
        <nav>
          <a href="/videos/">Videos</a>
          <a href="/albums/">Albums</a>
          <a href="/tags/">Tags</a>
        </nav>
      </header>
      <main>
        <div class="list-videos">
          <div class="item">
            <a href="/video/post-workout-smoothie/" title="Post Workout Smoothie">
              <img data-webp="https://pics-storage-1.archive.example/contents/videos_screenshots/20000/20306/preview.jpg" alt="Post Workout Smoothie" />
              <div class="title">Post Workout Smoothie</div>
            </a>
          </div>
          <div class="item">
            <a href="/video/morning-terrace-light/" title="Morning Terrace Light">
              <img data-src="https://pics-storage-1.archive.example/contents/videos_screenshots/20000/20307/preview.jpg" alt="Morning Terrace Light" />
              <div class="title">Morning Terrace Light</div>
            </a>
          </div>
          <div class="item">
            <a href="/models/elena-vance/">
              <img src="https://pics-storage-1.archive.example/contents/models/elena.jpg" alt="Model" />
              <div class="title">Model Link</div>
            </a>
          </div>
        </div>
      </main>
    </body>
  </html>`;

  const discovered = discoverChildGalleryLinks(
    searchVideoHubHtml,
    'https://archive.example/search/studio-showcase/'
  );
  assert.equal(discovered.length, 2);
  assert.equal(discovered[0].url, 'https://archive.example/video/post-workout-smoothie/');
  assert.equal(discovered[0].isIntermediateItem, true);
  assert.equal(
    discovered[0].coverThumbnailUrl,
    'https://pics-storage-1.archive.example/contents/videos_screenshots/20000/20306/preview.jpg'
  );
  assert.equal(discovered[1].url, 'https://archive.example/video/morning-terrace-light/');
  assert.equal(discovered[1].isIntermediateItem, true);

  const itemPageHtml = `<!DOCTYPE html>
  <html>
    <body>
      <aside class="related-albums">
        <a href="/albums/99999/unrelated-shoot/" title="Unrelated Shoot">Photos</a>
      </aside>
      <main class="video-info">
        <div class="tabs">
          <a href="/albums/20306/post-workout-smoothie/" class="btn">View Photo Album (18 photos)</a>
        </div>
      </main>
    </body>
  </html>`;

  const resolvedAlbum = extractLinkedAlbumUrlFromItemPage(
    itemPageHtml,
    'https://archive.example/video/post-workout-smoothie/'
  );
  assert.equal(resolvedAlbum, 'https://archive.example/albums/20306/post-workout-smoothie/');
});


