/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { encodeAnimatedGif } from './gifEncoder';
import {
  DEFAULT_GIF_CONFIG,
  buildGifSequence,
  clampLoopCount,
  computeFrameDrawRect,
  computeGifCanvasDimensions,
  estimateTotalGifDurationMs,
  formatGifDuration,
  fpsToDelayMs,
} from './gifMakerLogic';

test('buildGifSequence builds forward, reverse, and boomerang orders cleanly', () => {
  const forward = buildGifSequence(4, { fps: 5, playbackOrder: 'forward', crossfadeFrames: 0 });
  assert.deepEqual(
    forward.map((s) => s.primaryIndex),
    [0, 1, 2, 3]
  );

  const reverse = buildGifSequence(4, { fps: 5, playbackOrder: 'reverse', crossfadeFrames: 0 });
  assert.deepEqual(
    reverse.map((s) => s.primaryIndex),
    [3, 2, 1, 0]
  );

  const boomerang = buildGifSequence(4, { fps: 5, playbackOrder: 'boomerang', crossfadeFrames: 0 });
  assert.deepEqual(
    boomerang.map((s) => s.primaryIndex),
    [0, 1, 2, 3, 2, 1]
  );
});

test('buildGifSequence injects interpolated crossfade steps when enabled', () => {
  const steps = buildGifSequence(3, { fps: 4, playbackOrder: 'forward', crossfadeFrames: 2 });
  // 3 hold frames + 3 * 2 crossfade transitions = 9 total steps
  assert.equal(steps.length, 9);
  assert.equal(steps[1].primaryIndex, 0);
  assert.equal(steps[1].secondaryIndex, 1);
  assert.ok(steps[1].blendFactor > 0 && steps[1].blendFactor < 1);
  assert.equal(steps[2].primaryIndex, 0);
  assert.equal(steps[2].secondaryIndex, 1);
  assert.ok(steps[2].blendFactor > steps[1].blendFactor);
});

test('computeGifCanvasDimensions honors aspect presets and keeps even dimensions', () => {
  const square = computeGifCanvasDimensions({
    aspectPreset: 'square',
    maxEdge: 480,
    customWidth: 400,
    customHeight: 400,
  });
  assert.deepEqual(square, { width: 480, height: 480 });

  const landscape = computeGifCanvasDimensions({
    aspectPreset: 'landscape',
    maxEdge: 640,
    customWidth: 640,
    customHeight: 360,
  });
  assert.deepEqual(landscape, { width: 640, height: 360 });

  const origPortrait = computeGifCanvasDimensions(
    {
      aspectPreset: 'original',
      maxEdge: 500,
      customWidth: 500,
      customHeight: 500,
    },
    { width: 1000, height: 2000 }
  );
  assert.deepEqual(origPortrait, { width: 250, height: 500 });
});

test('computeFrameDrawRect computes centered cover and contain boxes accurately', () => {
  const cover = computeFrameDrawRect(1000, 500, 400, 400, 'cover');
  assert.equal(cover.dw, 800);
  assert.equal(cover.dh, 400);
  assert.equal(cover.dx, -200);
  assert.equal(cover.dy, 0);

  const contain = computeFrameDrawRect(1000, 500, 400, 400, 'contain');
  assert.equal(contain.dw, 400);
  assert.equal(contain.dh, 200);
  assert.equal(contain.dx, 0);
  assert.equal(contain.dy, 100);
});

test('timing and duration helpers stay bounded and formatted', () => {
  assert.equal(fpsToDelayMs(10), 100);
  assert.equal(fpsToDelayMs(5), 200);
  assert.equal(clampLoopCount(0), 0);
  assert.equal(clampLoopCount(-3), 0);
  assert.equal(clampLoopCount(5), 5);
  assert.equal(formatGifDuration(1250), '1.3s');
  assert.equal(formatGifDuration(450), '450ms');

  const steps = buildGifSequence(4, DEFAULT_GIF_CONFIG);
  assert.equal(estimateTotalGifDurationMs(steps), steps.length * fpsToDelayMs(DEFAULT_GIF_CONFIG.fps));
});

test('encodeAnimatedGif outputs valid GIF89a binary decodable by sharp', async () => {
  const width = 48;
  const height = 36;

  const makeSolidFrame = (r: number, g: number, b: number, delayMs: number) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const off = (y * width + x) * 4;
        // Slight gradient so palette quantizer & LZW get realistic texture
        rgba[off] = Math.min(255, r + x);
        rgba[off + 1] = Math.min(255, g + y);
        rgba[off + 2] = b;
        rgba[off + 3] = 255;
      }
    }
    return { rgba, width, height, delayMs };
  };

  const frames = [
    makeSolidFrame(20, 90, 210, 150),
    makeSolidFrame(210, 60, 40, 200),
    makeSolidFrame(30, 175, 110, 250),
  ];

  const gifBytes = encodeAnimatedGif(frames, {
    width,
    height,
    loopCount: 0,
    dither: true,
  });

  // Verify GIF89a header + EOF trailer byte
  assert.equal(String.fromCharCode(...gifBytes.slice(0, 6)), 'GIF89a');
  assert.equal(gifBytes[gifBytes.length - 1], 0x3b);
  assert.ok(Buffer.from(gifBytes).includes(Buffer.from('NETSCAPE2.0')));

  // Verify real native decoder (libvips/sharp) decodes all 3 animated pages cleanly
  const meta = await sharp(Buffer.from(gifBytes), { animated: true }).metadata();
  assert.equal(meta.format, 'gif');
  assert.equal(meta.width, width);
  assert.equal(meta.pageHeight, height);
  assert.equal(meta.pages, 3);
  assert.equal(meta.loop, 0);
  assert.deepEqual(meta.delay, [150, 200, 250]);

  // Also decode full pixel buffer to verify zero LZW bitstream errors across all 3 pages
  const decoded = await sharp(Buffer.from(gifBytes), { animated: true })
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(decoded.length, width * height * 3 * 4);
  // Top-left of frame 0 should be close to (20, 90, 210)
  assert.ok(Math.abs(decoded[0] - 20) < 20);
  assert.ok(Math.abs(decoded[1] - 90) < 20);
  assert.ok(Math.abs(decoded[2] - 210) < 20);
  // Top-left of frame 1 (offset height rows down) should be close to (210, 60, 40)
  const frame1Start = width * height * 4;
  assert.ok(Math.abs(decoded[frame1Start] - 210) < 20);
  assert.ok(Math.abs(decoded[frame1Start + 1] - 60) < 20);
  assert.ok(Math.abs(decoded[frame1Start + 2] - 40) < 20);
});

test('encodeAnimatedGif handles high-entropy photographic frames triggering LZW table resets', async () => {
  const width = 320;
  const height = 240;

  const makeNoisyPhotoFrame = (seed: number) => {
    const rgba = new Uint8ClampedArray(width * height * 4);
    let xorshift = seed || 123456789;
    for (let i = 0; i < width * height; i++) {
      xorshift ^= xorshift << 13;
      xorshift ^= xorshift >>> 17;
      xorshift ^= xorshift << 5;
      const off = i * 4;
      rgba[off] = xorshift & 0xff;
      rgba[off + 1] = (xorshift >>> 8) & 0xff;
      rgba[off + 2] = (xorshift >>> 16) & 0xff;
      rgba[off + 3] = 255;
    }
    return { rgba, width, height, delayMs: 120 };
  };

  const gifBytes = encodeAnimatedGif([makeNoisyPhotoFrame(111), makeNoisyPhotoFrame(999)], {
    width,
    height,
    loopCount: 3,
    dither: true,
  });

  const meta = await sharp(Buffer.from(gifBytes), { animated: true }).metadata();
  assert.equal(meta.format, 'gif');
  assert.equal(meta.width, width);
  assert.equal(meta.pageHeight, height);
  assert.equal(meta.pages, 2);
  assert.equal(meta.loop, 3); // sharp reports total play count matching loopCount = 3
  const decoded = await sharp(Buffer.from(gifBytes), { animated: true }).ensureAlpha().raw().toBuffer();
  assert.equal(decoded.length, width * height * 2 * 4);
});

