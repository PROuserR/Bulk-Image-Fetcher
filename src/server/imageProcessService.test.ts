import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  assertSafePublicHttpUrl,
  decodeInputBase64Image,
  ImageProcessError,
  parseProcessRequestOptions,
  processImageBuffer,
} from './imageProcessService.ts';
import { buildOpenApiDocument } from './openApiSpec.ts';

async function createSamplePngBuffer(width = 120, height = 80): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 210, g: 120, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

test('assertSafePublicHttpUrl accepts public http/https URLs and blocks private/loopback/SSRF targets', () => {
  assert.equal(assertSafePublicHttpUrl('https://images.unsplash.com/photo-1').hostname, 'images.unsplash.com');
  assert.equal(assertSafePublicHttpUrl('http://example.com/a.jpg').protocol, 'http:');

  const blocked = [
    'http://localhost:3000/secret',
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/internal',
    'http://192.168.1.10/router',
    'http://172.16.4.2/db',
    'http://[::1]:3000/',
    'file:///etc/passwd',
    'ftp://example.com/a.png',
    'https://user:pass@example.com/a.png',
  ];

  for (const url of blocked) {
    assert.throws(
      () => assertSafePublicHttpUrl(url),
      (err) => err instanceof ImageProcessError && err.status === 400,
      `Expected SSRF guard to block: ${url}`
    );
  }
});

test('parseProcessRequestOptions applies preset adjustments, clamps bounds, and defaults cleanly', () => {
  const opts = parseProcessRequestOptions({
    preset: 'bw_noir',
    adjustments: { brightness: 12 },
    resize: { mode: 'maxEdge', maxEdge: 99999 },
    format: 'jpg',
    quality: 150,
    responseType: 'json',
    detectFaces: true,
  });

  assert.equal(opts.preset, 'bw_noir');
  assert.equal(opts.adjustments.grayscale, 100);
  assert.equal(opts.adjustments.brightness, 12);
  assert.equal(opts.resize.mode, 'maxEdge');
  assert.equal(opts.resize.maxEdge, 8192);
  assert.equal(opts.format, 'jpeg');
  assert.equal(opts.quality, 100);
  assert.equal(opts.responseType, 'json');
  assert.equal(opts.detectFaces, true);
});

test('processImageBuffer crops, resizes, color-grades, converts format, and optionally runs face detection', async () => {
  const samplePng = await createSamplePngBuffer(200, 100);
  const b64 = `data:image/png;base64,${samplePng.toString('base64')}`;
  const decoded = decodeInputBase64Image(b64);
  assert.ok(decoded.byteLength > 0);

  const opts = parseProcessRequestOptions({
    preset: 'golden_hour',
    crop: { xRatio: 0.25, yRatio: 0, widthRatio: 0.5, heightRatio: 1 }, // 100x100
    resize: { mode: 'exact', width: 50, height: 50, lockAspect: false },
    format: 'webp',
    quality: 85,
    detectFaces: true,
  });

  const out = await processImageBuffer(decoded, opts, {
    analyzeFacesFn: async (inputs) => ({
      results: inputs.map((item) => ({
        id: item.id,
        hasHumanFace: false,
        faceCount: 0,
        confidence: 0.96,
        subjectSummary: 'Orange color test plate',
      })),
      cachedCount: 0,
      scannedCount: 1,
      errorCount: 0,
    }),
  });

  assert.equal(out.sourceWidth, 200);
  assert.equal(out.sourceHeight, 100);
  assert.equal(out.width, 50);
  assert.equal(out.height, 50);
  assert.equal(out.format, 'webp');
  assert.equal(out.mimeType, 'image/webp');
  assert.equal(out.appliedPreset, 'golden_hour');
  assert.equal(out.faceDetection?.hasHumanFace, false);
  assert.equal(out.faceDetection?.subjectSummary, 'Orange color test plate');

  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 50);
  assert.equal(meta.height, 50);
});

test('buildOpenApiDocument exposes valid OpenAPI 3.1.0 paths including /api/process and /api/health', () => {
  const doc = buildOpenApiDocument('https://ultimate.example.com/');
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.info.title, 'Ultimate Image Processor REST API');
  assert.equal(doc.servers[0].url, 'https://ultimate.example.com');
  assert.ok(doc.paths['/api/health']?.get);
  assert.ok(doc.paths['/api/openapi.json']?.get);
  assert.ok(doc.paths['/api/process']?.post);
  assert.ok(doc.paths['/api/scrape']?.post);
  assert.ok(doc.paths['/api/ai/human-face-filter']?.post);
  assert.ok(doc.paths['/api/download-zip']?.get);
});
