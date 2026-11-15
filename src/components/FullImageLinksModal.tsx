import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  ExternalLink,
  Search,
  FileText,
  FileCode,
  Table as TableIcon,
  Globe,
  Sparkles,
  Link2,
  FileArchive,
  RotateCcw,
} from 'lucide-react';
import {
  ScrapedImage,
  GalleryFilterState,
  DEFAULT_GALLERY_FILTERS,
  PreviewStateInfo,
  OrientationFilter,
  filterScrapedImages,
  countActiveFilters,
  getFilterFacetCounts,
  getEffectiveDimensions,
} from '../utils/scraperLogic';
import {
  downloadFileToDisk,
  triggerBlobDownload,
  triggerTextDownload,
  buildViewImageUrl,
} from '../utils/downloader';
import { FilterChipsRow, BooleanFilterKey } from './FilterStackBar';

interface FullImageLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: ScrapedImage[];
  pageTitle: string;
  sourceUrl: string;
  onBatchDownloadZip?: (selectedImages: ScrapedImage[]) => void;
  onDirectSaveAll?: (
    selectedImages: ScrapedImage[],
    options?: { saveToFolder?: boolean }
  ) => void;
  isDownloadingZip?: boolean;
  isDirectSaving?: boolean;
  downloadProgress?: string | null;
  initialFilters?: GalleryFilterState;
  previewMap?: Record<string, PreviewStateInfo>;
}

type ViewMode = 'direct_links' | 'webpage_links' | 'table' | 'json' | 'csv';

export const FullImageLinksModal: React.FC<FullImageLinksModalProps> = ({
  isOpen,
  onClose,
  images,
  pageTitle,
  sourceUrl,
  onBatchDownloadZip,
  onDirectSaveAll,
  isDownloadingZip = false,
  isDirectSaving = false,
  downloadProgress = null,
  initialFilters,
  previewMap,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('direct_links');
  const [filters, setFilters] = useState<GalleryFilterState>(
    initialFilters || DEFAULT_GALLERY_FILTERS
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isZippingLocal, setIsZippingLocal] = useState<boolean>(false);
  const [localZipProgress, setLocalZipProgress] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialFilters) {
      setFilters(initialFilters);
    }
  }, [isOpen, initialFilters]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const facets = useMemo(() => getFilterFacetCounts(images, previewMap), [images, previewMap]);

  const filteredImages = useMemo(
    () => filterScrapedImages(images, filters, previewMap),
    [images, filters, previewMap]
  );

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const toggleFilterBool = (key: BooleanFilterKey) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const directLinksText = useMemo(() => {
    return filteredImages.map((img) => img.fullUrl).join('\n');
  }, [filteredImages]);

  const webpageLinksText = useMemo(() => {
    return filteredImages
      .map((img) => img.linkedPageUrl || img.fullUrl)
      .join('\n');
  }, [filteredImages]);

  const jsonExportText = useMemo(() => {
    const data = filteredImages.map((img, idx) => {
      const dims = getEffectiveDimensions(img, previewMap?.[img.id]);
      return {
        index: idx + 1,
        id: img.id,
        filename: img.filename,
        width: dims.width,
        height: dims.height,
        resolutionTier: dims.tier,
        isUnshrunk: img.isUnshrunk,
        unshrinkMethod: img.unshrinkMethod,
        masterDirectDownloadUrl: img.fullUrl,
        masterWebpageUrl: img.linkedPageUrl || null,
        thumbnailUrl: img.thumbnailUrl,
      };
    });
    return JSON.stringify(data, null, 2);
  }, [filteredImages, previewMap]);

  const csvExportText = useMemo(() => {
    const headers = [
      'Index',
      'Filename',
      'Resolution',
      'UnshrinkMethod',
      'DirectMasterUrl',
      'WebpageUrl',
    ];
    const rows = filteredImages.map((img, idx) => {
      const dims = getEffectiveDimensions(img, previewMap?.[img.id]);
      return [
        idx + 1,
        `"${img.filename.replace(/"/g, '""')}"`,
        `"${dims.width && dims.height ? `${dims.width}x${dims.height}` : dims.tier}"`,
        `"${(img.unshrinkMethod || '').replace(/"/g, '""')}"`,
        `"${img.fullUrl.replace(/"/g, '""')}"`,
        `"${(img.linkedPageUrl || '').replace(/"/g, '""')}"`,
      ];
    });
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }, [filteredImages, previewMap]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 2000);
  };

  const handleDownloadTextFile = (
    content: string,
    filename: string,
    mimeType = 'text/plain'
  ) => {
    triggerTextDownload(content, filename, mimeType);
  };

  const isBusyZipping = isDownloadingZip || isZippingLocal;
  const currentZipProgress = downloadProgress || localZipProgress;

  const handleServerDownloadZip = async () => {
    if (filteredImages.length === 0 || isBusyZipping) return;

    if (onBatchDownloadZip) {
      onBatchDownloadZip(filteredImages);
      return;
    }

    try {
      setIsZippingLocal(true);
      setLocalZipProgress('Connecting to server ZIP packager...');

      const response = await fetch('/api/download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: filteredImages.map((img) => ({
            url: img.fullUrl,
            fallbackUrl: img.fallbackUrl,
            linkedPageUrl: img.linkedPageUrl,
            filename: img.filename,
          })),
          referer: sourceUrl,
          onlyFullRes: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      setLocalZipProgress('Transferring ZIP package...');
      const blob = await response.blob();
      const safeTitle = (pageTitle || 'master_images').replace(/[^a-zA-Z0-9_-]/g, '_');
      triggerBlobDownload(blob, `${safeTitle}_fullres_${Date.now()}.zip`);
      setLocalZipProgress('ZIP downloaded successfully!');
      setTimeout(() => setLocalZipProgress(null), 3000);
    } catch (err: any) {
      setLocalZipProgress(`Server ZIP download failed: ${err.message}`);
    } finally {
      setIsZippingLocal(false);
    }
  };

  const handleDirectSaveFiltered = () => {
    if (filteredImages.length === 0 || isDirectSaving || !onDirectSaveAll) return;
    onClose();
    onDirectSaveAll(filteredImages);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-zinc-950/80 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-5xl h-[88vh] max-h-[900px] flex flex-col shadow-2xl overflow-hidden text-zinc-950 dark:text-zinc-50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link2 className="w-5 h-5 text-blue-600 dark:text-blue-500 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-display font-bold truncate">
                  Full Image Links Harvester
                </h3>
                <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  · {filteredImages.length} / {images.length} Links
                  {activeFilterCount > 0
                    ? ` · ${activeFilterCount} Filter${activeFilterCount !== 1 ? 's' : ''} Stacked`
                    : ''}
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {pageTitle || sourceUrl || 'Extracted Gallery Master Links'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close links modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Mode Navigation & Stackable Filter Row */}
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2.5 bg-white dark:bg-[#111318] text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 flex-wrap p-1 bg-zinc-100 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('direct_links')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewMode === 'direct_links'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Direct Master Links (CDN)</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('webpage_links')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewMode === 'webpage_links'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Master Webpage Links</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Interactive Table</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('json')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewMode === 'json'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('csv')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  viewMode === 'csv'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={filters.searchQuery}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, searchQuery: e.target.value }))
                }
                placeholder="Filter links..."
                className="pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs w-44 sm:w-52 text-zinc-950 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Stackable High-Level Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-zinc-100 dark:border-zinc-800/70">
            <FilterChipsRow
              filters={filters}
              facets={facets}
              onToggle={toggleFilterBool}
              compact
            />

            <select
              aria-label="Filter modal links by orientation"
              value={filters.orientation}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  orientation: e.target.value as OrientationFilter,
                }))
              }
              className="bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md px-2 py-1 text-[11px] text-zinc-700 dark:text-zinc-200 font-medium focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Orientations</option>
              <option value="landscape">Landscape ({facets.landscape})</option>
              <option value="portrait">Portrait ({facets.portrait})</option>
              <option value="square">Square ({facets.square})</option>
            </select>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_GALLERY_FILTERS)}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Clear ({activeFilterCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Main Content Area */}
        <div className="flex-1 overflow-auto p-4 sm:p-5 bg-[#F9F9FB] dark:bg-[#090A0F] font-mono text-xs">
          {viewMode === 'direct_links' && (
            <div className="flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 flex-wrap gap-2 font-sans">
                <span className="tabular-nums">
                  Showing {filteredImages.length} direct master download link(s) (1 URL per line):
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleCopy(directLinksText, 'direct_all')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 rounded-lg font-semibold transition-colors cursor-pointer"
                  >
                    {copiedKey === 'direct_all' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'direct_all' ? 'Copied All!' : 'Copy All Links'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadTextFile(
                        directLinksText,
                        `direct_master_image_links_${Date.now()}.txt`
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .TXT</span>
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={directLinksText}
                rows={18}
                className="w-full flex-1 p-3.5 bg-white dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 focus:outline-none resize-none select-all"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
          )}

          {viewMode === 'webpage_links' && (
            <div className="flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 flex-wrap gap-2 font-sans">
                <span className="tabular-nums">
                  Showing {filteredImages.length} master webpage / detail subpage link(s):
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleCopy(webpageLinksText, 'webpage_all')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 rounded-lg font-semibold transition-colors cursor-pointer"
                  >
                    {copiedKey === 'webpage_all' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'webpage_all' ? 'Copied All!' : 'Copy Webpage Links'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadTextFile(
                        webpageLinksText,
                        `master_webpage_links_${Date.now()}.txt`
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .TXT</span>
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={webpageLinksText}
                rows={18}
                className="w-full flex-1 p-3.5 bg-white dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 focus:outline-none resize-none select-all"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
          )}

          {viewMode === 'table' && (
            <div className="flex flex-col space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 flex-wrap gap-2 font-sans">
                <span className="tabular-nums">
                  Showing {filteredImages.length} images with dimensions and direct actions:
                </span>
              </div>

              <div className="overflow-x-auto bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-zinc-50 dark:bg-[#0B0C10] border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 font-sans">
                      <th className="py-2.5 px-3 w-12 text-center">#</th>
                      <th className="py-2.5 px-3 w-14">Thumb</th>
                      <th className="py-2.5 px-3">Filename &amp; Dimensions</th>
                      <th className="py-2.5 px-3">Master Direct Download Link</th>
                      <th className="py-2.5 px-3">Linked Webpage</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70 text-[11px]">
                    {filteredImages.map((img, idx) => {
                      const dims = getEffectiveDimensions(img, previewMap?.[img.id]);
                      return (
                        <tr
                          key={img.id || idx}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-3 text-center text-zinc-400 font-mono tabular-nums">
                            {idx + 1}
                          </td>

                          <td className="py-2.5 px-3">
                            <img
                              src={img.thumbnailUrl}
                              alt={img.filename}
                              referrerPolicy="no-referrer"
                              onError={(e) => {
                                const target = e.currentTarget;
                                if (target.src !== img.fullUrl) {
                                  target.src = img.fullUrl;
                                }
                              }}
                              className="w-10 h-10 object-cover rounded bg-zinc-200 dark:bg-zinc-800"
                            />
                          </td>

                          <td className="py-2.5 px-3">
                            <div
                              className="font-sans font-semibold text-zinc-950 dark:text-zinc-100 truncate max-w-[180px]"
                              title={img.filename}
                            >
                              {img.filename}
                            </div>
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 mt-0.5 tabular-nums">
                              <span className="uppercase font-semibold text-blue-600 dark:text-blue-400">
                                {img.format}
                              </span>
                              <span>·</span>
                              <span>
                                {dims.width && dims.height
                                  ? `${dims.width}×${dims.height} px`
                                  : dims.tier.toUpperCase()}
                              </span>
                            </div>
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5 max-w-[280px]">
                              <span
                                className="truncate text-zinc-700 dark:text-zinc-300"
                                title={img.fullUrl}
                              >
                                {img.fullUrl}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(img.fullUrl, `link_${idx}`)}
                                className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded shrink-0 cursor-pointer"
                                title="Copy Direct Master Link"
                              >
                                {copiedKey === `link_${idx}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>

                          <td className="py-2.5 px-3">
                            {img.linkedPageUrl ? (
                              <div className="flex items-center gap-1.5 max-w-[220px]">
                                <a
                                  href={img.linkedPageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 dark:text-blue-400 hover:underline truncate"
                                  title={img.linkedPageUrl}
                                >
                                  {img.linkedPageUrl}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(img.linkedPageUrl!, `page_${idx}`)}
                                  className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded shrink-0 cursor-pointer"
                                  title="Copy Linked Webpage URL"
                                >
                                  {copiedKey === `page_${idx}` ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            ) : (
                              <span className="text-zinc-400 text-[10px]">—</span>
                            )}
                          </td>

                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  downloadFileToDisk(img.fullUrl, img.filename, sourceUrl, {
                                    fallbackUrl: img.fallbackUrl,
                                    linkedPageUrl: img.linkedPageUrl,
                                  })
                                }
                                className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-600 text-zinc-700 dark:text-zinc-200 rounded transition-colors cursor-pointer"
                                title="Download master image file directly"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>

                              <a
                                href={buildViewImageUrl({
                                  fullUrl: img.fullUrl,
                                  title: img.filename,
                                  sourcePage: sourceUrl,
                                  linkedPage: img.linkedPageUrl,
                                })}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded transition-colors"
                                title="Open full-sized master in standalone webpage"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {viewMode === 'json' && (
            <div className="flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-sans">
                <span>Structured JSON array of all harvested image links and metadata:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(jsonExportText, 'json_all')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 rounded-lg font-semibold transition-colors cursor-pointer"
                  >
                    {copiedKey === 'json_all' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'json_all' ? 'Copied JSON!' : 'Copy JSON'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadTextFile(
                        jsonExportText,
                        `image_links_${Date.now()}.json`,
                        'application/json'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .JSON</span>
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={jsonExportText}
                rows={18}
                className="w-full flex-1 p-3.5 bg-white dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 focus:outline-none resize-none select-all"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
          )}

          {viewMode === 'csv' && (
            <div className="flex flex-col h-full space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-sans">
                <span>CSV format with columns for Index, Filename, Resolution, URLs:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(csvExportText, 'csv_all')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 rounded-lg font-semibold transition-colors cursor-pointer"
                  >
                    {copiedKey === 'csv_all' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'csv_all' ? 'Copied CSV!' : 'Copy CSV'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadTextFile(
                        csvExportText,
                        `image_links_${Date.now()}.csv`,
                        'text/csv'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .CSV</span>
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={csvExportText}
                rows={18}
                className="w-full flex-1 p-3.5 bg-white dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 focus:outline-none resize-none select-all"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
          )}
        </div>

        {/* Footer: Single Cobalt Primary CTA + High-Contrast Neutral Secondary + Close */}
        <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111318] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 font-sans">
            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-500 shrink-0" />
            <span className="tabular-nums">
              {isBusyZipping
                ? currentZipProgress || 'Packaging master images into ZIP on server...'
                : `Ready for parallel direct save or ZIP packaging (${filteredImages.length} images)`}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {onDirectSaveAll && (
              <button
                type="button"
                onClick={handleDirectSaveFiltered}
                disabled={filteredImages.length === 0 || isBusyZipping || isDirectSaving}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors font-sans cursor-pointer whitespace-nowrap tabular-nums"
                title="Progressively download all listed images directly in parallel"
              >
                <Download className="w-4 h-4" />
                <span>Direct Save All ({filteredImages.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleServerDownloadZip}
              disabled={filteredImages.length === 0 || isBusyZipping}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 disabled:opacity-50 text-white dark:text-zinc-950 rounded-lg font-semibold transition-colors font-sans cursor-pointer whitespace-nowrap tabular-nums"
              title="Download all listed full-resolution images as a packaged ZIP archive via server"
            >
              <FileArchive className={`w-4 h-4 ${isBusyZipping ? 'animate-bounce' : ''}`} />
              <span>
                {isBusyZipping
                  ? currentZipProgress || 'Packaging Server ZIP...'
                  : `Download Full ZIP (${filteredImages.length})`}
              </span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg font-medium transition-colors font-sans cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
