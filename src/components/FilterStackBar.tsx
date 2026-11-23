'use client';

import React from 'react';
import {
  Check,
  Eye,
  Globe,
  ImageOff,
  Loader2,
  Maximize,
  ScanFace,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { GalleryFilterState } from '../utils/scraperLogic';

export type BooleanFilterKey =
  | 'onlyMasters'
  | 'onlyPreviewable'
  | 'onlyUnshrunk'
  | 'onlyWithSubpage'
  | 'onlyHighRes'
  | 'excludeIconsAndSmall'
  | 'onlyHumanFaces';

export interface FilterFacetSummary {
  masters: number;
  previewable: number;
  broken: number;
  unshrunk: number;
  withSubpage: number;
  highRes: number;
  nonIcons: number;
  humanFaces?: number;
  noFaceExcluded?: number;
  faceScanned?: number;
}

export interface FaceScanStatusSummary {
  isScanning: boolean;
  scanned: number;
  total: number;
  error?: string | null;
}

interface FilterChipsRowProps {
  filters: GalleryFilterState;
  facets: FilterFacetSummary;
  onToggle: (key: BooleanFilterKey) => void;
  faceScanStatus?: FaceScanStatusSummary;
  compact?: boolean;
}

/**
 * Unified neutral-and-cobalt segmented filter buttons shared across GalleryView and FullImageLinksModal.
 */
export const FilterChipsRow: React.FC<FilterChipsRowProps> = ({
  filters,
  facets,
  onToggle,
  faceScanStatus,
  compact = false,
}) => {
  const pad = compact ? 'px-2.5 py-1 text-[11px] rounded-md' : 'px-3 py-1.5 text-xs rounded-lg';
  const iconCls = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';

  const inactiveCls =
    'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-950 dark:hover:text-white';
  const aiInactiveCls =
    'bg-blue-50/80 dark:bg-blue-950/35 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800/80 hover:bg-blue-100/90 dark:hover:bg-blue-900/50';
  const primaryActiveCls =
    'bg-blue-600 text-white border border-blue-600 shadow-xs';
  const secondaryActiveCls =
    'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border border-zinc-900 dark:border-zinc-100';

  const isScanningFaces = Boolean(faceScanStatus?.isScanning);
  const faceScannedCount = facets.faceScanned ?? 0;
  const humanFacesCount = facets.humanFaces ?? 0;
  const noFaceExcludedCount = facets.noFaceExcluded ?? 0;

  return (
    <>
      <button
        type="button"
        aria-pressed={filters.onlyMasters}
        onClick={() => onToggle('onlyMasters')}
        className={`flex items-center gap-1.5 ${pad} font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.onlyMasters ? primaryActiveCls : inactiveCls
        }`}
        title="Keep only full-resolution master images (excludes shrunk thumbnails)"
      >
        <Sparkles className={iconCls} />
        <span className="tabular-nums">
          {compact ? `Full Masters (${facets.masters})` : `Full Masters Only (${facets.masters})`}
        </span>
        {filters.onlyMasters && <Check className={iconCls} />}
      </button>

      <button
        type="button"
        data-testid="ai-human-face-filter-btn"
        aria-pressed={filters.onlyHumanFaces}
        onClick={() => onToggle('onlyHumanFaces')}
        className={`flex items-center gap-1.5 ${pad} font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.onlyHumanFaces ? primaryActiveCls : aiInactiveCls
        }`}
        title="Use AI vision to include only images with a human face/person and exclude non-person or nature backgrounds"
      >
        {isScanningFaces ? (
          <Loader2 className={`${iconCls} animate-spin`} />
        ) : (
          <ScanFace className={iconCls} />
        )}
        <span className="tabular-nums">
          {isScanningFaces
            ? `Scanning People (${faceScanStatus?.scanned ?? 0}/${faceScanStatus?.total ?? 0})...`
            : filters.onlyHumanFaces
              ? compact
                ? `Only Person (${humanFacesCount})`
                : `Include Only Person (${humanFacesCount}${noFaceExcludedCount > 0 ? ` · ${noFaceExcludedCount} excluded` : ''})`
              : faceScannedCount > 0
                ? compact
                  ? `Only Person (${humanFacesCount})`
                  : `Include Only Person (${humanFacesCount})`
                : compact
                  ? 'Only Person (AI)'
                  : 'Include Only Person (AI)'}
        </span>
        {filters.onlyHumanFaces && !isScanningFaces && <Check className={iconCls} />}
      </button>

      <button
        type="button"
        aria-pressed={filters.onlyPreviewable}
        onClick={() => onToggle('onlyPreviewable')}
        className={`flex items-center gap-1.5 ${pad} font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.onlyPreviewable ? secondaryActiveCls : inactiveCls
        }`}
        title="Hide broken, 404, 1x1 spacer, or blank preview images"
      >
        <Eye className={iconCls} />
        <span className="tabular-nums">
          Previewable ({facets.previewable}
          {!compact && facets.broken > 0 ? ` · ${facets.broken} hidden` : ''})
        </span>
        {filters.onlyPreviewable && <Check className={iconCls} />}
      </button>

      <button
        type="button"
        aria-pressed={filters.onlyUnshrunk}
        onClick={() => onToggle('onlyUnshrunk')}
        className={`flex items-center gap-1.5 ${pad} font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.onlyUnshrunk ? secondaryActiveCls : inactiveCls
        }`}
        title="Keep only images actively un-shrunk from thumbnails or linked pages"
      >
        <ShieldCheck className={iconCls} />
        <span className="tabular-nums">Un-shrunk ({facets.unshrunk})</span>
        {filters.onlyUnshrunk && !compact && <Check className="w-3 h-3" />}
      </button>

      <button
        type="button"
        aria-pressed={filters.onlyHighRes}
        onClick={() => onToggle('onlyHighRes')}
        className={`flex items-center gap-1.5 ${pad} font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.onlyHighRes ? secondaryActiveCls : inactiveCls
        }`}
        title="Keep only HD & 4K images with ≥1920px dimensions"
      >
        <Maximize className={iconCls} />
        <span className="tabular-nums">
          {compact ? `HD / 4K (${facets.highRes})` : `HD / 4K ≥1920px (${facets.highRes})`}
        </span>
        {filters.onlyHighRes && !compact && <Check className="w-3 h-3" />}
      </button>

      <button
        type="button"
        aria-pressed={filters.onlyWithSubpage}
        onClick={() => onToggle('onlyWithSubpage')}
        className={`flex items-center gap-1.5 ${pad} font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.onlyWithSubpage ? secondaryActiveCls : inactiveCls
        }`}
        title="Keep only images that link to a dedicated detail/photo subpage"
      >
        <Globe className={iconCls} />
        <span className="tabular-nums">Has Subpage ({facets.withSubpage})</span>
        {filters.onlyWithSubpage && !compact && <Check className="w-3 h-3" />}
      </button>

      <button
        type="button"
        aria-pressed={filters.excludeIconsAndSmall}
        onClick={() => onToggle('excludeIconsAndSmall')}
        className={`flex items-center gap-1.5 ${pad} font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          filters.excludeIconsAndSmall ? secondaryActiveCls : inactiveCls
        }`}
        title="Exclude SVGs, GIFs, logos, icons, and graphics under 400px"
      >
        <ImageOff className={iconCls} />
        <span className="tabular-nums">
          {compact ? `Hide Icons (${facets.nonIcons})` : `Hide Icons / GIFs (${facets.nonIcons})`}
        </span>
        {filters.excludeIconsAndSmall && !compact && <Check className="w-3 h-3" />}
      </button>
    </>
  );
};
