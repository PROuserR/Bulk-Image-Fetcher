import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProxyImageUrl,
  getCachedImageBlob,
  setCachedImageBlob,
  dedupeImageBlobFetch,
  registerWorkingPreviewUrl,
  getWorkingPreviewUrl,
  getFullResReusablePreviewUrl,
  clearClientImageCache,
  getClientImageCacheStats,
} from './clientImageCache.ts';

test('buildProxyImageUrl constructs deterministic proxy URLs', () => {
  assert.equal(
    buildProxyImageUrl('https://cdn.example.com/a.jpg', 'https://example.com/gal'),
    '/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg&referer=https%3A%2F%2Fexample.com%2Fgal'
  );
  assert.equal(
    buildProxyImageUrl('https://cdn.example.com/a.jpg', '', 'https://relay.dev/?url='),
    '/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg&referer=&relayUrl=https%3A%2F%2Frelay.dev%2F%3Furl%3D'
  );
});

test('setCachedImageBlob & getCachedImageBlob track stats and evict by max entries', () => {
  clearClientImageCache();
  for (let i = 0; i < 85; i++) {
    const blob = new Blob([new Uint8Array(64).fill(i)], { type: 'image/jpeg' });
    setCachedImageBlob(`https://cdn.example.com/img-${i}.jpg`, blob);
  }

  const stats = getClientImageCacheStats();
  assert.equal(stats.entries, 80);
  assert.equal(stats.bytes, 80 * 64);

  // Earliest 5 should have been evicted
  assert.equal(getCachedImageBlob('https://cdn.example.com/img-0.jpg'), null);
  assert.equal(getCachedImageBlob('https://cdn.example.com/img-4.jpg'), null);
  assert.ok(getCachedImageBlob('https://cdn.example.com/img-84.jpg'));

  clearClientImageCache();
  assert.equal(getClientImageCacheStats().entries, 0);
  assert.equal(getClientImageCacheStats().bytes, 0);
});

test('dedupeImageBlobFetch shares single in-flight promise and caches result', async () => {
  clearClientImageCache();
  let networkCalls = 0;

  const mockFetcher = async () => {
    networkCalls++;
    await new Promise((r) => setTimeout(r, 20));
    return new Blob([new Uint8Array(128).fill(7)], { type: 'image/png' });
  };

  const [b1, b2] = await Promise.all([
    dedupeImageBlobFetch('https://cdn.example.com/concurrent.png', mockFetcher),
    dedupeImageBlobFetch('https://cdn.example.com/concurrent.png', mockFetcher),
  ]);

  assert.ok(b1 && b2);
  assert.equal(b1.size, 128);
  assert.equal(networkCalls, 1);

  const b3 = await dedupeImageBlobFetch('https://cdn.example.com/concurrent.png', mockFetcher);
  assert.ok(b3);
  assert.equal(networkCalls, 1);

  clearClientImageCache();
});

test('registerWorkingPreviewUrl and getFullResReusablePreviewUrl guard against thumbnail downgrades', () => {
  clearClientImageCache();
  const fullUrl = 'https://cdn.example.com/full/hero.jpg';
  const thumbUrl = 'https://cdn.example.com/thumb/hero.jpg';
  const proxyFull = buildProxyImageUrl(fullUrl, 'https://example.com');

  // If gallery loaded thumbnail fallback, Lightbox can use it for previewing,
  // but downloader must NOT reuse thumbnail URL as full-res file.
  registerWorkingPreviewUrl(fullUrl, thumbUrl);
  assert.equal(getWorkingPreviewUrl(fullUrl), thumbUrl);
  assert.equal(getFullResReusablePreviewUrl(fullUrl), undefined);

  // Direct full URL is reusable for full-res downloads
  registerWorkingPreviewUrl(fullUrl, fullUrl);
  assert.equal(getFullResReusablePreviewUrl(fullUrl), fullUrl);

  // /api/proxy wrapping exact full URL is also reusable for full-res downloads
  registerWorkingPreviewUrl(fullUrl, proxyFull);
  assert.equal(getFullResReusablePreviewUrl(fullUrl), proxyFull);

  clearClientImageCache();
});
