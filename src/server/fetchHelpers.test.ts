import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelayTarget,
  buildNonUkHtmlRelayUrl,
  isGeoBlockedHtml,
  isDirectImageOrBatchInput,
  resolveImageReferer,
  sanitizeDownloadFilename,
  ensureUniqueFilename,
  escapeHtml,
  isValidImageBuffer,
  resolveImageBufferWithFallbacks,
} from './fetchHelpers.ts';

test('buildRelayTarget handles empty, {url} placeholder, url= suffix, and query params', () => {
  assert.equal(buildRelayTarget('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(
    buildRelayTarget('https://example.com/a?b=1', 'https://relay.dev/?target={url}'),
    'https://relay.dev/?target=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1'
  );
  assert.equal(
    buildRelayTarget('https://example.com/p', 'https://relay.dev/?url='),
    'https://relay.dev/?url=https%3A%2F%2Fexample.com%2Fp'
  );
  assert.equal(
    buildRelayTarget('https://example.com/p', 'https://relay.dev/proxy'),
    'https://relay.dev/proxy?url=https%3A%2F%2Fexample.com%2Fp'
  );
  assert.equal(
    buildNonUkHtmlRelayUrl('https://www.imagefap.com/gallery/14385550?view=2'),
    'https://r.jina.ai/https://www.imagefap.com/gallery/14385550?view=2'
  );
});

test('isGeoBlockedHtml detects UK ban markers', () => {
  assert.equal(isGeoBlockedHtml('<html><body>Normal page</body></html>'), false);
  assert.equal(isGeoBlockedHtml('<html>uk_ban_ifap</html>'), true);
  assert.equal(isGeoBlockedHtml('', 'https://www.imagefap.com/uk_ban_ifap.html'), true);
});

test('isDirectImageOrBatchInput distinguishes image URLs and multi-line batches from webpages', () => {
  assert.equal(isDirectImageOrBatchInput('https://example.com/gallery'), false);
  assert.equal(isDirectImageOrBatchInput('https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=abc'), true);
  assert.equal(isDirectImageOrBatchInput('https://cdnc.imagefap.com/images/thumb/118/338/33802089.jpg'), true);
  assert.equal(
    isDirectImageOrBatchInput('https://example.com/1\nhttps://example.com/2'),
    true
  );
});

test('resolveImageReferer selects proper site referer for Instagram, ImageFap, and generic CDNs', () => {
  assert.equal(resolveImageReferer('https://scontent.cdninstagram.com/v/abc.jpg'), 'https://www.instagram.com/');
  assert.equal(resolveImageReferer('https://instagram.fnyc1-1.fna.fbcdn.net/v/abc.jpg'), 'https://www.instagram.com/');
  assert.equal(resolveImageReferer('https://cdnc.imagefap.com/images/full/1.jpg'), 'https://www.imagefap.com/');
  assert.equal(
    resolveImageReferer('https://pics-storage-1.archive.example/contents/albums/main/1920x1080/30000/30560/1556864.jpg'),
    'https://www.archive.example/'
  );
  assert.equal(resolveImageReferer('https://images.unsplash.com/photo-1', 'https://custom.site/page'), 'https://custom.site/page');
  assert.equal(resolveImageReferer('https://images.unsplash.com/photo-1'), 'https://images.unsplash.com');
});

test('sanitizeDownloadFilename & ensureUniqueFilename preserve extensions and prevent collisions', () => {
  assert.equal(sanitizeDownloadFilename('', 'https://cdn.example.com/path/hero.png?w=100'), 'hero.png');
  assert.equal(sanitizeDownloadFilename('photo_without_ext'), 'photo_without_ext.jpg');
  assert.equal(sanitizeDownloadFilename('bad"name\n.webp'), 'bad_name_.webp');

  const seen = new Set<string>();
  assert.equal(ensureUniqueFilename('photo.jpg', seen), 'photo.jpg');
  assert.equal(ensureUniqueFilename('photo.jpg', seen), 'photo_1.jpg');
  assert.equal(ensureUniqueFilename('photo.jpg', seen), 'photo_2.jpg');
});

test('escapeHtml escapes sensitive HTML characters', () => {
  assert.equal(
    escapeHtml(`<script>"alert('xss' & test)"</script>`),
    '&lt;script&gt;&quot;alert(&#039;xss&#039; &amp; test)&quot;&lt;/script&gt;'
  );
});

test('isValidImageBuffer rejects HTML/JSON error responses and accepts binary image buffers', () => {
  assert.equal(isValidImageBuffer(Buffer.alloc(0), 'image/jpeg'), false);
  assert.equal(isValidImageBuffer(Buffer.from('<!DOCTYPE html><html></html>'), 'image/jpeg'), false);
  assert.equal(isValidImageBuffer(Buffer.from('{"error":"not found"}'), 'application/json'), false);
  assert.equal(isValidImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg'), true);
});

test('resolveImageBufferWithFallbacks resolves detail page and fallback URLs in order', async () => {
  const calls: string[] = [];
  const fakeBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const res = await resolveImageBufferWithFallbacks({
    imageUrl: 'https://cdn.example.com/expired.jpg',
    linkedPageUrl: 'https://example.com/photo/42',
    fallbackUrl: 'https://cdn.example.com/fallback.png',
    resolveDetailPageUrl: async () => 'https://cdn.example.com/fresh-master.png',
    fetcher: async (url) => {
      calls.push(url);
      if (url.includes('fresh-master.png')) {
        return new Response(new Uint8Array(fakeBytes), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }
      return new Response('nope', { status: 403 });
    },
  });

  assert.ok(res);
  assert.equal(res.contentType, 'image/png');
  assert.deepEqual(calls, [
    'https://cdn.example.com/expired.jpg',
    'https://cdn.example.com/fresh-master.png',
  ]);
});

