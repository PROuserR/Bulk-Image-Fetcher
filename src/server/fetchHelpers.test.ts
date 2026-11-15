import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelayTarget,
  isGeoBlockedHtml,
  isDirectImageOrBatchInput,
  resolveImageReferer,
  sanitizeDownloadFilename,
  ensureUniqueFilename,
  escapeHtml,
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
