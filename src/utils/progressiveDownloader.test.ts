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
