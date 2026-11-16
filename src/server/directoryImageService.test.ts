import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  isSupportedImageFilename,
  isWithinRoot,
  scanDirectoryImages,
  processDirectoryImages,
} from './directoryImageService';

test('isSupportedImageFilename and isWithinRoot enforce image types and path boundaries', () => {
  assert.equal(isSupportedImageFilename('photo.JPG'), true);
  assert.equal(isSupportedImageFilename('render.webp'), true);
  assert.equal(isSupportedImageFilename('notes.txt'), false);

  assert.equal(isWithinRoot('/tmp/shoot', '/tmp/shoot/sub/img.jpg'), true);
  assert.equal(isWithinRoot('/tmp/shoot', '/tmp/shoot/../etc/passwd'), false);
});

test('scanDirectoryImages and processDirectoryImages scan subfolders, crop, resize, and write output safely', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fullres-dir-test-'));
  const subDir = path.join(tmpRoot, 'portraits');
  fs.mkdirSync(subDir, { recursive: true });

  const wideImgPath = path.join(tmpRoot, 'wide_scene.png');
  const portraitImgPath = path.join(subDir, 'model.jpg');

  await sharp({
    create: {
      width: 400,
      height: 200,
      channels: 3,
      background: { r: 30, g: 120, b: 220 },
    },
  })
    .png()
    .toFile(wideImgPath);

  await sharp({
    create: {
      width: 300,
      height: 500,
      channels: 3,
      background: { r: 220, g: 90, b: 50 },
    },
  })
    .jpeg()
    .toFile(portraitImgPath);

  try {
    const scan = await scanDirectoryImages(tmpRoot, { recursive: true });
    assert.equal(scan.images.length, 2);
    assert.deepEqual(
      scan.images.map((i) => i.relativePath),
      ['portraits/model.jpg', 'wide_scene.png']
    );

    const outDir = path.join(tmpRoot, 'processed_out');
    const result = await processDirectoryImages({
      sourceDir: tmpRoot,
      outputDir: outDir,
      items: [
        {
          relativePath: 'wide_scene.png',
          cropEnabled: true,
          cropRect: { x: 100, y: 0, width: 200, height: 200 },
        },
        {
          relativePath: 'portraits/model.jpg',
          cropEnabled: false,
        },
      ],
      resize: {
        mode: 'maxEdge',
        width: 100,
        height: 100,
        maxEdge: 150,
        percent: 100,
        lockAspect: true,
        fit: 'contain',
      },
      output: {
        format: 'webp',
        quality: 88,
        suffix: '_edited',
        preserveSubfolders: true,
      },
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.processed.length, 2);

    const wideOut = result.processed.find((p) => p.relativePath === 'wide_scene.png');
    assert.ok(wideOut);
    assert.equal(wideOut.outputRelativePath, 'wide_scene_edited.webp');
    assert.equal(wideOut.width, 150);
    assert.equal(wideOut.height, 150);
    assert.equal(fs.existsSync(wideOut.outputPath), true);

    const portraitOut = result.processed.find((p) => p.relativePath === 'portraits/model.jpg');
    assert.ok(portraitOut);
    assert.equal(portraitOut.outputRelativePath, 'portraits/model_edited.webp');
    assert.equal(portraitOut.width, 90);
    assert.equal(portraitOut.height, 150);
    assert.equal(fs.existsSync(portraitOut.outputPath), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
