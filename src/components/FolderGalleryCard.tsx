'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Check, Maximize2, Star } from 'lucide-react';
import { FolderGalleryItem } from '../utils/folderGalleryLogic';
import { formatBytesCompact } from '../utils/imageTransformLogic';
import {
  isSameOriginOrLocalImageUrl,
  warmImageBlobCacheFromLoadedPreview,
} from '../utils/clientImageCache';

interface FolderGalleryCardProps {
  item: FolderGalleryItem;
  cardIndex: number;
  variant: 'grid' | 'masonry';
  gridFitMode: 'cover' | 'contain';
  isSelected: boolean;
  onOpenLightbox: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleStar: (id: string) => void;
}

export const FolderGalleryCard = React.memo<FolderGalleryCardProps>(
  ({
    item,
    cardIndex,
    variant,
    gridFitMode,
    isSelected,
    onOpenLightbox,
    onToggleSelect,
    onToggleStar,
  }) => {
    const displaySrc = item.thumbnailUrl || item.previewUrl;
    const isMasonry = variant === 'masonry';
    const aspectRatio =
      isMasonry && item.width > 0 && item.height > 0
        ? `${item.width} / ${item.height}`
        : '4 / 3';

    return (
      <article
        className={`${isMasonry ? 'break-inside-avoid ' : ''}group bg-white dark:bg-[#0E121B] border rounded-xl overflow-hidden transition-all duration-150 ${
          isSelected
            ? 'border-blue-600 ring-2 ring-blue-600/25'
            : 'border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20'
        }`}
      >
        <div
          className={`relative ${isMasonry ? '' : 'aspect-[4/3] '}bg-[#EEF1F6] dark:bg-[#090C12] overflow-hidden`}
          style={isMasonry ? { aspectRatio } : undefined}
        >
          <button
            type="button"
            onClick={() => onOpenLightbox(item.id)}
            aria-label={`Open ${item.filename} in viewer`}
            className="w-full h-full block cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displaySrc}
              alt={item.filename}
              referrerPolicy="no-referrer"
              loading={cardIndex < 12 ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={cardIndex < 8 ? 'high' : 'auto'}
              onLoad={(e) => {
                const activeSrc = e.currentTarget.currentSrc || displaySrc;
                if (
                  activeSrc &&
                  item.previewUrl &&
                  activeSrc === item.previewUrl &&
                  isSameOriginOrLocalImageUrl(activeSrc) &&
                  !activeSrc.startsWith('blob:')
                ) {
                  void warmImageBlobCacheFromLoadedPreview(item.previewUrl, activeSrc);
                }
              }}
              style={
                item.rotationDeg
                  ? { transform: `rotate(${item.rotationDeg}deg)` }
                  : undefined
              }
              className={`w-full h-full transition-transform duration-300 group-hover:scale-[1.03] ${
                !isMasonry && gridFitMode === 'contain'
                  ? 'object-contain p-1.5'
                  : isMasonry
                    ? 'object-cover'
                    : 'object-cover object-[50%_20%]'
              }`}
            />
          </button>

          {/* Top-left selection toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.id);
            }}
            aria-label={`Select ${item.filename}`}
            aria-pressed={isSelected}
            className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-md border flex items-center justify-center transition-opacity cursor-pointer ${
              isSelected
                ? 'bg-blue-600 border-blue-600 text-white opacity-100'
                : 'bg-black/45 border-white/40 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
          </button>

          {/* Top-right favorite star toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(item.id);
            }}
            aria-label={item.starred ? `Unstar ${item.filename}` : `Star ${item.filename}`}
            aria-pressed={item.starred}
            className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-xs transition-opacity cursor-pointer ${
              item.starred
                ? 'bg-amber-500/85 text-white opacity-100'
                : 'bg-black/45 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/65'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${item.starred ? 'fill-white' : ''}`} />
          </button>

          {/* Subtle measured bottom hover bar (grid view) */}
          {!isMasonry && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-t from-black/70 via-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between px-3 pb-2">
              <span className="text-[11px] font-mono text-white/90 truncate">
                {item.subfolder}
              </span>
              <Maximize2 className="w-3.5 h-3.5 text-white/90 shrink-0" />
            </div>
          )}
        </div>

        {isMasonry ? (
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#0F141F] dark:text-[#F3F6FA] truncate">
              {item.filename}
            </span>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {item.width > 0 ? `${item.width}×${item.height}` : item.format}
            </span>
          </div>
        ) : (
          <div className="px-3 py-2.5 space-y-0.5">
            <div className="text-xs font-semibold text-[#0F141F] dark:text-[#F3F6FA] truncate">
              {item.filename}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              {item.width > 0 ? `${item.width}×${item.height}` : 'Loading'} · {item.format}
              {item.sizeBytes > 0 ? ` · ${formatBytesCompact(item.sizeBytes)}` : ''}
            </div>
          </div>
        )}
      </article>
    );
  }
);

FolderGalleryCard.displayName = 'FolderGalleryCard';
