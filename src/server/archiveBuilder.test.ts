import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import JSZip from 'jszip';
import { path7za } from '7zip-bin';
import {
  buildCompressedArchive,
  saveStagedArchive,
  readStagedArchive,
  deleteStagedArchive,
  consumeStagedArchive,
} from './archiveBuilder.ts';

test('buildCompressedArchive creates valid multi-folder .7z archive and emits progress up to 100%', async () => {
  const entries = [
    { path: 'Gallery_One/photo_01.jpg', data: Buffer.from('FAKE_JPEG_DATA_ALPHA_1234567890') },
    { path: 'Gallery_Two/photo_02.png', data: Buffer.from('FAKE_PNG_DATA_BETA_0987654321') },
    { path: '../../traversal/ignored.txt', data: Buffer.from('SANITIZED_ENTRY') },
  ];

  const reported: number[] = [];
  const result = await buildCompressedArchive(entries, '7z', {
    onProgress: (pct) => reported.push(pct),
  });
  assert.equal(result.format, '7z');
  assert.equal(result.contentType, 'application/x-7z-compressed');
  // 7z magic header: 37 7A BC AF 27 1C
  assert.equal(result.buffer.subarray(0, 6).toString('hex'), '377abcaf271c');
  assert.equal(reported[0], 0);
  assert.equal(reported[reported.length - 1], 100);

  // Verify contents using 7za list
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'verify-7z-'));
  try {
    const outFile = path.join(tmpDir, 'test.7z');
    await fs.promises.writeFile(outFile, result.buffer);
    const listOut = execFileSync(path7za, ['l', outFile], { encoding: 'utf8' });
    assert.ok(listOut.includes('Gallery_One/photo_01.jpg'));
    assert.ok(listOut.includes('Gallery_Two/photo_02.png'));
    assert.ok(listOut.includes('traversal/ignored.txt'));
    assert.ok(!listOut.includes('../'));
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
});

test('buildCompressedArchive creates valid .zip archive and emits progress up to 100%', async () => {
  const entries = [
    { path: 'Gallery_One/photo_01.jpg', data: Buffer.from('JPEG_BYTES') },
    { path: 'readme.txt', data: Buffer.from('ARCHIVE_README_CONTENT_REPEAT_REPEAT') },
  ];

  const reported: number[] = [];
  const result = await buildCompressedArchive(entries, 'zip', {
    onProgress: (pct) => reported.push(pct),
  });
  assert.equal(result.format, 'zip');
  assert.equal(result.contentType, 'application/zip');
  // ZIP PK\x03\x04 magic bytes
  assert.equal(result.buffer.subarray(0, 4).toString('hex'), '504b0304');
  assert.equal(reported[0], 0);
  assert.equal(reported[reported.length - 1], 100);

  const loaded = await JSZip.loadAsync(result.buffer);
  assert.ok(loaded.file('Gallery_One/photo_01.jpg'));
  assert.ok(loaded.file('readme.txt'));
  assert.equal(await loaded.file('Gallery_One/photo_01.jpg')!.async('string'), 'JPEG_BYTES');
});

test('saveStagedArchive and consumeStagedArchive transfer buffer once and reject invalid tokens', async () => {
  const payload = Buffer.from('7Z_STAGED_BINARY_CONTENT');
  const meta = await saveStagedArchive(payload, {
    filename: 'Test Album.7z',
    format: '7z',
    contentType: 'application/x-7z-compressed',
    fileCount: 3,
  });

  assert.equal(meta.totalBytes, payload.length);
  const consumed = await consumeStagedArchive(meta.token);
  assert.ok(consumed);
  assert.equal(consumed.meta.filename, 'Test Album.7z');
  assert.equal(consumed.buffer.toString('utf8'), '7Z_STAGED_BINARY_CONTENT');

  // Second read must return null (one-time cleanup)
  assert.equal(await consumeStagedArchive(meta.token), null);
  // Path traversal token must be rejected
  assert.equal(await consumeStagedArchive('../../etc/passwd'), null);
});

test('readStagedArchive allows repeated non-destructive reads for Range resume until deleteStagedArchive', async () => {
  const payload = Buffer.from('0123456789ABCDEF_RESUMABLE_ARCHIVE');
  const meta = await saveStagedArchive(payload, {
    filename: 'Resumable.7z',
    format: '7z',
    contentType: 'application/x-7z-compressed',
    fileCount: 2,
  });

  const firstRead = await readStagedArchive(meta.token);
  assert.ok(firstRead);
  assert.equal(firstRead.buffer.subarray(0, 10).toString('utf8'), '0123456789');

  const secondRead = await readStagedArchive(meta.token);
  assert.ok(secondRead);
  assert.equal(secondRead.buffer.subarray(10).toString('utf8'), 'ABCDEF_RESUMABLE_ARCHIVE');

  await deleteStagedArchive(meta.token);
  assert.equal(await readStagedArchive(meta.token), null);
});

