'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  SlidersHorizontal,
  Sparkles,
  Download,
  FileArchive,
  FolderOpen,
  ImagePlus,
  RotateCcw,
  SplitSquareHorizontal,
  ScanFace,
  Check,
  AlertCircle,
  CheckCircle2,
  Trash2,
  Loader2,
  CheckSquare,
  Square,
  Eye,
  EyeOff,
  Wand2,
} from 'lucide-react';
import {
  COLOR_PRESETS,
  ColorPresetId,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_FACE_ANCHOR,
  DEFAULT_FILTER_RECIPE,
  FaceAnchor,
  FilterRecipe,
  ImageAdjustmentState,
  SNAP_LENSES,
  SnapLensId,
  buildPresetAdjustments,
  countActiveEffects,
  sanitizeFaceAnchor,
} from '../utils/imageFilterLogic';
import {
  detectFaceAnchorFromImage,
  exportFilteredImageBlob,
  loadHtmlImageForFilter,
  renderFilteredToCanvas,
} from '../utils/canvasFilterRenderer';
import {
  OutputConfig,
  OutputFormat,
  buildOutputFilename,
  formatBytesCompact,
} from '../utils/imageTransformLogic';
import { triggerBlobDownload } from '../utils/downloader';
import { ScrapedImage } from '../utils/scraperLogic';
import { resolveSeededPreviewUrl } from '../utils/folderGalleryLogic';

interface FilterStudioItem {
  id: string;
  filename: string;
  previewUrl: string;
  objectUrlToRevoke?: string;
  width: number;
  height: number;
  sizeBytes: number;
  selected: boolean;
  detectedAnchor: FaceAnchor | null;
}

interface FilterStudioProps {
  seededScrapedImages?: ScrapedImage[];
  seededSourceUrl?: string;
  onClearSeeded?: () => void;
  onNotify?: (message: string) => void;
}

type InspectorTabId = 'adjustments' | 'lenses' | 'export';

interface SliderDef {
  key: keyof ImageAdjustmentState;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  group: 'tone' | 'classic' | 'optics';
}

const SLIDER_DEFINITIONS: SliderDef[] = [
  // Tone & Color
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, unit: '%', group: 'tone' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, unit: '%', group: 'tone' },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, unit: '%', group: 'tone' },
  { key: 'exposure', label: 'Exposure', min: -100, max: 100, step: 1, unit: '%', group: 'tone' },
  { key: 'warmth', label: 'Warmth', min: -100, max: 100, step: 1, unit: '', group: 'tone' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, unit: '', group: 'tone' },
  // Classic Filters
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, step: 1, unit: '%', group: 'classic' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, unit: '%', group: 'classic' },
  { key: 'hueRotate', label: 'Hue Rotate', min: -180, max: 180, step: 1, unit: '°', group: 'classic' },
  { key: 'invert', label: 'Invert', min: 0, max: 100, step: 1, unit: '%', group: 'classic' },
  // Optics & Finish
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 100, step: 1, unit: '%', group: 'optics' },
  { key: 'blur', label: 'Blur', min: 0, max: 20, step: 0.5, unit: 'px', group: 'optics' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1, unit: '%', group: 'optics' },
  { key: 'grain', label: 'Film Grain', min: 0, max: 100, step: 1, unit: '%', group: 'optics' },
];

const SAMPLE_PORTRAITS = [
  { url: '/samples/humans/random_001.jpg', filename: 'portrait_studio_01.jpg' },
  { url: '/samples/humans/random_002.jpg', filename: 'portrait_studio_02.jpg' },
  { url: '/samples/humans/random_003.jpg', filename: 'portrait_studio_03.jpg' },
  { url: '/samples/humans/random_004.jpg', filename: 'portrait_studio_04.jpg' },
  { url: '/samples/humans/random_005.jpg', filename: 'portrait_studio_05.jpg' },
  { url: '/samples/humans/random_006.jpg', filename: 'portrait_studio_06.jpg' },
];

export const FilterStudio: React.FC<FilterStudioProps> = ({
  seededScrapedImages = [],
  seededSourceUrl = '',
  onClearSeeded,
  onNotify,
}) => {
  const [items, setItems] = useState<FilterStudioItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>('adjustments');
  const [recipe, setRecipe] = useState<FilterRecipe>(() => ({
    presetId: DEFAULT_FILTER_RECIPE.presetId,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    lens: {
      lensId: 'none',
      intensity: 90,
      faceAnchor: { ...DEFAULT_FACE_ANCHOR },
    },
  }));

  const [outputConfig, setOutputConfig] = useState<OutputConfig>({
    format: 'keep',
    quality: 92,
    suffix: '_filtered',
    preserveSubfolders: false,
  });

  // Interactive Stage Controls
  const [compareSplit, setCompareSplit] = useState<boolean>(false);
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [showAnchorGuide, setShowAnchorGuide] = useState<boolean>(true);
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const loadedImageRef = useRef<{ url: string; img: HTMLImageElement } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const revokableUrlsRef = useRef<string[]>([]);
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
    };
  }, []);

  const clearPreviousObjectUrls = () => {
    for (const u of revokableUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch {
        // ignore
      }
    }
    revokableUrlsRef.current = [];
  };

  // Handle Scraper Gallery handoff
  useEffect(() => {
    if (!seededScrapedImages || seededScrapedImages.length === 0) return;
    const stamp = Date.now();
    const seeded: FilterStudioItem[] = seededScrapedImages.map((srcImg, i) => {
      const proxied = resolveSeededPreviewUrl(srcImg.fullUrl, seededSourceUrl || '');
      return {
        id: `scraped_filter_${stamp}_${i}`,
        filename: srcImg.filename || `image_${i + 1}.${srcImg.format || 'jpg'}`,
        previewUrl: proxied,
        width: Math.max(1, srcImg.width || 1200),
        height: Math.max(1, srcImg.height || 900),
        sizeBytes: 0,
        selected: true,
        detectedAnchor: null,
      };
    });
    setItems(seeded);
    setActiveId(seeded[0].id);
    setErrorMsg(null);
    setStatusMsg(`Loaded ${seeded.length} image${seeded.length === 1 ? '' : 's'} into Filter Studio.`);
    onClearSeededRef.current?.();
  }, [seededScrapedImages, seededSourceUrl]);

  const activeItem = useMemo(
    () => items.find((i) => i.id === activeId) || items[0] || null,
    [items, activeId]
  );

  const selectedItems = useMemo(() => items.filter((i) => i.selected), [items]);
  const activeEffectCount = useMemo(() => countActiveEffects(recipe), [recipe]);
  const currentLensMeta = useMemo(
    () => SNAP_LENSES.find((l) => l.id === recipe.lens.lensId) || SNAP_LENSES[0],
    [recipe.lens.lensId]
  );

  // Decode active image + detect face anchor on image switch, then render filter canvas
  useEffect(() => {
    if (!activeItem) {
      loadedImageRef.current = null;
      return;
    }

    let cancelled = false;
    const targetUrl = activeItem.previewUrl;
    const targetId = activeItem.id;

    const run = async () => {
      try {
        let img: HTMLImageElement;
        if (loadedImageRef.current && loadedImageRef.current.url === targetUrl) {
          img = loadedImageRef.current.img;
        } else {
          img = await loadHtmlImageForFilter(targetUrl);
          if (cancelled) return;
          loadedImageRef.current = { url: targetUrl, img };

          // Sync natural dimensions if placeholder dimensions differed
          const natW = Math.max(1, img.naturalWidth || img.width);
          const natH = Math.max(1, img.naturalHeight || img.height);
          setItems((prev) =>
            prev.map((it) =>
              it.id === targetId && (it.width !== natW || it.height !== natH)
                ? { ...it, width: natW, height: natH }
                : it
            )
          );

          // Auto-estimate face anchor once per image so AR lenses snap onto portraits automatically
          if (!activeItem.detectedAnchor) {
            const estimated = await detectFaceAnchorFromImage(img);
            if (cancelled) return;
            setItems((prev) =>
              prev.map((it) =>
                it.id === targetId ? { ...it, detectedAnchor: estimated } : it
              )
            );
            setRecipe((prev) => ({
              ...prev,
              lens: {
                ...prev.lens,
                faceAnchor: estimated,
              },
            }));
            return; // State update will trigger re-render pass below
          }
        }

        if (previewCanvasRef.current && !cancelled) {
          renderFilteredToCanvas(img, previewCanvasRef.current, recipe, {
            maxEdge: 720,
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Could not render image preview.');
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [activeItem, recipe]);

  // Synchronous fast re-render on slider/lens tweaks when image is already decoded
  useEffect(() => {
    if (!activeItem || !previewCanvasRef.current) return;
    if (loadedImageRef.current && loadedImageRef.current.url === activeItem.previewUrl) {
      renderFilteredToCanvas(loadedImageRef.current.img, previewCanvasRef.current, recipe, {
        maxEdge: 720,
      });
    }
  }, [activeItem, recipe]);

  const ingestFiles = async (fileList: FileList | File[], append = false) => {
    const rawFiles = Array.from(fileList).filter((f) => {
      if (f.type && f.type.startsWith('image/')) return true;
      return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);
    });
    if (rawFiles.length === 0) {
      setErrorMsg('No supported image files found.');
      return;
    }

    setIsLoadingFiles(true);
    setErrorMsg(null);
    if (!append) clearPreviousObjectUrls();

    const loaded: FilterStudioItem[] = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];
      const objectUrl = URL.createObjectURL(file);
      try {
        const img = await loadHtmlImageForFilter(objectUrl);
        revokableUrlsRef.current.push(objectUrl);
        loaded.push({
          id: `local_f_${Date.now()}_${i}`,
          filename: file.name,
          previewUrl: objectUrl,
          objectUrlToRevoke: objectUrl,
          width: Math.max(1, img.naturalWidth || img.width),
          height: Math.max(1, img.naturalHeight || img.height),
          sizeBytes: file.size,
          selected: true,
          detectedAnchor: null,
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

    setItems((prev) => {
      const next = append ? [...prev, ...loaded] : loaded;
      if (!append || !activeId) {
        setActiveId(next[0].id);
      }
      return next;
    });
    setStatusMsg(`Loaded ${loaded.length} image${loaded.length === 1 ? '' : 's'} into Filter Studio.`);
    setIsLoadingFiles(false);
  };

  const handleLoadSamplePortraits = async () => {
    setIsLoadingFiles(true);
    setErrorMsg(null);
    clearPreviousObjectUrls();

    try {
      const loaded: FilterStudioItem[] = SAMPLE_PORTRAITS.map((p, idx) => ({
        id: `sample_portrait_${Date.now()}_${idx}`,
        filename: p.filename,
        previewUrl: p.url,
        width: 512,
        height: 512,
        sizeBytes: 0,
        selected: true,
        detectedAnchor: null,
      }));
      setItems(loaded);
      setActiveId(loaded[0].id);
      setStatusMsg(`Loaded ${loaded.length} sample portraits ready for filters & AR lenses.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load sample portraits.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSelectImage = (item: FilterStudioItem) => {
    setActiveId(item.id);
    if (item.detectedAnchor) {
      setRecipe((prev) => ({
        ...prev,
        lens: { ...prev.lens, faceAnchor: item.detectedAnchor! },
      }));
    }
  };

  const handleSelectPreset = (presetId: ColorPresetId) => {
    setRecipe((prev) => ({
      ...prev,
      presetId,
      adjustments: buildPresetAdjustments(presetId),
    }));
  };

  const handleUpdateAdjustment = (key: keyof ImageAdjustmentState, value: number) => {
    setRecipe((prev) => ({
      ...prev,
      adjustments: {
        ...prev.adjustments,
        [key]: value,
      },
    }));
  };

  const handleSelectLens = (lensId: SnapLensId) => {
    setRecipe((prev) => ({
      ...prev,
      lens: {
        ...prev.lens,
        lensId,
      },
    }));
  };

  const handleAutoDetectFace = useCallback(async () => {
    if (!activeItem) return;
    try {
      const img =
        loadedImageRef.current && loadedImageRef.current.url === activeItem.previewUrl
          ? loadedImageRef.current.img
          : await loadHtmlImageForFilter(activeItem.previewUrl);
      const estimated = await detectFaceAnchorFromImage(img);
      setItems((prev) =>
        prev.map((it) => (it.id === activeItem.id ? { ...it, detectedAnchor: estimated } : it))
      );
      setRecipe((prev) => ({
        ...prev,
        lens: { ...prev.lens, faceAnchor: estimated },
      }));
      setShowAnchorGuide(true);
      setStatusMsg(
        `Face anchor aligned (${Math.round(estimated.centerX * 100)}%, ${Math.round(
          estimated.centerY * 100
        )}%). Drag the crosshair on canvas to fine-tune.`
      );
    } catch {
      setErrorMsg('Could not detect portrait region on this image.');
    }
  }, [activeItem]);

  const handleResetAll = () => {
    setRecipe((prev) => ({
      presetId: 'original',
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      lens: {
        lensId: 'none',
        intensity: 90,
        faceAnchor: activeItem?.detectedAnchor
          ? { ...activeItem.detectedAnchor }
          : { ...DEFAULT_FACE_ANCHOR },
      },
    }));
    setStatusMsg('Reset all color adjustments and active Snapchat lens.');
  };

  // Drag Face Anchor handle directly on the canvas stage
  const handleAnchorPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const stageEl = stageBoxRef.current;
    if (!stageEl) return;

    const updateFromClient = (clientX: number, clientY: number) => {
      const rect = stageEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = (clientX - rect.left) / rect.width;
      const ny = (clientY - rect.top) / rect.height;
      setRecipe((prev) => ({
        ...prev,
        lens: {
          ...prev.lens,
          faceAnchor: sanitizeFaceAnchor({
            ...prev.lens.faceAnchor,
            centerX: nx,
            centerY: ny,
            source: 'manual',
          }),
        },
      }));
    };

    const onMove = (ev: PointerEvent) => updateFromClient(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag Split Wipe divider
  const handleSplitPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const stageEl = stageBoxRef.current;
    if (!stageEl) return;

    const updateSplit = (clientX: number) => {
      const rect = stageEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
      setSplitPercent(Math.round(pct));
    };

    const onMove = (ev: PointerEvent) => updateSplit(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleDownloadActive = async () => {
    if (!activeItem || isExporting) return;
    setIsExporting(true);
    setErrorMsg(null);
    setExportProgress(`Rendering ${activeItem.filename}...`);
    try {
      const res = await exportFilteredImageBlob(
        activeItem.previewUrl,
        activeItem.filename,
        recipe,
        outputConfig
      );
      const outName = buildOutputFilename(activeItem.filename, {
        ...outputConfig,
        preserveSubfolders: false,
      });
      triggerBlobDownload(res.blob, outName);
      const msg = `Downloaded ${outName} (${res.width}×${res.height}).`;
      if (onNotify) {
        onNotify(msg);
      } else {
        setStatusMsg(msg);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to export filtered image.');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const handleBatchExportZip = async () => {
    if (selectedItems.length === 0 || isExporting) return;
    setIsExporting(true);
    setErrorMsg(null);

    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      let count = 0;

      for (let i = 0; i < selectedItems.length; i++) {
        const it = selectedItems[i];
        setExportProgress(`Filtering ${i + 1} / ${selectedItems.length}: ${it.filename}`);

        const itemRecipe: FilterRecipe = {
          ...recipe,
          lens: {
            ...recipe.lens,
            faceAnchor:
              it.id === activeItem?.id
                ? recipe.lens.faceAnchor
                : it.detectedAnchor || recipe.lens.faceAnchor,
          },
        };

        const res = await exportFilteredImageBlob(
          it.previewUrl,
          it.filename,
          itemRecipe,
          outputConfig
        );

        let name = buildOutputFilename(it.filename, {
          ...outputConfig,
          preserveSubfolders: false,
        });
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let c = 1;
          while (usedNames.has(`${base}_${c}${ext}`)) c++;
          name = `${base}_${c}${ext}`;
        }
        usedNames.add(name);
        zip.file(name, res.blob);
        count++;
      }

      setExportProgress('Packaging ZIP...');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      triggerBlobDownload(blob, `filtered_studio_${Date.now()}.zip`);
      const msg = `Exported ${count} filtered image${count === 1 ? '' : 's'} to ZIP!`;
      if (onNotify) {
        onNotify(msg);
      } else {
        setStatusMsg(msg);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Batch ZIP export failed.');
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
  };

  const toggleSelectAll = () => {
    const allSelected = items.length > 0 && selectedItems.length === items.length;
    setItems((prev) => prev.map((it) => ({ ...it, selected: !allSelected })));
  };

  return (
    <div className="space-y-6">
      {/* Hidden Pickers */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files, items.length > 0);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={(el) => {
          folderInputRef.current = el;
          if (el) {
            el.setAttribute('webkitdirectory', '');
            el.setAttribute('directory', '');
          }
        }}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFiles(e.target.files, false);
          }
          e.target.value = '';
        }}
      />

      {/* Top Intake & Studio Header */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDraggingFiles) setIsDraggingFiles(true);
        }}
        onDragLeave={() => setIsDraggingFiles(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFiles(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            ingestFiles(e.dataTransfer.files, false);
          }
        }}
        className={`bg-white dark:bg-[#111318] border rounded-2xl p-6 sm:p-8 transition-colors ${
          isDraggingFiles
            ? 'border-blue-600 ring-2 ring-blue-600/20'
            : 'border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-950 dark:text-zinc-50 tracking-tight leading-[1.15] [text-wrap:balance]">
              Color grade adjustments &amp; Snapchat-inspired AR lenses.
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mt-2">
              Tune exposure, contrast, brightness, grayscale, sepia, warmth, sharpen, and film grain alongside interactive face-aware AR lenses and optical effects directly in your browser.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoadingFiles}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <ImagePlus className="w-4 h-4 shrink-0" />
              <span>{items.length > 0 ? 'Add Images' : 'Select Images'}</span>
            </button>

            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={isLoadingFiles}
              className="flex items-center gap-2 px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <FolderOpen className="w-4 h-4 shrink-0 text-zinc-500" />
              <span>Open Folder</span>
            </button>

            <button
              type="button"
              onClick={handleLoadSamplePortraits}
              disabled={isLoadingFiles}
              className="flex items-center gap-1.5 px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/60 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>Load 6 Sample Portraits</span>
            </button>
          </div>
        </div>
      </section>

      {/* Inline Feedback */}
      {errorMsg && (
        <div className="px-4 py-3 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs underline hover:no-underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {statusMsg && (
        <div className="px-4 py-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200 text-xs sm:text-sm font-medium rounded-xl flex items-center gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="flex-1">{statusMsg}</span>
        </div>
      )}

      {/* Empty State Showcase */}
      {!isLoadingFiles && items.length === 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">01.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                14-Control Adjustment Suite
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Dial in Grayscale, Sepia, Brightness, Contrast, Saturation, Exposure, Warmth, Hue Rotate, Sharpen, Blur, Vignette, and Film Grain—or apply 8 curated presets in one click.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadSamplePortraits}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Try with 6 Sample Portraits &rarr;
            </button>
          </div>

          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">02.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Snapchat-Inspired Lenses
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Snap Puppy Ears, Flower Crown, Heart Blush, Rainbow Aura, Cool Shades, Gold Butterflies, 90s VHS, Fisheye Bulge, or Comic Pop onto any portrait with auto face alignment.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setInspectorTab('lenses');
                handleLoadSamplePortraits();
              }}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Open Snap Lenses &rarr;
            </button>
          </div>

          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">03.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Before/After Split &amp; Batch Export
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Inspect edits with a live draggable Before/After wipe bar and export full-resolution singles or batch ZIP archives in PNG, JPEG, or WebP.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Upload Your Images &rarr;
            </button>
          </div>
        </section>
      )}

      {/* Active Darkroom Workbench */}
      {activeItem && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT 8 COLS: Interactive Stage + Filmstrip */}
          <div className="lg:col-span-8 space-y-5">
            <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
              {/* Stage Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-950 dark:text-white truncate">
                    {activeItem.filename}
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 mt-0.5">
                    <span>
                      {activeItem.width}×{activeItem.height}
                    </span>
                    {activeItem.sizeBytes > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatBytesCompact(activeItem.sizeBytes)}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">
                      {activeEffectCount} active effect{activeEffectCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCompareSplit((v) => !v)}
                    aria-pressed={compareSplit}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                      compareSplit
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <SplitSquareHorizontal className="w-3.5 h-3.5" />
                    <span>Split Compare</span>
                  </button>

                  {currentLensMeta.needsFaceAnchor && (
                    <>
                      <button
                        type="button"
                        onClick={handleAutoDetectFace}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <ScanFace className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Auto-Detect Face</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowAnchorGuide((v) => !v)}
                        aria-pressed={showAnchorGuide}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 rounded-lg text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Toggle draggable face target marker"
                      >
                        {showAnchorGuide ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                        <span>Anchor</span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={handleResetAll}
                    disabled={activeEffectCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:text-rose-600 dark:hover:text-rose-400 disabled:opacity-40 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All</span>
                  </button>
                </div>
              </div>

              {/* Darkroom Viewport */}
              <div className="bg-[#090A0F] rounded-xl p-3 sm:p-4 flex items-center justify-center min-h-[340px] sm:min-h-[440px] overflow-hidden select-none">
                <div
                  ref={stageBoxRef}
                  className="relative inline-flex items-center justify-center max-w-full max-h-[540px] overflow-hidden rounded-lg shadow-2xl"
                >
                  {/* Filtered Canvas Output */}
                  <canvas
                    ref={previewCanvasRef}
                    data-testid="filter-preview-canvas"
                    className="block max-w-full max-h-[520px] w-auto h-auto object-contain"
                  />

                  {/* Before / After Original Split Layer (clipped to left splitPercent%) */}
                  {compareSplit && (
                    <>
                      <img
                        src={activeItem.previewUrl}
                        alt={`Original ${activeItem.filename}`}
                        draggable={false}
                        style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                      />

                      {/* Wipe Divider Line + Draggable Knob */}
                      <div
                        style={{ left: `${splitPercent}%` }}
                        className="absolute inset-y-0 -translate-x-1/2 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.65)] z-20 pointer-events-none"
                      />
                      <button
                        type="button"
                        aria-label="Drag Before and After split comparison handle"
                        onPointerDown={handleSplitPointerDown}
                        style={{ left: `${splitPercent}%` }}
                        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-white text-zinc-900 shadow-lg border border-zinc-300 flex items-center justify-center cursor-ew-resize hover:scale-105 transition-transform"
                      >
                        <SplitSquareHorizontal className="w-4 h-4" />
                      </button>

                      <span className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded bg-zinc-950/75 text-white text-[10px] font-mono uppercase tracking-wider pointer-events-none">
                        Before
                      </span>
                      <span className="absolute top-2.5 right-2.5 z-20 px-2 py-0.5 rounded bg-blue-600/90 text-white text-[10px] font-mono uppercase tracking-wider pointer-events-none">
                        After
                      </span>
                    </>
                  )}

                  {/* Interactive Face Anchor Drag Handle */}
                  {currentLensMeta.needsFaceAnchor && showAnchorGuide && (
                    <button
                      type="button"
                      data-testid="face-anchor-handle"
                      onPointerDown={handleAnchorPointerDown}
                      aria-label="Drag face lens anchor position"
                      style={{
                        left: `${recipe.lens.faceAnchor.centerX * 100}%`,
                        top: `${recipe.lens.faceAnchor.centerY * 100}%`,
                      }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full border-2 border-white bg-blue-600/45 hover:bg-blue-600/75 shadow-lg flex items-center justify-center cursor-move transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      title="Drag to align lens onto face"
                    >
                      <span className="w-2 h-2 rounded-full bg-white" />
                    </button>
                  )}
                </div>
              </div>

              {/* Split Percentage Slider Strip when Compare is ON */}
              {compareSplit && (
                <div className="flex items-center gap-3 px-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono uppercase text-[11px] shrink-0">Before/After Wipe</span>
                  <input
                    type="range"
                    min={5}
                    max={95}
                    value={splitPercent}
                    aria-label="Split compare position"
                    onChange={(e) => setSplitPercent(Number(e.target.value))}
                    className="flex-1 accent-blue-600 cursor-pointer"
                  />
                  <span className="font-mono tabular-nums w-10 text-right">{splitPercent}%</span>
                </div>
              )}
            </div>

            {/* Filmstrip / Batch Queue */}
            <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
                  >
                    {selectedItems.length === items.length && items.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Square className="w-4 h-4 text-zinc-400" />
                    )}
                    <span className="tabular-nums">
                      Batch Selection ({selectedItems.length}/{items.length})
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    clearPreviousObjectUrls();
                    setItems([]);
                    setActiveId(null);
                    setStatusMsg(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Queue</span>
                </button>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                {items.map((it) => {
                  const isActive = it.id === activeItem.id;
                  return (
                    <div
                      key={it.id}
                      onClick={() => handleSelectImage(it)}
                      className={`group relative rounded-xl overflow-hidden border transition-all cursor-pointer ${
                        isActive
                          ? 'border-blue-600 ring-2 ring-blue-600/25'
                          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600'
                      }`}
                    >
                      <div className="aspect-square bg-zinc-100 dark:bg-[#090A0F]">
                        <img
                          src={it.previewUrl}
                          alt={it.filename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setItems((prev) =>
                            prev.map((row) =>
                              row.id === it.id ? { ...row, selected: !row.selected } : row
                            )
                          );
                        }}
                        aria-label={`Include ${it.filename} in batch export`}
                        aria-pressed={it.selected}
                        className={`absolute top-1.5 left-1.5 w-5 h-5 rounded flex items-center justify-center transition-colors cursor-pointer ${
                          it.selected
                            ? 'bg-blue-600 text-white'
                            : 'bg-zinc-950/60 text-white hover:bg-zinc-950/85'
                        }`}
                      >
                        {it.selected ? (
                          <Check className="w-3.5 h-3.5 stroke-[2.75]" />
                        ) : (
                          <span className="w-2.5 h-2.5 border border-white/80 rounded-[2px]" />
                        )}
                      </button>
                      <div className="px-2 py-1 bg-white dark:bg-[#111318] text-[10px] font-mono text-zinc-600 dark:text-zinc-300 truncate">
                        {it.filename}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT 4 COLS: 3-Tab Inspector */}
          <aside className="lg:col-span-4 bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden flex flex-col">
            {/* 3-Tab Switcher */}
            <div
              role="tablist"
              aria-label="Filter Studio Inspector Tabs"
              className="grid grid-cols-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#0D0F16]"
            >
              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'adjustments'}
                onClick={() => setInspectorTab('adjustments')}
                className={`flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  inspectorTab === 'adjustments'
                    ? 'border-blue-600 text-zinc-950 dark:text-white bg-white dark:bg-[#111318]'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Adjust</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'lenses'}
                onClick={() => setInspectorTab('lenses')}
                className={`flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  inspectorTab === 'lenses'
                    ? 'border-blue-600 text-zinc-950 dark:text-white bg-white dark:bg-[#111318]'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Snap Lenses</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={inspectorTab === 'export'}
                onClick={() => setInspectorTab('export')}
                className={`flex items-center justify-center gap-1.5 py-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                  inspectorTab === 'export'
                    ? 'border-blue-600 text-zinc-950 dark:text-white bg-white dark:bg-[#111318]'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export</span>
              </button>
            </div>

            <div className="p-5 space-y-5 max-h-[580px] overflow-y-auto flex-1">
              {/* TAB 1: COLOR PRESETS & ADJUSTMENT SLIDERS */}
              {inspectorTab === 'adjustments' && (
                <div className="space-y-5">
                  {/* Curated Presets */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Color Presets
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">8 looks</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {COLOR_PRESETS.map((preset) => {
                        const isSelected = recipe.presetId === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleSelectPreset(preset.id)}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 text-zinc-950 dark:text-white'
                                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 text-zinc-800 dark:text-zinc-200'
                            }`}
                          >
                            <span
                              className="w-4 h-4 rounded-full shrink-0 border border-black/10"
                              style={{
                                background: `linear-gradient(135deg, ${preset.swatch[0]} 0%, ${preset.swatch[1]} 100%)`,
                              }}
                            />
                            <span className="text-xs font-semibold truncate">{preset.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Slider Groups */}
                  {(
                    [
                      { id: 'tone', title: 'Light & Color' },
                      { id: 'classic', title: 'Classic Filters' },
                      { id: 'optics', title: 'Optics & Finish' },
                    ] as const
                  ).map((group) => (
                    <div
                      key={group.id}
                      className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {group.title}
                      </div>

                      {SLIDER_DEFINITIONS.filter((s) => s.group === group.id).map((def) => {
                        const val = recipe.adjustments[def.key];
                        const isModified = val !== DEFAULT_ADJUSTMENTS[def.key];
                        return (
                          <div key={def.key} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <label
                                htmlFor={`slider-${def.key}`}
                                className="font-medium text-zinc-800 dark:text-zinc-200"
                              >
                                {def.label}
                              </label>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`font-mono tabular-nums text-[11px] ${
                                    isModified
                                      ? 'text-blue-600 dark:text-blue-400 font-semibold'
                                      : 'text-zinc-500 dark:text-zinc-400'
                                  }`}
                                >
                                  {val > 0 && def.min < 0 ? `+${val}` : val}
                                  {def.unit}
                                </span>
                                {isModified && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateAdjustment(def.key, DEFAULT_ADJUSTMENTS[def.key])
                                    }
                                    aria-label={`Reset ${def.label}`}
                                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <input
                              id={`slider-${def.key}`}
                              type="range"
                              min={def.min}
                              max={def.max}
                              step={def.step}
                              value={val}
                              onChange={(e) =>
                                handleUpdateAdjustment(def.key, Number(e.target.value))
                              }
                              className="w-full accent-blue-600 cursor-pointer"
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 2: SNAPCHAT-INSPIRED AR & OPTICAL LENSES */}
              {inspectorTab === 'lenses' && (
                <div className="space-y-5">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Snapchat-Inspired Lenses
                      </span>
                      <span className="text-[11px] font-mono text-zinc-400">
                        {currentLensMeta.category}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {SNAP_LENSES.map((lens) => {
                        const isSelected = recipe.lens.lensId === lens.id;
                        return (
                          <button
                            key={lens.id}
                            type="button"
                            onClick={() => handleSelectLens(lens.id)}
                            aria-pressed={isSelected}
                            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30 text-zinc-950 dark:text-white'
                                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 text-zinc-800 dark:text-zinc-200'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="text-xs font-semibold truncate">{lens.label}</span>
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: lens.accentColor }}
                              />
                            </div>
                            <span className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-1">
                              {lens.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Lens Intensity */}
                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <label
                          htmlFor="lens-intensity"
                          className="font-medium text-zinc-800 dark:text-zinc-200"
                        >
                          Lens Intensity
                        </label>
                        <span className="font-mono tabular-nums text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
                          {recipe.lens.intensity}%
                        </span>
                      </div>
                      <input
                        id="lens-intensity"
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={recipe.lens.intensity}
                        onChange={(e) =>
                          setRecipe((prev) => ({
                            ...prev,
                            lens: { ...prev.lens, intensity: Number(e.target.value) },
                          }))
                        }
                        className="w-full accent-blue-600 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Face Anchor Alignment Controls */}
                  {currentLensMeta.needsFaceAnchor && (
                    <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                          Face Alignment
                        </span>
                        <button
                          type="button"
                          onClick={handleAutoDetectFace}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          <ScanFace className="w-3 h-3" />
                          <span>Auto-Align</span>
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label
                            htmlFor="lens-face-scale"
                            className="font-medium text-zinc-800 dark:text-zinc-200"
                          >
                            Lens Scale
                          </label>
                          <span className="font-mono tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
                            {Math.round(recipe.lens.faceAnchor.widthRatio * 100)}%
                          </span>
                        </div>
                        <input
                          id="lens-face-scale"
                          type="range"
                          min={16}
                          max={80}
                          step={1}
                          value={Math.round(recipe.lens.faceAnchor.widthRatio * 100)}
                          onChange={(e) => {
                            const ratio = Number(e.target.value) / 100;
                            setRecipe((prev) => ({
                              ...prev,
                              lens: {
                                ...prev.lens,
                                faceAnchor: sanitizeFaceAnchor({
                                  ...prev.lens.faceAnchor,
                                  widthRatio: ratio,
                                  source: 'manual',
                                }),
                              },
                            }));
                          }}
                          className="w-full accent-blue-600 cursor-pointer"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label
                            htmlFor="lens-face-tilt"
                            className="font-medium text-zinc-800 dark:text-zinc-200"
                          >
                            Head Tilt
                          </label>
                          <span className="font-mono tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
                            {recipe.lens.faceAnchor.tiltDeg}°
                          </span>
                        </div>
                        <input
                          id="lens-face-tilt"
                          type="range"
                          min={-45}
                          max={45}
                          step={1}
                          value={recipe.lens.faceAnchor.tiltDeg}
                          onChange={(e) => {
                            const tilt = Number(e.target.value);
                            setRecipe((prev) => ({
                              ...prev,
                              lens: {
                                ...prev.lens,
                                faceAnchor: sanitizeFaceAnchor({
                                  ...prev.lens.faceAnchor,
                                  tiltDeg: tilt,
                                  source: 'manual',
                                }),
                              },
                            }));
                          }}
                          className="w-full accent-blue-600 cursor-pointer"
                        />
                      </div>

                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        Tip: Drag the circular blue crosshair directly over the face on the canvas to reposition the lens.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: FORMAT & BATCH EXPORT */}
              {inspectorTab === 'export' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="filter-export-format"
                      className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                    >
                      Output Format
                    </label>
                    <select
                      id="filter-export-format"
                      value={outputConfig.format}
                      onChange={(e) =>
                        setOutputConfig((prev) => ({
                          ...prev,
                          format: e.target.value as OutputFormat,
                        }))
                      }
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="keep">Keep Original Format</option>
                      <option value="png">PNG (Lossless)</option>
                      <option value="jpeg">JPEG</option>
                      <option value="webp">WebP</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <label
                        htmlFor="filter-export-quality"
                        className="font-semibold text-zinc-800 dark:text-zinc-200"
                      >
                        Encoding Quality
                      </label>
                      <span className="font-mono tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
                        {outputConfig.quality}%
                      </span>
                    </div>
                    <input
                      id="filter-export-quality"
                      type="range"
                      min={50}
                      max={100}
                      step={1}
                      value={outputConfig.quality}
                      onChange={(e) =>
                        setOutputConfig((prev) => ({
                          ...prev,
                          quality: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="filter-export-suffix"
                      className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200"
                    >
                      Filename Suffix
                    </label>
                    <input
                      id="filter-export-suffix"
                      type="text"
                      value={outputConfig.suffix}
                      onChange={(e) =>
                        setOutputConfig((prev) => ({ ...prev, suffix: e.target.value }))
                      }
                      placeholder="_filtered"
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono text-xs text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Persistent Export Footer pinned outside scrollable area */}
            <div className="p-4 sm:p-5 bg-zinc-50/70 dark:bg-[#0D0F16] border-t border-zinc-200 dark:border-zinc-800 space-y-2.5 shrink-0">
              {exportProgress && (
                <div className="flex items-center gap-2 text-xs font-mono text-blue-600 dark:text-blue-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">{exportProgress}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleDownloadActive}
                disabled={isExporting || !activeItem}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Download Filtered Image</span>
              </button>

              <button
                type="button"
                onClick={handleBatchExportZip}
                disabled={isExporting || selectedItems.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-45 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                <FileArchive className="w-4 h-4 shrink-0" />
                <span className="tabular-nums">
                  Export Selected (.ZIP) ({selectedItems.length})
                </span>
              </button>
            </div>
          </aside>
        </section>
      )}
    </div>
  );
};
