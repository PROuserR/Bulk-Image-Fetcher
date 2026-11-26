/**
 * @module archiveBuilder
 * Server-side archive packager and resumable staging store.
 * Builds either multi-threaded LZMA2 `.7z` archives (via `7zip-bin`) or `STORE`/`DEFLATE` `.zip`
 * archives (via `JSZip`), and temporarily stages built archives on `/tmp` by UUIDv4 token so
 * clients can resume interrupted transfers via HTTP `Range` (`206 Partial Content`).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import JSZip from 'jszip';
import { path7za } from '7zip-bin';
import {
  ArchiveFormat,
  getArchiveContentType,
  normalizeArchiveFormat,
} from '../utils/downloader.ts';

export interface ArchiveEntry {
  /** Relative archive path, e.g. "photo_1.jpg" or "Gallery_A/photo_1.jpg" */
  path: string;
  data: Buffer;
}

export interface BuiltArchiveResult {
  buffer: Buffer;
  format: ArchiveFormat;
  contentType: string;
}

export interface BuildArchiveOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export interface StagedArchiveMetadata {
  token: string;
  filename: string;
  format: ArchiveFormat;
  contentType: string;
  totalBytes: number;
  fileCount: number;
  archiveSha256?: string;
  createdAt: number;
}

let ensureExecutablePromise: Promise<void> | null = null;

async function ensure7zaExecutable(): Promise<string> {
  if (!ensureExecutablePromise) {
    ensureExecutablePromise = (async () => {
      try {
        await fs.promises.chmod(path7za, 0o755);
      } catch {
        // Ignore if filesystem is read-only and binary already has +x
      }
    })();
  }
  await ensureExecutablePromise;
  return path7za;
}

function sanitizeArchiveRelativePath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized
    .split('/')
    .map((segment) => segment.replace(/[<>:"|?*\x00-\x1f]/g, '_').trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  return parts.length > 0 ? parts.join('/') : 'image.jpg';
}

const ALREADY_COMPRESSED_EXT = /\.(?:jpe?g|png|webp|avif|gif|heic|mp4|webm|7z|zip)$/i;

function run7zaWithProgress(
  bin7za: string,
  args: string[],
  cwd: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Archive compression cancelled'));
      return;
    }

    const child = spawn(bin7za, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastPct = -1;
    let stderrText = '';
    let settled = false;

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGKILL');
        reject(new Error('7-Zip compression timed out'));
      }
    }, 120000);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutTimer);
        child.kill('SIGKILL');
        reject(new Error('Archive compression cancelled'));
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const parseChunk = (chunk: Buffer | string) => {
      const text = chunk.toString();
      const matches = text.match(/(\d{1,3})%/g);
      if (matches && onProgress) {
        for (const m of matches) {
          const pct = Math.min(100, Math.max(0, parseInt(m, 10)));
          if (!Number.isNaN(pct) && pct > lastPct) {
            lastPct = pct;
            onProgress(pct);
          }
        }
      }
    };

    child.stdout?.on('data', parseChunk);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString();
      if (stderrText.length > 4096) stderrText = stderrText.slice(-4096);
      parseChunk(chunk);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) {
        if (lastPct < 100) onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`7za exited with code ${code}: ${stderrText.trim() || 'Unknown error'}`));
      }
    });
  });
}

/**
 * Packages binary entries into either a multi-threaded LZMA2 `.7z` archive
 * (via native 7-Zip static binary) or a fast `.zip` archive (via JSZip).
 */
export async function buildCompressedArchive(
  entries: ArchiveEntry[],
  requestedFormat: ArchiveFormat = '7z',
  options: BuildArchiveOptions = {}
): Promise<BuiltArchiveResult> {
  const format = normalizeArchiveFormat(requestedFormat);
  const contentType = getArchiveContentType(format);

  if (entries.length === 0) {
    throw new Error('Cannot build an empty archive.');
  }
  if (options.signal?.aborted) {
    throw new Error('Archive compression cancelled');
  }

  options.onProgress?.(0);

  if (format === 'zip') {
    const zip = new JSZip();
    for (const entry of entries) {
      const safePath = sanitizeArchiveRelativePath(entry.path);
      const useStore = ALREADY_COMPRESSED_EXT.test(safePath);
      zip.file(safePath, entry.data, {
        compression: useStore ? 'STORE' : 'DEFLATE',
        compressionOptions: useStore ? undefined : { level: 3 },
      });
    }
    let lastPct = -1;
    const buffer = await zip.generateAsync({ type: 'nodebuffer' }, (metadata) => {
      const pct = Math.min(100, Math.max(0, Math.round(metadata.percent)));
      if (pct > lastPct) {
        lastPct = pct;
        options.onProgress?.(pct);
      }
    });
    if (lastPct < 100) options.onProgress?.(100);
    return { buffer, format: 'zip', contentType };
  }

  const bin7za = await ensure7zaExecutable();
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fullres-7z-'));
  const stagingDir = path.join(workDir, 'staging');
  const outArchivePath = path.join(workDir, 'output.7z');

  try {
    await fs.promises.mkdir(stagingDir, { recursive: true });

    const createdDirs = new Set<string>([stagingDir]);
    for (const entry of entries) {
      const safeRel = sanitizeArchiveRelativePath(entry.path);
      const targetPath = path.resolve(stagingDir, safeRel);
      if (!targetPath.startsWith(`${stagingDir}${path.sep}`)) {
        throw new Error(`Invalid archive path rejected: ${entry.path}`);
      }
      const parentDir = path.dirname(targetPath);
      if (!createdDirs.has(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
        createdDirs.add(parentDir);
      }
      await fs.promises.writeFile(targetPath, entry.data);
    }

    // Use native multi-threaded LZMA2 solid 7z compression with stdout progress (-bsp1)
    await run7zaWithProgress(
      bin7za,
      ['a', '-t7z', '-m0=lzma2', '-mx=3', '-mmt=on', '-ms=on', '-bsp1', '-y', outArchivePath, '.'],
      stagingDir,
      options.onProgress,
      options.signal
    );

    const buffer = await fs.promises.readFile(outArchivePath);
    return { buffer, format: '7z', contentType };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const STAGED_ARCHIVE_DIR = path.join(os.tmpdir(), 'fullres-staged-archives');
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGED_ARCHIVE_TTL_MS = 15 * 60 * 1000;

async function pruneExpiredStagedArchives(): Promise<void> {
  try {
    const files = await fs.promises.readdir(STAGED_ARCHIVE_DIR);
    const now = Date.now();
    await Promise.all(
      files.map(async (name) => {
        const full = path.join(STAGED_ARCHIVE_DIR, name);
        const stat = await fs.promises.stat(full).catch(() => null);
        if (stat && now - stat.mtimeMs > STAGED_ARCHIVE_TTL_MS) {
          await fs.promises.unlink(full).catch(() => {});
        }
      })
    );
  } catch {
    // Directory may not exist yet
  }
}

/** Persists a built archive buffer in `/tmp` under a random UUIDv4 token for 15 minutes. */
export async function saveStagedArchive(
  buffer: Buffer,
  meta: Omit<StagedArchiveMetadata, 'token' | 'totalBytes' | 'createdAt'>
): Promise<StagedArchiveMetadata> {
  await fs.promises.mkdir(STAGED_ARCHIVE_DIR, { recursive: true });
  void pruneExpiredStagedArchives();

  const token = crypto.randomUUID();
  const fullMeta: StagedArchiveMetadata = {
    ...meta,
    token,
    totalBytes: buffer.length,
    createdAt: Date.now(),
  };

  const binPath = path.join(STAGED_ARCHIVE_DIR, `${token}.bin`);
  const metaPath = path.join(STAGED_ARCHIVE_DIR, `${token}.meta.json`);
  await Promise.all([
    fs.promises.writeFile(binPath, buffer),
    fs.promises.writeFile(metaPath, JSON.stringify(fullMeta), 'utf8'),
  ]);
  return fullMeta;
}

/** Reads a staged archive and its metadata without deleting it (used for HTTP Range resumes). */
export async function readStagedArchive(
  token: string
): Promise<{ buffer: Buffer; meta: StagedArchiveMetadata } | null> {
  if (!UUID_V4_RE.test(token)) {
    return null;
  }
  const binPath = path.join(STAGED_ARCHIVE_DIR, `${token}.bin`);
  const metaPath = path.join(STAGED_ARCHIVE_DIR, `${token}.meta.json`);

  try {
    const [metaRaw, buffer] = await Promise.all([
      fs.promises.readFile(metaPath, 'utf8'),
      fs.promises.readFile(binPath),
    ]);
    const meta = JSON.parse(metaRaw) as StagedArchiveMetadata;
    return { buffer, meta };
  } catch {
    return null;
  }
}

/** Deletes a staged archive binary and metadata pair from `/tmp`. */
export async function deleteStagedArchive(token: string): Promise<void> {
  if (!UUID_V4_RE.test(token)) return;
  const binPath = path.join(STAGED_ARCHIVE_DIR, `${token}.bin`);
  const metaPath = path.join(STAGED_ARCHIVE_DIR, `${token}.meta.json`);
  await Promise.all([
    fs.promises.unlink(binPath).catch(() => {}),
    fs.promises.unlink(metaPath).catch(() => {}),
  ]);
}

/** Reads a staged archive once and immediately deletes the temporary files on completion. */
export async function consumeStagedArchive(
  token: string
): Promise<{ buffer: Buffer; meta: StagedArchiveMetadata } | null> {
  try {
    return await readStagedArchive(token);
  } finally {
    await deleteStagedArchive(token);
  }
}


