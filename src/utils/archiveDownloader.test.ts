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
