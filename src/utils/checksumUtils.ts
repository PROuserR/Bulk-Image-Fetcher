/**
 * @module checksumUtils
 * Pure cryptographic SHA-256 manifest generation, `sha256sum -c` formatting/parsing,
 * and local-file completeness verification utilities shared by client & server pipelines.
 */

export interface ChecksumEntry {
  id?: string;
  filename: string;
  relativePath: string;
  sha256: string;
  bytes: number;
  url?: string;
  resolvedVia?: string;
}

export interface LocalFileHashInput {
  filename: string;
  relativePath?: string;
  sha256: string;
  sizeBytes: number;
}

export type ChecksumMatchStatus = 'matched' | 'missing' | 'mismatched';

export interface ChecksumVerificationItem {
  status: ChecksumMatchStatus;
  expected: ChecksumEntry;
  actual?: LocalFileHashInput;
}

export interface ChecksumVerificationReport {
  expectedCount: number;
  verifiedCount: number;
  missingCount: number;
  mismatchedCount: number;
  extraCount: number;
  isComplete: boolean;
  items: ChecksumVerificationItem[];
  missingEntries: ChecksumEntry[];
  mismatchedEntries: ChecksumVerificationItem[];
  extraFiles: LocalFileHashInput[];
}

export type Sha256Input = Blob | ArrayBuffer | ArrayBufferView | string;

/** Normalizes relative paths (converts backslashes, strips leading `./` or `/`). */
export function normalizeChecksumPath(rawPath: string): string {
  return (rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .trim();
}

function getBasename(rawPath: string): string {
  const norm = normalizeChecksumPath(rawPath);
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function toExactUint8Array(data: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return copy;
}

/** Computes a lowercase 64-character hexadecimal SHA-256 digest via Web Crypto API. */
export async function computeSha256Hex(input: Sha256Input): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto SHA-256 API is unavailable in this environment.');
  }

  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof input === 'string') {
    const encoded = new TextEncoder().encode(input);
    bytes = new Uint8Array(encoded.length);
    bytes.set(encoded);
  } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    const ab = await input.arrayBuffer();
    bytes = new Uint8Array(ab);
  } else {
    bytes = toExactUint8Array(input as ArrayBuffer | ArrayBufferView);
  }

  const digest = await subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** Formats a compact truncated SHA-256 preview for UI badges. */
export function formatShortSha256(hex?: string | null, head = 8, tail = 6): string {
  if (!hex) return '';
  const clean = hex.trim().toLowerCase();
  if (clean.length <= head + tail + 1) return clean;
  return `${clean.slice(0, head)}…${clean.slice(-tail)}`;
}

/**
 * Formats entries into standard GNU `sha256sum -c` manifest text (`<64-hex>  <path>`).
 * Comment lines begin with `#` and are ignored by standard `sha256sum -c` tools.
 */
export function formatSha256SumsText(
  entries: ChecksumEntry[],
  headerComments: string[] = []
): string {
  const lines: string[] = [];
  for (const comment of headerComments) {
    const trimmed = comment.replace(/[\r\n]+/g, ' ').trim();
    if (trimmed) {
      lines.push(`# ${trimmed}`);
    }
  }
  if (lines.length > 0 && entries.length > 0) {
    lines.push('');
  }
  for (const entry of entries) {
    const path = normalizeChecksumPath(entry.relativePath || entry.filename);
    if (!entry.sha256 || !path) continue;
    lines.push(`${entry.sha256.toLowerCase()}  ${path}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Formats a `.sha256` sidecar file for a compressed archive (`.7z` / `.zip`),
 * placing the archive's own digest first for `sha256sum -c` plus commented per-image digests.
 */
export function formatArchiveSidecarSha256Text(params: {
  archiveFilename: string;
  archiveSha256: string;
  totalBytes: number;
  expectedImageCount: number;
  entries?: ChecksumEntry[];
}): string {
  const { archiveFilename, archiveSha256, totalBytes, expectedImageCount, entries = [] } = params;
  const lines: string[] = [
    `# Ultimate Image Processor Download Checksum`,
    `# Archive: ${archiveFilename} (${totalBytes} bytes)`,
    `# Images Included: ${entries.length > 0 ? `${entries.length} of ${expectedImageCount}` : expectedImageCount}`,
    `${archiveSha256.toLowerCase()}  ${normalizeChecksumPath(archiveFilename)}`,
  ];

  if (entries.length > 0) {
    lines.push('');
    lines.push('# Per-Image SHA-256 Checksums (extract archive and verify SHA256SUMS.txt):');
    for (const entry of entries) {
      const p = normalizeChecksumPath(entry.relativePath || entry.filename);
      lines.push(`# ${entry.sha256.toLowerCase()}  ${p}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

const SHA256_LINE_RE = /^([a-fA-F0-9]{64})\s+[* ]?(.+)$/;

/** Parses standard `sha256sum` / `SHA256SUMS.txt` content into expected checksum entries. */
export function parseSha256SumsText(text: string): ChecksumEntry[] {
  if (!text) return [];
  const entries: ChecksumEntry[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = SHA256_LINE_RE.exec(trimmed);
    if (!match) continue;
    const sha256 = match[1].toLowerCase();
    const relativePath = normalizeChecksumPath(match[2]);
    if (!relativePath) continue;
    const filename = getBasename(relativePath) || relativePath;
    entries.push({
      id: `manifest-${i}-${filename}`,
      filename,
      relativePath,
      sha256,
      bytes: 0,
    });
  }

  return entries;
}

/**
 * Compares locally selected/downloaded files (pre-hashed in browser or tests)
 * against expected image checksums to detect missing or corrupted files.
 */
export function verifyFilesAgainstChecksums(
  expected: ChecksumEntry[],
  localFiles: LocalFileHashInput[]
): ChecksumVerificationReport {
  const unmatchedLocalIndices = new Set<number>(localFiles.map((_, idx) => idx));

  const consumeLocal = (idx: number): LocalFileHashInput => {
    unmatchedLocalIndices.delete(idx);
    return localFiles[idx];
  };

  // Pre-compute normalized paths for local files
  const normalizedLocals = localFiles.map((file, idx) => {
    const normRel = normalizeChecksumPath(file.relativePath || file.filename);
    // When picking a directory via webkitdirectory, browsers prefix paths with the selected folder name
    // (e.g. "MyFolder/photo.jpg" or "MyFolder/Gallery_A/photo.jpg"). Also track path without root folder.
    const slashIdx = normRel.indexOf('/');
    const strippedTopDir = slashIdx >= 0 ? normRel.slice(slashIdx + 1) : normRel;
    const base = getBasename(normRel);
    return {
      idx,
      normRel,
      strippedTopDir,
      base,
      file,
    };
  });

  const findMatchingLocal = (entry: ChecksumEntry): LocalFileHashInput | undefined => {
    const expRel = normalizeChecksumPath(entry.relativePath || entry.filename);
    const expBase = getBasename(expRel);

    // Pass 1: exact normalized path or path stripped of top webkitdirectory wrapper
    for (const loc of normalizedLocals) {
      if (!unmatchedLocalIndices.has(loc.idx)) continue;
      if (loc.normRel === expRel || loc.strippedTopDir === expRel) {
        return consumeLocal(loc.idx);
      }
    }

    // Pass 2: case-insensitive path match
    const expRelLower = expRel.toLowerCase();
    for (const loc of normalizedLocals) {
      if (!unmatchedLocalIndices.has(loc.idx)) continue;
      if (
        loc.normRel.toLowerCase() === expRelLower ||
        loc.strippedTopDir.toLowerCase() === expRelLower
      ) {
        return consumeLocal(loc.idx);
      }
    }

    // Pass 3: case-insensitive basename fallback (handles flat "Direct Save" folders)
    const expBaseLower = expBase.toLowerCase();
    // Prefer matching hash among same-basename candidates first if duplicates exist
    for (const loc of normalizedLocals) {
      if (!unmatchedLocalIndices.has(loc.idx)) continue;
      if (
        loc.base.toLowerCase() === expBaseLower &&
        loc.file.sha256.toLowerCase() === entry.sha256.toLowerCase()
      ) {
        return consumeLocal(loc.idx);
      }
    }
    for (const loc of normalizedLocals) {
      if (!unmatchedLocalIndices.has(loc.idx)) continue;
      if (loc.base.toLowerCase() === expBaseLower) {
        return consumeLocal(loc.idx);
      }
    }

    return undefined;
  };

  const items: ChecksumVerificationItem[] = [];
  const missingEntries: ChecksumEntry[] = [];
  const mismatchedEntries: ChecksumVerificationItem[] = [];
  let verifiedCount = 0;

  for (const entry of expected) {
    const matchedLocal = findMatchingLocal(entry);
    if (!matchedLocal) {
      const item: ChecksumVerificationItem = { status: 'missing', expected: entry };
      items.push(item);
      missingEntries.push(entry);
      continue;
    }

    if (matchedLocal.sha256.toLowerCase() === entry.sha256.toLowerCase()) {
      items.push({ status: 'matched', expected: entry, actual: matchedLocal });
      verifiedCount++;
    } else {
      const item: ChecksumVerificationItem = {
        status: 'mismatched',
        expected: entry,
        actual: matchedLocal,
      };
      items.push(item);
      mismatchedEntries.push(item);
    }
  }

  const extraFiles: LocalFileHashInput[] = [];
  for (const idx of unmatchedLocalIndices) {
    const f = localFiles[idx];
    // Ignore checksum manifest files themselves when scanning a folder
    if (/^(?:sha256sums\.txt|.*\.sha256)$/i.test(f.filename)) continue;
    extraFiles.push(f);
  }

  const missingCount = missingEntries.length;
  const mismatchedCount = mismatchedEntries.length;
  const expectedCount = expected.length;

  return {
    expectedCount,
    verifiedCount,
    missingCount,
    mismatchedCount,
    extraCount: extraFiles.length,
    isComplete: expectedCount > 0 && missingCount === 0 && mismatchedCount === 0,
    items,
    missingEntries,
    mismatchedEntries,
    extraFiles,
  };
}

/** Builds a sanitized `.sha256` manifest filename from a page title or source URL. */
export function buildChecksumManifestFilename(
  baseName?: string,
  sourceUrl?: string,
  suffix = '_SHA256SUMS.sha256'
): string {
  let candidate = (baseName || '').trim();
  if (!candidate && sourceUrl) {
    try {
      candidate = new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      candidate = '';
    }
  }
  const clean = (candidate || 'images')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);

  return `${clean || 'images'}${suffix}`;
}
