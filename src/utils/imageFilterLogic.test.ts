import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_FACE_ANCHOR,
  DEFAULT_FILTER_RECIPE,
  COLOR_PRESETS,
  SNAP_LENSES,
  buildPresetAdjustments,
  sanitizeAdjustments,
  sanitizeFaceAnchor,
  hasActiveAdjustments,
  countActiveEffects,
  buildCssFilterString,
  applyPixelAdjustmentsToRgba,
  applyUnsharpSharpenToRgba,
  applyRadialBulgeWarpToRgba,
  applyVhsEffectToRgba,
  applyComicPopEffectToRgba,
  estimateSkinPortraitAnchor,
} from './imageFilterLogic';

describe('imageFilterLogic presets & sanitization', () => {
  it('exposes curated color presets and Snapchat-inspired lenses', () => {
    assert.ok(COLOR_PRESETS.length >= 8);
    assert.ok(SNAP_LENSES.length >= 9);
    assert.ok(SNAP_LENSES.some((l) => l.id === 'puppy' && l.needsFaceAnchor));
    assert.ok(SNAP_LENSES.some((l) => l.id === 'flower_crown' && l.needsFaceAnchor));
    assert.ok(SNAP_LENSES.some((l) => l.id === 'vhs_cam' && !l.needsFaceAnchor));
  });

  it('builds preset adjustments cleanly and preserves defaults for original', () => {
    const noir = buildPresetAdjustments('bw_noir');
    assert.equal(noir.grayscale, 100);
    assert.ok(noir.contrast > 0);
    assert.ok(noir.vignette > 0);

    const vintage = buildPresetAdjustments('vintage_sepia');
    assert.ok(vintage.sepia >= 70);
    assert.ok(vintage.warmth > 0);

    const orig = buildPresetAdjustments('original');
    assert.deepEqual(orig, DEFAULT_ADJUSTMENTS);
  });

  it('clamps adjustment bounds and face anchors safely', () => {
    const clamped = sanitizeAdjustments({
      brightness: 999,
      contrast: -999,
      grayscale: 150,
      sepia: -20,
      hueRotate: 400,
      blur: 99,
    });
    assert.equal(clamped.brightness, 100);
    assert.equal(clamped.contrast, -100);
    assert.equal(clamped.grayscale, 100);
    assert.equal(clamped.sepia, 0);
    assert.equal(clamped.hueRotate, 180);
    assert.equal(clamped.blur, 20);

    const anchor = sanitizeFaceAnchor({
      centerX: -1,
      centerY: 5,
      widthRatio: 0.01,
      tiltDeg: 90,
      source: 'manual',
    });
    assert.equal(anchor.centerX, 0.05);
    assert.equal(anchor.centerY, 0.95);
    assert.equal(anchor.widthRatio, 0.12);
    assert.equal(anchor.tiltDeg, 45);
  });

  it('tracks active adjustments and counts active effects accurately', () => {
    assert.equal(hasActiveAdjustments(DEFAULT_ADJUSTMENTS), false);
    assert.equal(countActiveEffects(DEFAULT_FILTER_RECIPE), 0);

    const edited = {
      ...DEFAULT_FILTER_RECIPE,
      adjustments: { ...DEFAULT_ADJUSTMENTS, grayscale: 100, brightness: 15 },
      lens: { ...DEFAULT_FILTER_RECIPE.lens, lensId: 'puppy' as const, intensity: 85 },
    };
    assert.equal(hasActiveAdjustments(edited.adjustments), true);
    assert.equal(countActiveEffects(edited), 3);
  });

  it('builds valid CSS filter strings', () => {
    assert.equal(buildCssFilterString(DEFAULT_ADJUSTMENTS), 'none');
    const css = buildCssFilterString({
      ...DEFAULT_ADJUSTMENTS,
      grayscale: 100,
      sepia: 50,
      contrast: 25,
      brightness: 20,
      blur: 4,
    });
    assert.ok(css.includes('brightness('));
    assert.ok(css.includes('contrast('));
    assert.ok(css.includes('grayscale(1.000)'));
    assert.ok(css.includes('sepia(0.500)'));
    assert.ok(css.includes('blur(4.00px)'));
  });
});

describe('imageFilterLogic pixel & optical shaders', () => {
  it('converts colorful pixels to pure monochrome under Grayscale 100%', () => {
    const rgba = new Uint8ClampedArray([
      220, 40, 80, 255,
      30, 180, 60, 255,
    ]);
    applyPixelAdjustmentsToRgba(rgba, 2, 1, { ...DEFAULT_ADJUSTMENTS, grayscale: 100 });
    assert.equal(rgba[0], rgba[1]);
    assert.equal(rgba[1], rgba[2]);
    assert.equal(rgba[4], rgba[5]);
    assert.equal(rgba[5], rgba[6]);
  });

  it('shifts pixels toward warm archival tones under Sepia', () => {
    const rgba = new Uint8ClampedArray([100, 140, 200, 255]);
    applyPixelAdjustmentsToRgba(rgba, 1, 1, { ...DEFAULT_ADJUSTMENTS, sepia: 100 });
    // Sepia makes red channel > green channel > blue channel
    assert.ok(rgba[0] > rgba[1]);
    assert.ok(rgba[1] > rgba[2]);
    assert.equal(rgba[3], 255);
  });

  it('scales brightness and contrast cleanly', () => {
    const brightBuf = new Uint8ClampedArray([100, 100, 100, 255]);
    applyPixelAdjustmentsToRgba(brightBuf, 1, 1, { ...DEFAULT_ADJUSTMENTS, brightness: 40 });
    assert.ok(brightBuf[0] > 140);

    const contrastBuf = new Uint8ClampedArray([
      80, 80, 80, 255,
      180, 180, 180, 255,
    ]);
    applyPixelAdjustmentsToRgba(contrastBuf, 2, 1, { ...DEFAULT_ADJUSTMENTS, contrast: 50 });
    // Darker gets darker, lighter gets lighter
    assert.ok(contrastBuf[0] < 80);
    assert.ok(contrastBuf[4] > 180);
  });

  it('inverts RGB channels under Invert 100%', () => {
    const rgba = new Uint8ClampedArray([25, 100, 230, 255]);
    applyPixelAdjustmentsToRgba(rgba, 1, 1, { ...DEFAULT_ADJUSTMENTS, invert: 100 });
    assert.equal(rgba[0], 230);
    assert.equal(rgba[1], 155);
    assert.equal(rgba[2], 25);
  });

  it('enhances local edges under sharpen kernel', () => {
    // 3x3 buffer with a bright center pixel surrounded by dark pixels
    const rgba = new Uint8ClampedArray(9 * 4);
    for (let i = 0; i < 9; i++) {
      rgba[i * 4] = 80;
      rgba[i * 4 + 1] = 80;
      rgba[i * 4 + 2] = 80;
      rgba[i * 4 + 3] = 255;
    }
    // Center pixel index 4
    rgba[16] = 150;
    rgba[17] = 150;
    rgba[18] = 150;
    applyUnsharpSharpenToRgba(rgba, 3, 3, 100);
    assert.ok(rgba[16] > 150);
  });

  it('warps region under radial bulge lens without losing alpha', () => {
    const w = 32;
    const h = 32;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = (x * 8) & 255;
        rgba[idx + 1] = (y * 8) & 255;
        rgba[idx + 2] = 128;
        rgba[idx + 3] = 255;
      }
    }
    const before = new Uint8ClampedArray(rgba);
    applyRadialBulgeWarpToRgba(rgba, w, h, DEFAULT_FACE_ANCHOR, 100);
    let diffPixels = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] !== before[i] || rgba[i + 1] !== before[i + 1]) diffPixels++;
    }
    assert.ok(diffPixels > 0);
  });

  it('applies VHS chromatic shift and Comic Pop quantization', () => {
    const w = 24;
    const h = 24;
    const base = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        base[idx] = x > 12 ? 220 : 30;
        base[idx + 1] = 120;
        base[idx + 2] = y * 10;
        base[idx + 3] = 255;
      }
    }

    const vhs = new Uint8ClampedArray(base);
    applyVhsEffectToRgba(vhs, w, h, 90);
    let vhsDiff = 0;
    for (let i = 0; i < vhs.length; i += 4) {
      if (vhs[i] !== base[i] || vhs[i + 2] !== base[i + 2]) vhsDiff++;
    }
    assert.ok(vhsDiff > 0);

    const comic = new Uint8ClampedArray(base);
    applyComicPopEffectToRgba(comic, w, h, 95);
    let comicDiff = 0;
    for (let i = 0; i < comic.length; i += 4) {
      if (comic[i] !== base[i] || comic[i + 1] !== base[i + 1]) comicDiff++;
    }
    assert.ok(comicDiff > 0);
  });

  it('estimates skin portrait centroid on synthetic head region', () => {
    const w = 64;
    const h = 64;
    const rgba = new Uint8ClampedArray(w * h * 4);
    // Cool blue studio background
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 24;
      rgba[i + 1] = 48;
      rgba[i + 2] = 96;
      rgba[i + 3] = 255;
    }
    // Paint a portrait oval off-center to the right (x: 34..50, y: 10..30)
    for (let y = 10; y <= 30; y++) {
      for (let x = 34; x <= 50; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 212;
        rgba[idx + 1] = 158;
        rgba[idx + 2] = 126;
      }
    }

    const detected = estimateSkinPortraitAnchor(rgba, w, h);
    assert.equal(detected.source, 'auto');
    assert.ok(detected.centerX > 0.55 && detected.centerX < 0.78);
    assert.ok(detected.centerY > 0.2 && detected.centerY < 0.5);
  });

  it('locks onto upper head even when lower bare arms appear in 3/4 portrait', () => {
    const w = 80;
    const h = 100;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 150;
      rgba[i + 1] = 152;
      rgba[i + 2] = 155;
      rgba[i + 3] = 255;
    }
    // Head at x: 32..48, y: 10..30 (center ~0.5, y ~0.20)
    for (let y = 10; y <= 30; y++) {
      for (let x = 32; x <= 48; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 212;
        rgba[idx + 1] = 158;
        rgba[idx + 2] = 126;
      }
    }
    // Wide bare arms lower down at y: 45..85 on left (10..20) & right (60..70)
    for (let y = 45; y <= 85; y++) {
      for (let x = 10; x <= 20; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 212;
        rgba[idx + 1] = 158;
        rgba[idx + 2] = 126;
      }
      for (let x = 60; x <= 70; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 212;
        rgba[idx + 1] = 158;
        rgba[idx + 2] = 126;
      }
    }

    const detected = estimateSkinPortraitAnchor(rgba, w, h);
    assert.ok(detected.centerY <= 0.3, `expected head centerY <= 0.3, got ${detected.centerY}`);
    assert.ok(detected.widthRatio < 0.36, `expected compact face widthRatio, got ${detected.widthRatio}`);
  });
});
