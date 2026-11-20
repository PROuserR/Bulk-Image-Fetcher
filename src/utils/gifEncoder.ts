/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure TypeScript Animated GIF89a Binary Encoder.
 * Supports per-frame Median Cut 256-color quantization, optional Bayer 4x4 dithering,
 * fast hash-table LZW compression, Netscape 2.0 looping, and centisecond frame delays.
 */

export interface GifFrameRgbaInput {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Delay in milliseconds before advancing to the next frame. Clamped to >= 20ms (2cs). */
  delayMs: number;
}

export interface GifEncodeOptions {
  width: number;
  height: number;
  /** 0 = infinite loop, 1 = play once (omit Netscape extension), >1 = loop N times. */
  loopCount?: number;
  /** Apply lightweight Bayer 4x4 ordered dithering for smoother photo gradients. */
  dither?: boolean;
  /** Optional progress callback invoked after each frame is encoded. */
  onProgress?: (completedFrames: number, totalFrames: number) => void;
}

interface ColorBox {
  colors: number[];
  rMin: number;
  rMax: number;
  gMin: number;
  gMax: number;
  bMin: number;
  bMax: number;
  population: number;
}

const BAYER_4X4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

function clampByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 255) return 255;
  return v | 0;
}

function makeColorBox(colors: number[], histogram: Uint32Array): ColorBox {
  let rMin = 31;
  let rMax = 0;
  let gMin = 31;
  let gMax = 0;
  let bMin = 31;
  let bMax = 0;
  let population = 0;

  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const r = (c >> 10) & 31;
    const g = (c >> 5) & 31;
    const b = c & 31;
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
    population += histogram[c];
  }

  return { colors, rMin, rMax, gMin, gMax, bMin, bMax, population };
}

/**
 * Quantizes an RGBA frame into an optimal 256-color RGB palette (768 bytes)
 * and maps every pixel to its nearest palette index.
 */
export function quantizeRgbaFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  dither = true
): { palette: Uint8Array; indices: Uint8Array } {
  const pixelCount = width * height;
  const histogram = new Uint32Array(32768);

  // Sample aggressively only if huge so histogram remains instant (<3ms)
  const stride = pixelCount > 250_000 ? Math.ceil(pixelCount / 250_000) : 1;
  for (let p = 0; p < pixelCount; p += stride) {
    const off = p * 4;
    const a = rgba[off + 3];
    // Premultiply/blend semi-transparent against dark neutral if needed
    const r = a < 255 ? Math.round((rgba[off] * a) / 255) : rgba[off];
    const g = a < 255 ? Math.round((rgba[off + 1] * a) / 255) : rgba[off + 1];
    const b = a < 255 ? Math.round((rgba[off + 2] * a) / 255) : rgba[off + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    histogram[key]++;
  }

  const uniqueKeys: number[] = [];
  for (let k = 0; k < 32768; k++) {
    if (histogram[k] > 0) uniqueKeys.push(k);
  }

  const palette = new Uint8Array(256 * 3);

  if (uniqueKeys.length === 0) {
    // Fallback empty black frame
    const indices = new Uint8Array(pixelCount);
    return { palette, indices };
  }

  if (uniqueKeys.length <= 256) {
    for (let i = 0; i < uniqueKeys.length; i++) {
      const k = uniqueKeys[i];
      palette[i * 3] = Math.min(255, (((k >> 10) & 31) << 3) + 4);
      palette[i * 3 + 1] = Math.min(255, (((k >> 5) & 31) << 3) + 4);
      palette[i * 3 + 2] = Math.min(255, ((k & 31) << 3) + 4);
    }
  } else {
    const boxes: ColorBox[] = [makeColorBox(uniqueKeys, histogram)];

    while (boxes.length < 256) {
      // Pick the box with largest population * volume score that has >= 2 colors
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.colors.length < 2) continue;
        const span =
          (box.rMax - box.rMin + 1) *
          (box.gMax - box.gMin + 1) *
          (box.bMax - box.bMin + 1);
        const score = box.population * Math.cbrt(span);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx === -1) break;

      const target = boxes[bestIdx];
      const rSpan = target.rMax - target.rMin;
      const gSpan = target.gMax - target.gMin;
      const bSpan = target.bMax - target.bMin;

      let shift = 0;
      if (rSpan >= gSpan && rSpan >= bSpan) {
        shift = 10;
      } else if (gSpan >= rSpan && gSpan >= bSpan) {
        shift = 5;
      } else {
        shift = 0;
      }

      target.colors.sort((a, b) => ((a >> shift) & 31) - ((b >> shift) & 31));

      // Split near weighted median population
      let acc = 0;
      const halfPop = target.population / 2;
      let splitAt = 1;
      for (let i = 0; i < target.colors.length - 1; i++) {
        acc += histogram[target.colors[i]];
        splitAt = i + 1;
        if (acc >= halfPop) break;
      }

      const leftColors = target.colors.slice(0, splitAt);
      const rightColors = target.colors.slice(splitAt);
      boxes.splice(
        bestIdx,
        1,
        makeColorBox(leftColors, histogram),
        makeColorBox(rightColors, histogram)
      );
    }

    const paletteCount = Math.min(256, boxes.length);
    for (let i = 0; i < paletteCount; i++) {
      const box = boxes[i];
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let total = 0;
      for (let j = 0; j < box.colors.length; j++) {
        const c = box.colors[j];
        const w = histogram[c];
        rSum += (((c >> 10) & 31) * 255) / 31 * w;
        gSum += (((c >> 5) & 31) * 255) / 31 * w;
        bSum += ((c & 31) * 255) / 31 * w;
        total += w;
      }
      if (total > 0) {
        palette[i * 3] = clampByte(Math.round(rSum / total));
        palette[i * 3 + 1] = clampByte(Math.round(gSum / total));
        palette[i * 3 + 2] = clampByte(Math.round(bSum / total));
      }
    }
  }

  const paletteSize = Math.min(256, Math.max(2, uniqueKeys.length));
  const lookupCache = new Int16Array(32768).fill(-1);

  const findNearestIndex = (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const cached = lookupCache[key];
    if (cached !== -1) return cached;

    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < paletteSize; i++) {
      const dr = r - palette[i * 3];
      const dg = g - palette[i * 3 + 1];
      const db = b - palette[i * 3 + 2];
      // Perceptual luminance weighting improves visual color fidelity
      const dist = dr * dr * 2 + dg * dg * 4 + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        if (dist === 0) break;
      }
    }
    lookupCache[key] = bestIdx;
    return bestIdx;
  };

  const indices = new Uint8Array(pixelCount);
  if (dither) {
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      const bayerRow = (y & 3) * 4;
      for (let x = 0; x < width; x++) {
        const p = rowOffset + x;
        const off = p * 4;
        const threshold = (BAYER_4X4[bayerRow + (x & 3)] - 7.5) * 1.4;
        const r = clampByte(rgba[off] + threshold);
        const g = clampByte(rgba[off + 1] + threshold);
        const b = clampByte(rgba[off + 2] + threshold);
        indices[p] = findNearestIndex(r, g, b);
      }
    }
  } else {
    for (let p = 0; p < pixelCount; p++) {
      const off = p * 4;
      indices[p] = findNearestIndex(rgba[off], rgba[off + 1], rgba[off + 2]);
    }
  }

  return { palette, indices };
}

/**
 * Encodes palette-indexed pixel data into GIF89a LZW sub-blocks (including minCodeSize byte and 0x00 terminator).
 */
export function encodeLzwIndices(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const clearCode = 1 << minCodeSize; // 256
  const eoiCode = clearCode + 1; // 257

  const outBytes: number[] = [minCodeSize];
  const subBlock: number[] = [];

  let bitBuffer = 0;
  let bitCount = 0;

  const flushSubBlock = () => {
    if (subBlock.length === 0) return;
    outBytes.push(subBlock.length);
    for (let i = 0; i < subBlock.length; i++) {
      outBytes.push(subBlock[i]);
    }
    subBlock.length = 0;
  };

  const emitCode = (code: number, width: number) => {
    bitBuffer |= code << bitCount;
    bitCount += width;
    while (bitCount >= 8) {
      subBlock.push(bitBuffer & 0xff);
      if (subBlock.length === 255) {
        flushSubBlock();
      }
      bitBuffer >>>= 8;
      bitCount -= 8;
    }
  };

  // Flat open-addressing hash table for (prefix << 8 | suffix) -> code
  const HASH_SIZE = 8192;
  const hashKeys = new Int32Array(HASH_SIZE);
  const hashCodes = new Int16Array(HASH_SIZE);

  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const resetTable = () => {
    hashKeys.fill(-1);
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };

  resetTable();
  emitCode(clearCode, codeSize);

  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const suffix = indices[i];
      const combined = (prefix << 8) | suffix;
      let slot = ((prefix << 5) ^ suffix) & (HASH_SIZE - 1);
      let matchedCode = -1;

      while (true) {
        const key = hashKeys[slot];
        if (key === combined) {
          matchedCode = hashCodes[slot];
          break;
        }
        if (key === -1) break;
        slot = (slot + 1) & (HASH_SIZE - 1);
      }

      if (matchedCode !== -1) {
        prefix = matchedCode;
      } else {
        emitCode(prefix, codeSize);
        if (nextCode < 4096) {
          hashKeys[slot] = combined;
          hashCodes[slot] = nextCode;
          nextCode++;
          if (nextCode - 1 === 1 << codeSize && codeSize < 12) {
            // Delay bump applies on the code emitted AFTER nextCode crosses power of 2
          }
          // Standard GIF decoder bumps code size when nextCode exceeds (1 << codeSize) - 1
          if (nextCode > 1 << codeSize && codeSize < 12) {
            codeSize++;
          }
        } else {
          emitCode(clearCode, codeSize);
          resetTable();
        }
        prefix = suffix;
      }
    }
    emitCode(prefix, codeSize);
  }

  emitCode(eoiCode, codeSize);

  if (bitCount > 0) {
    subBlock.push(bitBuffer & 0xff);
  }
  flushSubBlock();
  outBytes.push(0x00); // Block terminator

  return Uint8Array.from(outBytes);
}

function writeUint16LE(target: number[], value: number) {
  const clamped = Math.max(0, Math.min(0xffff, Math.round(value)));
  target.push(clamped & 0xff, (clamped >> 8) & 0xff);
}

/**
 * Encodes an array of RGBA frames into a complete GIF89a binary byte array.
 */
export function encodeAnimatedGif(
  frames: GifFrameRgbaInput[],
  options: GifEncodeOptions
): Uint8Array {
  if (!frames || frames.length === 0) {
    throw new Error('At least one frame is required to encode an animated GIF.');
  }

  const width = Math.max(1, Math.min(4096, Math.round(options.width)));
  const height = Math.max(1, Math.min(4096, Math.round(options.height)));
  const loopCount = options.loopCount ?? 0;
  const dither = options.dither ?? true;

  const chunks: Uint8Array[] = [];

  // 1. Header ('GIF89a') + Logical Screen Descriptor (7 bytes)
  const header: number[] = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
  ];
  writeUint16LE(header, width);
  writeUint16LE(header, height);
  // Packed field: Global Color Table = 0, Color Res = 7 (8-bit), Sort = 0, GCT Size = 0 -> 0x70
  header.push(0x70, 0x00, 0x00);

  // 2. Netscape 2.0 Application Extension for looping (when loopCount !== 1)
  if (loopCount !== 1) {
    header.push(
      0x21, 0xff, 0x0b,
      0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // NETSCAPE2.0
      0x03, 0x01
    );
    // Netscape loop value: 0 = infinite; N > 1 encodes repeat count N-1 (so 2 plays = 1 repeat)
    const netscapeRepeats = loopCount <= 0 ? 0 : Math.max(1, loopCount - 1);
    writeUint16LE(header, netscapeRepeats);
    header.push(0x00);
  }
  chunks.push(Uint8Array.from(header));

  // 3. Encode each frame
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const delayCs = Math.max(2, Math.min(65535, Math.round(frame.delayMs / 10)));

    const { palette, indices } = quantizeRgbaFrame(frame.rgba, width, height, dither);
    const lzwData = encodeLzwIndices(indices, 8);

    const frameHeader: number[] = [
      // Graphic Control Extension (8 bytes)
      0x21, 0xf9, 0x04,
      0x04, // Disposal method = 1 (leave previous pixels, overwrite with full frame)
    ];
    writeUint16LE(frameHeader, delayCs);
    frameHeader.push(0x00, 0x00); // transparent index + terminator

    // Image Descriptor (10 bytes)
    frameHeader.push(0x2c);
    writeUint16LE(frameHeader, 0); // left
    writeUint16LE(frameHeader, 0); // top
    writeUint16LE(frameHeader, width);
    writeUint16LE(frameHeader, height);
    // Packed: Local Color Table = 1, Interlace = 0, Sort = 0, LCT size = 7 (256 entries) -> 0x87
    frameHeader.push(0x87);

    chunks.push(Uint8Array.from(frameHeader));
    chunks.push(palette);
    chunks.push(lzwData);

    options.onProgress?.(i + 1, frames.length);
  }

  // 4. GIF Trailer
  chunks.push(Uint8Array.from([0x3b]));

  let totalBytes = 0;
  for (const chunk of chunks) {
    totalBytes += chunk.length;
  }

  const output = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }

  return output;
}
