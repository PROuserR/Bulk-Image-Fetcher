'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Download,
  Maximize2,
  CheckSquare,
  Square,
  FileArchive,
  Sparkles,
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Check,
  Link2,
  RotateCcw,
  Layers,
  FolderDown,
  Loader2,
  PlusCircle,
  LayoutGrid,
  RectangleHorizontal,
  Search,
  Crop,
  Users,
  Wand2,
  Film,
  FolderTree,
  List,
  AlertCircle,
  ScanFace,
} from 'lucide-react';
import {
  ScrapedImage,
  GalleryFilterState,
  DEFAULT_GALLERY_FILTERS,
  PreviewStateInfo,
  FaceScanResult,
  OrientationFilter,
  isMasterImage,
  isBlankOrPlaceholderUrl,
  filterScrapedImages,
  countActiveFilters,
  getFilterFacetCounts,
  getEffectiveDimensions,
} from '../utils/scraperLogic';
import type { NestedGallerySummary } from '../utils/nestedGalleryLogic';
import {
  downloadFileToDisk,
  triggerTextDownload,
  buildDownloadFileUrl,
  buildViewImageUrl,
  ArchiveFormat,
  DEFAULT_ARCHIVE_FORMAT,
} from '../utils/downloader';
import {
  buildProxyImageUrl,
  registerWorkingPreviewUrl,
} from '../utils/clientImageCache';
import type { ArchiveDownloadProgress } from '../utils/archiveDownloader';
import { FullImageLinksModal } from './FullImageLinksModal';
import { FilterChipsRow, BooleanFilterKey, FaceScanStatusSummary } from './FilterStackBar';

interface GalleryViewProps {
  images: ScrapedImage[];
  pageTitle: string;
  sourceUrl: string;
  unshrunkCount: number;
  nestedGalleries?: NestedGallerySummary[];
  onSelectImage: (image: ScrapedImage) => void;
  onBatchDownloadZip: (selectedImages: ScrapedImage[], format?: ArchiveFormat) => void;
  onDownloadIndividually?: (
    selectedImages: ScrapedImage[],
    options?: { saveToFolder?: boolean }
  ) => void;
  isDownloadingZip: boolean;
  isDirectSaving?: boolean;
  downloadProgress?: string | null;
  archiveProgress?: ArchiveDownloadProgress | null;
  onPauseArchiveDownload?: () => void;
  onResumeArchiveDownload?: () => void;
  onCancelArchiveDownload?: () => void;
  onDismissArchiveDownload?: () => void;
  archiveFormat?: ArchiveFormat;
  onArchiveFormatChange?: (format: ArchiveFormat) => void;
  faceScanMap?: Record<string, FaceScanResult>;
  faceScanStatus?: FaceScanStatusSummary;
  onScanHumanFaces?: (targetImages: ScrapedImage[]) => Promise<boolean>;
  hasMorePosts?: boolean;
  isLoadingMorePosts?: boolean;
  onLoadMorePosts?: () => void;
  totalProfilePosts?: number;
  onSendToCropResize?: (targetImages: ScrapedImage[]) => void;
  onSendToFilterStudio?: (targetImages: ScrapedImage[]) => void;
  onSendToGifMaker?: (targetImages: ScrapedImage[]) => void;
  onSendToHumanClassifier?: (targetImages: ScrapedImage[]) => void;
  onSendToGemmaCaptioner?: (targetImages: ScrapedImage[]) => void;
}

interface GalleryCardProps {
  img: ScrapedImage;
  cardIndex: number;
  sourceUrl: string;
  isSelected: boolean;
  aspectMode: 'wide' | 'contact';
  previewInfo?: PreviewStateInfo;
  faceScan?: FaceScanResult;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onSelectImage: (img: ScrapedImage) => void;
  onPreviewUpdate: (id: string, info: PreviewStateInfo) => void;
}

const GalleryCard: React.FC<GalleryCardProps> = React.memo(({
  img,
  cardIndex,
  sourceUrl,
  isSelected,
  aspectMode,
  previewInfo,
  faceScan,
  onToggleSelect,
  onSelectImage,
  onPreviewUpdate,
}) => {
  const candidateUrls = useMemo(() => {
    const urls: string[] = [];
    const addCandidate = (u?: string) => {
      if (u && !isBlankOrPlaceholderUrl(u) && !urls.includes(u)) {
        urls.push(u);
      }
    };
    if (img.isUnshrunk) {
      addCandidate(img.fullUrl);
      addCandidate(img.thumbnailUrl);
    } else {
      addCandidate(img.thumbnailUrl);
      addCandidate(img.fullUrl);
    }
    addCandidate(img.fallbackUrl);
    const proxyTarget = img.fullUrl || img.thumbnailUrl;
    if (proxyTarget && !isBlankOrPlaceholderUrl(proxyTarget)) {
      const proxyUrl = buildProxyImageUrl(proxyTarget, sourceUrl || '');
      if (!urls.includes(proxyUrl)) urls.push(proxyUrl);
    }
    return urls;
  }, [img.thumbnailUrl, img.fullUrl, img.fallbackUrl, img.isUnshrunk, sourceUrl]);

  const [candidateIdx, setCandidateIdx] = useState<number>(0);

  useEffect(() => {
    setCandidateIdx(0);
    if (candidateUrls.length === 0) {
      onPreviewUpdate(img.id, { status: 'broken' });
    }
  }, [img.id, candidateUrls.length, onPreviewUpdate]);

  const activeSrc = candidateUrls[candidateIdx];
  const isBroken = candidateIdx >= candidateUrls.length || previewInfo?.status === 'broken';
  const isLoaded = previewInfo?.status === 'loaded';
  const dims = getEffectiveDimensions(img, previewInfo);
  const isMaster = isMasterImage(img, previewInfo);

  const advanceFallback = () => {
    if (candidateIdx + 1 < candidateUrls.length) {
      setCandidateIdx((prev) => prev + 1);
    } else {
      setCandidateIdx(candidateUrls.length);
      onPreviewUpdate(img.id, { status: 'broken' });
    }
  };

  return (
    <article
      onClick={() => onSelectImage(img)}
      className={`group bg-white dark:bg-[#101218] border rounded-xl overflow-hidden transition-all duration-150 flex flex-col cursor-pointer ${
        isSelected
          ? 'border-blue-600 ring-2 ring-blue-600/20 shadow-sm'
          : 'border-[#E2DED3] dark:border-white/[0.08] hover:border-zinc-400 dark:hover:border-white/25 hover:-translate-y-0.5'
      }`}
    >
      {/* Thumbnail Viewport */}
      <div
        className={`relative ${
          aspectMode === 'wide' ? 'aspect-video' : 'aspect-[4/3]'
        } bg-zinc-100 dark:bg-[#090A0F] overflow-hidden flex items-center justify-center`}
      >
        {!isBroken && !isLoaded && (
          <div className="absolute inset-0 animate-pulse bg-zinc-200/80 dark:bg-zinc-800/60" />
        )}

        {!isBroken && activeSrc ? (
          <img
            data-face-img-id={img.id}
            src={activeSrc}
            alt={img.altText}
            loading={cardIndex < 12 ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={cardIndex < 8 ? 'high' : 'auto'}
            referrerPolicy="no-referrer"
            onLoad={(e) => {
              const target = e.currentTarget;
              if (target.naturalWidth <= 1 || target.naturalHeight <= 1) {
                advanceFallback();
                return;
              }
              if (activeSrc && (img.fullUrl || img.thumbnailUrl)) {
                registerWorkingPreviewUrl(img.fullUrl || img.thumbnailUrl, activeSrc);
              }
              onPreviewUpdate(img.id, {
                status: 'loaded',
                naturalWidth: target.naturalWidth,
                naturalHeight: target.naturalHeight,
              });
            }}
            onError={advanceFallback}
            className={`w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300 ease-out ${
              isLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        ) : (
          <div className="flex flex-col items-center justify-center p-4 text-center text-zinc-400 dark:text-zinc-500">
            <ImageOff className="w-6 h-6 mb-1.5 opacity-70" />
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              Preview unavailable
            </span>
          </div>
        )}

        {/* Top-left Select Checkbox */}
        <button
          type="button"
          onClick={(e) => onToggleSelect(img.id, e)}
          className={`absolute top-2.5 left-2.5 z-10 w-7 h-7 rounded-md backdrop-blur-sm flex items-center justify-center transition-colors cursor-pointer ${
            isSelected
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-950/60 text-white hover:bg-zinc-950/85'
          }`}
          aria-label={`Select ${img.filename}`}
          aria-pressed={isSelected}
        >
          {isSelected ? (
            <Check className="w-4 h-4 stroke-[2.75]" />
          ) : (
            <div className="w-3.5 h-3.5 rounded-[3px] border border-white/75" />
          )}
        </button>

        {/* Measured Hover Scrim */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-end justify-end p-2.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectImage(img);
            }}
            className="pointer-events-auto cursor-pointer px-2.5 py-1 bg-white/95 text-zinc-950 rounded-md text-[11px] font-semibold shadow-sm flex items-center gap-1.5 hover:bg-white transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Inspect</span>
          </button>
        </div>
      </div>

      {/* Card Body — Unboxed Editorial Metadata */}
      <div className="p-3.5 flex flex-col flex-1 justify-between gap-2.5">
        <div>
          <h4
            className="text-[13px] font-semibold text-zinc-950 dark:text-zinc-100 truncate"
            title={img.filename}
          >
            {img.filename}
          </h4>

          {/* Clean unboxed typographic metadata with · separators */}
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono tabular-nums truncate">
            <span className="uppercase font-semibold text-zinc-700 dark:text-zinc-300">
              {img.format}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {dims.width && dims.height
                ? `${dims.width}×${dims.height}`
                : dims.tier.toUpperCase()}
            </span>
            {isBroken ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-rose-600 dark:text-rose-400 font-sans font-medium">
                  Blocked
                </span>
              </>
            ) : isMaster ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-blue-600 dark:text-blue-400 font-sans font-semibold">
                  Master
                </span>
              </>
            ) : null}
            {faceScan && !faceScan.error && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  title={faceScan.subjectSummary}
                  className={`font-sans font-semibold ${
                    faceScan.hasHumanFace
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {faceScan.hasHumanFace
                    ? faceScan.faceCount > 1
                      ? `${faceScan.faceCount} Faces`
                      : 'Face'
                    : 'No Face'}
                </span>
              </>
            )}
          </div>

          {img.galleryTitle && (
            <div
              className="mt-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 truncate"
              title={`Child gallery: ${img.galleryTitle}`}
            >
              {img.galleryTitle}
            </div>
          )}

          {img.linkedPageUrl && (
            <div
              className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500 flex items-center gap-1 truncate"
              title={`Linked subpage: ${img.linkedPageUrl}`}
            >
              <a
                href={img.linkedPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:text-blue-600 dark:hover:text-blue-400 underline truncate"
              >
                {img.linkedPageUrl}
              </a>
            </div>
          )}
        </div>

        <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectImage(img);
            }}
            className="text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
          >
            Inspect
          </button>

          <div className="flex items-center gap-2">
            <a
              href={buildViewImageUrl({
                fullUrl: img.fullUrl,
                title: img.filename,
                sourcePage: sourceUrl,
                linkedPage: img.linkedPageUrl,
                method: img.unshrinkMethod,
              })}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline px-2 py-1 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
              title="Open full-sized master in a dedicated new webpage"
            >
              <span>Full Page</span>
              <ExternalLink className="w-3 h-3" />
            </a>

            <a
              href={buildDownloadFileUrl(img.fullUrl, img.filename, sourceUrl, {
                fallbackUrl: img.fallbackUrl,
                linkedPageUrl: img.linkedPageUrl,
              })}
              download={img.filename}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                downloadFileToDisk(img.fullUrl, img.filename, sourceUrl, {
                  fallbackUrl: img.fallbackUrl,
                  linkedPageUrl: img.linkedPageUrl,
                });
              }}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Direct download image file to device"
              aria-label={`Download ${img.filename}`}
            >
              <Download className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
});

GalleryCard.displayName = 'GalleryCard';

export const GalleryView: React.FC<GalleryViewProps> = ({
  images,
  pageTitle,
  sourceUrl,
  unshrunkCount,
  nestedGalleries = [],
  onSelectImage,
  onBatchDownloadZip,
  onDownloadIndividually,
  isDownloadingZip,
  isDirectSaving = false,
  downloadProgress,
  archiveProgress = null,
  onPauseArchiveDownload,
  onResumeArchiveDownload,
  onCancelArchiveDownload,
  onDismissArchiveDownload,
  archiveFormat,
  onArchiveFormatChange,
  faceScanMap,
  faceScanStatus,
  onScanHumanFaces,
  hasMorePosts = false,
  isLoadingMorePosts = false,
  onLoadMorePosts,
  totalProfilePosts,
  onSendToCropResize,
  onSendToFilterStudio,
  onSendToGifMaker,
  onSendToHumanClassifier,
  onSendToGemmaCaptioner,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<GalleryFilterState>(DEFAULT_GALLERY_FILTERS);
  const [previewMap, setPreviewMap] = useState<Record<string, PreviewStateInfo>>({});
  const [isLinksModalOpen, setIsLinksModalOpen] = useState<boolean>(false);
  const [aspectMode, setAspectMode] = useState<'wide' | 'contact'>('contact');
  const [groupByGallery, setGroupByGallery] = useState<boolean>(true);
  const [canPickFolder, setCanPickFolder] = useState<boolean>(false);
  const [localArchiveFormat, setLocalArchiveFormat] = useState<ArchiveFormat>(DEFAULT_ARCHIVE_FORMAT);
  const activeArchiveFormat = archiveFormat ?? localArchiveFormat;
  const setActiveArchiveFormat = onArchiveFormatChange ?? setLocalArchiveFormat;

  useEffect(() => {
    setCanPickFolder('showDirectoryPicker' in window && window.self === window.top);
  }, []);

  useEffect(() => {
    setPreviewMap({});
    setSelectedIds(new Set());
    setFilters((prev) => ({ ...prev, galleryId: 'all', onlyHumanFaces: false }));
  }, [sourceUrl]);

  useEffect(() => {
    const validIds = new Set(images.map((img) => img.id));
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [images]);

  useEffect(() => {
    if (
      filters.onlyHumanFaces &&
      !faceScanStatus?.isScanning &&
      images.length > 0 &&
      Object.keys(faceScanMap || {}).length === 0
    ) {
      setFilters((prev) => (prev.onlyHumanFaces ? { ...prev, onlyHumanFaces: false } : prev));
    }
  }, [filters.onlyHumanFaces, faceScanStatus?.isScanning, images.length, faceScanMap]);

  useEffect(() => {
    if (!filters.onlyHumanFaces || !faceScanMap) return;
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        const scan = faceScanMap[id];
        if (scan && !scan.hasHumanFace) {
          changed = true;
        } else {
          next.add(id);
        }
      }
      return changed ? next : prev;
    });
  }, [filters.onlyHumanFaces, faceScanMap]);

  const unscannedPendingCount = useMemo(() => {
    if (!filters.onlyHumanFaces) return 0;
    return images.filter(
      (img) =>
        !isBlankOrPlaceholderUrl(img.thumbnailUrl || img.fullUrl) && !faceScanMap?.[img.id]
    ).length;
  }, [filters.onlyHumanFaces, images, faceScanMap]);

  const handlePreviewUpdate = useCallback((id: string, info: PreviewStateInfo) => {
    setPreviewMap((prev) => {
      const existing = prev[id];
      if (
        existing &&
        existing.status === info.status &&
        existing.naturalWidth === info.naturalWidth &&
        existing.naturalHeight === info.naturalHeight
      ) {
        return prev;
      }
      return { ...prev, [id]: info };
    });
  }, []);

  const updateFilter = <K extends keyof GalleryFilterState>(
    key: K,
    value: GalleryFilterState[K]
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleFilterBool = (key: BooleanFilterKey) => {
    if (key === 'onlyHumanFaces') {
      if (filters.onlyHumanFaces) {
        setFilters((prev) => ({ ...prev, onlyHumanFaces: false }));
        return;
      }
      const unscanned = images.filter(
        (img) =>
          !isBlankOrPlaceholderUrl(img.thumbnailUrl || img.fullUrl) &&
          (!faceScanMap?.[img.id] || Boolean(faceScanMap?.[img.id]?.error))
      );
      if (unscanned.length > 0 && onScanHumanFaces) {
        void onScanHumanFaces(images).then((ok) => {
          if (ok) {
            setFilters((prev) => ({ ...prev, onlyHumanFaces: true }));
          }
        });
        return;
      }
      setFilters((prev) => ({ ...prev, onlyHumanFaces: true }));
      return;
    }
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const applyCleanMastersStack = () => {
    const isAlreadyActive =
      filters.onlyMasters && filters.onlyPreviewable && filters.excludeIconsAndSmall;
    setFilters((prev) => ({
      ...prev,
      onlyMasters: !isAlreadyActive,
      onlyPreviewable: !isAlreadyActive,
      excludeIconsAndSmall: !isAlreadyActive,
    }));
  };

  const resetFilters = () => {
    setFilters(DEFAULT_GALLERY_FILTERS);
  };

  const facets = useMemo(
    () => getFilterFacetCounts(images, previewMap, faceScanMap),
    [images, previewMap, faceScanMap]
  );

  const filteredImages = useMemo(
    () => filterScrapedImages(images, filters, previewMap, faceScanMap),
    [images, filters, previewMap, faceScanMap]
  );

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const filteredMasters = useMemo(
    () => filteredImages.filter((img) => isMasterImage(img, previewMap[img.id])),
    [filteredImages, previewMap]
  );

  const selectedInViewCount = useMemo(
    () => filteredImages.filter((img) => selectedIds.has(img.id)).length,
    [filteredImages, selectedIds]
  );

  const selectedMastersCount = useMemo(() => {
    return images.filter((img) => selectedIds.has(img.id) && isMasterImage(img, previewMap[img.id]))
      .length;
  }, [images, selectedIds, previewMap]);

  const isAllMastersSelected =
    filteredMasters.length > 0 && filteredMasters.every((img) => selectedIds.has(img.id));

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectFullMasters = () => {
    const next = new Set(selectedIds);
    if (isAllMastersSelected) {
      filteredMasters.forEach((img) => next.delete(img.id));
    } else {
      filteredMasters.forEach((img) => next.add(img.id));
    }
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    if (selectedInViewCount === filteredImages.length && filteredImages.length > 0) {
      const next = new Set(selectedIds);
      filteredImages.forEach((img) => next.delete(img.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      filteredImages.forEach((img) => next.add(img.id));
      setSelectedIds(next);
    }
  };

  const handleInvertSelection = () => {
    const next = new Set(selectedIds);
    filteredImages.forEach((img) => {
      if (next.has(img.id)) next.delete(img.id);
      else next.add(img.id);
    });
    setSelectedIds(next);
  };

  const handleBatchDownload = () => {
    const selected = images.filter((img) => selectedIds.has(img.id));
    if (selected.length > 0) {
      onBatchDownloadZip(selected, activeArchiveFormat);
    }
  };

  const handleExportJson = () => {
    const selected = images.filter((img) => selectedIds.has(img.id));
    const targetList = selected.length > 0 ? selected : filteredImages;
    triggerTextDownload(
      JSON.stringify(targetList, null, 2),
      `scraped_manifest_${Date.now()}.json`,
      'application/json'
    );
  };

  const isAllSelected =
    filteredImages.length > 0 && selectedInViewCount === filteredImages.length;
  const isCleanStackActive =
    filters.onlyMasters && filters.onlyPreviewable && filters.excludeIconsAndSmall;
  const hasMultipleNestedGalleries = nestedGalleries.length > 1;

  const groupedGallerySections = useMemo(() => {
    if (!groupByGallery || !hasMultipleNestedGalleries || (filters.galleryId && filters.galleryId !== 'all')) {
      return null;
    }
    const bucket = new Map<string, ScrapedImage[]>();
    for (const img of filteredImages) {
      const key = img.galleryId || 'other';
      const arr = bucket.get(key) || [];
      arr.push(img);
      bucket.set(key, arr);
    }
    const sections: { id: string; title: string; url: string; items: ScrapedImage[] }[] = [];
    for (const g of nestedGalleries) {
      const items = bucket.get(g.id);
      if (items && items.length > 0) {
        sections.push({ id: g.id, title: g.title, url: g.url, items });
        bucket.delete(g.id);
      }
    }
    for (const [id, items] of bucket.entries()) {
      sections.push({
        id,
        title: items[0]?.galleryTitle || 'Other Images',
        url: items[0]?.galleryUrl || sourceUrl,
        items,
      });
    }
    return sections;
  }, [groupByGallery, hasMultipleNestedGalleries, filters.galleryId, filteredImages, nestedGalleries, sourceUrl]);

  const handleToggleSelectGalleryGroup = (items: ScrapedImage[]) => {
    const allChecked = items.length > 0 && items.every((i) => selectedIds.has(i.id));
    const next = new Set(selectedIds);
    for (const item of items) {
      if (allChecked) next.delete(item.id);
      else next.add(item.id);
    }
    setSelectedIds(next);
  };

  return (
    <div className="space-y-5">
      {/* Gallery Header & Filter Workbench */}
      <section className="bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-2xl p-5 sm:p-6 transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-xl sm:text-2xl font-bold text-zinc-950 dark:text-white truncate max-w-2xl">
              {pageTitle || 'Extracted Asset Contact Sheet'}
            </h2>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1 flex-wrap tabular-nums">
              {nestedGalleries.length > 0 && (
                <>
                  <span className="font-semibold text-[#141413] dark:text-zinc-100">
                    {nestedGalleries.length} nested {nestedGalleries.length === 1 ? 'gallery' : 'galleries'}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {images.length} images extracted
              </span>
              <span aria-hidden="true">·</span>
              <span className="text-blue-600 dark:text-blue-400 font-semibold">
                {unshrunkCount} upgraded to master full-res
              </span>
              <span aria-hidden="true">·</span>
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-xs inline-flex items-center gap-1"
              >
                <span className="truncate">{sourceUrl}</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>
          </div>

          {/* Search & Aspect Mode Switch */}
          <div className="flex items-center gap-2.5 w-full lg:w-auto shrink-0">
            <div className="relative flex-1 lg:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={filters.searchQuery}
                onChange={(e) => updateFilter('searchQuery', e.target.value)}
                placeholder="Search filename, gallery, or URL..."
                className="w-full pl-8.5 pr-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-950 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {hasMultipleNestedGalleries && (
              <div
                role="group"
                aria-label="Gallery grouping mode"
                className="inline-flex items-center p-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shrink-0"
              >
                <button
                  type="button"
                  onClick={() => setGroupByGallery(true)}
                  title="Group photos by child gallery"
                  aria-label="Group photos by child gallery"
                  aria-pressed={groupByGallery}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    groupByGallery
                      ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <FolderTree className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setGroupByGallery(false)}
                  title="Flat contact sheet across all galleries"
                  aria-label="Flat contact sheet across all galleries"
                  aria-pressed={!groupByGallery}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    !groupByGallery
                      ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div
              role="group"
              aria-label="Card framing aspect"
              className="inline-flex items-center p-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shrink-0"
            >
              <button
                type="button"
                onClick={() => setAspectMode('contact')}
                title="4:3 Contact Sheet Grid"
                aria-label="4:3 Contact Sheet Grid"
                aria-pressed={aspectMode === 'contact'}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  aspectMode === 'contact'
                    ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setAspectMode('wide')}
                title="16:9 Wide Frame Grid"
                aria-label="16:9 Wide Frame Grid"
                aria-pressed={aspectMode === 'wide'}
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  aspectMode === 'wide'
                    ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <RectangleHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* High-Level Filter Bar */}
        <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <FilterChipsRow
                filters={filters}
                facets={facets}
                onToggle={toggleFilterBool}
                faceScanStatus={faceScanStatus}
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={applyCleanMastersStack}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border whitespace-nowrap cursor-pointer ${
                  isCleanStackActive
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-800 hover:border-blue-500'
                }`}
                title="Stack Full Masters + Previewable + Hide Icons/GIFs in one click"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Clean Masters Preset</span>
                {isCleanStackActive && <Check className="w-3.5 h-3.5" />}
              </button>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset ({activeFilterCount})</span>
                </button>
              )}
            </div>
          </div>

          {faceScanStatus?.error && (
            <div
              role="alert"
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{faceScanStatus.error}</span>
            </div>
          )}

          {unscannedPendingCount > 0 && onScanHumanFaces && !faceScanStatus?.isScanning && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/35 border border-blue-200 dark:border-blue-800/70 text-blue-800 dark:text-blue-200 text-xs">
              <span>
                {unscannedPendingCount} newly added scraped image
                {unscannedPendingCount === 1 ? ' is' : 's are'} hidden until inspected by AI face detection.
              </span>
              <button
                type="button"
                onClick={() => void onScanHumanFaces(images)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors cursor-pointer"
              >
                <ScanFace className="w-3.5 h-3.5" />
                <span>Scan New (+{unscannedPendingCount})</span>
              </button>
            </div>
          )}

          <div className="pt-2.5 border-t border-zinc-100 dark:border-zinc-800/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">Format</span>
                <select
                  aria-label="Filter by format"
                  value={filters.format}
                  onChange={(e) => updateFilter('format', e.target.value)}
                  className="bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-zinc-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="all">All Formats</option>
                  <option value="jpg">JPG / JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WEBP</option>
                  <option value="avif">AVIF</option>
                  <option value="svg">SVG</option>
                  <option value="gif">GIF</option>
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">Resolution</span>
                <select
                  aria-label="Filter by resolution tier"
                  value={filters.resolution}
                  onChange={(e) => updateFilter('resolution', e.target.value)}
                  className="bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-zinc-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="all">All Tiers</option>
                  <option value="masters">Full Masters Only ({facets.masters})</option>
                  <option value="4k">4K Ultra HD (≥3840px)</option>
                  <option value="hd">Full HD (≥1920px)</option>
                  <option value="medium">Standard (≥800px)</option>
                  <option value="small">Small / Thumb</option>
                </select>
              </label>

              <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                <span className="font-medium">Orientation</span>
                <select
                  aria-label="Filter by orientation"
                  value={filters.orientation}
                  onChange={(e) => updateFilter('orientation', e.target.value as OrientationFilter)}
                  className="bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-zinc-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="all">All Orientations</option>
                  <option value="landscape">Landscape ({facets.landscape})</option>
                  <option value="portrait">Portrait ({facets.portrait})</option>
                  <option value="square">Square ({facets.square})</option>
                </select>
              </label>

              {nestedGalleries.length > 0 && (
                <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium">Gallery</span>
                  <select
                    aria-label="Filter by child gallery"
                    value={filters.galleryId || 'all'}
                    onChange={(e) => updateFilter('galleryId', e.target.value)}
                    className="bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-zinc-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 max-w-[200px]"
                  >
                    <option value="all">All Galleries ({images.length})</option>
                    {nestedGalleries.map((gal) => (
                      <option key={gal.id} value={gal.id}>
                        {gal.title} ({gal.imageCount})
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="text-zinc-500 dark:text-zinc-400 font-mono tabular-nums text-xs">
              Showing {filteredImages.length} of {images.length} images
            </div>
          </div>
        </div>
      </section>

      {/* Batch Action Toolbar */}
      <section className="bg-white dark:bg-[#101218] border border-[#E2DED3] dark:border-white/[0.08] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleSelectFullMasters}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              isAllMastersSelected
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
            title="Click to select or deselect all verified full-resolution master images matching current filters"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              {isAllMastersSelected
                ? `Deselect Masters (${filteredMasters.length})`
                : `Select Full Masters (${filteredMasters.length})`}
            </span>
          </button>

          <button
            type="button"
            onClick={handleSelectAll}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer"
          >
            {isAllSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            ) : (
              <Square className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>
              {isAllSelected
                ? `Deselect Matching (${filteredImages.length})`
                : activeFilterCount > 0
                  ? `Select Matching (${filteredImages.length})`
                  : 'Select All'}
            </span>
          </button>

          <button
            type="button"
            onClick={handleInvertSelection}
            className="px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors whitespace-nowrap cursor-pointer"
          >
            Invert
          </button>

          <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 pl-2 border-l border-zinc-200 dark:border-zinc-800 flex items-center gap-1">
            <span className="font-semibold text-zinc-900 dark:text-white">{selectedIds.size}</span>
            <span>selected</span>
            {selectedMastersCount > 0 && (
              <span className="ml-1 text-blue-600 dark:text-blue-400 font-semibold">
                ({selectedMastersCount} master{selectedMastersCount !== 1 ? 's' : ''})
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onDownloadIndividually && (() => {
            const directSaveTargets =
              selectedIds.size > 0
                ? images.filter((img) => selectedIds.has(img.id))
                : filteredImages;

            return (
              <>
                <button
                  type="button"
                  onClick={() => onDownloadIndividually(directSaveTargets)}
                  disabled={directSaveTargets.length === 0 || isDownloadingZip || isDirectSaving}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap cursor-pointer ${
                    selectedIds.size === 0
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200'
                  }`}
                  title="Progressively download images directly in parallel without creating a ZIP"
                >
                  <Download className={`w-3.5 h-3.5 ${selectedIds.size === 0 ? 'text-white' : 'text-blue-600 dark:text-blue-400'}`} />
                  <span className="tabular-nums">
                    {isDirectSaving
                      ? 'Saving...'
                      : selectedIds.size > 0
                        ? `Direct Save (${selectedIds.size})`
                        : `Direct Save All (${filteredImages.length})`}
                  </span>
                </button>

                {canPickFolder && (
                  <button
                    type="button"
                    onClick={() => onDownloadIndividually(directSaveTargets, { saveToFolder: true })}
                    disabled={directSaveTargets.length === 0 || isDownloadingZip || isDirectSaving}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 whitespace-nowrap cursor-pointer"
                    title="Choose a local folder and write all images directly to disk"
                  >
                    <FolderDown className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
                    <span>Save to Folder</span>
                  </button>
                )}
              </>
            );
          })()}

          <button
            type="button"
            onClick={() => setIsLinksModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            title="View, copy, and export full-res master links & subpage links"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              Get All Full Links ({activeFilterCount > 0 ? `${filteredImages.length}/${images.length}` : images.length})
            </span>
          </button>

          {onSendToCropResize && (
            <button
              type="button"
              onClick={() => {
                const targets =
                  selectedIds.size > 0
                    ? images.filter((img) => selectedIds.has(img.id))
                    : filteredImages;
                if (targets.length > 0) onSendToCropResize(targets);
              }}
              disabled={filteredImages.length === 0 && selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
              title="Open selected or filtered images inside Crop & Resize Studio"
            >
              <Crop className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Crop / Resize ({selectedIds.size > 0 ? selectedIds.size : filteredImages.length})</span>
            </button>
          )}

          {onSendToFilterStudio && (
            <button
              type="button"
              onClick={() => {
                const targets =
                  selectedIds.size > 0
                    ? images.filter((img) => selectedIds.has(img.id))
                    : filteredImages;
                if (targets.length > 0) onSendToFilterStudio(targets);
              }}
              disabled={filteredImages.length === 0 && selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
              title="Apply color adjustments and Snapchat-inspired lenses inside Filter Studio"
            >
              <Wand2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Filter &amp; Lens ({selectedIds.size > 0 ? selectedIds.size : filteredImages.length})</span>
            </button>
          )}

          {onSendToGifMaker && (
            <button
              type="button"
              onClick={() => {
                const targets =
                  selectedIds.size > 0
                    ? images.filter((img) => selectedIds.has(img.id))
                    : filteredImages;
                if (targets.length > 0) onSendToGifMaker(targets);
              }}
              disabled={filteredImages.length === 0 && selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
              title="Turn selected or filtered images into an animated GIF"
            >
              <Film className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Make GIF ({selectedIds.size > 0 ? selectedIds.size : filteredImages.length})</span>
            </button>
          )}

          {onSendToHumanClassifier && (
            <button
              type="button"
              onClick={() => {
                const targets =
                  selectedIds.size > 0
                    ? images.filter((img) => selectedIds.has(img.id))
                    : filteredImages;
                if (targets.length > 0) onSendToHumanClassifier(targets);
              }}
              disabled={filteredImages.length === 0 && selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
              title="Classify selected or filtered images by human identity with AI"
            >
              <Users className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Classify Humans ({selectedIds.size > 0 ? selectedIds.size : filteredImages.length})</span>
            </button>
          )}

          {onSendToGemmaCaptioner && (
            <button
              type="button"
              onClick={() => {
                const targets =
                  selectedIds.size > 0
                    ? images.filter((img) => selectedIds.has(img.id))
                    : filteredImages;
                if (targets.length > 0) onSendToGemmaCaptioner(targets);
              }}
              disabled={filteredImages.length === 0 && selectedIds.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
              title="Auto-caption selected or filtered images locally with open-source Gemma 4"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Caption with Gemma 4 ({selectedIds.size > 0 ? selectedIds.size : filteredImages.length})</span>
            </button>
          )}

          {onScanHumanFaces && (
            <button
              type="button"
              data-testid="toolbar-only-person-btn"
              aria-pressed={filters.onlyHumanFaces}
              disabled={images.length === 0 || Boolean(faceScanStatus?.isScanning)}
              onClick={() => toggleFilterBool('onlyHumanFaces')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                filters.onlyHumanFaces
                  ? 'bg-blue-600 hover:bg-blue-700 text-white border border-blue-600'
                  : 'bg-blue-50/85 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 text-blue-800 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900/55'
              }`}
              title="Use AI vision to keep only images containing a person/human face and exclude nature or landscape backgrounds"
            >
              {faceScanStatus?.isScanning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ScanFace className="w-3.5 h-3.5" />
              )}
              <span className="tabular-nums">
                {faceScanStatus?.isScanning
                  ? `Scanning People (${faceScanStatus.scanned}/${faceScanStatus.total})...`
                  : filters.onlyHumanFaces
                    ? `Only Person · Exclude Landscape (${facets.humanFaces ?? 0})`
                    : (facets.faceScanned ?? 0) > 0
                      ? `Only Person · Exclude Landscape (${facets.humanFaces ?? 0})`
                      : 'Only Person · Exclude Landscape (AI)'}
              </span>
              {filters.onlyHumanFaces && !faceScanStatus?.isScanning && (
                <Check className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleExportJson}
            className="px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
          >
            Export JSON
          </button>

          <div className="flex items-center gap-1.5">
            <div
              role="group"
              aria-label="Archive compression format"
              className="inline-flex items-center p-0.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shrink-0"
            >
              {(['7z', 'zip'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setActiveArchiveFormat(fmt)}
                  aria-pressed={activeArchiveFormat === fmt}
                  disabled={isDownloadingZip}
                  title={
                    fmt === '7z'
                      ? '7-Zip LZMA2 compression — smallest files (Default)'
                      : 'Standard ZIP archive — universal compatibility'
                  }
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-50 ${
                    activeArchiveFormat === fmt
                      ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                      : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleBatchDownload}
              disabled={selectedIds.size === 0 || isDownloadingZip}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                selectedIds.size > 0
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
              }`}
              title={`Download selected images as a .${activeArchiveFormat.toUpperCase()} archive named after page title`}
            >
              <FileArchive className={`w-3.5 h-3.5 ${isDownloadingZip ? 'animate-bounce' : ''}`} />
              <span className="tabular-nums">
                {isDownloadingZip
                  ? archiveProgress?.isRunning
                    ? `${archiveProgress.percent}% · Packaging .${activeArchiveFormat.toUpperCase()}`
                    : downloadProgress || `Packaging .${activeArchiveFormat.toUpperCase()}...`
                  : `Download Selected .${activeArchiveFormat.toUpperCase()} (${selectedIds.size})`}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Contact-Sheet Grid (Grouped by Child Gallery or Flat) */}
      {filteredImages.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-[#111319] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8">
          <ImageIcon className="w-10 h-10 mx-auto text-zinc-400 mb-3" />
          <h3 className="text-base font-semibold text-zinc-950 dark:text-white">
            No images match your stacked filters
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active. Remove one or reset the filter stack.
          </p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filter Stack</span>
            </button>
          )}
        </div>
      ) : groupedGallerySections ? (
        <div className="space-y-8">
          {groupedGallerySections.map((section, sIdx) => {
            const allGroupSelected = section.items.every((i) => selectedIds.has(i.id));
            return (
              <section key={section.id} className="space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#E4E0D6] dark:border-white/[0.08]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs tabular-nums text-zinc-400 shrink-0">
                        {String(sIdx + 1).padStart(2, '0')}.
                      </span>
                      <h3 className="font-display text-base sm:text-lg font-bold text-[#141413] dark:text-white truncate">
                        {section.title}
                      </h3>
                      <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 shrink-0">
                        · {section.items.length} photos
                      </span>
                    </div>
                    <a
                      href={section.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 truncate max-w-md mt-0.5"
                    >
                      <span className="truncate">{section.url}</span>
                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                    </a>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleSelectGalleryGroup(section.items)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] hover:border-blue-500 rounded-lg text-xs font-semibold text-[#141413] dark:text-zinc-200 transition-colors whitespace-nowrap shrink-0 self-start sm:self-center cursor-pointer tabular-nums"
                  >
                    {allGroupSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span>
                      {allGroupSelected
                        ? `Deselect Gallery (${section.items.length})`
                        : `Select Gallery (${section.items.length})`}
                    </span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
                  {section.items.map((img, itemIdx) => (
                    <GalleryCard
                      key={img.id}
                      img={img}
                      cardIndex={sIdx === 0 ? itemIdx : 12 + itemIdx}
                      sourceUrl={img.galleryUrl || sourceUrl}
                      aspectMode={aspectMode}
                      isSelected={selectedIds.has(img.id)}
                      previewInfo={previewMap[img.id]}
                      faceScan={faceScanMap?.[img.id]}
                      onToggleSelect={toggleSelect}
                      onSelectImage={onSelectImage}
                      onPreviewUpdate={handlePreviewUpdate}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {filteredImages.map((img, idx) => (
            <GalleryCard
              key={img.id}
              img={img}
              cardIndex={idx}
              sourceUrl={img.galleryUrl || sourceUrl}
              aspectMode={aspectMode}
              isSelected={selectedIds.has(img.id)}
              previewInfo={previewMap[img.id]}
              faceScan={faceScanMap?.[img.id]}
              onToggleSelect={toggleSelect}
              onSelectImage={onSelectImage}
              onPreviewUpdate={handlePreviewUpdate}
            />
          ))}
        </div>
      )}

      {hasMorePosts && onLoadMorePosts && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onLoadMorePosts}
            disabled={isLoadingMorePosts}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-blue-600 dark:hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
          >
            {isLoadingMorePosts ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading next Instagram posts...</span>
              </>
            ) : (
              <>
                <PlusCircle className="w-4 h-4" />
                <span className="tabular-nums">
                  Load More Posts ({images.length}
                  {totalProfilePosts ? ` / ~${totalProfilePosts.toLocaleString()}` : ''})
                </span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Full Links Modal & Exporter */}
      <FullImageLinksModal
        isOpen={isLinksModalOpen}
        onClose={() => setIsLinksModalOpen(false)}
        images={images}
        pageTitle={pageTitle}
        sourceUrl={sourceUrl}
        onBatchDownloadZip={onBatchDownloadZip}
        onDirectSaveAll={onDownloadIndividually}
        isDownloadingZip={isDownloadingZip}
        isDirectSaving={isDirectSaving}
        downloadProgress={downloadProgress}
        archiveProgress={archiveProgress}
        onPauseArchiveDownload={onPauseArchiveDownload}
        onResumeArchiveDownload={onResumeArchiveDownload}
        onCancelArchiveDownload={onCancelArchiveDownload}
        onDismissArchiveDownload={onDismissArchiveDownload}
        archiveFormat={activeArchiveFormat}
        onArchiveFormatChange={setActiveArchiveFormat}
        initialFilters={filters}
        previewMap={previewMap}
        faceScanMap={faceScanMap}
        faceScanStatus={faceScanStatus}
        onScanHumanFaces={onScanHumanFaces}
      />
    </div>
  );
};
