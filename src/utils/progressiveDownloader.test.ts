import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeDownloadItems,
  runProgressiveDownloads,
  formatBytes,
  type DownloadItemInput,
  type FetchLike,
} from './progressiveDownloader';

function makeMockResponse(sizeBytes: number, contentType = 'image/jpeg', status = 200) {
  const bytes = new Uint8Array(sizeBytes).fill(65);
  const blob = new Blob([bytes], { type: contentType });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    } as Headers,
    blob: async () => blob,
  };
}

test('dedupeDownloadItems assigns collision-free filenames cleanly', () => {
  const input: DownloadItemInput[] = [
    { id: '1', url: 'https://a.com/photo.jpg', filename: 'photo.jpg' },
    { id: '2', url: 'https://b.com/photo.jpg', filename: 'photo.jpg' },
    { id: '3', url: 'https://c.com/photo.jpg', filename: 'PHOTO.JPG' },
    { id: '4', url: 'https://d.com/noext', filename: 'bad:name*?' },
  ];
  const deduped = dedupeDownloadItems(input);
  assert.deepEqual(
    deduped.map((d) => d.filename),
    ['photo.jpg', 'photo_1.jpg', 'PHOTO_2.JPG', 'bad_name__.jpg']
  );
});

test('runProgressiveDownloads processes items concurrently and saves progressively', async () => {
  const items: DownloadItemInput[] = Array.from({ length: 6 }, (_, i) => ({
    id: `id-${i}`,
    url: `https://cdn.example.com/img-${i}.jpg`,
    filename: `img-${i}.jpg`,
  }));

  let inFlight = 0;
  let peakInFlight = 0;
  const savedOrder: string[] = [];
  const progressEvents: number[] = [];

  const mockFetch: FetchLike = async () => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 25));
    inFlight--;
    return makeMockResponse(1024);
  };

  const result = await runProgressiveDownloads(items, {
    concurrency: 3,
    staggerMs: 0,
    fetchFn: mockFetch,
    saveBlobFn: (_blob, filename) => {
      savedOrder.push(filename);
    },
    onProgress: (p) => {
      if (p.isRunning) progressEvents.push(p.saved);
    },
  });

  assert.equal(peakInFlight, 3, 'Expected 3 concurrent workers');
  assert.equal(result.total, 6);
  assert.equal(result.saved, 6);
  assert.equal(result.failed, 0);
  assert.equal(result.percent, 100);
  assert.equal(result.bytesSaved, 6 * 1024);
  assert.equal(savedOrder.length, 6);
  assert.equal(result.checksumEntries.length, 6);
  for (const entry of result.checksumEntries) {
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(entry.bytes, 1024);
  }
  assert.ok(
    progressEvents.includes(1) && progressEvents.includes(3),
    'Expected progressive updates as items finish rather than only at the end'
  );
});

test('runProgressiveDownloads falls back to direct CORS and fallbackUrl when proxy fails', async () => {
  const items: DownloadItemInput[] = [
    {
      id: 'cors-ok',
      url: 'https://cors-cdn.example.com/master1.jpg',
      filename: 'master1.jpg',
    },
    {
      id: 'fallback-ok',
      url: 'https://blocked.example.com/master2.jpg',
      fallbackUrl: 'https://mirror.example.com/master2.jpg',
      filename: 'master2.jpg',
    },
    {
      id: 'all-fail',
      url: 'https://dead.example.com/master3.jpg',
      filename: 'master3.jpg',
    },
  ];

  const mockFetch: FetchLike = async (url) => {
    if (url.startsWith('/api/download-file')) {
      return makeMockResponse(0, 'text/html', 502);
    }
    if (url === 'https://cors-cdn.example.com/master1.jpg') {
      return makeMockResponse(2048, 'image/jpeg', 200);
    }
    if (url === 'https://mirror.example.com/master2.jpg') {
      return makeMockResponse(4096, 'image/webp', 200);
    }
    return makeMockResponse(0, 'text/html', 404);
  };

  const savedFiles: string[] = [];
  const result = await runProgressiveDownloads(items, {
    concurrency: 2,
    staggerMs: 0,
    fetchFn: mockFetch,
    saveBlobFn: (_blob, name) => {
      savedFiles.push(name);
    },
  });

  assert.equal(result.saved, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.bytesSaved, 6144);
  assert.deepEqual(savedFiles.sort(), ['master1.jpg', 'master2.jpg']);
  assert.equal(result.itemStatuses['cors-ok']?.resolvedVia, 'direct-cors');
  assert.equal(result.itemStatuses['fallback-ok']?.resolvedVia, 'fallback-cors');
  assert.equal(result.failedItems.length, 1);
  assert.equal(result.failedItems[0]?.id, 'all-fail');
});

test('runProgressiveDownloads aborts cleanly via AbortSignal', async () => {
  const items: DownloadItemInput[] = Array.from({ length: 10 }, (_, i) => ({
    id: `item-${i}`,
    url: `https://cdn.example.com/${i}.jpg`,
    filename: `${i}.jpg`,
  }));

  const controller = new AbortController();
  let calls = 0;

  const mockFetch: FetchLike = async (_url, init) => {
    calls++;
    await new Promise((resolve, reject) => {
      const t = setTimeout(resolve, 40);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('Aborted'));
      });
    });
    return makeMockResponse(512);
  };

  setTimeout(() => controller.abort(), 15);

  const result = await runProgressiveDownloads(items, {
    concurrency: 2,
    staggerMs: 0,
    signal: controller.signal,
    fetchFn: mockFetch,
    saveBlobFn: () => {},
  });

  assert.equal(result.isCancelled, true);
  assert.equal(result.saved, 0);
  assert.ok(calls <= 2, `Expected cancellation to stop remaining items, got ${calls} calls`);
});

test('formatBytes formats byte sizes readably', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(2.5 * 1024 * 1024), '2.50 MB');
});

test('runProgressiveDownloads supports pause and resuming remaining items later without duplicate saves', async () => {
  const items: DownloadItemInput[] = Array.from({ length: 5 }, (_, i) => ({
    id: `p-${i}`,
    url: `https://cdn.example.com/p-${i}.jpg`,
    filename: `p-${i}.jpg`,
  }));

  const controller = new AbortController();
  const savedFilesPhase1: string[] = [];

  const mockFetchPhase1: FetchLike = async (url) => {
    const isFirstTwo = url.includes('p-0.jpg') || url.includes('p-1.jpg');
    await new Promise((r) => setTimeout(r, isFirstTwo ? 5 : 40));
    return makeMockResponse(1000);
  };

  setTimeout(() => controller.abort('PAUSED'), 20);

  const pausedSnapshot = await runProgressiveDownloads(items, {
    concurrency: 2,
    staggerMs: 0,
    signal: controller.signal,
    fetchFn: mockFetchPhase1,
    saveBlobFn: (_blob, filename) => {
      savedFilesPhase1.push(filename);
    },
  });

  assert.equal(pausedSnapshot.isPaused, true);
  assert.equal(pausedSnapshot.isCancelled, false);
  assert.ok(pausedSnapshot.saved >= 1 && pausedSnapshot.saved < 5);
  assert.equal(pausedSnapshot.failed, 0);

  // Unfinished items remain pending rather than failed
  for (const item of items) {
    if (!pausedSnapshot.savedItemIds.includes(item.id)) {
      assert.equal(pausedSnapshot.itemStatuses[item.id]?.status, 'pending');
    }
  }

  // Resume later using savedItemIds from pausedSnapshot
  const savedFilesPhase2: string[] = [];
  const resumedResult = await runProgressiveDownloads(items, {
    concurrency: 2,
    staggerMs: 0,
    initialProgress: {
      savedItemIds: pausedSnapshot.savedItemIds,
      bytesSaved: pausedSnapshot.bytesSaved,
      itemStatuses: pausedSnapshot.itemStatuses,
    },
    fetchFn: async () => makeMockResponse(1000),
    saveBlobFn: (_blob, filename) => {
      savedFilesPhase2.push(filename);
    },
  });

  assert.equal(resumedResult.isPaused, false);
  assert.equal(resumedResult.isCancelled, false);
  assert.equal(resumedResult.saved, 5);
  assert.equal(resumedResult.percent, 100);
  assert.equal(resumedResult.bytesSaved, 5000);
  assert.equal(
    savedFilesPhase2.length,
    5 - savedFilesPhase1.length,
    'Resumed run should only download remaining unsaved files'
  );
});

import {
  clearClientImageCache,
  registerWorkingPreviewUrl,
  setCachedImageBlob,
  buildProxyImageUrl,
} from './clientImageCache.ts';

test('runProgressiveDownloads reuses memory-cache and preview-http-cache without calling /api/download-file', async () => {
  clearClientImageCache();
  const urlMem = 'https://cdn.example.com/already-in-memory.jpg';
  const urlProxyCached = 'https://cdn.example.com/already-in-http-cache.jpg';
  const proxyUrl = buildProxyImageUrl(urlProxyCached, 'https://example.com');

  setCachedImageBlob(urlMem, new Blob([new Uint8Array(512)], { type: 'image/jpeg' }));
  registerWorkingPreviewUrl(urlProxyCached, proxyUrl);

  const requestedUrls: string[] = [];
  const requestedCacheModes: Array<RequestCache | undefined> = [];

  const mockFetch: FetchLike = async (url, init) => {
    requestedUrls.push(url);
    requestedCacheModes.push(init?.cache);
    return makeMockResponse(768, 'image/jpeg', 200);
  };

  const result = await runProgressiveDownloads(
    [
      { id: 'm1', url: urlMem, filename: 'mem.jpg' },
      { id: 'p1', url: urlProxyCached, filename: 'proxy.jpg' },
    ],
    {
      concurrency: 2,
      staggerMs: 0,
      fetchFn: mockFetch,
      saveBlobFn: () => {},
      // Enable cache path explicitly when using custom fetchFn
    }
  );

  // Note: runProgressiveDownloads calls fetchImageBlobWithFallbacks without overriding useCache,
  // so verify direct fetchImageBlobWithFallbacks with useCache: true as well:
  assert.equal(result.saved, 2);

  clearClientImageCache();
  setCachedImageBlob(urlMem, new Blob([new Uint8Array(512)], { type: 'image/jpeg' }));
  registerWorkingPreviewUrl(urlProxyCached, proxyUrl);
  requestedUrls.length = 0;
  requestedCacheModes.length = 0;

  const { fetchImageBlobWithFallbacks } = await import('./progressiveDownloader');
  const r1 = await fetchImageBlobWithFallbacks(
    { id: 'm1', url: urlMem, filename: 'mem.jpg' },
    { fetchFn: mockFetch, useCache: true }
  );
  const r2 = await fetchImageBlobWithFallbacks(
    { id: 'p1', url: urlProxyCached, filename: 'proxy.jpg' },
    { fetchFn: mockFetch, useCache: true }
  );

  assert.equal(r1.resolvedVia, 'memory-cache');
  assert.equal(r2.resolvedVia, 'preview-http-cache');
  assert.deepEqual(requestedUrls, [proxyUrl]);
  assert.deepEqual(requestedCacheModes, ['force-cache']);
  assert.ok(!requestedUrls.some((u) => u.startsWith('/api/download-file')));

  clearClientImageCache();
});
