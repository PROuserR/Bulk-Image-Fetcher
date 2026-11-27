import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLocalFolderBlobs,
  clearThumbnailCache,
  getCachedThumbnailMeta,
  getLocalFolderBlob,
  getThumbnailCacheStats,
  registerLocalFolderBlob,
  resolveFolderItemBlob,
  setCachedThumbnailMeta,
} from './folderThumbnailCache.ts';
import { clearClientImageCache, setCachedImageBlob } from './clientImageCache.ts';

test('folderThumbnailCache tracks LRU entries, byte stats, and local blobs cleanly', () => {
  clearThumbnailCache();
  clearLocalFolderBlobs();

  setCachedThumbnailMeta('sig-a', {
    width: 1920,
    height: 1080,
    thumbnailUrl: 'blob:thumb-a',
    thumbBytes: 12000,
    isObjectUrl: false,
  });
  setCachedThumbnailMeta('sig-b', {
    width: 1200,
    height: 1600,
    thumbnailUrl: 'blob:thumb-b',
    thumbBytes: 18000,
    isObjectUrl: false,
  });

  const stats = getThumbnailCacheStats();
  assert.equal(stats.entries, 2);
  assert.equal(stats.bytes, 30000);
  assert.equal(getCachedThumbnailMeta('sig-a')?.width, 1920);

  const blob = new Blob([new Uint8Array(64).fill(7)], { type: 'image/jpeg' });
  registerLocalFolderBlob('fg_1', blob);
  assert.equal(getLocalFolderBlob('fg_1'), blob);
  assert.equal(getThumbnailCacheStats().localBlobs, 1);

  clearLocalFolderBlobs();
  assert.equal(getLocalFolderBlob('fg_1'), null);
  clearThumbnailCache();
  assert.equal(getThumbnailCacheStats().entries, 0);
  assert.equal(getThumbnailCacheStats().bytes, 0);
});

test('folderThumbnailCache evicts oldest LRU entry when max entries exceeded', () => {
  clearThumbnailCache();
  for (let i = 0; i < 505; i++) {
    setCachedThumbnailMeta(`sig-${i}`, {
      width: 480,
      height: 360,
      thumbnailUrl: `blob:t-${i}`,
      thumbBytes: 1024,
      isObjectUrl: false,
    });
  }
  const stats = getThumbnailCacheStats();
  assert.equal(stats.entries, 500);
  assert.equal(getCachedThumbnailMeta('sig-0'), null);
  assert.equal(getCachedThumbnailMeta('sig-4'), null);
  assert.ok(getCachedThumbnailMeta('sig-504'));
  clearThumbnailCache();
});

test('resolveFolderItemBlob prioritizes local File blobs and clientImageCache without network calls', async () => {
  clearLocalFolderBlobs();
  clearClientImageCache();

  const localBlob = new Blob([new Uint8Array(42).fill(3)], { type: 'image/png' });
  registerLocalFolderBlob('item-local', localBlob);
  const resolvedLocal = await resolveFolderItemBlob('item-local', '/never-fetched.png');
  assert.equal(resolvedLocal, localBlob);

  const remoteUrl = 'https://cdn.example.com/sample-cached.jpg';
  const ramBlob = new Blob([new Uint8Array(96).fill(5)], { type: 'image/jpeg' });
  setCachedImageBlob(remoteUrl, ramBlob);
  const resolvedRam = await resolveFolderItemBlob('item-remote', remoteUrl);
  assert.equal(resolvedRam, ramBlob);

  clearLocalFolderBlobs();
  clearClientImageCache();
});
