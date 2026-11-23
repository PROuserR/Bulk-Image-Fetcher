import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HUMAN_FACE_FILTER_MODEL,
  HumanFaceFilterError,
  analyzeImagesForHumanFaces,
  clearHumanFaceFilterCache,
  getHumanFaceFilterCacheStats,
  mapGeminiFaceError,
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
