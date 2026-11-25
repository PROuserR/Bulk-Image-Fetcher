'use client';

import React from 'react';
import {
  Check,
  AlertCircle,
  ExternalLink,
  FolderTree,
  Loader2,
  Play,
  Square,
  CheckSquare,
  X,
  ImageOff,
} from 'lucide-react';
import type { DiscoveredGallery } from '../utils/nestedGalleryLogic';

export interface NestedCrawlProgressState {
  isCrawling: boolean;
  completedCount: number;
  totalCount: number;
  activeTitle?: string;
  extractedImagesCount: number;
  statusById: Record<
    string,
    {
      status: 'queued' | 'crawling' | 'completed' | 'failed';
      count?: number;
      error?: string;
    }
  >;
}

interface NestedGalleryQueueProps {
  parentUrl: string;
  parentTitle: string;
  galleries: DiscoveredGallery[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onScrapeSelected: () => void;
  onCancelCrawl?: () => void;
  onClear: () => void;
  crawlProgress: NestedCrawlProgressState;
}

export const NestedGalleryQueue: React.FC<NestedGalleryQueueProps> = ({
  parentUrl,
  parentTitle,
  galleries,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onScrapeSelected,
  onCancelCrawl,
  onClear,
  crawlProgress,
}) => {
  if (galleries.length === 0) return null;

  const isAllSelected = galleries.length > 0 && selectedIds.size === galleries.length;
  const pct =
    crawlProgress.totalCount > 0
      ? Math.min(1, crawlProgress.completedCount / crawlProgress.totalCount)
      : 0;

  return (
    <section
      aria-label="Discovered child galleries"
      className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl overflow-hidden transition-colors"
    >
      {/* Header Row */}
      <div className="px-5 py-4 border-b border-[#DCE1EB] dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FolderTree className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="font-display text-sm sm:text-base font-bold text-[#0F141F] dark:text-[#F3F6FA] truncate">
              Discovered Child Galleries
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate tabular-nums">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {galleries.length} galleries found
            </span>
            <span aria-hidden="true">·</span>
            <span>{selectedIds.size} selected</span>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={parentTitle || parentUrl}>
              {parentTitle || parentUrl}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            disabled={crawlProgress.isCrawling}
            onClick={onSelectAll}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[#F4F6F9] dark:bg-white/[0.06] hover:bg-[#E2E7F0] dark:hover:bg-white/[0.1] border border-[#DCE1EB] dark:border-white/[0.08] rounded-lg text-xs font-medium text-[#0F141F] dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            {isAllSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            ) : (
              <Square className="w-3.5 h-3.5 text-slate-400" />
            )}
            <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
          </button>

          {crawlProgress.isCrawling ? (
            <button
              type="button"
              onClick={onCancelCrawl}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
            >
              <X className="w-3.5 h-3.5" />
              <span>Stop Crawl</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={onScrapeSelected}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap tabular-nums"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Scrape Selected Galleries ({selectedIds.size})</span>
            </button>
          )}

          {!crawlProgress.isCrawling && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear discovered galleries queue"
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-[#EEF1F6] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Live Crawl Progress Bar */}
      {(crawlProgress.isCrawling || crawlProgress.completedCount > 0) && (
        <div className="px-5 py-2.5 bg-[#F4F6F9] dark:bg-[#090C12] border-b border-[#DCE1EB] dark:border-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1.5">
            <div className="flex items-center gap-2 font-medium text-[#0F141F] dark:text-slate-200 min-w-0">
              {crawlProgress.isCrawling ? (
                <Loader2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
              ) : (
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span className="truncate">
                {crawlProgress.isCrawling
                  ? `Extracting full-res photos${crawlProgress.activeTitle ? `: ${crawlProgress.activeTitle}` : '...'}`
                  : 'Nested multi-gallery crawl finished'}
              </span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {crawlProgress.completedCount} / {crawlProgress.totalCount} galleries ·{' '}
              {crawlProgress.extractedImagesCount} photos
            </span>
          </div>
          <div className="h-1 w-full bg-[#DCE1EB] dark:bg-white/[0.08] rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 origin-left transition-transform duration-200"
              style={{ transform: `scaleX(${pct})` }}
            />
          </div>
        </div>
      )}

      {/* Gallery Queue List */}
      <div className="max-h-[320px] overflow-y-auto divide-y divide-[#DCE1EB] dark:divide-white/[0.06]">
        {galleries.map((gal, idx) => {
          const isChecked = selectedIds.has(gal.id);
          const itemStatus = crawlProgress.statusById[gal.id];

          return (
            <div
              key={gal.id}
              className={`px-5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                isChecked
                  ? 'bg-white dark:bg-[#0E121B] hover:bg-[#F4F6F9] dark:hover:bg-white/[0.03]'
                  : 'bg-[#F4F6F9] dark:bg-[#090C12] opacity-70'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={crawlProgress.isCrawling}
                  onChange={() => onToggleSelect(gal.id)}
                  aria-label={`Select gallery ${gal.title}`}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 accent-blue-600 shrink-0 cursor-pointer"
                />

                <span className="font-mono text-[11px] tabular-nums text-slate-400 w-6 shrink-0">
                  {String(idx + 1).padStart(2, '0')}
                </span>

                <div className="w-11 h-8 rounded-md bg-[#EEF1F6] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
                  {gal.coverThumbnailUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={gal.coverThumbnailUrl}
                      alt={gal.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : (
                    <ImageOff className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-xs font-semibold text-[#0F141F] dark:text-slate-100 truncate"
                      title={gal.title}
                    >
                      {gal.title}
                    </span>
                    {gal.photoCountHint && (
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                        · ~{gal.photoCountHint} photos
                      </span>
                    )}
                  </div>
                  <a
                    href={gal.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-full"
                    title={gal.url}
                  >
                    <span className="truncate">{gal.url}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                </div>
              </div>

              <div className="shrink-0 text-right font-mono text-[11px] tabular-nums">
                {itemStatus?.status === 'crawling' && (
                  <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Crawling...</span>
                  </span>
                )}
                {itemStatus?.status === 'completed' && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <Check className="w-3 h-3" />
                    <span>{itemStatus.count ?? 0} full-res</span>
                  </span>
                )}
                {itemStatus?.status === 'failed' && (
                  <span
                    className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium"
                    title={itemStatus.error}
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>Failed</span>
                  </span>
                )}
                {(!itemStatus || itemStatus.status === 'queued') && (
                  <span className="text-zinc-400 dark:text-zinc-500">
                    {isChecked ? 'Ready' : 'Skipped'}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
