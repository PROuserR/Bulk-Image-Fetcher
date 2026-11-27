import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCropRect,
  computeAspectLockedCrop,
  normalizeCropRect,
  denormalizeCropRect,
  computeTargetDimensions,
  buildOutputFilename,
  formatBytesCompact,
} from './imageTransformLogic';

test('clampCropRect keeps coordinates and dimensions strictly within image bounds', () => {
  assert.deepEqual(
    clampCropRect({ x: -50, y: 20, width: 2000, height: 400 }, 1200, 800),
    { x: 0, y: 20, width: 1200, height: 400 }
  );

  assert.deepEqual(
    clampCropRect({ x: 950, y: 700, width: 400, height: 200 }, 1200, 800),
    { x: 800, y: 600, width: 400, height: 200 }
  );
});

test('computeAspectLockedCrop centers 1:1 square and 16:9 widescreen crops', () => {
  assert.deepEqual(computeAspectLockedCrop(1600, 1000, '1:1'), {
    x: 300,
    y: 0,
    width: 1000,
    height: 1000,
  });

  assert.deepEqual(computeAspectLockedCrop(1600, 1200, '16:9'), {
    x: 0,
    y: 150,
    width: 1600,
    height: 900,
  });

  assert.deepEqual(computeAspectLockedCrop(800, 600, 'free'), {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
});

test('normalizeCropRect and denormalizeCropRect propagate proportions cleanly across dimensions', () => {
  const norm = normalizeCropRect({ x: 200, y: 100, width: 800, height: 400 }, 1200, 600);
  const mapped = denormalizeCropRect(norm, 2400, 1200);
  assert.deepEqual(mapped, { x: 400, y: 200, width: 1600, height: 800 });
});

test('computeTargetDimensions handles original, percent, maxEdge, and exact modes accurately', () => {
  const baseConfig = {
    mode: 'original' as const,
    width: 800,
    height: 600,
    maxEdge: 1200,
    percent: 50,
    lockAspect: true,
    fit: 'cover' as const,
  };

  assert.deepEqual(computeTargetDimensions(1600, 900, baseConfig), {
    width: 1600,
    height: 900,
    fit: 'fill',
  });

  assert.deepEqual(
    computeTargetDimensions(1600, 800, { ...baseConfig, mode: 'percent', percent: 50 }),
    { width: 800, height: 400, fit: 'fill' }
  );

  assert.deepEqual(
    computeTargetDimensions(2400, 1200, { ...baseConfig, mode: 'maxEdge', maxEdge: 1200 }),
    { width: 1200, height: 600, fit: 'contain' }
  );

  // maxEdge should not upscale smaller images
  assert.deepEqual(
    computeTargetDimensions(800, 500, { ...baseConfig, mode: 'maxEdge', maxEdge: 1200 }),
    { width: 800, height: 500, fit: 'contain' }
  );

  // exact with lockAspect computes proportional height from requested width
  assert.deepEqual(
    computeTargetDimensions(1600, 800, { ...baseConfig, mode: 'exact', width: 1000, lockAspect: true }),
    { width: 1000, height: 500, fit: 'fill' }
  );

  // exact without lockAspect uses requested width and height with selected fit
  assert.deepEqual(
    computeTargetDimensions(1600, 800, {
      ...baseConfig,
      mode: 'exact',
      width: 1080,
      height: 1080,
      lockAspect: false,
      fit: 'cover',
    }),
    { width: 1080, height: 1080, fit: 'cover' }
  );
});

test('buildOutputFilename preserves subfolders, appends suffix, and updates extensions cleanly', () => {
  assert.equal(
    buildOutputFilename('shoot/day1/DSC_0042.JPG', {
      format: 'webp',
      quality: 90,
      suffix: '_crop',
      preserveSubfolders: true,
    }),
    'shoot/day1/DSC_0042_crop.webp'
  );

  assert.equal(
    buildOutputFilename('shoot/day1/frame.png', {
      format: 'keep',
      quality: 90,
      suffix: '',
      preserveSubfolders: false,
    }),
    'frame.png'
  );

  assert.equal(
    buildOutputFilename(
      'shoot/day1/DSC_0042.JPG',
      {
        format: 'webp',
        quality: 86,
        suffix: '',
        namingTemplate: '{index3}_{name}_{w}x{h}_{date}',
        preserveSubfolders: true,
      },
      { index: 7, width: 1600, height: 1067, dateStr: '2026-11-27' }
    ),
    'shoot/day1/007_DSC_0042_1600x1067_2026-11-27.webp'
  );
});

test('formatBytesCompact formats sizes readably', () => {
  assert.equal(formatBytesCompact(0), '0 B');
  assert.equal(formatBytesCompact(512), '512 B');
  assert.equal(formatBytesCompact(1536), '1.5 KB');
  assert.equal(formatBytesCompact(2 * 1024 * 1024), '2.0 MB');
});
