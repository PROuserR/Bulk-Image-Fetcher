'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crop,
  Film,
  Layers,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import type { ScrapedImage } from '../utils/scraperLogic';

interface WorkingTrayBarProps {
  items: ScrapedImage[];
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onSendToCrop: (items: ScrapedImage[]) => void;
  onSendToFilters: (items: ScrapedImage[]) => void;
  onSendToGif: (items: ScrapedImage[]) => void;
  onSendToClassifier: (items: ScrapedImage[]) => void;
  onSendToVision: (items: ScrapedImage[]) => void;
}

export const WorkingTrayBar: React.FC<WorkingTrayBarProps> = ({
  items,
  onRemoveItem,
  onClearAll,
  onSendToCrop,
  onSendToFilters,
  onSendToGif,
  onSendToClassifier,
  onSendToVision,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Cross-Studio Working Tray"
      className="bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.1] rounded-2xl px-4 py-3 space-y-3 animate-fadeIn"
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-blue-600/12 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Layers className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <span className="font-display text-xs sm:text-sm font-bold text-[#0F141F] dark:text-white">
              Working Tray
            </span>
            <span className="ml-2 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {items.length} staged
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSendToCrop(items)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-blue-500/40 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Crop className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>Crop</span>
          </button>
          <button
            type="button"
            onClick={() => onSendToFilters(items)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-blue-500/40 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Wand2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>Filters</span>
          </button>
          <button
            type="button"
            onClick={() => onSendToGif(items)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-blue-500/40 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Film className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>GIF89a</span>
          </button>
          <button
            type="button"
            onClick={() => onSendToClassifier(items)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-blue-500/40 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Users className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>Face Sort</span>
          </button>
          <button
            type="button"
            onClick={() => onSendToVision(items)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-blue-500/40 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>Vision</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-label={isExpanded ? 'Collapse Working Tray' : 'Expand Working Tray'}
            className="w-7 h-7 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] flex items-center justify-center text-slate-500 hover:text-[#0F141F] dark:hover:text-white cursor-pointer"
          >
            {isExpanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onClearAll}
            aria-label="Clear Working Tray"
            className="w-7 h-7 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] flex items-center justify-center text-slate-500 hover:text-red-500 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {items.map((item) => (
            <div
              key={item.id}
              className="relative group w-14 h-14 rounded-lg overflow-hidden border border-[#DCE1EB] dark:border-white/[0.1] bg-[#0B0D12] shrink-0"
              title={item.filename || item.altText || 'Staged asset'}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.thumbnailUrl || item.fullUrl}
                alt={item.filename || item.altText || 'Tray asset'}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemoveItem(item.id)}
                aria-label={`Remove ${item.filename || 'item'} from tray`}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/75 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
