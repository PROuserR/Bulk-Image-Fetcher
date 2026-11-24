import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  HUMAN_FACE_FILTER_MODEL,
  HumanFaceFilterError,
  analyzeImagesForHumanFaces,
  clearHumanFaceFilterCache,
  decodeBase64DataImage,
  getHumanFaceFilterCacheStats,
  mapGeminiFaceError,
  normalizeBufferForFaceVision,
} from './humanFaceFilterService.ts';

test('analyzeImagesForHumanFaces classifies human faces vs nature backgrounds and reuses cache', async () => {
  clearHumanFaceFilterCache();
  let modelCalledCount = 0;

  const inputs = [
    {
      id: 'portrait-1',
      url: 'https://cdn.example.com/portrait-1.jpg',
      filename: 'portrait-1.jpg',
    },
    {
      id: 'nature-1',
      url: 'https://cdn.example.com/mountain-lake.jpg',
      filename: 'mountain-lake.jpg',
    },
  ];

  const deps = {
    apiKey: 'test-key-for-unit-test',
    useCache: true,
    fetchImageFn: async () => ({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      mimeType: 'image/jpeg',
    }),
    generateContentFn: async (params: { model: string; config: unknown }) => {
      modelCalledCount++;
      assert.equal(params.model, HUMAN_FACE_FILTER_MODEL);
      return {
        text: JSON.stringify({
          results: [
            {
              id: 'portrait-1',
              hasHumanFace: true,
              faceCount: 1,
              confidence: 0.96,
              subjectSummary: 'Smiling woman portrait',
            },
            {
              id: 'nature-1',
              hasHumanFace: false,
              faceCount: 0,
              confidence: 0.99,
              subjectSummary: 'Mountain lake landscape',
            },
          ],
        }),
      };
    },
  };

  const firstRun = await analyzeImagesForHumanFaces(inputs, { deps });
  assert.equal(modelCalledCount, 1);
  assert.equal(firstRun.scannedCount, 2);
  assert.equal(firstRun.cachedCount, 0);
  assert.equal(firstRun.errorCount, 0);
  assert.equal(firstRun.results[0].hasHumanFace, true);
  assert.equal(firstRun.results[0].faceCount, 1);
  assert.equal(firstRun.results[1].hasHumanFace, false);
  assert.equal(firstRun.results[1].subjectSummary, 'Mountain lake landscape');
  assert.equal(getHumanFaceFilterCacheStats().entries, 2);

  // Second run with same URLs hits cache cleanly without re-calling Gemini
  const secondRun = await analyzeImagesForHumanFaces(inputs, { deps });
  assert.equal(modelCalledCount, 1);
  assert.equal(secondRun.cachedCount, 2);
  assert.equal(secondRun.scannedCount, 0);
  assert.equal(secondRun.results[0].cached, true);
  assert.equal(secondRun.results[1].hasHumanFace, false);

  clearHumanFaceFilterCache();
});

test('normalizeBufferForFaceVision safely rejects HTML/corrupt payloads and skips tiny 1x1 / malformed SVGs', async () => {
  const htmlResult = await normalizeBufferForFaceVision(
    Buffer.from('<!DOCTYPE html><html><body>403 Forbidden</body></html>'),
    'https://cdn.example.com/photo.jpg'
  );
  assert.equal(htmlResult, null);

  const corruptResult = await normalizeBufferForFaceVision(
    Buffer.from('not-actually-an-image-bytes-1234567890'),
    'https://cdn.example.com/broken.jpg'
  );
  assert.equal(corruptResult, null);

  const malformedSvg = await normalizeBufferForFaceVision(
    Buffer.from('<svg xmlns="bad" ><not-valid-xml'),
    'https://cdn.example.com/icon.svg'
  );
  assert.deepEqual(malformedSvg, { skippedReason: 'Vector graphic / icon' });

  const tiny1x1Png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  const tinyResult = await normalizeBufferForFaceVision(tiny1x1Png, 'https://cdn.example.com/1x1.png');
  assert.deepEqual(tinyResult, { skippedReason: 'Tiny UI icon or spacer' });

  const validPhotoPng = await sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 64, g: 128, b: 200 } },
  })
    .png()
    .toBuffer();
  const normalizedPhoto = await normalizeBufferForFaceVision(validPhotoPng, 'https://cdn.example.com/p.png');
  assert.ok(normalizedPhoto && 'buffer' in normalizedPhoto && normalizedPhoto.buffer);
  assert.equal(normalizedPhoto.mimeType, 'image/jpeg');
});

test('analyzeImagesForHumanFaces handles mixed scraped batch (inline data URI, tiny icon skip, broken item, portrait)', async () => {
  clearHumanFaceFilterCache();
  const tinyPng = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .png()
    .toBuffer();
  const realPhotoPng = await sharp({
    create: { width: 160, height: 160, channels: 3, background: { r: 180, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();
  const inlineDataUri = `data:image/png;base64,${realPhotoPng.toString('base64')}`;

  assert.ok(decodeBase64DataImage(inlineDataUri));

  let sentToModelCount = 0;
  const result = await analyzeImagesForHumanFaces(
    [
      { id: 'img-inline', url: inlineDataUri, filename: 'inline_portrait.png' },
      { id: 'img-tiny', url: `data:image/png;base64,${tinyPng.toString('base64')}`, filename: 'pixel.png' },
      { id: 'img-broken', url: 'https://cdn.example.com/missing.jpg', filename: 'missing.jpg' },
    ],
    {
      deps: {
        apiKey: 'test-key-mixed',
        useCache: false,
        fetchImageFn: async (item) => {
          if (item.url.startsWith('data:')) {
            const decoded = decodeBase64DataImage(item.url)!;
            return normalizeBufferForFaceVision(decoded.buffer, item.url);
          }
          return null;
        },
        generateContentFn: async (params: { model: string; contents: unknown; config: unknown }) => {
          const contentObj = params.contents as { parts?: Array<{ inlineData?: unknown }> };
          const inlineParts = (contentObj.parts || []).filter((p) => Boolean(p.inlineData));
          sentToModelCount = inlineParts.length;
          return {
            text: JSON.stringify({
              results: [
                {
                  id: 'img-inline',
                  hasHumanFace: true,
                  faceCount: 1,
                  confidence: 0.94,
                  subjectSummary: 'Inline portrait photo',
                },
              ],
            }),
          };
        },
      },
    }
  );

  // Only the valid portrait image should be sent to Gemini; tiny icon skipped and broken isolated
  assert.equal(sentToModelCount, 1);
  assert.equal(result.errorCount, 1);
  assert.equal(result.scannedCount, 2);
  assert.equal(result.results[0].hasHumanFace, true);
  assert.equal(result.results[1].hasHumanFace, false);
  assert.equal(result.results[1].subjectSummary, 'Tiny UI icon or spacer');
  assert.equal(result.results[2].hasHumanFace, false);
  assert.ok(result.results[2].error);
});

test('analyzeImagesForHumanFaces throws HumanFaceFilterError(400) when API key is missing', async () => {
  clearHumanFaceFilterCache();
  await assert.rejects(
    () =>
      analyzeImagesForHumanFaces(
        [{ id: '1', url: 'https://cdn.example.com/a.jpg' }],
        { deps: { apiKey: '', useCache: false } }
      ),
    (err: unknown) => {
      assert.ok(err instanceof HumanFaceFilterError);
      assert.equal(err.status, 400);
      assert.match(err.message, /GEMINI_API_KEY/i);
      return true;
    }
  );
});

test('mapGeminiFaceError maps quota and invalid key errors to HTTP statuses', () => {
  const invalidKey = mapGeminiFaceError(new Error('API_KEY_INVALID: bad token'));
  assert.equal(invalidKey.status, 400);

  const denied = mapGeminiFaceError(new Error('PERMISSION_DENIED: 403 forbidden'));
  assert.equal(denied.status, 403);

  const quota = mapGeminiFaceError(new Error('429 RESOURCE_EXHAUSTED quota exceeded'));
  assert.equal(quota.status, 429);

  const unavailable = mapGeminiFaceError(
    new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}')
  );
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.message, /temporarily busy/i);
});
