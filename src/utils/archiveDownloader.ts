/**
 * @module archiveDownloader
 * Client-side orchestrator for compressed `.7z` (LZMA2) and `.zip` archive downloads.
 * Streams real-time server progress via NDJSON (`POST /api/download-zip`), supports
 * byte-level pause/resume via HTTP `Range` (`206 Partial Content`) over staged tokens,
 * and falls back seamlessly to in-browser `JSZip` packaging if the server route is blocked.
 */
import JSZip from 'jszip';
import {
  ArchiveFormat,
  buildArchiveFilename,
  normalizeArchiveFormat,
  triggerBlobDownload,
} from './downloader';
import {
  fetchImageBlobWithFallbacks,
  formatBytes,
  isCacheResolvedVia,
  type FetchLike,
} from './progressiveDownloader';
import { countReusableBrowserImages } from './clientImageCache';
import { sanitizeGalleryFolderName } from './nestedGalleryLogic';
import {
  computeSha256Hex,
  formatSha256SumsText,
  type ChecksumEntry,
} from './checksumUtils';
import type { ScrapedImage } from './scraperLogic';

export type ArchiveDownloadStage =
  | 'connecting'
  | 'fetching'
  | 'compressing'
  | 'downloading'
  | 'paused'
  | 'complete'
  | 'error'
  | 'cancelled';

/** Snapshot captured when a transfer is paused so downloading can resume via HTTP `Range`. */
export interface ResumableArchiveState {
  token?: string;
  filename: string;
  format: ArchiveFormat;
  contentType: string;
  totalBytes?: number;
  bytesLoaded: number;
  fileCount: number;
  receivedChunks: Uint8Array<ArrayBuffer>[];
  percent: number;
  fetchedImages: number;
  validImages: number;
  totalImages: number;
  archiveSha256?: string;
  checksumEntries?: ChecksumEntry[];
}

export interface ArchiveDownloadProgress {
  format: ArchiveFormat;
  filename: string;
  stage: ArchiveDownloadStage;
  percent: number;
  fetchedImages: number;
  validImages: number;
  totalImages: number;
  bytesLoaded: number;
  bytesTotal?: number;
  message: string;
  isRunning: boolean;
  isPaused?: boolean;
  isFallback?: boolean;
  usedBrowserCache?: boolean;
  reusedFromCacheCount?: number;
  archiveSha256?: string;
  checksumEntries?: ChecksumEntry[];
  skippedCount?: number;
  error?: string | null;
}

export interface DownloadCompressedArchiveOptions {
  images: ScrapedImage[];
  pageTitle?: string;
  sourceUrl?: string;
  relayUrl?: string;
  format?: ArchiveFormat;
  onlyFullRes?: boolean;
  signal?: AbortSignal;
  fetchFn?: FetchLike;
  saveBlobFn?: (blob: Blob, filename: string) => void;
  resumeState?: ResumableArchiveState | null;
  onPauseSnapshot?: (snapshot: ResumableArchiveState) => void;
  onProgress?: (progress: ArchiveDownloadProgress) => void;
}

export interface ArchiveDownloadResult {
  success: boolean;
  paused?: boolean;
  cancelled?: boolean;
  filename: string;
  format: ArchiveFormat;
  fileCount: number;
  totalBytes: number;
  usedFallback?: boolean;
  usedBrowserCache?: boolean;
  reusedFromCacheCount?: number;
  archiveSha256?: string;
  checksumEntries?: ChecksumEntry[];
  skippedCount?: number;
  error?: string;
}

/** Maps byte transfer progress onto a bounded percentage band (defaults to 85–100%). */
export function computeTransferProgressPercent(
  receivedBytes: number,
  totalBytes?: number,
  startPct = 85,
  endPct = 100
): number {
  if (!totalBytes || totalBytes <= 0) {
    return Math.min(endPct - 1, startPct + 5);
  }
  const ratio = Math.min(1, Math.max(0, receivedBytes / totalBytes));
  return Math.min(endPct, Math.max(startPct, Math.round(startPct + ratio * (endPct - startPct))));
}

/** Splits an NDJSON chunk buffer into parsed JSON event objects plus trailing incomplete text. */
export function parseNdjsonBuffer(
  buffer: string
): { events: Record<string, any>[]; remainder: string } {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  const events: Record<string, any>[] = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        events.push(parsed as Record<string, any>);
      }
    } catch {
      // Ignore partial or malformed line
    }
  }
  return { events, remainder };
}

/** Formats a compact status summary string for the sticky archive download progress bar. */
export function formatArchiveStatusLine(progress: ArchiveDownloadProgress): string {
  const fmt = progress.format.toUpperCase();
  if (progress.stage === 'paused') {
    return `Paused .${fmt} at ${progress.percent}%`;
  }
  if (progress.stage === 'cancelled') {
    return `Cancelled .${fmt} (${progress.percent}%)`;
  }
  if (progress.stage === 'error') {
    return `Failed .${fmt} (${progress.percent}%)`;
  }
  if (progress.stage === 'complete') {
    return `100% · Downloaded .${fmt}`;
  }
  return `${progress.percent}% · ${progress.message}`;
}

/** Best-effort server cleanup of a staged archive token after cancellation or completion. */
export function cleanupStagedArchiveToken(token?: string): void {
  if (!token) return;
  void fetch(`/api/download-zip?token=${encodeURIComponent(token)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

async function readResponseWithDownloadProgress(
  response: Response,
  contentType: string,
  expectedBytes: number | undefined,
  onChunk: (receivedBytes: number, totalBytes: number | undefined) => void,
  existingChunks: Uint8Array<ArrayBuffer>[] = [],
  startingOffset = 0
): Promise<{
  blob: Blob;
  chunks: Uint8Array<ArrayBuffer>[];
  received: number;
  totalBytes: number | undefined;
}> {
  const contentRangeHeader = response.headers.get('content-range');
  let rangeTotal: number | undefined;
  if (contentRangeHeader) {
    const match = /\/(\d+)$/.exec(contentRangeHeader.trim());
    if (match) {
      rangeTotal = parseInt(match[1], 10);
    }
  }

  const headerLenRaw = response.headers.get('content-length');
  const headerLen = headerLenRaw ? parseInt(headerLenRaw, 10) : NaN;
  const totalBytes =
    rangeTotal && rangeTotal > 0
      ? rangeTotal
      : !Number.isNaN(headerLen) && headerLen > 0
        ? (response.status === 206 ? startingOffset + headerLen : headerLen)
        : expectedBytes && expectedBytes > 0
          ? expectedBytes
          : undefined;

  const chunks: Uint8Array<ArrayBuffer>[] =
    response.status === 206 ? [...existingChunks] : [];
  let received = response.status === 206 ? startingOffset : 0;

  if (!response.body) {
    const blob = await response.blob();
    const arr = new Uint8Array(await blob.arrayBuffer());
    chunks.push(arr);
    received += arr.byteLength;
    onChunk(received, totalBytes || received);
    return {
      blob: new Blob(chunks, { type: contentType }),
      chunks,
      received,
      totalBytes: totalBytes || received,
    };
  }

  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(new Uint8Array(value));
      received += value.byteLength;
      onChunk(received, totalBytes);
    }
  }

  onChunk(received, totalBytes || received);
  return {
    blob: new Blob(chunks, { type: contentType }),
    chunks,
    received,
    totalBytes: totalBytes || received,
  };
}

/**
 * Executes or resumes a compressed `.7z`/`.zip` download with live stage & byte progress,
 * pausing cleanly via `AbortController` (`signal.abort('PAUSED')`) and falling back to
 * in-browser `JSZip` packaging when server egress is blocked.
 */
export async function downloadCompressedArchiveWithProgress(
  options: DownloadCompressedArchiveOptions
): Promise<ArchiveDownloadResult> {
  const {
    images,
    pageTitle,
    sourceUrl = '',
    relayUrl = '',
    onlyFullRes = true,
    signal,
    fetchFn,
    saveBlobFn,
    resumeState,
    onPauseSnapshot,
    onProgress,
  } = options;

  const format = normalizeArchiveFormat(options.format);
  const formatUpper = format.toUpperCase();
  const archiveFilename = resumeState?.filename || buildArchiveFilename(pageTitle, sourceUrl, format);

  const isPausedSignal = () => Boolean(signal?.aborted && signal.reason === 'PAUSED');

  let latestProgress: ArchiveDownloadProgress = {
    format,
    filename: archiveFilename,
    stage: 'connecting',
    percent: resumeState?.percent ?? 0,
    fetchedImages: resumeState?.fetchedImages ?? 0,
    validImages: resumeState?.validImages ?? 0,
    totalImages: images.length,
    bytesLoaded: resumeState?.bytesLoaded ?? 0,
    bytesTotal: resumeState?.totalBytes,
    message: `Connecting to server .${formatUpper} packager...`,
    isRunning: true,
    isPaused: false,
  };

  const emit = (patch: Partial<ArchiveDownloadProgress>) => {
    latestProgress = {
      ...latestProgress,
      ...patch,
    };
    onProgress?.(latestProgress);
    return latestProgress;
  };

  if (images.length === 0) {
    const errMsg = 'No images selected for archive download.';
    emit({ stage: 'error', percent: 0, isRunning: false, message: errMsg, error: errMsg });
    return {
      success: false,
      filename: archiveFilename,
      format,
      fileCount: 0,
      totalBytes: 0,
      error: errMsg,
    };
  }

  let readyPayload: {
    token: string;
    filename: string;
    contentType: string;
    totalBytes: number;
    fileCount: number;
    format: ArchiveFormat;
    archiveSha256?: string;
    checksumEntries?: ChecksumEntry[];
    skippedCount?: number;
  } | null = null;

  let transferChunks: Uint8Array<ArrayBuffer>[] = [];
  let transferBytesLoaded = 0;

  // Check if we can resume directly at HTTP Range download phase
  if (resumeState?.token) {
    readyPayload = {
      token: resumeState.token,
      filename: resumeState.filename,
      contentType: resumeState.contentType,
      totalBytes: resumeState.totalBytes || 0,
      fileCount: resumeState.fileCount,
      format: resumeState.format,
      archiveSha256: resumeState.archiveSha256,
      checksumEntries: resumeState.checksumEntries,
    };
    transferChunks = [...(resumeState.receivedChunks || [])];
    transferBytesLoaded = resumeState.bytesLoaded || 0;
  }

  let serverError: string | null = null;
  const cacheStats =
    !readyPayload && format === 'zip' ? countReusableBrowserImages(images) : null;
  const shouldPackageLocallyFromCache = Boolean(cacheStats && cacheStats.reusableCount > 0);

  // Phase 1 & 2: Server streaming NDJSON (skipped when resuming token or packaging browser-cached .ZIP!)
  if (!readyPayload && !shouldPackageLocallyFromCache) {
    emit({
      stage: 'connecting',
      percent: Math.max(1, resumeState?.percent ?? 1),
      message: `Connecting to server .${formatUpper} packager...`,
      isPaused: false,
      isRunning: true,
    });

    try {
      const streamController = new AbortController();
      const timeoutId = setTimeout(() => streamController.abort(new Error('Server timed out')), 120000);
      const onOuterAbort = () => streamController.abort(signal?.reason);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeoutId);
          throw new DOMException('Aborted', 'AbortError');
        }
        signal.addEventListener('abort', onOuterAbort, { once: true });
      }

      try {
        const response = await fetch('/api/download-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: images.map((img) => ({
              url: img.fullUrl,
              fallbackUrl: img.fallbackUrl,
              linkedPageUrl: img.linkedPageUrl,
              filename: img.filename,
              galleryTitle: img.galleryTitle,
              galleryId: img.galleryId,
            })),
            archiveName: pageTitle,
            referer: sourceUrl,
            relayUrl: relayUrl.trim() || undefined,
            format,
            onlyFullRes,
            streamProgress: true,
          }),
          signal: streamController.signal,
        });

        const contentType = (response.headers.get('content-type') || '').toLowerCase();

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          throw new Error(errData?.error || `Server returned HTTP ${response.status}`);
        }

        if (contentType.includes('application/x-ndjson') && response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = '';

          const handleEvent = (evt: Record<string, any>) => {
            if (evt.stage === 'fetching') {
              const fetched = Number(evt.fetchedCount || 0);
              const valid = Number(evt.validCount || 0);
              const total = Number(evt.totalCount || images.length);
              const bytesFetched = Number(evt.bytesFetched || 0);
              const pct = Number(evt.percent || 2);
              emit({
                stage: 'fetching',
                percent: pct,
                fetchedImages: fetched,
                validImages: valid,
                totalImages: total,
                bytesLoaded: bytesFetched,
                message: `Fetching images (${fetched}/${total})${bytesFetched > 0 ? ` · ${formatBytes(bytesFetched)}` : ''}`,
              });
            } else if (evt.stage === 'compressing') {
              const compPct = Number(evt.compressPercent || 0);
              const pct = Number(evt.percent || 60);
              const valid = Number(evt.validCount || images.length);
              emit({
                stage: 'compressing',
                percent: pct,
                fetchedImages: Number(evt.totalCount || images.length),
                validImages: valid,
                message:
                  format === '7z'
                    ? `Compressing .7Z LZMA2 (${compPct}%)`
                    : `Compressing .ZIP (${compPct}%)`,
              });
            } else if (evt.stage === 'ready') {
              readyPayload = {
                token: String(evt.token),
                filename: String(evt.filename || archiveFilename),
                contentType: String(evt.contentType || 'application/octet-stream'),
                totalBytes: Number(evt.totalBytes || 0),
                fileCount: Number(evt.fileCount || images.length),
                format: normalizeArchiveFormat(evt.format || format),
                archiveSha256:
                  typeof evt.archiveSha256 === 'string' ? evt.archiveSha256 : undefined,
                checksumEntries: Array.isArray(evt.checksumEntries)
                  ? (evt.checksumEntries as ChecksumEntry[])
                  : undefined,
                skippedCount:
                  typeof evt.skippedCount === 'number' ? evt.skippedCount : undefined,
              };
              emit({
                stage: 'downloading',
                filename: readyPayload.filename,
                percent: 85,
                fetchedImages: images.length,
                validImages: readyPayload.fileCount,
                bytesLoaded: 0,
                bytesTotal: readyPayload.totalBytes,
                archiveSha256: readyPayload.archiveSha256,
                checksumEntries: readyPayload.checksumEntries,
                skippedCount: readyPayload.skippedCount,
                message: `Starting .${formatUpper} download (${formatBytes(readyPayload.totalBytes)})...`,
              });
            } else if (evt.stage === 'error') {
              serverError = String(evt.error || 'Archive creation failed on server');
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (value) {
              lineBuffer += decoder.decode(value, { stream: true });
              const { events, remainder } = parseNdjsonBuffer(lineBuffer);
              lineBuffer = remainder;
              for (const evt of events) {
                handleEvent(evt);
              }
            }
            if (done) {
              lineBuffer += decoder.decode();
              if (lineBuffer.trim()) {
                const { events } = parseNdjsonBuffer(`${lineBuffer}\n`);
                for (const evt of events) {
                  handleEvent(evt);
                }
              }
              break;
            }
          }
        } else {
          // Fallback if proxy/server returned direct binary blob directly
          const resData = await readResponseWithDownloadProgress(
            response,
            contentType || 'application/octet-stream',
            undefined,
            (received, total) => {
              const pct = computeTransferProgressPercent(received, total, 50, 99);
              emit({
                stage: 'downloading',
                percent: pct,
                bytesLoaded: received,
                bytesTotal: total,
                message: total
                  ? `Downloading .${formatUpper} (${formatBytes(received)} / ${formatBytes(total)})`
                  : `Downloading .${formatUpper} (${formatBytes(received)})`,
              });
            }
          );
          if (resData.blob.size > 0) {
            const archiveSha256 =
              response.headers.get('x-archive-sha256') ||
              (await computeSha256Hex(resData.blob).catch(() => undefined));
            triggerBlobDownload(resData.blob, archiveFilename);
            emit({
              stage: 'complete',
              percent: 100,
              fetchedImages: images.length,
              validImages: images.length,
              bytesLoaded: resData.blob.size,
              bytesTotal: resData.blob.size,
              archiveSha256,
              isRunning: false,
              isPaused: false,
              message: `Downloaded ${archiveFilename} (${formatBytes(resData.blob.size)})`,
            });
            return {
              success: true,
              filename: archiveFilename,
              format,
              fileCount: images.length,
              totalBytes: resData.blob.size,
              archiveSha256,
            };
          }
        }
      } finally {
        clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', onOuterAbort);
        }
      }
    } catch (err: any) {
      if (isPausedSignal()) {
        onPauseSnapshot?.({
          filename: archiveFilename,
          format,
          contentType: format === '7z' ? 'application/x-7z-compressed' : 'application/zip',
          bytesLoaded: latestProgress.bytesLoaded,
          totalBytes: latestProgress.bytesTotal,
          fileCount: latestProgress.validImages,
          receivedChunks: [],
          percent: latestProgress.percent,
          fetchedImages: latestProgress.fetchedImages,
          validImages: latestProgress.validImages,
          totalImages: images.length,
        });
        emit({
          stage: 'paused',
          isRunning: false,
          isPaused: true,
          message: `Paused at ${latestProgress.percent}% · Ready to resume later`,
        });
        return {
          success: false,
          paused: true,
          filename: archiveFilename,
          format,
          fileCount: 0,
          totalBytes: 0,
        };
      }
      if (signal?.aborted || err?.name === 'AbortError') {
        emit({
          stage: 'cancelled',
          isRunning: false,
          isPaused: false,
          message: 'Archive download cancelled',
        });
        return {
          success: false,
          cancelled: true,
          filename: archiveFilename,
          format,
          fileCount: 0,
          totalBytes: 0,
        };
      }
      serverError = err?.message || 'Server compression stream interrupted';
    }
  }

  // Phase 3: Download staged file with real byte-transfer progress & Range 206 resumption (85% -> 100%)
  if (readyPayload) {
    let activeChunkBuffer: Uint8Array<ArrayBuffer>[] = [...transferChunks];
    let currentReceived = transferBytesLoaded;

    try {
      const fetchHeaders: Record<string, string> = {};
      if (transferBytesLoaded > 0 && activeChunkBuffer.length > 0) {
        fetchHeaders['Range'] = `bytes=${transferBytesLoaded}-`;
      }

      const fileResp = await fetch(
        `/api/download-zip?token=${encodeURIComponent(readyPayload.token)}&resumable=1`,
        { signal, headers: fetchHeaders }
      );

      if (fileResp.status === 404 || fileResp.status === 410 || fileResp.status === 416) {
        // Staged token expired on server (e.g. after long pause or restart) — cleanly rebuild
        if (resumeState?.token) {
          return downloadCompressedArchiveWithProgress({
            ...options,
            resumeState: null,
          });
        }
        throw new Error(`Download token expired (HTTP ${fileResp.status})`);
      }

      if (!fileResp.ok && fileResp.status !== 206) {
        throw new Error(`Download failed (HTTP ${fileResp.status})`);
      }

      const contentRangeHeader = fileResp.headers.get('content-range');
      let rangeTotal: number | undefined;
      if (contentRangeHeader) {
        const m = /\/(\d+)$/.exec(contentRangeHeader.trim());
        if (m) rangeTotal = parseInt(m[1], 10);
      }
      const headerLenRaw = fileResp.headers.get('content-length');
      const headerLen = headerLenRaw ? parseInt(headerLenRaw, 10) : NaN;
      const totalBytes =
        rangeTotal && rangeTotal > 0
          ? rangeTotal
          : !Number.isNaN(headerLen) && headerLen > 0
            ? fileResp.status === 206
              ? transferBytesLoaded + headerLen
              : headerLen
            : readyPayload.totalBytes || undefined;

      if (fileResp.status !== 206) {
        activeChunkBuffer = [];
        currentReceived = 0;
      }

      if (!fileResp.body) {
        const blob = await fileResp.blob();
        const arr = new Uint8Array(await blob.arrayBuffer());
        activeChunkBuffer.push(arr);
        currentReceived += arr.byteLength;
      } else {
        const reader = fileResp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            activeChunkBuffer.push(new Uint8Array(value));
            currentReceived += value.byteLength;
            const pct = computeTransferProgressPercent(currentReceived, totalBytes, 85, 100);
            emit({
              stage: 'downloading',
              filename: readyPayload.filename,
              percent: pct,
              fetchedImages: images.length,
              validImages: readyPayload.fileCount,
              bytesLoaded: currentReceived,
              bytesTotal: totalBytes,
              isPaused: false,
              message: totalBytes
                ? `Downloading .${formatUpper} (${formatBytes(currentReceived)} / ${formatBytes(totalBytes)})`
                : `Downloading .${formatUpper} (${formatBytes(currentReceived)})`,
            });
          }
        }
      }

      const finalBlob = new Blob(activeChunkBuffer, { type: readyPayload.contentType });
      if (finalBlob.size > 0) {
        const computedArchiveSha =
          readyPayload.archiveSha256 ||
          fileResp.headers.get('x-archive-sha256') ||
          (await computeSha256Hex(finalBlob).catch(() => undefined));
        triggerBlobDownload(finalBlob, readyPayload.filename);
        cleanupStagedArchiveToken(readyPayload.token);
        emit({
          stage: 'complete',
          filename: readyPayload.filename,
          percent: 100,
          fetchedImages: images.length,
          validImages: readyPayload.fileCount,
          bytesLoaded: finalBlob.size,
          bytesTotal: finalBlob.size,
          archiveSha256: computedArchiveSha,
          checksumEntries: readyPayload.checksumEntries,
          skippedCount: readyPayload.skippedCount ?? Math.max(0, images.length - readyPayload.fileCount),
          isRunning: false,
          isPaused: false,
          message: `Downloaded ${readyPayload.filename} (${formatBytes(finalBlob.size)})`,
        });
        return {
          success: true,
          filename: readyPayload.filename,
          format: readyPayload.format,
          fileCount: readyPayload.fileCount,
          totalBytes: finalBlob.size,
          archiveSha256: computedArchiveSha,
          checksumEntries: readyPayload.checksumEntries,
          skippedCount: readyPayload.skippedCount ?? Math.max(0, images.length - readyPayload.fileCount),
        };
      }
      throw new Error('Downloaded archive file was empty');
    } catch (downloadErr: any) {
      if (isPausedSignal()) {
        const pausedPct = computeTransferProgressPercent(
          currentReceived,
          readyPayload.totalBytes,
          85,
          99
        );
        onPauseSnapshot?.({
          token: readyPayload.token,
          filename: readyPayload.filename,
          format: readyPayload.format,
          contentType: readyPayload.contentType,
          totalBytes: readyPayload.totalBytes,
          bytesLoaded: currentReceived,
          fileCount: readyPayload.fileCount,
          receivedChunks: activeChunkBuffer,
          percent: pausedPct,
          fetchedImages: images.length,
          validImages: readyPayload.fileCount,
          totalImages: images.length,
          archiveSha256: readyPayload.archiveSha256,
          checksumEntries: readyPayload.checksumEntries,
        });
        emit({
          stage: 'paused',
          filename: readyPayload.filename,
          percent: pausedPct,
          bytesLoaded: currentReceived,
          bytesTotal: readyPayload.totalBytes,
          isRunning: false,
          isPaused: true,
          message: readyPayload.totalBytes
            ? `Paused at ${pausedPct}% (${formatBytes(currentReceived)} / ${formatBytes(readyPayload.totalBytes)})`
            : `Paused at ${pausedPct}%`,
        });
        return {
          success: false,
          paused: true,
          filename: readyPayload.filename,
          format: readyPayload.format,
          fileCount: readyPayload.fileCount,
          totalBytes: currentReceived,
        };
      }
      if (signal?.aborted || downloadErr?.name === 'AbortError') {
        cleanupStagedArchiveToken(readyPayload.token);
        emit({
          stage: 'cancelled',
          isRunning: false,
          isPaused: false,
          message: 'Archive download cancelled',
        });
        return {
          success: false,
          cancelled: true,
          filename: readyPayload.filename,
          format,
          fileCount: 0,
          totalBytes: 0,
        };
      }
      serverError = downloadErr?.message || 'Transfer interrupted';
    }
  }

  // Fallback: In-browser ZIP packaging with granular fetch + JSZip progress (0% -> 100%)
  if (isPausedSignal()) {
    onPauseSnapshot?.({
      filename: archiveFilename,
      format,
      contentType: format === '7z' ? 'application/x-7z-compressed' : 'application/zip',
      bytesLoaded: latestProgress.bytesLoaded,
      totalBytes: latestProgress.bytesTotal,
      fileCount: latestProgress.validImages,
      receivedChunks: [],
      percent: latestProgress.percent,
      fetchedImages: latestProgress.fetchedImages,
      validImages: latestProgress.validImages,
      totalImages: images.length,
    });
    emit({
      stage: 'paused',
      isRunning: false,
      isPaused: true,
      message: `Paused at ${latestProgress.percent}% · Ready to resume later`,
    });
    return {
      success: false,
      paused: true,
      filename: archiveFilename,
      format,
      fileCount: 0,
      totalBytes: 0,
    };
  }

  if (signal?.aborted) {
    emit({ stage: 'cancelled', isRunning: false, isPaused: false, message: 'Archive download cancelled' });
    return {
      success: false,
      cancelled: true,
      filename: archiveFilename,
      format,
      fileCount: 0,
      totalBytes: 0,
    };
  }

  const fallbackFilename = buildArchiveFilename(pageTitle, sourceUrl, 'zip');
  const isCacheFirstZip = shouldPackageLocallyFromCache;
  try {
    emit({
      format: 'zip',
      filename: fallbackFilename,
      stage: 'fetching',
      percent: 2,
      isFallback: !isCacheFirstZip,
      usedBrowserCache: isCacheFirstZip,
      reusedFromCacheCount: 0,
      message: isCacheFirstZip
        ? `Reusing ${cacheStats?.reusableCount ?? 0}/${images.length} loaded webpage images for .ZIP...`
        : serverError
          ? `Switching to browser .ZIP fallback (0/${images.length})...`
          : `Fetching images in browser (0/${images.length})...`,
    });

    const clientZip = new JSZip();
    const seenByFolder = new Map<string, Set<string>>();
    let addedCount = 0;
    let bytesFetched = 0;
    let reusedFromCacheCount = 0;

    const resolvedPaths = images.map((img, overallIdx) => {
      const folderKey = img.galleryTitle
        ? sanitizeGalleryFolderName(img.galleryTitle, img.galleryId || 'gallery')
        : '';
      let seenNames = seenByFolder.get(folderKey);
      if (!seenNames) {
        seenNames = new Set<string>();
        seenByFolder.set(folderKey, seenNames);
      }

      const filename = img.filename || `image_${overallIdx + 1}.jpg`;
      const lastDot = filename.lastIndexOf('.');
      const ext = lastDot !== -1 ? filename.slice(lastDot) : '.jpg';
      const base = lastDot !== -1 ? filename.slice(0, lastDot) : filename;
      let uniqueName = filename;
      let counter = 1;
      while (seenNames.has(uniqueName)) {
        uniqueName = `${base}_${counter}${ext}`;
        counter++;
      }
      seenNames.add(uniqueName);
      return {
        img,
        uniqueName,
        zipEntryPath: folderKey ? `${folderKey}/${uniqueName}` : uniqueName,
      };
    });

    let cursor = 0;
    let completed = 0;
    const workerCount = Math.min(6, resolvedPaths.length);
    const checksumByIndex: Array<ChecksumEntry | null> = new Array(resolvedPaths.length).fill(null);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (!signal?.aborted) {
          const idx = cursor++;
          if (idx >= resolvedPaths.length) break;
          const { img, uniqueName, zipEntryPath } = resolvedPaths[idx];

          const { blob: imageBlob, resolvedVia } = await fetchImageBlobWithFallbacks(
            {
              id: img.id || `zip-${idx}`,
              url: img.fullUrl,
              filename: uniqueName,
              fallbackUrl: img.fallbackUrl,
              linkedPageUrl: img.linkedPageUrl,
              referer: sourceUrl,
              relayUrl: relayUrl.trim() || undefined,
            },
            {
              fetchFn,
              timeoutMs: 12000,
              signal,
              useCache: true,
            }
          );

          if (imageBlob && imageBlob.size > 0) {
            const sha256 = await computeSha256Hex(imageBlob).catch(() => '');
            clientZip.file(zipEntryPath, imageBlob, { compression: 'STORE' });
            if (sha256) {
              checksumByIndex[idx] = {
                id: img.id,
                filename: uniqueName,
                relativePath: zipEntryPath,
                sha256,
                bytes: imageBlob.size,
                url: img.fullUrl,
                resolvedVia,
              };
            }
            addedCount++;
            bytesFetched += imageBlob.size;
            if (isCacheResolvedVia(resolvedVia)) {
              reusedFromCacheCount++;
            }
          }
          completed++;
          const fetchPct = Math.min(70, Math.max(2, Math.round(2 + (completed / resolvedPaths.length) * 68)));
          emit({
            format: 'zip',
            filename: fallbackFilename,
            stage: 'fetching',
            percent: fetchPct,
            fetchedImages: completed,
            validImages: addedCount,
            bytesLoaded: bytesFetched,
            isFallback: !isCacheFirstZip,
            usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
            reusedFromCacheCount,
            message: isCacheFirstZip
              ? `Reading webpage data (${completed}/${resolvedPaths.length} · ${reusedFromCacheCount} cached · ${formatBytes(bytesFetched)})`
              : `Browser fallback: fetching ${completed}/${resolvedPaths.length} (${formatBytes(bytesFetched)})`,
          });
        }
      })
    );

    if (isPausedSignal()) {
      onPauseSnapshot?.({
        filename: fallbackFilename,
        format: 'zip',
        contentType: 'application/zip',
        bytesLoaded: latestProgress.bytesLoaded,
        totalBytes: latestProgress.bytesTotal,
        fileCount: addedCount,
        receivedChunks: [],
        percent: latestProgress.percent,
        fetchedImages: completed,
        validImages: addedCount,
        totalImages: resolvedPaths.length,
      });
      emit({
        format: 'zip',
        filename: fallbackFilename,
        stage: 'paused',
        isRunning: false,
        isPaused: true,
        isFallback: !isCacheFirstZip,
        usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
        reusedFromCacheCount,
        message: `Paused at ${latestProgress.percent}% · Ready to resume later`,
      });
      return {
        success: false,
        paused: true,
        filename: fallbackFilename,
        format: 'zip',
        fileCount: 0,
        totalBytes: 0,
        usedFallback: !isCacheFirstZip,
        usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
        reusedFromCacheCount,
      };
    }

    if (signal?.aborted) {
      emit({
        format: 'zip',
        filename: fallbackFilename,
        stage: 'cancelled',
        isRunning: false,
        isPaused: false,
        isFallback: !isCacheFirstZip,
        usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
        reusedFromCacheCount,
        message: 'Archive download cancelled',
      });
      return {
        success: false,
        cancelled: true,
        filename: fallbackFilename,
        format: 'zip',
        fileCount: 0,
        totalBytes: 0,
        usedFallback: !isCacheFirstZip,
        usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
        reusedFromCacheCount,
      };
    }

    if (addedCount === 0) {
      throw new Error(
        serverError ||
          'Remote image host blocked packaging. Use "Direct Save" to download images directly to your device.'
      );
    }

    const checksumEntries = checksumByIndex.filter((c): c is ChecksumEntry => c !== null);
    if (checksumEntries.length > 0) {
      const sumsText = formatSha256SumsText(checksumEntries, [
        `Ultimate Image Processor Archive Checksums (${fallbackFilename})`,
        `Images included: ${checksumEntries.length} of ${resolvedPaths.length}`,
        `Verify after extraction with: sha256sum -c SHA256SUMS.txt`,
      ]);
      clientZip.file('SHA256SUMS.txt', sumsText, { compression: 'DEFLATE' });
    }

    emit({
      format: 'zip',
      filename: fallbackFilename,
      stage: 'compressing',
      percent: 70,
      fetchedImages: resolvedPaths.length,
      validImages: addedCount,
      bytesLoaded: bytesFetched,
      isFallback: !isCacheFirstZip,
      usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
      reusedFromCacheCount,
      checksumEntries,
      skippedCount: Math.max(0, resolvedPaths.length - addedCount),
      message: isCacheFirstZip
        ? 'Packaging .ZIP from cached webpage images (0%)...'
        : 'Generating browser .ZIP archive (0%)...',
    });

    const zipBlob = await clientZip.generateAsync(
      { type: 'blob', compression: 'STORE' },
      (meta) => {
        const compPct = Math.min(100, Math.max(0, Math.round(meta.percent)));
        const overall = Math.min(99, Math.max(70, Math.round(70 + (compPct / 100) * 29)));
        emit({
          format: 'zip',
          filename: fallbackFilename,
          stage: 'compressing',
          percent: overall,
          fetchedImages: resolvedPaths.length,
          validImages: addedCount,
          bytesLoaded: bytesFetched,
          isFallback: !isCacheFirstZip,
          usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
          reusedFromCacheCount,
          message: isCacheFirstZip
            ? `Packaging .ZIP from cached webpage images (${compPct}%)`
            : `Generating browser .ZIP archive (${compPct}%)`,
        });
      }
    );

    const archiveSha256 = await computeSha256Hex(zipBlob).catch(() => undefined);

    if (saveBlobFn) {
      saveBlobFn(zipBlob, fallbackFilename);
    } else {
      triggerBlobDownload(zipBlob, fallbackFilename);
    }
    emit({
      format: 'zip',
      filename: fallbackFilename,
      stage: 'complete',
      percent: 100,
      fetchedImages: resolvedPaths.length,
      validImages: addedCount,
      bytesLoaded: zipBlob.size,
      bytesTotal: zipBlob.size,
      isRunning: false,
      isFallback: !isCacheFirstZip,
      usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
      reusedFromCacheCount,
      archiveSha256,
      checksumEntries,
      skippedCount: Math.max(0, resolvedPaths.length - addedCount),
      message: `Downloaded ${fallbackFilename} (${formatBytes(zipBlob.size)})`,
    });

    return {
      success: true,
      filename: fallbackFilename,
      format: 'zip',
      fileCount: addedCount,
      totalBytes: zipBlob.size,
      usedFallback: !isCacheFirstZip,
      usedBrowserCache: isCacheFirstZip || reusedFromCacheCount > 0,
      reusedFromCacheCount,
      archiveSha256,
      checksumEntries,
      skippedCount: Math.max(0, resolvedPaths.length - addedCount),
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Batch download failed';
    emit({
      format,
      filename: archiveFilename,
      stage: 'error',
      isRunning: false,
      error: errMsg,
      message: errMsg,
    });
    return {
      success: false,
      filename: archiveFilename,
      format,
      fileCount: 0,
      totalBytes: 0,
      error: errMsg,
    };
  }
}
