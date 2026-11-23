import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildZipFilename,
  buildArchiveFilename,
  buildContentDispositionHeader,
  normalizeArchiveFormat,
  getArchiveContentType,
  DEFAULT_ARCHIVE_FORMAT,
} from './downloader.ts';

test('DEFAULT_ARCHIVE_FORMAT defaults to 7z and normalizeArchiveFormat accepts 7z or zip', () => {
  assert.equal(DEFAULT_ARCHIVE_FORMAT, '7z');
  assert.equal(normalizeArchiveFormat(undefined), '7z');
  assert.equal(normalizeArchiveFormat('7z'), '7z');
  assert.equal(normalizeArchiveFormat('ZIP'), 'zip');
  assert.equal(normalizeArchiveFormat('zip'), 'zip');
  assert.equal(normalizeArchiveFormat('tar'), '7z');
  assert.equal(getArchiveContentType('7z'), 'application/x-7z-compressed');
  assert.equal(getArchiveContentType('zip'), 'application/zip');
});

test('buildArchiveFilename defaults to .7z and switches cleanly to .zip using webpage header', () => {
  assert.equal(
    buildArchiveFilename('Yosemite Valley & Alpine Wildlife Photography 2026', 'https://archive.example/hub'),
    'Yosemite Valley & Alpine Wildlife Photography 2026.7z'
  );
  assert.equal(
    buildArchiveFilename('Yosemite Valley & Alpine Wildlife Photography 2026', 'https://archive.example/hub', 'zip'),
    'Yosemite Valley & Alpine Wildlife Photography 2026.zip'
  );
  assert.equal(
    buildArchiveFilename('Gallery Archive.zip', undefined, '7z'),
    'Gallery Archive.7z'
  );
  assert.equal(
    buildArchiveFilename('Gallery Archive.7z', undefined, 'zip'),
    'Gallery Archive.zip'
  );
  assert.equal(buildArchiveFilename('', ''), 'scraped_images.7z');
});

test('buildZipFilename formats clean ZIP filename from webpage header without random timestamps', () => {
  assert.equal(
    buildZipFilename('Editorial Multi-Gallery Contact Sheet Archive', 'https://archive.example/hub'),
    'Editorial Multi-Gallery Contact Sheet Archive.zip'
  );

  assert.equal(
    buildZipFilename('  Studio / Set: "2026" | Master*   Photos?  ', 'https://archive.example/1'),
    'Studio Set 2026 Master Photos.zip'
  );

  assert.equal(
    buildZipFilename('Gallery Archive.zip'),
    'Gallery Archive.zip'
  );
});

test('buildZipFilename falls back cleanly to URL slug/host or default when pageTitle is missing or a bare URL', () => {
  assert.equal(
    buildZipFilename('', 'https://archive.example/albums/30560/studio-session-one/'),
    'studio session one.zip'
  );
  assert.equal(
    buildZipFilename('https://archive.example/albums/30560/morning-terrace-light/', ''),
    'morning terrace light.zip'
  );
  assert.equal(buildZipFilename('', ''), 'scraped_images.zip');
});

test('buildContentDispositionHeader escapes non-ASCII headers safely while preserving UTF-8 filename*', () => {
  assert.equal(
    buildContentDispositionHeader('National Gallery.7z'),
    'attachment; filename="National Gallery.7z"'
  );

  const unicodeHeader = buildContentDispositionHeader('Hazel — 2026 Studio.7z');
  assert.ok(unicodeHeader.startsWith('attachment; filename="Hazel - 2026 Studio.7z"; filename*=UTF-8\'\''));
  assert.ok(unicodeHeader.includes(encodeURIComponent('Hazel — 2026 Studio.7z')));
});
