'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Film,
  ImagePlus,
  FolderOpen,
  Sparkles,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ArrowLeft,
  ArrowRight,
  Copy,
  Trash2,
  Download,
  Loader2,
  Eye,
  EyeOff,
  ArrowLeftRight,
  AlertCircle,
  CheckCircle2,
  SlidersHorizontal,
  Video,
} from 'lucide-react';
import { encodeAnimatedGif, GifFrameRgbaInput } from '../utils/gifEncoder';
import {
  DEFAULT_GIF_CONFIG,
  GifAspectPreset,
  GifCaptionPosition,
  GifFitMode,
  GifMakerConfig,
  GifPlaybackOrder,
  buildGifSequence,
  clampLoopCount,
  computeFrameDrawRect,
  computeGifCanvasDimensions,
  estimateTotalGifDurationMs,
  formatGifDuration,
  fpsToDelayMs,
} from '../utils/gifMakerLogic';
import {
  ClipExtractionPlan,
  deriveClipBaseFilename,
  isSupportedVideoFile,
} from '../utils/videoClipLogic';
import { ExtractedVideoFrame } from '../utils/videoFrameExtractor';
import { VideoClipExtractorPanel } from './VideoClipExtractorPanel';
import { formatBytesCompact } from '../utils/imageTransformLogic';
import { triggerBlobDownload } from '../utils/downloader';
import { ScrapedImage } from '../utils/scraperLogic';

interface GifStudioFrameItem {
  id: string;
  filename: string;
  previewUrl: string;
  objectUrlToRevoke?: string;
  width: number;
  height: number;
  sizeBytes: number;
  included: boolean;
}

interface GifMakerStudioProps {
  seededScrapedImages?: ScrapedImage[];
  seededSourceUrl?: string;
  onClearSeeded?: () => void;
  onNotify?: (message: string) => void;
}

const SAMPLE_SEQUENCE = [
  { url: '/samples/humans/random_001.jpg', filename: 'frame_01_portrait.jpg' },
  { url: '/samples/humans/random_002.jpg', filename: 'frame_02_portrait.jpg' },
  { url: '/samples/humans/random_003.jpg', filename: 'frame_03_portrait.jpg' },
  { url: '/samples/humans/random_004.jpg', filename: 'frame_04_portrait.jpg' },
  { url: '/samples/humans/random_005.jpg', filename: 'frame_05_portrait.jpg' },
  { url: '/samples/humans/random_006.jpg', filename: 'frame_06_portrait.jpg' },
];

const ASPECT_OPTIONS: { id: GifAspectPreset; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'square', label: '1:1 Square' },
  { id: 'landscape', label: '16:9 Wide' },
  { id: 'portrait', label: '4:5 Portrait' },
  { id: 'story', label: '9:16 Story' },
  { id: 'custom', label: 'Custom' },
];

const MAX_EDGE_OPTIONS = [320, 480, 640, 800];

const BG_SWATCHES = ['#090A0F', '#FFFFFF', '#18181B', '#2563EB'];

function loadHtmlImageForGif(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not decode image: ${url}`));
    img.src = url;
  });
}

function drawCaptionBanner(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  position: GifCaptionPosition
) {
  const trimmed = text.trim();
  if (!trimmed || position === 'none') return;

  const fontSize = Math.max(13, Math.round(height * 0.055));
  ctx.save();
  ctx.font = `700 ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const padY = Math.max(8, Math.round(fontSize * 0.55));
  const bannerHeight = fontSize + padY * 2;
  const yCenter = position === 'top' ? bannerHeight / 2 + 8 : height - bannerHeight / 2 - 8;

  const metrics = ctx.measureText(trimmed);
  const pillWidth = Math.min(width - 24, Math.max(96, metrics.width + fontSize * 1.6));
  const rectX = (width - pillWidth) / 2;
  const rectY = yCenter - bannerHeight / 2;

  ctx.fillStyle = 'rgba(9, 10, 15, 0.72)';
  ctx.beginPath();
  ctx.roundRect(rectX, rectY, pillWidth, bannerHeight, 8);
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(trimmed, width / 2, yCenter, pillWidth - 16);
  ctx.restore();
}

function renderSequenceStepToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: GifMakerConfig,
  primaryImg: HTMLImageElement,
  secondaryImg: HTMLImageElement | null,
  blendFactor: number
) {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = config.backgroundColor || '#090A0F';
  ctx.fillRect(0, 0, width, height);

  const pRect = computeFrameDrawRect(
    primaryImg.naturalWidth || primaryImg.width,
    primaryImg.naturalHeight || primaryImg.height,
    width,
    height,
    config.fitMode
  );
  ctx.globalAlpha = 1;
  ctx.drawImage(primaryImg, pRect.dx, pRect.dy, pRect.dw, pRect.dh);

  if (secondaryImg && blendFactor > 0) {
    const sRect = computeFrameDrawRect(
      secondaryImg.naturalWidth || secondaryImg.width,
      secondaryImg.naturalHeight || secondaryImg.height,
      width,
      height,
      config.fitMode
    );
    ctx.globalAlpha = Math.max(0, Math.min(1, blendFactor));
    ctx.drawImage(secondaryImg, sRect.dx, sRect.dy, sRect.dw, sRect.dh);
    ctx.globalAlpha = 1;
  }

  drawCaptionBanner(ctx, width, height, config.captionText, config.captionPosition);
  ctx.restore();
}

export const GifMakerStudio: React.FC<GifMakerStudioProps> = ({
  seededScrapedImages = [],
  seededSourceUrl = '',
  onClearSeeded,
  onNotify,
}) => {
  const [sourceMode, setSourceMode] = useState<'frames' | 'video'>('frames');
  const [queuedVideoFile, setQueuedVideoFile] = useState<File | null>(null);
  const [items, setItems] = useState<GifStudioFrameItem[]>([]);
  const [config, setConfig] = useState<GifMakerConfig>(() => ({ ...DEFAULT_GIF_CONFIG }));
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stageMode, setStageMode] = useState<'preview' | 'output'>('preview');
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [isEncoding, setIsEncoding] = useState<boolean>(false);
  const [encodeProgress, setEncodeProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [generatedGif, setGeneratedGif] = useState<{
    url: string;
    blob: Blob;
    filename: string;
    width: number;
    height: number;
    frameCount: number;
    sizeBytes: number;
  } | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const decodedCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const revokableUrlsRef = useRef<string[]>([]);
  const generatedGifUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const onClearSeededRef = useRef(onClearSeeded);

  useEffect(() => {
    onClearSeededRef.current = onClearSeeded;
  }, [onClearSeeded]);

  useEffect(() => {
    return () => {
      for (const u of revokableUrlsRef.current) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          // ignore
        }
      }
      if (generatedGifUrlRef.current) {
        try {
          URL.revokeObjectURL(generatedGifUrlRef.current);
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const clearGeneratedOutput = useCallback(() => {
    if (generatedGifUrlRef.current) {
      try {
        URL.revokeObjectURL(generatedGifUrlRef.current);
      } catch {
        // ignore
      }
      generatedGifUrlRef.current = null;
    }
    setGeneratedGif(null);
    setStageMode('preview');
  }, []);

  const clearObjectUrls = () => {
    for (const u of revokableUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    revokableUrlsRef.current = [];
  };

  // Ingest images seeded from Scraper GalleryView
  useEffect(() => {
    if (!seededScrapedImages || seededScrapedImages.length === 0) return;
    const stamp = Date.now();
    const seeded: GifStudioFrameItem[] = seededScrapedImages.map((srcImg, idx) => ({
      id: `scraped_gif_${stamp}_${idx}`,
      filename: srcImg.filename || `frame_${String(idx + 1).padStart(2, '0')}.jpg`,
      previewUrl: `/api/proxy?url=${encodeURIComponent(srcImg.fullUrl)}&referer=${encodeURIComponent(seededSourceUrl || '')}`,
      width: Math.max(1, srcImg.width || 800),
      height: Math.max(1, srcImg.height || 800),
      sizeBytes: 0,
      included: true,
    }));

    clearGeneratedOutput();
    setItems(seeded);
    setCurrentStepIndex(0);
    setIsPlaying(true);
    setErrorMsg(null);
    setStatusMsg(`Loaded ${seeded.length} image${seeded.length === 1 ? '' : 's'} into GIF Maker.`);
    onClearSeededRef.current?.();
  }, [seededScrapedImages, seededSourceUrl, clearGeneratedOutput]);

  const includedItems = useMemo(() => items.filter((it) => it.included), [items]);

  const canvasDimensions = useMemo(() => {
    const first = includedItems[0];
    return computeGifCanvasDimensions(
      config,
      first ? { width: first.width, height: first.height } : null
    );
  }, [config, includedItems]);

  const sequenceSteps = useMemo(
    () => buildGifSequence(includedItems.length, config),
    [includedItems.length, config]
  );

  const totalLoopDurationMs = useMemo(
    () => estimateTotalGifDurationMs(sequenceSteps),
    [sequenceSteps]
  );

  const safeStepIndex =
    sequenceSteps.length > 0 ? Math.min(currentStepIndex, sequenceSteps.length - 1) : 0;

  // Pre-decode included images so live preview & export run without stutter
  const [decodedTick, setDecodedTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const urlsToLoad = includedItems
      .map((it) => it.previewUrl)
      .filter((u) => !decodedCacheRef.current.has(u));

    if (urlsToLoad.length === 0) return;

    const loadAll = async () => {
      for (const item of includedItems) {
        if (cancelled) break;
        if (decodedCacheRef.current.has(item.previewUrl)) continue;
        try {
          const img = await loadHtmlImageForGif(item.previewUrl);
          if (cancelled) return;
          decodedCacheRef.current.set(item.previewUrl, img);
          const natW = Math.max(1, img.naturalWidth || img.width);
          const natH = Math.max(1, img.naturalHeight || img.height);
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id && (it.width !== natW || it.height !== natH)
                ? { ...it, width: natW, height: natH }
                : it
            )
          );
          setDecodedTick((t) => t + 1);
        } catch {
          // Ignore individual frame decode failures cleanly
        }
      }
    };

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [includedItems]);

  // Playback timer
  useEffect(() => {
    if (!isPlaying || stageMode !== 'preview' || sequenceSteps.length <= 1) return;
    const step = sequenceSteps[safeStepIndex];
    const delay = step ? step.delayMs : fpsToDelayMs(config.fps);
    const timer = setTimeout(() => {
      setCurrentStepIndex((prev) => (prev + 1) % sequenceSteps.length);
    }, delay);
    return () => clearTimeout(timer);
  }, [isPlaying, stageMode, sequenceSteps, safeStepIndex, config.fps]);

  // Render active preview frame onto <canvas>
  useEffect(() => {
    if (stageMode !== 'preview' || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const { width, height } = canvasDimensions;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (sequenceSteps.length === 0 || includedItems.length === 0) {
      ctx.fillStyle = config.backgroundColor || '#090A0F';
      ctx.fillRect(0, 0, width, height);
      return;
    }

    const step = sequenceSteps[safeStepIndex];
    const primaryItem = includedItems[step.primaryIndex];
    const secondaryItem =
      step.secondaryIndex !== null ? includedItems[step.secondaryIndex] : null;

    const primaryImg = primaryItem ? decodedCacheRef.current.get(primaryItem.previewUrl) : null;
    if (!primaryImg) return;

    const secondaryImg = secondaryItem
      ? decodedCacheRef.current.get(secondaryItem.previewUrl) || null
      : null;

    renderSequenceStepToCanvas(
      ctx,
      width,
      height,
      config,
      primaryImg,
      secondaryImg,
      step.blendFactor
    );
  }, [
    stageMode,
    canvasDimensions,
    sequenceSteps,
    safeStepIndex,
    includedItems,
    config,
    decodedTick,
  ]);

  const ingestFiles = async (fileList: FileList | File[], append = false) => {
    const allFiles = Array.from(fileList);
    const firstVideo = allFiles.find((f) => isSupportedVideoFile(f));
    const rawFiles = allFiles.filter((f) => {
      if (f.type && f.type.startsWith('image/')) return true;
      return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);
    });

    if (rawFiles.length === 0 && firstVideo) {
      setErrorMsg(null);
      setQueuedVideoFile(firstVideo);
      setSourceMode('video');
      return;
    }

    if (rawFiles.length === 0) {
      setErrorMsg('No supported image or video files found.');
      return;
    }

    setIsLoadingFiles(true);
    setErrorMsg(null);
    if (!append) clearObjectUrls();
    clearGeneratedOutput();

    const loaded: GifStudioFrameItem[] = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await loadHtmlImageForGif(objectUrl);
        revokableUrlsRef.current.push(objectUrl);
        decodedCacheRef.current.set(objectUrl, img);
        loaded.push({
          id: `local_gif_${Date.now()}_${i}`,
          filename: file.name,
          previewUrl: objectUrl,
          objectUrlToRevoke: objectUrl,
          width: Math.max(1, img.naturalWidth || img.width),
          height: Math.max(1, img.naturalHeight || img.height),
          sizeBytes: file.size,
          included: true,
        });
      } catch {
        URL.revokeObjectURL(objectUrl);
      }
    }

    if (loaded.length === 0) {
      setErrorMsg('Could not decode selected image files.');
      setIsLoadingFiles(false);
      return;
    }

    setItems((prev) => (append ? [...prev, ...loaded] : loaded));
    setCurrentStepIndex(0);
    setIsPlaying(true);
    setStatusMsg(
      `Added ${loaded.length} frame${loaded.length === 1 ? '' : 's'} to GIF timeline.`
    );
    setIsLoadingFiles(false);
  };

  const handleLoadSampleSequence = async () => {
    setIsLoadingFiles(true);
    setErrorMsg(null);
    clearObjectUrls();
    clearGeneratedOutput();

    const loaded: GifStudioFrameItem[] = [];
    for (let i = 0; i < SAMPLE_SEQUENCE.length; i++) {
      const sample = SAMPLE_SEQUENCE[i];
      try {
        const img = await loadHtmlImageForGif(sample.url);
        decodedCacheRef.current.set(sample.url, img);
        loaded.push({
          id: `sample_gif_${Date.now()}_${i}`,
          filename: sample.filename,
          previewUrl: sample.url,
          width: Math.max(1, img.naturalWidth || img.width),
          height: Math.max(1, img.naturalHeight || img.height),
          sizeBytes: 0,
          included: true,
        });
      } catch {
        // skip
      }
    }

    if (loaded.length === 0) {
      setErrorMsg('Could not load local sample frames.');
      setIsLoadingFiles(false);
      return;
    }

    setItems(loaded);
    setCurrentStepIndex(0);
    setIsPlaying(true);
    setStatusMsg(`Loaded ${loaded.length}-frame sample sequence.`);
    setIsLoadingFiles(false);
  };

  const moveItem = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    clearGeneratedOutput();
    setItems((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  };

  const duplicateItem = (index: number) => {
    const src = items[index];
    if (!src) return;
    clearGeneratedOutput();
    const copyItem: GifStudioFrameItem = {
      ...src,
      id: `dup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    };
    setItems((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copyItem);
      return next;
    });
  };

  const removeItem = (id: string) => {
    clearGeneratedOutput();
    setItems((prev) => prev.filter((it) => it.id !== id));
    setCurrentStepIndex(0);
  };

  const toggleInclude = (id: string) => {
    clearGeneratedOutput();
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, included: !it.included } : it))
    );
    setCurrentStepIndex(0);
  };

  const reverseTimelineOrder = () => {
    if (items.length < 2) return;
    clearGeneratedOutput();
    setItems((prev) => [...prev].reverse());
  };

  const handleClearAll = () => {
    clearObjectUrls();
    clearGeneratedOutput();
    setItems([]);
    setCurrentStepIndex(0);
    setStatusMsg(null);
    setErrorMsg(null);
  };

  const updateConfig = <K extends keyof GifMakerConfig>(key: K, value: GifMakerConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const encodeSequenceToGif = useCallback(
    async (
      targetIncludedItems: GifStudioFrameItem[],
      targetConfig: GifMakerConfig,
      customBaseName?: string
    ) => {
      const targetSteps = buildGifSequence(targetIncludedItems.length, targetConfig);
      if (targetIncludedItems.length === 0 || targetSteps.length === 0) {
        setErrorMsg('Include at least one image frame before encoding.');
        return;
      }

      const first = targetIncludedItems[0];
      const targetDims = computeGifCanvasDimensions(
        targetConfig,
        first ? { width: first.width, height: first.height } : null
      );

      setIsEncoding(true);
      setErrorMsg(null);
      setEncodeProgress({ done: 0, total: targetSteps.length });

      try {
        for (const item of targetIncludedItems) {
          if (!decodedCacheRef.current.has(item.previewUrl)) {
            const img = await loadHtmlImageForGif(item.previewUrl);
            decodedCacheRef.current.set(item.previewUrl, img);
          }
        }

        const { width, height } = targetDims;
        const renderCanvas = document.createElement('canvas');
        renderCanvas.width = width;
        renderCanvas.height = height;
        const ctx = renderCanvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser.');

        const rgbaFrames: GifFrameRgbaInput[] = [];
        for (let i = 0; i < targetSteps.length; i++) {
          const step = targetSteps[i];
          const primaryItem = targetIncludedItems[step.primaryIndex];
          const secondaryItem =
            step.secondaryIndex !== null ? targetIncludedItems[step.secondaryIndex] : null;
          const primaryImg = decodedCacheRef.current.get(primaryItem.previewUrl);
          if (!primaryImg) continue;
          const secondaryImg = secondaryItem
            ? decodedCacheRef.current.get(secondaryItem.previewUrl) || null
            : null;

          renderSequenceStepToCanvas(
            ctx,
            width,
            height,
            targetConfig,
            primaryImg,
            secondaryImg,
            step.blendFactor
          );
          const imageData = ctx.getImageData(0, 0, width, height);
          rgbaFrames.push({
            rgba: imageData.data,
            width,
            height,
            delayMs: step.delayMs,
          });
        }

        if (rgbaFrames.length === 0) {
          throw new Error('Failed to rasterize any frames for the GIF.');
        }

        await new Promise((r) => setTimeout(r, 16));

        const gifBytes = encodeAnimatedGif(rgbaFrames, {
          width,
          height,
          loopCount: targetConfig.loopCount,
          dither: targetConfig.dither,
          onProgress: (done, total) => {
            setEncodeProgress({ done, total });
          },
        });

        const gifBuffer = new Uint8Array(gifBytes);
        const blob = new Blob([gifBuffer], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const prefix = customBaseName ? deriveClipBaseFilename(customBaseName) : 'ultimate_processor_animated';
        const filename = `${prefix}_${width}x${height}_${rgbaFrames.length}f.gif`;

        if (generatedGifUrlRef.current) {
          try {
            URL.revokeObjectURL(generatedGifUrlRef.current);
          } catch {
            // ignore
          }
        }
        generatedGifUrlRef.current = url;

        setGeneratedGif({
          url,
          blob,
          filename,
          width,
          height,
          frameCount: rgbaFrames.length,
          sizeBytes: blob.size,
        });
        setStageMode('output');
        const summary = `Created ${width}×${height} GIF (${rgbaFrames.length} frames · ${formatBytesCompact(blob.size)})`;
        setStatusMsg(summary);
        onNotify?.(summary);
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to encode animated GIF.');
      } finally {
        setIsEncoding(false);
        setEncodeProgress(null);
      }
    },
    [onNotify]
  );

  const handleCreateGif = async () => {
    await encodeSequenceToGif(includedItems, config);
  };

  const handleVideoFramesExtracted = async (
    extractedFrames: ExtractedVideoFrame[],
    plan: ClipExtractionPlan,
    autoConvertToGif: boolean,
    sourceName: string
  ) => {
    clearObjectUrls();
    clearGeneratedOutput();

    const nextItems: GifStudioFrameItem[] = [];
    for (const frame of extractedFrames) {
      revokableUrlsRef.current.push(frame.objectUrlToRevoke);
      try {
        const img = await loadHtmlImageForGif(frame.previewUrl);
        decodedCacheRef.current.set(frame.previewUrl, img);
      } catch {
        // decode lazily if needed
      }
      nextItems.push({
        id: frame.id,
        filename: frame.filename,
        previewUrl: frame.previewUrl,
        objectUrlToRevoke: frame.objectUrlToRevoke,
        width: frame.width,
        height: frame.height,
        sizeBytes: frame.sizeBytes,
        included: true,
      });
    }

    const nextConfig: GifMakerConfig = {
      ...config,
      fps: plan.outputGifFps,
      aspectPreset: 'original',
      maxEdge: Math.max(config.maxEdge, Math.min(800, extractedFrames[0]?.width || 480)),
    };

    setItems(nextItems);
    setConfig(nextConfig);
    setCurrentStepIndex(0);
    setIsPlaying(true);
    setSourceMode('frames');
    setErrorMsg(null);
    setStatusMsg(
      `Extracted ${nextItems.length} frames from "${sourceName}" (${plan.clipDurationSec.toFixed(1)}s @ ${plan.outputGifFps} fps).`
    );

    if (autoConvertToGif) {
      await encodeSequenceToGif(nextItems, nextConfig, sourceName);
    }
  };

  const handleDownloadGif = () => {
    if (!generatedGif) return;
    triggerBlobDownload(generatedGif.blob, generatedGif.filename);
    onNotify?.(`Downloaded ${generatedGif.filename}`);
  };

  const currentStep = sequenceSteps[safeStepIndex];

  return (
    <div className="space-y-6">
      {/* Hidden file/folder pickers */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files, items.length > 0);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files, false);
          }
          e.target.value = '';
        }}
      />

      {/* Studio Top Bar */}
      <section className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-5 sm:p-6 transition-colors space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <Film className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
              <h1 className="font-display text-lg sm:text-xl font-bold text-[#0F141F] dark:text-[#F3F6FA] tracking-tight">
                GIF89a Motion Studio
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono tabular-nums">
              {sourceMode === 'video' ? (
                <span>Trim a video clip and extract frames or convert directly to animated GIF89a</span>
              ) : items.length === 0 ? (
                <span>Build looping GIF89a animations from image sequences or trimmed video clips</span>
              ) : (
                <>
                  <span>
                    {includedItems.length}/{items.length} frame{items.length === 1 ? '' : 's'} active
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {canvasDimensions.width}×{canvasDimensions.height} px
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{config.fps} fps</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatGifDuration(totalLoopDurationMs)} cycle</span>
                </>
              )}
            </p>
          </div>

          {/* Source Mode Switcher */}
          <div
            role="group"
            aria-label="GIF Source Mode"
            className="inline-flex items-center self-start md:self-auto p-0.5 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl shrink-0"
          >
            <button
              type="button"
              onClick={() => setSourceMode('frames')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                sourceMode === 'frames'
                  ? 'bg-white dark:bg-[#171E2E] text-[#0F141F] dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Image Frames</span>
            </button>
            <button
              type="button"
              onClick={() => setSourceMode('video')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                sourceMode === 'video'
                  ? 'bg-white dark:bg-[#171E2E] text-[#0F141F] dark:text-white shadow-xs'
                  : 'text-slate-500 hover:text-[#0F141F] dark:hover:text-slate-200'
              }`}
            >
              <Video className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Video Clip → GIF</span>
            </button>
          </div>
        </div>

        {sourceMode === 'frames' && (
          <div className="pt-3 border-t border-[#DCE1EB] dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoadingFiles || isEncoding}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>{items.length > 0 ? 'Add Images' : 'Select Images'}</span>
              </button>

              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isLoadingFiles || isEncoding}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <FolderOpen className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                <span>Select Folder</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSampleSequence}
                disabled={isLoadingFiles || isEncoding}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-blue-500 text-[#0F141F] dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Load Sample Sequence</span>
              </button>
            </div>

            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isEncoding}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Timeline</span>
              </button>
            )}
          </div>
        )}

        {(errorMsg || statusMsg) && (
          <div className="pt-3 border-t border-[#DCE1EB] dark:border-white/[0.08]">
            {errorMsg ? (
              <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            ) : (
              statusMsg && (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{statusMsg}</span>
                </div>
              )
            )}
          </div>
        )}
      </section>

      {/* Video Clip Extraction Workbench (kept mounted once opened so loaded video/trim range persists across switches) */}
      <div className={sourceMode === 'video' ? 'block' : 'hidden'}>
        <VideoClipExtractorPanel
          externalVideoFile={queuedVideoFile}
          onExternalVideoFileConsumed={() => setQueuedVideoFile(null)}
          onFramesExtracted={handleVideoFramesExtracted}
          isBusyExternal={isEncoding}
          onNotify={onNotify}
        />
      </div>

      {/* Image Frames Intake or Live Timeline/Stage */}
      {sourceMode === 'frames' && (
        items.length === 0 ? (
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              ingestFiles(e.dataTransfer.files, false);
            }
          }}
          className={`bg-white dark:bg-[#0E121B] border-2 border-dashed rounded-2xl p-10 sm:p-14 text-center transition-colors ${
            isDraggingOver
              ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
              : 'border-[#DCE1EB] dark:border-white/[0.1]'
          }`}
        >
          <div className="max-w-lg mx-auto flex flex-col items-center">
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200/70 dark:border-blue-800/60 flex items-center justify-center mb-4">
              <Film className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0F141F] dark:text-[#F3F6FA]">
              Drop images or a video clip to build an animated GIF
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              Reorder frames or trim a video clip, set FPS or boomerang loops, resize to
              square/16:9/portrait, add crossfades &amp; captions, and export crisp 256-color GIF89a
              animations locally.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <ImagePlus className="w-4 h-4" />
                <span>Select Multiple Images</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceMode('video')}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#0F141F] dark:bg-white text-white dark:text-[#0F141F] hover:opacity-90 rounded-xl text-xs font-semibold transition-opacity whitespace-nowrap cursor-pointer"
              >
                <Video className="w-4 h-4" />
                <span>Extract Video Clip → GIF</span>
              </button>
              <button
                type="button"
                onClick={handleLoadSampleSequence}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-blue-500 text-[#0F141F] dark:text-slate-100 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Try 6-Frame Sample</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left/Main Column: Preview Stage + Frame Sequence Strip */}
          <div className="lg:col-span-8 space-y-5">
            {/* Stage Container */}
            <section
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  ingestFiles(e.dataTransfer.files, true);
                }
              }}
              className={`bg-white dark:bg-[#0E121B] border rounded-2xl p-4 sm:p-5 transition-colors ${
                isDraggingOver
                  ? 'border-blue-500 ring-2 ring-blue-500/20'
                  : 'border-[#DCE1EB] dark:border-white/[0.08]'
              }`}
            >
              {/* Stage Mode Switch + Live Dimensions */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div
                  role="group"
                  aria-label="GIF Stage View"
                  className="inline-flex items-center p-0.5 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-lg"
                >
                  <button
                    type="button"
                    onClick={() => setStageMode('preview')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                      stageMode === 'preview'
                        ? 'bg-white dark:bg-[#171E2E] text-[#0F141F] dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-[#0F141F] dark:hover:text-slate-200'
                    }`}
                  >
                    Live Preview
                  </button>
                  <button
                    type="button"
                    disabled={!generatedGif}
                    onClick={() => setStageMode('output')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 ${
                      stageMode === 'output'
                        ? 'bg-white dark:bg-[#171E2E] text-[#0F141F] dark:text-white shadow-xs'
                        : 'text-slate-500 hover:text-[#0F141F] dark:hover:text-slate-200'
                    }`}
                  >
                    {generatedGif
                      ? `Rendered .GIF (${formatBytesCompact(generatedGif.sizeBytes)})`
                      : 'Rendered .GIF'}
                  </button>
                </div>

                <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {stageMode === 'output' && generatedGif
                    ? `${generatedGif.width}×${generatedGif.height} · ${generatedGif.frameCount} frames`
                    : `${canvasDimensions.width}×${canvasDimensions.height} px · ${sequenceSteps.length} steps`}
                </div>
              </div>

              {/* Visual Canvas or Encoded GIF Output */}
              <div className="bg-[#EEF1F6] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl p-4 flex items-center justify-center min-h-[320px] sm:min-h-[400px]">
                {stageMode === 'output' && generatedGif ? (
                  <div className="flex flex-col items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={generatedGif.url}
                      alt="Generated animated GIF preview"
                      className="max-w-full max-h-[360px] rounded-lg shadow-sm border border-[#DCE1EB] dark:border-white/[0.08] object-contain"
                    />
                  </div>
                ) : (
                  <canvas
                    ref={previewCanvasRef}
                    aria-label="Animated GIF sequence canvas preview"
                    className="max-w-full max-h-[360px] rounded-lg shadow-sm border border-[#DCE1EB] dark:border-white/[0.08] object-contain"
                  />
                )}
              </div>

              {/* Transport Controls (for Live Preview) or Quick Download Strip (for Rendered Output) */}
              {stageMode === 'preview' ? (
                <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/70 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentStepIndex((prev) =>
                          sequenceSteps.length > 0
                            ? (prev - 1 + sequenceSteps.length) % sequenceSteps.length
                            : 0
                        );
                      }}
                      disabled={sequenceSteps.length <= 1}
                      aria-label="Previous step"
                      className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsPlaying((p) => !p)}
                      disabled={sequenceSteps.length <= 1}
                      aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Play</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentStepIndex((prev) =>
                          sequenceSteps.length > 0 ? (prev + 1) % sequenceSteps.length : 0
                        );
                      }}
                      disabled={sequenceSteps.length <= 1}
                      aria-label="Next step"
                      className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                  </div>

                  {sequenceSteps.length > 1 && (
                    <div className="flex-1 min-w-[140px] max-w-xs">
                      <input
                        type="range"
                        aria-label="Scrub animation frame"
                        min={0}
                        max={sequenceSteps.length - 1}
                        value={safeStepIndex}
                        onChange={(e) => {
                          setIsPlaying(false);
                          setCurrentStepIndex(Number(e.target.value));
                        }}
                        className="w-full accent-blue-600 cursor-pointer"
                      />
                    </div>
                  )}

                  <div className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    Step {String(safeStepIndex + 1).padStart(2, '0')}/
                    {String(Math.max(1, sequenceSteps.length)).padStart(2, '0')} ·{' '}
                    {currentStep ? `${currentStep.delayMs}ms` : '0ms'}
                  </div>
                </div>
              ) : (
                generatedGif && (
                  <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/70 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                      Ready: {generatedGif.filename} · {formatBytesCompact(generatedGif.sizeBytes)}
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadGif}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download .GIF</span>
                    </button>
                  </div>
                )
              )}
            </section>

            {/* Frame Sequence Timeline */}
            <section className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-display text-sm font-bold text-[#0F141F] dark:text-[#F3F6FA]">
                    Frame Timeline ({includedItems.length} active)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Reorder, duplicate, or exclude frames. Click any frame to jump preview.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={reverseTimelineOrder}
                    disabled={items.length < 2}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                    <span>Reverse List</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Add More</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {items.map((item, idx) => {
                  const includedPos = includedItems.findIndex((inc) => inc.id === item.id);
                  const isActiveInPreview =
                    stageMode === 'preview' &&
                    currentStep &&
                    includedPos !== -1 &&
                    currentStep.primaryIndex === includedPos;

                  return (
                    <div
                      key={item.id}
                      className={`group rounded-xl border p-2 transition-colors ${
                        !item.included
                          ? 'opacity-55 border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40'
                          : isActiveInPreview
                            ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
                            : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-[#0D0F16]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (!item.included) return;
                          const stepIdx = sequenceSteps.findIndex(
                            (s) => s.primaryIndex === includedPos && s.blendFactor === 0
                          );
                          if (stepIdx !== -1) {
                            setStageMode('preview');
                            setIsPlaying(false);
                            setCurrentStepIndex(stepIdx);
                          }
                        }}
                        className="relative w-full aspect-square rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-900 mb-2 block cursor-pointer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.previewUrl}
                          alt={item.filename}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-zinc-950/75 text-white text-[10px] font-mono tabular-nums font-semibold">
                          #{String(idx + 1).padStart(2, '0')}
                        </span>
                      </button>

                      <div className="px-0.5 space-y-1.5">
                        <div className="text-[11px] font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {item.filename}
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                          {item.width}×{item.height}
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-zinc-200/70 dark:border-zinc-800/80">
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveItem(idx, -1)}
                              disabled={idx === 0}
                              aria-label={`Move ${item.filename} earlier`}
                              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowLeft className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveItem(idx, 1)}
                              disabled={idx === items.length - 1}
                              aria-label={`Move ${item.filename} later`}
                              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 disabled:opacity-30 cursor-pointer"
                            >
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => toggleInclude(item.id)}
                              title={item.included ? 'Exclude frame' : 'Include frame'}
                              aria-label={item.included ? 'Exclude frame' : 'Include frame'}
                              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 cursor-pointer"
                            >
                              {item.included ? (
                                <Eye className="w-3 h-3" />
                              ) : (
                                <EyeOff className="w-3 h-3" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => duplicateItem(idx)}
                              title="Duplicate frame"
                              aria-label={`Duplicate ${item.filename}`}
                              className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              title="Remove frame"
                              aria-label={`Remove ${item.filename}`}
                              className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right Column: Animation & Export Inspector */}
          <aside className="lg:col-span-4 bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-5 space-y-5 lg:sticky lg:top-20">
            <div className="flex items-center gap-2 pb-3 border-b border-[#DCE1EB] dark:border-white/[0.08]">
              <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="font-display text-sm font-bold text-[#0F141F] dark:text-[#F3F6FA]">
                Animation Settings
              </h2>
            </div>

            {/* Frame Rate (FPS) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  Speed (Frame Rate)
                </span>
                <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                  {config.fps} fps · {fpsToDelayMs(config.fps)}ms
                </span>
              </div>
              <input
                type="range"
                aria-label="Frames per second"
                min={1}
                max={24}
                step={1}
                value={config.fps}
                onChange={(e) => {
                  clearGeneratedOutput();
                  updateConfig('fps', Number(e.target.value));
                }}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            {/* Playback Order */}
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                Playback Direction
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'forward', label: 'Forward' },
                    { id: 'reverse', label: 'Reverse' },
                    { id: 'boomerang', label: 'Boomerang' },
                  ] as { id: GifPlaybackOrder; label: string }[]
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      clearGeneratedOutput();
                      updateConfig('playbackOrder', mode.id);
                      setCurrentStepIndex(0);
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                      config.playbackOrder === mode.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Crossfade & Loop */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Crossfade
                </span>
                <select
                  aria-label="Crossfade blend frames"
                  value={config.crossfadeFrames}
                  onChange={(e) => {
                    clearGeneratedOutput();
                    updateConfig('crossfadeFrames', Number(e.target.value));
                  }}
                  className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value={0}>Hard Cut (0)</option>
                  <option value={1}>Soft (1 blend)</option>
                  <option value={2}>Smooth (2 blends)</option>
                  <option value={3}>Silky (3 blends)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Loop Behavior
                </span>
                <select
                  aria-label="GIF loop count"
                  value={config.loopCount}
                  onChange={(e) => {
                    clearGeneratedOutput();
                    updateConfig('loopCount', clampLoopCount(Number(e.target.value)));
                  }}
                  className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value={0}>Infinite Loop</option>
                  <option value={1}>Play Once (1×)</option>
                  <option value={2}>Repeat 2×</option>
                  <option value={3}>Repeat 3×</option>
                  <option value={5}>Repeat 5×</option>
                  <option value={10}>Repeat 10×</option>
                </select>
              </div>
            </div>

            {/* Aspect Ratio & Dimensions */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3">
              <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                Canvas Aspect &amp; Size
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {ASPECT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      clearGeneratedOutput();
                      updateConfig('aspectPreset', opt.id);
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                      config.aspectPreset === opt.id
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {config.aspectPreset === 'custom' ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="block mb-1 font-medium">Width (px)</span>
                    <input
                      type="number"
                      min={64}
                      max={1200}
                      value={config.customWidth}
                      onChange={(e) => {
                        clearGeneratedOutput();
                        updateConfig('customWidth', Number(e.target.value));
                      }}
                      className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white font-mono tabular-nums"
                    />
                  </label>
                  <label className="text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="block mb-1 font-medium">Height (px)</span>
                    <input
                      type="number"
                      min={64}
                      max={1200}
                      value={config.customHeight}
                      onChange={(e) => {
                        clearGeneratedOutput();
                        updateConfig('customHeight', Number(e.target.value));
                      }}
                      className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white font-mono tabular-nums"
                    />
                  </label>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">
                      Resolution Max Edge
                    </span>
                    <span className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                      {config.maxEdge}px
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {MAX_EDGE_OPTIONS.map((edge) => (
                      <button
                        key={edge}
                        type="button"
                        onClick={() => {
                          clearGeneratedOutput();
                          updateConfig('maxEdge', edge);
                        }}
                        className={`py-1 rounded-md text-xs font-mono tabular-nums font-semibold border transition-colors cursor-pointer ${
                          config.maxEdge === edge
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {edge}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Fit Mode + Background Color */}
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {(
                  [
                    { id: 'cover', label: 'Cover (Fill)' },
                    { id: 'contain', label: 'Contain (Fit)' },
                  ] as { id: GifFitMode; label: string }[]
                ).map((fit) => (
                  <button
                    key={fit.id}
                    type="button"
                    onClick={() => {
                      clearGeneratedOutput();
                      updateConfig('fitMode', fit.id);
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      config.fitMode === fit.id
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {fit.label}
                  </button>
                ))}
              </div>

              {config.fitMode === 'contain' && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400 font-medium">
                    Letterbox Fill
                  </span>
                  <div className="flex items-center gap-1.5">
                    {BG_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Background ${hex}`}
                        onClick={() => {
                          clearGeneratedOutput();
                          updateConfig('backgroundColor', hex);
                        }}
                        style={{ backgroundColor: hex }}
                        className={`w-5 h-5 rounded-md border cursor-pointer ${
                          config.backgroundColor === hex
                            ? 'ring-2 ring-blue-600 border-white'
                            : 'border-zinc-300 dark:border-zinc-700'
                        }`}
                      />
                    ))}
                    <input
                      type="color"
                      aria-label="Custom background color"
                      value={config.backgroundColor}
                      onChange={(e) => {
                        clearGeneratedOutput();
                        updateConfig('backgroundColor', e.target.value);
                      }}
                      className="w-6 h-6 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Caption & Quality Options */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="gif-caption-input"
                    className="text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                  >
                    Caption Overlay (Optional)
                  </label>
                  <select
                    aria-label="Caption position"
                    value={config.captionPosition}
                    onChange={(e) => {
                      clearGeneratedOutput();
                      updateConfig('captionPosition', e.target.value as GifCaptionPosition);
                    }}
                    className="text-[11px] bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300"
                  >
                    <option value="bottom">Bottom</option>
                    <option value="top">Top</option>
                    <option value="none">Hidden</option>
                  </select>
                </div>
                <input
                  id="gif-caption-input"
                  type="text"
                  maxLength={60}
                  value={config.captionText}
                  onChange={(e) => {
                    clearGeneratedOutput();
                    updateConfig('captionText', e.target.value);
                  }}
                  placeholder="Add optional text banner..."
                  className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <label className="flex items-center justify-between gap-2 text-xs cursor-pointer">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Bayer 4×4 Dithering (smoother gradients)
                </span>
                <input
                  type="checkbox"
                  checked={config.dither}
                  onChange={(e) => {
                    clearGeneratedOutput();
                    updateConfig('dither', e.target.checked);
                  }}
                  className="w-4 h-4 accent-blue-600 rounded cursor-pointer"
                />
              </label>
            </div>

            {/* Primary Export Action */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800/80 space-y-2.5">
              <button
                type="button"
                onClick={handleCreateGif}
                disabled={isEncoding || includedItems.length === 0}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                {isEncoding ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="tabular-nums">
                      {encodeProgress
                        ? `Encoding ${encodeProgress.done}/${encodeProgress.total}...`
                        : 'Encoding GIF...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Film className="w-4 h-4" />
                    <span>Create Animated GIF ({sequenceSteps.length} frames)</span>
                  </>
                )}
              </button>

              {generatedGif && (
                <button
                  type="button"
                  onClick={handleDownloadGif}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span className="tabular-nums">
                    Download .GIF ({formatBytesCompact(generatedGif.sizeBytes)})
                  </span>
                </button>
              )}
            </div>
          </aside>
        </div>
        )
      )}
    </div>
  );
};
