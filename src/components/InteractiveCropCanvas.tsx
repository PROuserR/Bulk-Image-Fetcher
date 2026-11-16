'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AspectRatioPreset,
  ASPECT_RATIO_VALUES,
  CropRect,
  clampCropRect,
} from '../utils/imageTransformLogic';

interface InteractiveCropCanvasProps {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  cropEnabled: boolean;
  cropRect: CropRect;
  aspectPreset: AspectRatioPreset;
  onChangeCrop: (next: CropRect) => void;
  onImageLoad?: (naturalWidth: number, naturalHeight: number) => void;
}

type DragHandle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragSession {
  handle: DragHandle;
  startClientX: number;
  startClientY: number;
  startRect: CropRect;
  scaleX: number;
  scaleY: number;
}

export const InteractiveCropCanvas: React.FC<InteractiveCropCanvasProps> = ({
  src,
  alt,
  naturalWidth,
  naturalHeight,
  cropEnabled,
  cropRect,
  aspectPreset,
  onChangeCrop,
  onImageLoad,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageBoxRef = useRef<HTMLDivElement | null>(null);
  const [stageBounds, setStageBounds] = useState<{ width: number; height: number }>({
    width: 640,
    height: 380,
  });
  const [dragSession, setDragSession] = useState<DragSession | null>(null);

  const safeNatW = Math.max(1, naturalWidth);
  const safeNatH = Math.max(1, naturalHeight);
  const clamped = clampCropRect(cropRect, safeNatW, safeNatH);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const updateBounds = () => {
      const rect = el.getBoundingClientRect();
      // Reserve 20px inset per side so outer crop handles never touch stage edges
      const availW = Math.max(120, Math.floor(rect.width - 40));
      const availH = Math.max(120, Math.floor(rect.height - 40));
      setStageBounds({ width: availW, height: availH });
    };

    updateBounds();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateBounds);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

  // Compute exact aspect-fitted box within stageBounds so neither portrait nor landscape overflows
  const fitScale = Math.min(stageBounds.width / safeNatW, stageBounds.height / safeNatH);
  const boxWidth = Math.max(60, Math.floor(safeNatW * fitScale));
  const boxHeight = Math.max(60, Math.floor(safeNatH * fitScale));

  const leftPct = (clamped.x / safeNatW) * 100;
  const topPct = (clamped.y / safeNatH) * 100;
  const widthPct = (clamped.width / safeNatW) * 100;
  const heightPct = (clamped.height / safeNatH) * 100;

  const startDrag = (handle: DragHandle, e: React.PointerEvent) => {
    if (!cropEnabled || !imageBoxRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const bounds = imageBoxRef.current.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragSession({
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRect: clamped,
      scaleX: safeNatW / bounds.width,
      scaleY: safeNatH / bounds.height,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragSession) return;
    const dx = Math.round((e.clientX - dragSession.startClientX) * dragSession.scaleX);
    const dy = Math.round((e.clientY - dragSession.startClientY) * dragSession.scaleY);
    const s = dragSession.startRect;
    const lockedRatio = ASPECT_RATIO_VALUES[aspectPreset];
    const minSize = 16;

    if (dragSession.handle === 'move') {
      const nextX = Math.max(0, Math.min(safeNatW - s.width, s.x + dx));
      const nextY = Math.max(0, Math.min(safeNatH - s.height, s.y + dy));
      onChangeCrop({ ...s, x: nextX, y: nextY });
      return;
    }

    let left = s.x;
    let top = s.y;
    let right = s.x + s.width;
    let bottom = s.y + s.height;

    if (dragSession.handle.includes('w')) {
      left = Math.max(0, Math.min(right - minSize, s.x + dx));
    }
    if (dragSession.handle.includes('e')) {
      right = Math.min(safeNatW, Math.max(left + minSize, s.x + s.width + dx));
    }
    if (dragSession.handle.includes('n')) {
      top = Math.max(0, Math.min(bottom - minSize, s.y + dy));
    }
    if (dragSession.handle.includes('s')) {
      bottom = Math.min(safeNatH, Math.max(top + minSize, s.y + s.height + dy));
    }

    let nextW = right - left;
    let nextH = bottom - top;

    if (lockedRatio) {
      if (dragSession.handle === 'n' || dragSession.handle === 's') {
        nextW = Math.round(nextH * lockedRatio);
        if (left + nextW > safeNatW) {
          nextW = safeNatW - left;
          nextH = Math.round(nextW / lockedRatio);
        }
      } else {
        nextH = Math.round(nextW / lockedRatio);
        if (top + nextH > safeNatH) {
          nextH = safeNatH - top;
          nextW = Math.round(nextH * lockedRatio);
        }
      }

      if (dragSession.handle.includes('w')) {
        left = Math.max(0, right - nextW);
      }
      if (dragSession.handle.includes('n')) {
        top = Math.max(0, bottom - nextH);
      }
    }

    onChangeCrop(
      clampCropRect(
        {
          x: left,
          y: top,
          width: Math.max(minSize, nextW),
          height: Math.max(minSize, nextH),
        },
        safeNatW,
        safeNatH
      )
    );
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragSession) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer already released
    }
    setDragSession(null);
  };

  return (
    <div
      ref={stageRef}
      className="relative w-full h-[320px] sm:h-[420px] bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden flex items-center justify-center select-none"
      style={{
        backgroundImage:
          'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 0)',
        backgroundSize: '18px 18px',
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Aspect-fitted image container with exact bounds */}
      <div
        ref={imageBoxRef}
        className="relative shadow-2xl shrink-0"
        style={{
          width: `${boxWidth}px`,
          height: `${boxHeight}px`,
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              onImageLoad?.(img.naturalWidth, img.naturalHeight);
            }
          }}
          className="block w-full h-full object-fill pointer-events-none select-none rounded-sm"
        />

        {cropEnabled && (
          <div className="absolute inset-0" aria-label="Interactive crop frame">
            {/* Dimmed outside scrim mask (clipped cleanly inside image bounds) */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute left-0 right-0 top-0 bg-black/60"
                style={{ height: `${topPct}%` }}
              />
              <div
                className="absolute left-0 right-0 bottom-0 bg-black/60"
                style={{ height: `${Math.max(0, 100 - topPct - heightPct)}%` }}
              />
              <div
                className="absolute left-0 bg-black/60"
                style={{
                  top: `${topPct}%`,
                  height: `${heightPct}%`,
                  width: `${leftPct}%`,
                }}
              />
              <div
                className="absolute right-0 bg-black/60"
                style={{
                  top: `${topPct}%`,
                  height: `${heightPct}%`,
                  width: `${Math.max(0, 100 - leftPct - widthPct)}%`,
                }}
              />
            </div>

            {/* Active Draggable Crop Box — handles protrude unclipped over padding */}
            <div
              role="region"
              aria-label={`Crop box ${clamped.width} by ${clamped.height} pixels`}
              onPointerDown={(e) => startDrag('move', e)}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
              className="absolute border-2 border-blue-500 shadow-[0_0_0_1px_rgba(255,255,255,0.45)] cursor-move touch-none"
            >
              {/* Rule-of-thirds interior hairlines */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, idx) => (
                  <div key={idx} className="border border-white/25" />
                ))}
              </div>

              {/* 8 Resize Handles */}
              <button
                type="button"
                aria-label="Resize top-left corner"
                onPointerDown={(e) => startDrag('nw', e)}
                className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nwse-resize"
              />
              <button
                type="button"
                aria-label="Resize top-right corner"
                onPointerDown={(e) => startDrag('ne', e)}
                className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nesw-resize"
              />
              <button
                type="button"
                aria-label="Resize bottom-left corner"
                onPointerDown={(e) => startDrag('sw', e)}
                className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nesw-resize"
              />
              <button
                type="button"
                aria-label="Resize bottom-right corner"
                onPointerDown={(e) => startDrag('se', e)}
                className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-xs cursor-nwse-resize"
              />

              <button
                type="button"
                aria-label="Resize top edge"
                onPointerDown={(e) => startDrag('n', e)}
                className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-2 bg-white border border-blue-600 rounded-xs cursor-ns-resize"
              />
              <button
                type="button"
                aria-label="Resize bottom edge"
                onPointerDown={(e) => startDrag('s', e)}
                className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-2 bg-white border border-blue-600 rounded-xs cursor-ns-resize"
              />
              <button
                type="button"
                aria-label="Resize left edge"
                onPointerDown={(e) => startDrag('w', e)}
                className="absolute top-1/2 -left-1 -translate-y-1/2 w-2 h-6 bg-white border border-blue-600 rounded-xs cursor-ew-resize"
              />
              <button
                type="button"
                aria-label="Resize right edge"
                onPointerDown={(e) => startDrag('e', e)}
                className="absolute top-1/2 -right-1 -translate-y-1/2 w-2 h-6 bg-white border border-blue-600 rounded-xs cursor-ew-resize"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
