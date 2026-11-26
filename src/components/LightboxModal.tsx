'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { ScrapedImage, classifyResolution } from '../utils/scraperLogic';
import {
  downloadFileToDisk,
  buildViewImageUrl,
  buildDownloadFileUrl,
} from '../utils/downloader';
import {
  buildProxyImageUrl,
  getOrCreateCachedBlobUrl,
  getWorkingPreviewUrl,
  registerWorkingPreviewUrl,
  warmImageBlobCacheFromLoadedPreview,
} from '../utils/clientImageCache';

interface LightboxModalProps {
  image: ScrapedImage | null;
  images: ScrapedImage[];
  sourcePageUrl?: string;
  onClose: () => void;
  onNavigate: (direction: number) => void;
  onDeepResolve?: (image: ScrapedImage) => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({
  image,
  images,
  sourcePageUrl,
  onClose,
  onNavigate,
  onDeepResolve,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isImageLoading, setIsImageLoading] = useState<boolean>(true);
  const [candidateIdx, setCandidateIdx] = useState<number>(0);

  const candidateUrls = useMemo(() => {
    if (!image) return [];
    const urls: string[] = [];
    const pushUnique = (u?: string) => {
      if (u && !urls.includes(u)) urls.push(u);
    };
    const cachedBlobUrl = getOrCreateCachedBlobUrl(image.fullUrl);
    if (cachedBlobUrl) {
      pushUnique(cachedBlobUrl);
    }
    const knownWorking = getWorkingPreviewUrl(image.fullUrl);
    if (knownWorking) {
      pushUnique(knownWorking);
    }
    pushUnique(image.fullUrl);
    pushUnique(image.fallbackUrl);
    if (image.fullUrl) {
      pushUnique(buildProxyImageUrl(image.fullUrl, sourcePageUrl || ''));
    }
    return urls;
  }, [image, sourcePageUrl]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNavigate(1);
      if (e.key === 'ArrowLeft') onNavigate(-1);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNavigate]);

  // Reset state on image change without triggering a duplicate network probe
  useEffect(() => {
    if (image) {
      setZoomLevel(1);
      setShowComparison(false);
      setIsCopied(false);
      setNaturalDimensions(null);
      setCandidateIdx(0);
      setIsImageLoading(true);
    }
  }, [image]);

  if (!image) return null;

  const activeFullSrc = candidateUrls[candidateIdx] || image.fullUrl;
  const displayedSrc = showComparison ? image.thumbnailUrl : activeFullSrc;

  const advanceFallback = () => {
    if (!showComparison && candidateIdx + 1 < candidateUrls.length) {
      setCandidateIdx((prev) => prev + 1);
      setIsImageLoading(true);
    } else {
      setIsImageLoading(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(image.fullUrl);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const currentIndex = images.findIndex((img) => img.id === image.id);
  const displayWidth = naturalDimensions?.width || image.width;
  const displayHeight = naturalDimensions?.height || image.height;
  const displayTier = displayWidth && displayHeight ? classifyResolution(displayWidth, displayHeight) : image.resolutionTier;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-zinc-950/85 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <h3 className="text-sm sm:text-base font-display font-bold text-zinc-950 dark:text-zinc-50 truncate">
              {image.filename}
            </h3>
            {image.isUnshrunk && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 shrink-0">
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <Sparkles className="w-3 h-3" />
                <span>Full-Res Master</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 hidden sm:inline">
              {currentIndex + 1} / {images.length}
            </span>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Darkroom Viewport + Inspector Sidebar */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0">
          {/* Main Visual Viewport */}
          <div className="relative flex-1 bg-[#090A0F] flex items-center justify-center overflow-auto p-4 select-none group min-h-[350px]">
            {isImageLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#090A0F]/70 z-20">
                <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            <div
              className="relative transition-transform duration-200 ease-out flex items-center justify-center max-w-full max-h-full"
              style={{ transform: `scale(${zoomLevel})` }}
            >
              <img
                data-full-url={image.fullUrl}
                src={displayedSrc}
                alt={image.altText}
                referrerPolicy="no-referrer"
                onLoad={(e) => {
                  const target = e.currentTarget;
                  if (target.naturalWidth <= 1 || target.naturalHeight <= 1) {
                    advanceFallback();
                    return;
                  }
                  setNaturalDimensions({ width: target.naturalWidth, height: target.naturalHeight });
                  setIsImageLoading(false);
                  if (!showComparison && activeFullSrc) {
                    registerWorkingPreviewUrl(image.fullUrl, activeFullSrc);
                    void warmImageBlobCacheFromLoadedPreview(image.fullUrl, activeFullSrc);
                  }
                }}
                onError={advanceFallback}
                className="max-w-full max-h-[60vh] lg:max-h-[70vh] object-contain rounded shadow-lg pointer-events-none"
              />
            </div>

            {/* Navigation Arrows */}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate(-1)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-[#111318]/85 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate(1)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-[#111318]/85 hover:bg-zinc-800 border border-zinc-800 text-zinc-100 backdrop-blur transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer"
                  aria-label="Next image"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}

            {/* Floating Zoom & Compare Toolbar */}
            <div className="absolute bottom-4 inset-x-0 flex justify-center items-center gap-2 pointer-events-auto">
              <div className="bg-[#111318]/90 backdrop-blur-md border border-zinc-800 rounded-lg p-1 flex items-center gap-1 shadow-lg text-zinc-100">
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
                  className="p-1.5 hover:bg-zinc-800 rounded text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  title="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-[11px] font-mono px-1.5 text-zinc-300 tabular-nums">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="p-1.5 hover:bg-zinc-800 rounded text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  title="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <div className="h-4 w-px bg-zinc-800 mx-1" />
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="p-1.5 hover:bg-zinc-800 rounded text-zinc-300 hover:text-white transition-colors cursor-pointer"
                  title="Fit to view"
                >
                  <Maximize className="w-4 h-4" />
                </button>
                {image.isUnshrunk && (
                  <>
                    <div className="h-4 w-px bg-zinc-800 mx-1" />
                    <button
                      type="button"
                      onClick={() => setShowComparison(!showComparison)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                        showComparison
                          ? 'bg-amber-500 text-zinc-950 font-semibold'
                          : 'text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      {showComparison ? 'Showing: Thumb Preview' : 'Compare: Preview'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar Metadata */}
          <div className="w-full lg:w-84 bg-white dark:bg-[#111318] border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-5">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
                  Resolution &amp; Geometry
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                    <span className="text-zinc-500 dark:text-zinc-400">Dimensions</span>
                    <span className="font-mono font-semibold text-zinc-950 dark:text-zinc-100 tabular-nums">
                      {displayWidth && displayHeight ? `${displayWidth} × ${displayHeight} px` : 'Auto-detected'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                    <span className="text-zinc-500 dark:text-zinc-400">Format</span>
                    <span className="font-mono uppercase font-semibold text-zinc-950 dark:text-zinc-100">
                      {image.format}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1.5 border-b border-zinc-100 dark:border-zinc-800/80">
                    <span className="text-zinc-500 dark:text-zinc-400">Resolution Tier</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400 uppercase tabular-nums">
                      {displayTier === '4k'
                        ? '4K Ultra HD (≥3840px)'
                        : displayTier === 'hd'
                          ? 'Full HD (≥1920px)'
                          : displayTier === 'medium'
                            ? 'Standard High-Res'
                            : displayTier.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-3">
                  Extraction Intelligence
                </h4>
                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400 block mb-1">
                      Unshrinking Method
                    </span>
                    <span
                      className="font-mono text-[11px] text-zinc-900 dark:text-zinc-200 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 rounded-md block truncate"
                      title={image.unshrinkMethod}
                    >
                      {image.unshrinkMethod}
                    </span>
                  </div>

                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400 block mb-1">
                      Full-Res Source URL
                    </span>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={image.fullUrl}
                        className="w-full text-[11px] font-mono bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md px-2.5 py-1.5 pr-8 text-zinc-800 dark:text-zinc-200 truncate focus:outline-none focus:border-blue-600"
                      />
                      <button
                        onClick={handleCopyUrl}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                        title="Copy full URL"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {image.galleryTitle && (
                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                      <span className="text-zinc-500 dark:text-zinc-400 block mb-1 text-[11px]">
                        Child Gallery Source
                      </span>
                      <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {image.galleryTitle}
                      </div>
                      {image.galleryUrl && (
                        <a
                          href={image.galleryUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline truncate block mt-0.5"
                          title={image.galleryUrl}
                        >
                          {image.galleryUrl}
                        </a>
                      )}
                    </div>
                  )}

                  {image.linkedPageUrl && (
                    <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
                      <span className="text-zinc-500 dark:text-zinc-400 block mb-1 text-[11px]">
                        Linked Detail Webpage
                      </span>
                      <div className="flex items-center gap-1.5">
                        <a
                          href={image.linkedPageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate flex-1"
                          title={image.linkedPageUrl}
                        >
                          {image.linkedPageUrl}
                        </a>
                        {onDeepResolve && (
                          <button
                            type="button"
                            onClick={() => onDeepResolve(image)}
                            className="px-2 py-1 text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-700 dark:text-zinc-200 shrink-0 transition-colors cursor-pointer"
                          >
                            Re-scan Webpage
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions: Single Primary Cobalt CTA + High-Contrast Neutral Secondary + Subtle Ghost */}
            <div className="pt-6 space-y-2">
              <a
                href={buildDownloadFileUrl(image.fullUrl, image.filename, sourcePageUrl)}
                download={image.filename}
                onClick={(e) => {
                  e.preventDefault();
                  downloadFileToDisk(image.fullUrl, image.filename, sourcePageUrl || '', {
                    fallbackUrl: image.fallbackUrl,
                    linkedPageUrl: image.linkedPageUrl,
                  });
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Download Master Image</span>
              </a>

              <a
                href={buildViewImageUrl({
                  fullUrl: image.fullUrl,
                  title: image.filename,
                  sourcePage: sourcePageUrl,
                  linkedPage: image.linkedPageUrl,
                  method: image.unshrinkMethod,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-950 font-semibold text-xs rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Full Image in New Webpage</span>
              </a>

              <a
                href={image.fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-1.5 py-2 px-4 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium text-xs rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Direct Raw File</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
