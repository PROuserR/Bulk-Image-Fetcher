import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTransferProgressPercent,
  parseNdjsonBuffer,
  formatArchiveStatusLine,
  ArchiveDownloadProgress,
} from './archiveDownloader.ts';

test('computeTransferProgressPercent maps transfer bytes smoothly across 85-100%', () => {
  assert.equal(computeTransferProgressPercent(0, 1000), 85);
  assert.equal(computeTransferProgressPercent(500, 1000), 93);
  assert.equal(computeTransferProgressPercent(1000, 1000), 100);
  assert.equal(computeTransferProgressPercent(1500, 1000), 100);
  assert.equal(computeTransferProgressPercent(100, undefined), 90);
});

test('parseNdjsonBuffer extracts complete JSON lines and retains trailing remainder', () => {
  const chunk1 = '{"stage":"fetching","percent":18}\n{"stage":"compressing","per';
  const res1 = parseNdjsonBuffer(chunk1);
  assert.equal(res1.events.length, 1);
  assert.equal(res1.events[0].percent, 18);
  assert.equal(res1.remainder, '{"stage":"compressing","per');

  const chunk2 = `${res1.remainder}cent":72}\n`;
  const res2 = parseNdjsonBuffer(chunk2);
  assert.equal(res2.events.length, 1);
  assert.equal(res2.events[0].stage, 'compressing');
  assert.equal(res2.events[0].percent, 72);
  assert.equal(res2.remainder, '');
});

test('formatArchiveStatusLine shows clear percentage and stage across lifecycle', () => {
  const base: ArchiveDownloadProgress = {
    format: '7z',
    filename: 'Yosemite.7z',
    stage: 'compressing',
    percent: 74,
    fetchedImages: 5,
    validImages: 5,
    totalImages: 5,
    bytesLoaded: 102400,
    message: 'Compressing .7Z LZMA2 (56%)',
    isRunning: true,
  };
  assert.equal(formatArchiveStatusLine(base), '74% · Compressing .7Z LZMA2 (56%)');
  assert.equal(
    formatArchiveStatusLine({ ...base, stage: 'complete', percent: 100, isRunning: false }),
    '100% · Downloaded .7Z'
  );
  assert.equal(
    formatArchiveStatusLine({ ...base, format: 'zip', stage: 'cancelled', percent: 42, isRunning: false }),
    'Cancelled .ZIP (42%)'
  );
});

import {
  downloadCompressedArchiveWithProgress,
} from './archiveDownloader.ts';
import {
  clearClientImageCache,
  setCachedImageBlob,
  registerWorkingPreviewUrl,
  buildProxyImageUrl,
} from './clientImageCache.ts';

test('downloadCompressedArchiveWithProgress packages browser-cached images into .ZIP without calling /api/download-zip', async () => {
  clearClientImageCache();
  const url1 = 'https://cdn.example.com/cached-1.jpg';
  const url2 = 'https://cdn.example.com/cached-2.jpg';
  const proxy2 = buildProxyImageUrl(url2, 'https://example.com');

  setCachedImageBlob(url1, new Blob([new Uint8Array(256).fill(1)], { type: 'image/jpeg' }));
  registerWorkingPreviewUrl(url2, proxy2);

  const prevFetch = globalThis.fetch;
  let serverZipCalls = 0;
  let savedZipName = '';
  let savedZipBlob: Blob | null = null;
  const clientFetchUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/api/download-zip')) serverZipCalls++;
    return new Response(null, { status: 500 });
  }) as typeof fetch;

  try {
    const result = await downloadCompressedArchiveWithProgress({
      images: [
        {
          id: '1',
          fullUrl: url1,
          thumbnailUrl: url1,
          filename: 'cached-1.jpg',
          altText: 'Cached 1',
          format: 'jpg',
          resolutionTier: 'hd',
          isUnshrunk: true,
          unshrinkMethod: 'Direct Master',
        },
        {
          id: '2',
          fullUrl: url2,
          thumbnailUrl: url2,
          filename: 'cached-2.jpg',
          altText: 'Cached 2',
          format: 'jpg',
          resolutionTier: 'hd',
          isUnshrunk: true,
          unshrinkMethod: 'Direct Master',
        },
      ],
      pageTitle: 'Cached Gallery',
      sourceUrl: 'https://example.com',
      format: 'zip',
      saveBlobFn: (blob, filename) => {
        savedZipName = filename;
        savedZipBlob = blob;
      },
      fetchFn: async (u) => {
        clientFetchUrls.push(u);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/jpeg' }),
          blob: async () => new Blob([new Uint8Array(320).fill(2)], { type: 'image/jpeg' }),
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.format, 'zip');
    assert.equal(result.fileCount, 2);
    assert.equal(result.usedBrowserCache, true);
    assert.equal(result.reusedFromCacheCount, 2);
    assert.equal(savedZipName, 'Cached Gallery.zip');
    assert.ok(savedZipBlob && savedZipBlob.size > 0);
    assert.match(result.archiveSha256 || '', /^[a-f0-9]{64}$/);
    assert.equal(result.checksumEntries?.length, 2);
    assert.equal(serverZipCalls, 0, 'Must not call /api/download-zip when webpage images are already cached');
    assert.deepEqual(clientFetchUrls, [proxy2], 'Only non-RAM preview-cached image reads from force-cache proxy');

    const JSZipMod = (await import('jszip')).default;
    const loadedZip = await JSZipMod.loadAsync(await savedZipBlob!.arrayBuffer());
    const manifestFile = loadedZip.file('SHA256SUMS.txt');
    assert.ok(manifestFile, 'Expected SHA256SUMS.txt embedded inside archive');
    const manifestText = await manifestFile!.async('string');
    assert.ok(manifestText.includes(result.checksumEntries![0].sha256));
    assert.ok(manifestText.includes('cached-1.jpg'));
    assert.ok(manifestText.includes('cached-2.jpg'));
  } finally {
    globalThis.fetch = prevFetch;
    clearClientImageCache();
  }
});

test('downloadCompressedArchiveWithProgress uploads cached browser blobs via FormData for .7z archives', async () => {
  clearClientImageCache();
  const cachedUrl = 'https://cdn.example.com/cached-7z-1.jpg';
  const uncachedUrl = 'https://cdn.example.com/uncached-7z-2.jpg';
  setCachedImageBlob(cachedUrl, new Blob([new Uint8Array(180).fill(9)], { type: 'image/jpeg' }));

  const prevFetch = globalThis.fetch;
  let capturedFormData: FormData | null = null;
  let savedName = '';
  let savedBlob: Blob | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u === '/api/download-zip' && init?.method === 'POST') {
      assert.ok(init.body instanceof FormData, 'Expected FormData multipart body when browser blobs are cached for .7z');
      capturedFormData = init.body;
      const ndjson =
        JSON.stringify({ stage: 'fetching', fetchedCount: 2, totalCount: 2, validCount: 2, bytesFetched: 400, percent: 55 }) +
        '\n' +
        JSON.stringify({
          stage: 'ready',
          token: '11111111-1111-4111-8111-111111111111',
          filename: 'Cached7z.7z',
          format: '7z',
          contentType: 'application/x-7z-compressed',
          totalBytes: 128,
          fileCount: 2,
          percent: 85,
        }) +
        '\n';
      return new Response(ndjson, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      });
    }
    if (u.includes('/api/download-zip?token=')) {
      return new Response(new Uint8Array(128).fill(7), {
        status: 200,
        headers: {
          'Content-Type': 'application/x-7z-compressed',
          'Content-Length': '128',
        },
      });
    }
    if (u.includes('/api/download-zip?token=') === false && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await downloadCompressedArchiveWithProgress({
      images: [
        {
          id: '1',
          fullUrl: cachedUrl,
          thumbnailUrl: cachedUrl,
          filename: 'cached-7z-1.jpg',
          altText: 'Cached',
          format: 'jpg',
          resolutionTier: 'hd',
          isUnshrunk: true,
          unshrinkMethod: 'Direct Master',
        },
        {
          id: '2',
          fullUrl: uncachedUrl,
          thumbnailUrl: uncachedUrl,
          filename: 'uncached-7z-2.jpg',
          altText: 'Uncached',
          format: 'jpg',
          resolutionTier: 'hd',
          isUnshrunk: true,
          unshrinkMethod: 'Direct Master',
        },
      ],
      pageTitle: 'Cached7z',
      sourceUrl: 'https://example.com',
      format: '7z',
      saveBlobFn: (blob, filename) => {
        savedBlob = blob;
        savedName = filename;
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.format, '7z');
    assert.equal(result.usedBrowserCache, true);
    assert.equal(result.reusedFromCacheCount, 1);
    assert.equal(savedName, 'Cached7z.7z');
    assert.ok(savedBlob && (savedBlob as Blob).size === 128);
    assert.ok(capturedFormData, 'FormData should have been posted');
    assert.ok(capturedFormData!.get('metadata'));
    assert.ok(capturedFormData!.get('cached_0'), 'Expected cached_0 binary part in FormData');
    assert.equal(capturedFormData!.get('cached_1'), null, 'Uncached index 1 should not be uploaded');
  } finally {
    globalThis.fetch = prevFetch;
    clearClientImageCache();
  }
});

