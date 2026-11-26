'use client';

import React, { useState } from 'react';
import {
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RotateCcw,
  X,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Pause,
  PauseCircle,
  Play,
  ShieldCheck,
  FileDown,
} from 'lucide-react';
import { ProgressiveDownloadProgress, formatBytes } from '../utils/progressiveDownloader';

interface ProgressiveDownloadBarProps {
  progress: ProgressiveDownloadProgress | null;
  modeLabel?: string;
  onPause?: () => void;
  onResume?: () => void;
  onCancel: () => void;
  onRetryFailed: () => void;
  onDownloadChecksum?: () => void;
  onOpenChecksumVerifier?: () => void;
  onDismiss: () => void;
}

export const ProgressiveDownloadBar: React.FC<ProgressiveDownloadBarProps> = ({
  progress,
  modeLabel = 'Progressive Direct Save',
  onPause,
  onResume,
  onCancel,
  onRetryFailed,
  onDownloadChecksum,
  onOpenChecksumVerifier,
  onDismiss,
}) => {
  const [showFailures, setShowFailures] = useState(false);

  if (!progress) return null;

  const {
    total,
    completed,
    saved,
    failed,
    percent,
    bytesSaved,
    currentItems,
    isRunning,
    isPaused,
    isCancelled,
    failedItems,
    checksumEntries,
  } = progress;

  const hasFailures = failed > 0;
  const remaining = Math.max(0, total - saved - failed);
  const isCompleteSuccess = !isRunning && !isPaused && !isCancelled && !hasFailures && saved > 0;
  const hasChecksums = (checksumEntries?.length ?? 0) > 0;

  return (
    <section
      aria-label="Progressive direct download status"
      data-testid="progressive-download-bar"
      className="bg-white dark:bg-[#0E121B] rounded-xl border border-[#DCE1EB] dark:border-white/[0.08] p-4 transition-colors"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {isRunning ? (
            <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
          ) : isPaused ? (
            <PauseCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          ) : isCompleteSuccess ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap text-xs sm:text-sm font-medium text-zinc-950 dark:text-zinc-50">
              <span className="font-semibold">{modeLabel}</span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span className="font-mono tabular-nums text-xs text-zinc-700 dark:text-zinc-300">
                {saved} / {total} saved ({percent}%)
              </span>
              {bytesSaved > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatBytes(bytesSaved)}
                  </span>
                </>
              )}
              {isRunning && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                    4 parallel workers
                  </span>
                </>
              )}
              {isPaused && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    Paused ({remaining} left · Ready to resume later)
                  </span>
                </>
              )}
              {isCancelled && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    Cancelled ({completed}/{total} processed)
                  </span>
                </>
              )}
              {hasFailures && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 tabular-nums">
                    {failed} failed
                  </span>
                </>
              )}
            </div>

            {isRunning && currentItems.length > 0 && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5 font-mono">
                Downloading: {currentItems.join(', ')}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <>
              {onPause && (
                <button
                  type="button"
                  data-testid="direct-pause-btn"
                  onClick={onPause}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </>
          ) : (
            <>
              {isPaused && onResume && remaining > 0 && (
                <button
                  type="button"
                  data-testid="direct-resume-btn"
                  onClick={onResume}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer tabular-nums"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume ({remaining} left)</span>
                </button>
              )}
              {hasFailures && (
                <>
                  <button
                    type="button"
                    onClick={onRetryFailed}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer tabular-nums"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Failed ({failed})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowFailures((prev) => !prev)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <span>Details</span>
                    {showFailures ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </>
              )}
              {hasChecksums && onDownloadChecksum && (
                <button
                  type="button"
                  data-testid="direct-download-checksum-btn"
                  onClick={onDownloadChecksum}
                  title="Download SHA256SUMS (.sha256) checksum manifest for downloaded images"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>.sha256</span>
                </button>
              )}
              {hasChecksums && onOpenChecksumVerifier && (
                <button
                  type="button"
                  data-testid="direct-verify-checksum-btn"
                  onClick={onOpenChecksumVerifier}
                  title="Verify local downloaded folder against SHA-256 checksums"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Verify Files</span>
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                aria-label={isPaused ? 'Discard paused download' : 'Dismiss progressive download status'}
                title={isPaused ? 'Discard paused download' : 'Dismiss'}
                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden"
      >
        <div
          className={`h-full transition-all duration-200 ${
            isRunning
              ? 'bg-blue-600'
              : isPaused || hasFailures || isCancelled
                ? 'bg-amber-500'
                : 'bg-emerald-600'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Expandable Failed Items List */}
      {showFailures && failedItems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/70 max-h-40 overflow-y-auto">
          {failedItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 text-[11px] py-1.5"
            >
              <div className="min-w-0 flex items-center gap-2">
                <Download className="w-3 h-3 text-rose-500 shrink-0" />
                <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[200px]">
                  {item.filename}
                </span>
                <span className="text-rose-600 dark:text-rose-400 truncate">{item.reason}</span>
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline shrink-0 font-medium"
              >
                <span>Open URL</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
