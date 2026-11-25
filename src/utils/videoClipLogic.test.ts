/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeClipTimestamps,
  deriveClipBaseFilename,
  estimateClipExtractionPlan,
  formatVideoTimestamp,
  isSupportedVideoFile,
  isValidVideoUrl,
  parseVideoTimestamp,
  resolveOutputGifFps,
  sanitizeVideoTimeRange,
} from './videoClipLogic';

test('isSupportedVideoFile recognizes video MIME types and common extensions', () => {
  assert.equal(isSupportedVideoFile({ name: 'clip.mp4', type: 'video/mp4' }), true);
  assert.equal(isSupportedVideoFile({ name: 'capture.MOV', type: '' }), true);
  assert.equal(isSupportedVideoFile({ name: 'demo.webm', type: 'video/webm' }), true);
  assert.equal(isSupportedVideoFile({ name: 'photo.jpg', type: 'image/jpeg' }), false);
  assert.equal(isSupportedVideoFile({ name: 'archive.zip', type: 'application/zip' }), false);
});

test('isValidVideoUrl accepts http(s), relative paths, and blob URLs while rejecting bad protocols', () => {
  assert.equal(isValidVideoUrl('/samples/sample_motion_clip.webm'), true);
  assert.equal(isValidVideoUrl('https://cdn.example.com/demo.mp4'), true);
  assert.equal(isValidVideoUrl('blob:http://localhost:3000/abc-123'), true);
  assert.equal(isValidVideoUrl('javascript:alert(1)'), false);
  assert.equal(isValidVideoUrl(''), false);
});

test('formatVideoTimestamp and parseVideoTimestamp roundtrip cleanly', () => {
  assert.equal(formatVideoTimestamp(0), '0:00.0');
  assert.equal(formatVideoTimestamp(4.26), '0:04.3');
  assert.equal(formatVideoTimestamp(75.2), '1:15.2');
  assert.equal(formatVideoTimestamp(59.96), '1:00.0');

  assert.equal(parseVideoTimestamp('0:04.3'), 4.3);
  assert.equal(parseVideoTimestamp('1:15.2'), 75.2);
  assert.equal(parseVideoTimestamp('12.5'), 12.5);
  assert.equal(parseVideoTimestamp('1:02:03.5'), 3723.5);
  assert.equal(parseVideoTimestamp('invalid'), null);
  assert.equal(parseVideoTimestamp('1:75'), null);
});

test('sanitizeVideoTimeRange enforces bounds, minimum duration, and max clip duration', () => {
  const normal = sanitizeVideoTimeRange(1.2, 4.5, 10);
  assert.deepEqual(normal, { startSec: 1.2, endSec: 4.5, durationSec: 3.3 });

  const invertedStartAnchor = sanitizeVideoTimeRange(6, 2, 10, {
    minClipSec: 0.5,
    anchor: 'start',
  });
  assert.equal(invertedStartAnchor.startSec, 6);
  assert.equal(invertedStartAnchor.endSec, 6.5);
  assert.equal(invertedStartAnchor.durationSec, 0.5);

  const capped = sanitizeVideoTimeRange(2, 50, 60, { maxClipSec: 15, anchor: 'start' });
  assert.equal(capped.startSec, 2);
  assert.equal(capped.endSec, 17);
  assert.equal(capped.durationSec, 15);

  const shortVideo = sanitizeVideoTimeRange(0, 10, 0.4, { minClipSec: 0.2 });
  assert.deepEqual(shortVideo, { startSec: 0, endSec: 0.4, durationSec: 0.4 });
});

test('computeClipTimestamps spaces frames monotonically within bounds and caps when needed', () => {
  const res = computeClipTimestamps(1, 3, 10, 120);
  assert.equal(res.wasCapped, false);
  assert.equal(res.timestamps.length, 20);
  assert.equal(res.timestamps[0], 1);
  assert.ok(res.timestamps[res.timestamps.length - 1] < 3);
  for (let i = 1; i < res.timestamps.length; i++) {
    assert.ok(res.timestamps[i] > res.timestamps[i - 1]);
  }

  const capped = computeClipTimestamps(0, 20, 15, 60);
  assert.equal(capped.wasCapped, true);
  assert.equal(capped.timestamps.length, 60);
  assert.equal(capped.effectiveExtractFps, 3);
});

test('estimateClipExtractionPlan computes output FPS and duration with speed multiplier', () => {
  assert.equal(resolveOutputGifFps(10, 1.5), 15);
  assert.equal(resolveOutputGifFps(20, 2), 24); // clamped to GIF encoder max 24

  const plan = estimateClipExtractionPlan(0.5, 3.5, 4.0, 8, 1.5, 120);
  assert.equal(plan.startSec, 0.5);
  assert.equal(plan.endSec, 3.5);
  assert.equal(plan.clipDurationSec, 3);
  assert.equal(plan.frameCount, 24);
  assert.equal(plan.outputGifFps, 12);
  assert.ok(plan.estimatedOutputDurationMs > 1800 && plan.estimatedOutputDurationMs <= 2200);
});

test('deriveClipBaseFilename sanitizes file names cleanly', () => {
  assert.equal(deriveClipBaseFilename('My Awesome Clip (1).mp4'), 'My_Awesome_Clip_1');
  assert.equal(deriveClipBaseFilename('/samples/sample_motion_clip.webm'), 'sample_motion_clip');
});
