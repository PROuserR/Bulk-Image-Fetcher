'use client';

import React from 'react';
import {
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  Pause,
  PauseCircle,
  Play,
  X,
  ShieldCheck,
  FileDown,
  Copy,
  Check,
} from 'lucide-react';
import type { ArchiveDownloadProgress } from '../utils/archiveDownloader';
import { formatBytes } from '../utils/progressiveDownloader';
import { formatShortSha256 } from '../utils/checksumUtils';

interface ArchiveDownloadBarProps {
  progress: ArchiveDownloadProgress | null;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onDismiss?: () => void;
  onDownloadChecksum?: () => void;
  onOpenChecksumVerifier?: () => void;
  compact?: boolean;
}

const STAGE_LABEL: Record<ArchiveDownloadProgress['stage'], string> = {
  connecting: 'Connecting',
  fetching: 'Fetching Images',
  compressing: 'Compressing Archive',
  downloading: 'Downloading File',
  paused: 'Paused',
  complete: 'Completed',
  cancelled: 'Cancelled',
  error: 'Failed',
};

/**
 * Live progress HUD for `.7Z` (LZMA2) and `.ZIP` archive builds and HTTP Range downloads,
 * supporting Pause, Resume, Cancel, and Dismiss controls.
 */
export const ArchiveDownloadBar: React.FC<ArchiveDownloadBarProps> = ({
  progress,
  onPause,
  onResume,
  onCancel,
  onDismiss,
  onDownloadChecksum,
  onOpenChecksumVerifier,
  compact = false,
}) => {
  const [copiedSha, setCopiedSha] = React.useState(false);
  if (!progress) return null;

  const {
    format,
    filename,
    stage,
    percent,
    fetchedImages,
    validImages,
    totalImages,
    bytesLoaded,
    bytesTotal,
    message,
    isRunning,
    isFallback,
    archiveSha256,
    checksumEntries,
    skippedCount,
    reusedFromCacheCount,
  } = progress;

  const isSuccess = stage === 'complete';
  const isError = stage === 'error';
  const isPaused = stage === 'paused' || Boolean(progress.isPaused);
  const isCancelled = stage === 'cancelled';

  const barColor = isError
    ? 'bg-rose-600'
    : isPaused || isCancelled
      ? 'bg-amber-500'
      : isSuccess
        ? 'bg-emerald-600'
        : 'bg-blue-600';

  return (
    <section
      aria-label="Compressed archive download progress"
      data-testid="archive-download-bar"
      className={`bg-white dark:bg-[#0E121B] rounded-xl border border-[#DCE1EB] dark:border-white/[0.08] transition-colors ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
          ) : isPaused ? (
            <PauseCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : isSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${
                isError ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'
              }`}
            />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap text-xs sm:text-sm font-medium text-zinc-950 dark:text-zinc-50">
              <span className="inline-flex items-center gap-1 font-semibold">
                <FileArchive className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>.{format.toUpperCase()} Archive</span>
              </span>

              <span className="text-zinc-300 dark:text-zinc-700">·</span>

              <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300 truncate max-w-[260px]" title={filename}>
                {filename}
              </span>

              <span className="text-zinc-300 dark:text-zinc-700">·</span>

              <span
                className={`text-xs font-semibold ${
                  isError
                    ? 'text-rose-600 dark:text-rose-400'
                    : isPaused || isCancelled
                      ? 'text-amber-600 dark:text-amber-400'
                      : isSuccess
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {STAGE_LABEL[stage]}
              </span>

              {isFallback && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Browser fallback
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 font-mono tabular-nums">
              <span className="truncate">{message}</span>
              {totalImages > 0 && stage === 'fetching' && (
                <span>
                  ({fetchedImages}/{totalImages})
                </span>
              )}
              {isSuccess && totalImages > 0 && (
                <span
                  className={
                    (skippedCount ?? 0) > 0
                      ? 'text-amber-600 dark:text-amber-400 font-semibold'
                      : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  }
                >
                  · {validImages}/{totalImages} images verified
                </span>
              )}
              {(reusedFromCacheCount ?? 0) > 0 && (
                <span className="text-blue-600 dark:text-blue-400 font-semibold">
                  · {reusedFromCacheCount} cached
                </span>
              )}
              {isSuccess && archiveSha256 && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(archiveSha256).then(() => {
                      setCopiedSha(true);
                      setTimeout(() => setCopiedSha(false), 1600);
                    });
                  }}
                  title={`Copy full SHA-256: ${archiveSha256}`}
                  className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                >
                  <span>SHA-256: {formatShortSha256(archiveSha256)}</span>
                  {copiedSha ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              )}
              {bytesLoaded > 0 && (stage === 'downloading' || stage === 'paused') && bytesTotal && bytesTotal > 0 && (
                <span>
                  ({formatBytes(bytesLoaded)} / {formatBytes(bytesTotal)})
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            data-testid="archive-download-percentage"
            className={`font-mono tabular-nums font-bold mr-1 ${
              compact ? 'text-sm' : 'text-base sm:text-lg'
            } ${
              isError
                ? 'text-rose-600 dark:text-rose-400'
                : isPaused || isCancelled
                  ? 'text-amber-600 dark:text-amber-400'
                  : isSuccess
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-blue-600 dark:text-blue-400'
            }`}
          >
            {percent}%
          </span>

          {isRunning ? (
            <>
              {onPause && (
                <button
                  type="button"
                  data-testid="archive-pause-btn"
                  onClick={onPause}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              )}
            </>
          ) : (
            <>
              {isPaused && onResume && (
                <button
                  type="button"
                  data-testid="archive-resume-btn"
                  onClick={onResume}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </button>
              )}
              {isSuccess && (archiveSha256 || (checksumEntries?.length ?? 0) > 0) && onDownloadChecksum && (
                <button
                  type="button"
                  data-testid="archive-download-checksum-btn"
                  onClick={onDownloadChecksum}
                  title={`Download ${filename}.sha256 verification file`}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>.sha256</span>
                </button>
              )}
              {isSuccess && onOpenChecksumVerifier && (
                <button
                  type="button"
                  data-testid="archive-verify-checksum-btn"
                  onClick={onOpenChecksumVerifier}
                  title="Inspect SHA-256 manifest or verify local files"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verify Files</span>
                </button>
              )}
              {onDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={isPaused ? 'Discard paused archive download' : 'Dismiss compressed archive progress'}
                  title={isPaused ? 'Discard paused download' : 'Dismiss'}
                  className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Linear Progress Track */}
      <div
        role="progressbar"
        aria-label="Compressed archive download percentage"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2.5 w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
      >
        <div
          className={`h-full transition-all duration-150 ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </section>
  );
};
