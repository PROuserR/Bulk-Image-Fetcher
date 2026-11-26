'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCw,
  Star,
  Play,
  Pause,
  Info,
  Download,
  FolderOpen,
} from 'lucide-react';
import {
  FolderGalleryItem,
  clampLightboxZoom,
  clampPanOffset,
  computeSteppedZoom,
  formatGalleryDate,
  formatMegapixels,
} from '../utils/folderGalleryLogic';
import { formatBytesCompact } from '../utils/imageTransformLogic';
import { triggerBlobDownload } from '../utils/downloader';

interface FolderLightboxModalProps {
  item: FolderGalleryItem | null;
  items: FolderGalleryItem[];
  onClose: () => void;
  onSelectItem: (item: FolderGalleryItem) => void;
  onToggleStar: (id: string) => void;
  onRotateItem: (id: string) => void;
}

export const FolderLightboxModal: React.FC<FolderLightboxModalProps> = ({
  item,
  items,
  onClose,
  onSelectItem,
  onToggleStar,
  onRotateItem,
}) => {
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [isSlideshow, setIsSlideshow] = useState<boolean>(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const currentIndex = item ? items.findIndex((i) => i.id === item.id) : -1;

  const navigateBy = (delta: number) => {
    if (!item || items.length === 0) return;
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx === -1) return;
    const nextIdx = (idx + delta + items.length) % items.length;
    onSelectItem(items[nextIdx]);
  };

  // Reset zoom & pan whenever active item changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [item?.id]);

  // Slideshow timer (3 seconds per slide)
  useEffect(() => {
    if (!isSlideshow || !item || items.length <= 1) return;
    const timer = setInterval(() => {
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx !== -1) {
        onSelectItem(items[(idx + 1) % items.length]);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [isSlideshow, item, items, onSelectItem]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsSlideshow(false);
        navigateBy(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsSlideshow(false);
        navigateBy(-1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => computeSteppedZoom(z, 'in'));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => {
          const next = computeSteppedZoom(z, 'out');
          if (next <= 1) setPan({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === '0') {
        e.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key === '1') {
        e.preventDefault();
        setZoom(2);
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsSlideshow((s) => !s);
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        onRotateItem(item.id);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onToggleStar(item.id);
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setShowInfo((s) => !s);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!item) return null;

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    setZoom((prev) => {
      const next = clampLightboxZoom(prev * factor);
      if (next <= 1.01) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1.01) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const rect = stageRef.current?.getBoundingClientRect();
    setPan(
      clampPanOffset(
        dragStartRef.current.panX + dx,
        dragStartRef.current.panY + dy,
        zoom,
        rect?.width || 1000,
        rect?.height || 700
      )
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleDoubleClick = () => {
    if (zoom > 1.05) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      setZoom(2);
    }
  };

  const handleDownloadCurrent = async () => {
    try {
      const resp = await fetch(item.previewUrl);
      const blob = await resp.blob();
      triggerBlobDownload(blob, item.filename);
    } catch {
      const a = document.createElement('a');
      a.href = item.previewUrl;
      a.download = item.filename;
      a.click();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${item.filename}`}
      className="fixed inset-0 z-50 bg-[#07090E]/95 backdrop-blur-md flex flex-col text-[#F3F6FA] select-none"
    >
      {/* Top Bar */}
      <header className="h-14 px-4 sm:px-6 border-b border-white/[0.08] flex items-center justify-between gap-4 shrink-0 bg-[#0A0D14]/90">
        <div className="min-w-0 flex items-center gap-3">
          <h2 className="font-display text-sm sm:text-base font-bold truncate text-white">
            {item.filename}
          </h2>
          <span className="hidden md:inline text-xs font-mono tabular-nums text-slate-400">
            {item.subfolder} · {item.width}×{item.height} px · {formatMegapixels(item.width, item.height)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono tabular-nums text-slate-400 mr-1">
            {currentIndex + 1} / {items.length}
          </span>

          <button
            type="button"
            onClick={() => onToggleStar(item.id)}
            aria-label={item.starred ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={item.starred}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              item.starred
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                : 'bg-white/[0.05] border-white/[0.08] text-slate-300 hover:text-white'
            }`}
          >
            <Star className={`w-4 h-4 ${item.starred ? 'fill-amber-300' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setShowInfo((s) => !s)}
            aria-label="Toggle image metadata inspector"
            aria-pressed={showInfo}
            className={`p-2 rounded-lg border transition-colors cursor-pointer ${
              showInfo
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-white/[0.05] border-white/[0.08] text-slate-300 hover:text-white'
            }`}
          >
            <Info className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleDownloadCurrent}
            aria-label={`Download ${item.filename}`}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close gallery lightbox"
            className="p-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-slate-300 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Center Darkroom Canvas + Optional Info Inspector */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          ref={stageRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          className={`relative flex-1 flex items-center justify-center overflow-hidden p-4 sm:p-8 ${
            zoom > 1.01 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
          }`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.previewUrl}
            alt={item.filename}
            referrerPolicy="no-referrer"
            draggable={false}
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom}) rotate(${item.rotationDeg}deg)`,
            }}
            className={`max-w-full max-h-full object-contain rounded shadow-2xl pointer-events-none ${
              isDragging ? '' : 'transition-transform duration-150 ease-out'
            }`}
          />

          {/* Prev / Next Overlay Navigation */}
          {items.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSlideshow(false);
                  navigateBy(-1);
                }}
                aria-label="Previous image"
                className="absolute left-3 sm:left-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#0E121B]/85 hover:bg-[#171E2E] border border-white/15 text-white flex items-center justify-center backdrop-blur-md transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSlideshow(false);
                  navigateBy(1);
                }}
                aria-label="Next image"
                className="absolute right-3 sm:right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[#0E121B]/85 hover:bg-[#171E2E] border border-white/15 text-white flex items-center justify-center backdrop-blur-md transition-colors cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {/* Bottom Floating Zoom & Viewer Controls */}
          <div
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 inset-x-0 flex justify-center px-4 pointer-events-none"
          >
            <div className="pointer-events-auto inline-flex flex-wrap items-center justify-center gap-1 bg-[#0E121B]/92 backdrop-blur-md border border-white/12 rounded-xl px-2 py-1.5 shadow-xl">
              <button
                type="button"
                onClick={() =>
                  setZoom((z) => {
                    const next = computeSteppedZoom(z, 'out');
                    if (next <= 1.01) setPan({ x: 0, y: 0 });
                    return next;
                  })
                }
                aria-label="Zoom out"
                title="Zoom out (-)"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" />
              </button>

              <span
                data-testid="lightbox-zoom-readout"
                className="min-w-[46px] text-center text-xs font-mono tabular-nums text-slate-200"
              >
                {Math.round(zoom * 100)}%
              </span>

              <button
                type="button"
                onClick={() => setZoom((z) => computeSteppedZoom(z, 'in'))}
                aria-label="Zoom in"
                title="Zoom in (+)"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              <div className="h-4 w-px bg-white/15 mx-1" />

              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                aria-label="Fit image to screen"
                title="Fit to screen (0)"
                className="px-2 py-1 rounded-lg text-xs font-medium text-slate-200 hover:bg-white/[0.08] cursor-pointer whitespace-nowrap"
              >
                Fit
              </button>

              <button
                type="button"
                onClick={() => setZoom(2)}
                aria-label="Zoom to 200 percent"
                title="200% detail (1)"
                className="px-2 py-1 rounded-lg text-xs font-mono tabular-nums font-medium text-slate-200 hover:bg-white/[0.08] cursor-pointer whitespace-nowrap"
              >
                200%
              </button>

              <button
                type="button"
                onClick={() => onRotateItem(item.id)}
                aria-label="Rotate image 90 degrees"
                title="Rotate 90° (R)"
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.08] cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              {items.length > 1 && (
                <>
                  <div className="h-4 w-px bg-white/15 mx-1" />
                  <button
                    type="button"
                    onClick={() => setIsSlideshow((s) => !s)}
                    aria-label={isSlideshow ? 'Pause slideshow' : 'Play slideshow'}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      isSlideshow
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-200 hover:bg-white/[0.08]'
                    }`}
                  >
                    {isSlideshow ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        <span>Slideshow</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Right Metadata Sidebar */}
        {showInfo && (
          <aside
            aria-label="Image details inspector"
            className="w-72 sm:w-80 bg-[#0E121B] border-l border-white/[0.08] p-5 overflow-y-auto space-y-5 shrink-0"
          >
            <div>
              <div className="text-[11px] font-semibold tracking-wide text-slate-400 mb-3">
                File Details
              </div>
              <dl className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-3 py-1.5 border-b border-white/[0.06]">
                  <dt className="text-slate-400">Dimensions</dt>
                  <dd className="font-mono tabular-nums text-white font-semibold">
                    {item.width} × {item.height} px
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-1.5 border-b border-white/[0.06]">
                  <dt className="text-slate-400">Megapixels</dt>
                  <dd className="font-mono tabular-nums text-white font-semibold">
                    {formatMegapixels(item.width, item.height)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-1.5 border-b border-white/[0.06]">
                  <dt className="text-slate-400">Format</dt>
                  <dd className="font-mono text-white font-semibold">{item.format}</dd>
                </div>
                <div className="flex justify-between gap-3 py-1.5 border-b border-white/[0.06]">
                  <dt className="text-slate-400">File Size</dt>
                  <dd className="font-mono tabular-nums text-white font-semibold">
                    {item.sizeBytes > 0 ? formatBytesCompact(item.sizeBytes) : 'Sample asset'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 py-1.5 border-b border-white/[0.06]">
                  <dt className="text-slate-400">Modified</dt>
                  <dd className="font-mono tabular-nums text-white">
                    {formatGalleryDate(item.lastModified)}
                  </dd>
                </div>
                <div className="py-1.5">
                  <dt className="text-slate-400 mb-1 flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Relative Path</span>
                  </dt>
                  <dd className="font-mono text-[11px] text-slate-200 bg-[#090C12] border border-white/[0.08] rounded-lg px-2.5 py-2 break-all">
                    {item.relativePath}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="pt-2 border-t border-white/[0.08] text-[11px] text-slate-400 space-y-1 font-mono">
              <div>Wheel / Pinch · Zoom 25%–600%</div>
              <div>Drag · Pan zoomed image</div>
              <div>← / → · Previous / Next</div>
              <div>R · Rotate · F · Favorite</div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Thumbnail Filmstrip */}
      {items.length > 1 && (
        <div className="h-20 px-4 border-t border-white/[0.08] bg-[#0A0D14]/95 flex items-center gap-2 overflow-x-auto shrink-0">
          {items.map((thumb) => {
            const active = thumb.id === item.id;
            return (
              <button
                key={thumb.id}
                type="button"
                onClick={() => {
                  setIsSlideshow(false);
                  onSelectItem(thumb);
                }}
                aria-label={`View ${thumb.filename}`}
                className={`relative w-14 h-14 rounded-lg overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                  active
                    ? 'border-blue-500 scale-105 opacity-100'
                    : 'border-transparent opacity-55 hover:opacity-90'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb.previewUrl}
                  alt={thumb.filename}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
