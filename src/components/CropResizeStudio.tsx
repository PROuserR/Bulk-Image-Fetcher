'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Crop,
  FolderOpen,
  FolderInput,
  ImagePlus,
  Layers,
  Check,
  RotateCcw,
  Maximize,
  Sparkles,
  Loader2,
  Search,
  CheckSquare,
  Square,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { InteractiveCropCanvas } from './InteractiveCropCanvas';
import { CropResizeInspector } from './CropResizeInspector';
import {
  AspectRatioPreset,
  CropRect,
  NormalizedCropRect,
  OutputConfig,
  ResizeConfig,
  buildOutputFilename,
  clampCropRect,
  computeAspectLockedCrop,
  computeTargetDimensions,
  denormalizeCropRect,
  formatBytesCompact,
  normalizeCropRect,
} from '../utils/imageTransformLogic';
import {
  generateSampleDirectoryPlates,
  processImageInBrowser,
} from '../utils/browserImageProcessor';
import { triggerBlobDownload } from '../utils/downloader';
import { fetchApiJson } from '../utils/safeFetchJson';
import { ScrapedImage } from '../utils/scraperLogic';
import { resolveSeededPreviewUrl } from '../utils/folderGalleryLogic';

export interface StudioDirectoryItem {
  id: string;
  sourceKind: 'browser' | 'server' | 'remote';
  relativePath: string;
  filename: string;
  previewUrl: string;
  objectUrlToRevoke?: string;
  width: number;
  height: number;
  sizeBytes: number;
  format: string;
  selected: boolean;
  cropEnabled: boolean;
  cropRect: CropRect;
  hasCustomCrop: boolean;
}

interface CropResizeStudioProps {
  seededScrapedImages?: ScrapedImage[];
  seededSourceUrl?: string;
  onClearSeeded?: () => void;
  onNotify?: (message: string) => void;
}

type IntakeMode = 'browser' | 'disk';

function readImageDimensions(url: string, timeoutMs = 8000): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      reject(new Error('Image dimension probe timed out'));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve({
        width: Math.max(1, img.naturalWidth || img.width || 1),
        height: Math.max(1, img.naturalHeight || img.height || 1),
      });
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

export const CropResizeStudio: React.FC<CropResizeStudioProps> = ({
  seededScrapedImages = [],
  seededSourceUrl = '',
  onClearSeeded,
  onNotify,
}) => {
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('browser');
  const [items, setItems] = useState<StudioDirectoryItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [folderLabel, setFolderLabel] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDraggingFiles, setIsDraggingFiles] = useState<boolean>(false);

  // Disk Directory Mode state
  const [diskPathInput, setDiskPathInput] = useState<string>('');
  const [diskScannedRoot, setDiskScannedRoot] = useState<string>('');
  const [diskOutputDir, setDiskOutputDir] = useState<string>('');
  const [diskRecursive, setDiskRecursive] = useState<boolean>(true);
  const [diskOverwrite, setDiskOverwrite] = useState<boolean>(false);
  const [isScanningDisk, setIsScanningDisk] = useState<boolean>(false);

  // Transform controls
  const [aspectPreset, setAspectPreset] = useState<AspectRatioPreset>('free');
  const [resizeConfig, setResizeConfig] = useState<ResizeConfig>({
    mode: 'original',
    width: 1920,
    height: 1080,
    maxEdge: 1600,
    percent: 50,
    lockAspect: true,
    fit: 'cover',
  });
  const [outputConfig, setOutputConfig] = useState<OutputConfig>({
    format: 'keep',
    quality: 90,
    suffix: '_resized',
    preserveSubfolders: true,
  });

  // Processing state
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [diskSummary, setDiskSummary] = useState<{
    outputDir: string;
    count: number;
    errors: number;
  } | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  const syncDecodedDimensions = (id: string, natW: number, natH: number) => {
    if (natW <= 0 || natH <= 0) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (it.width === natW && it.height === natH) return it;
        const nextCrop = it.hasCustomCrop
          ? clampCropRect(it.cropRect, natW, natH)
          : { x: 0, y: 0, width: natW, height: natH };
        return {
          ...it,
          width: natW,
          height: natH,
          cropRect: nextCrop,
        };
      })
    );
  };

  // Import seeded scraped images immediately when sent from GalleryView
  useEffect(() => {
    if (!seededScrapedImages || seededScrapedImages.length === 0) return;
    let cancelled = false;
    const stamp = Date.now();

    const immediateItems: StudioDirectoryItem[] = seededScrapedImages.map((srcImg, i) => {
      const proxied = resolveSeededPreviewUrl(srcImg.fullUrl, seededSourceUrl || '');
      const initW = Math.max(1, srcImg.width || 1600);
      const initH = Math.max(1, srcImg.height || 1066);
      const fallbackName = srcImg.filename || `image_${i + 1}.${srcImg.format || 'jpg'}`;
      return {
        id: `scraped_${stamp}_${i}`,
        sourceKind: 'remote',
        relativePath: fallbackName,
        filename: fallbackName,
        previewUrl: proxied,
        width: initW,
        height: initH,
        sizeBytes: 0,
        format: srcImg.format || 'jpeg',
        selected: true,
        cropEnabled: false,
        cropRect: { x: 0, y: 0, width: initW, height: initH },
        hasCustomCrop: false,
      };
    });

    setErrorMsg(null);
    setIntakeMode('browser');
    setItems(immediateItems);
    setActiveId(immediateItems[0].id);
    setFolderLabel(`Scraped Selection (${immediateItems.length} images)`);
    setStatusMsg(`Loaded ${immediateItems.length} images from Scraper Studio into Crop & Resize.`);
    onClearSeededRef.current?.();

    // Non-blocking background decode to refine exact natural dimensions without stalling UI handoff
    Promise.allSettled(
      immediateItems.map(async (item) => {
        const dims = await readImageDimensions(item.previewUrl, 8000);
        if (!cancelled) {
          syncDecodedDimensions(item.id, dims.width, dims.height);
        }
      })
    ).catch(() => {
      // ignore background probe failures; active image also syncs via InteractiveCropCanvas onImageLoad
    });

    return () => {
      cancelled = true;
    };
  }, [seededScrapedImages, seededSourceUrl]);

  const activeItem = useMemo(
    () => items.find((item) => item.id === activeId) || items[0] || null,
    [items, activeId]
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.relativePath.toLowerCase().includes(q) ||
        item.filename.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const selectedItems = useMemo(() => items.filter((i) => i.selected), [items]);

  const previewTargetDimensions = useMemo(() => {
    if (!activeItem) return { width: 0, height: 0 };
    const workingW = activeItem.cropEnabled ? activeItem.cropRect.width : activeItem.width;
    const workingH = activeItem.cropEnabled ? activeItem.cropRect.height : activeItem.height;
    return computeTargetDimensions(workingW, workingH, resizeConfig);
  }, [activeItem, resizeConfig]);

  const clearPreviousObjectUrls = () => {
    for (const url of revokableUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    revokableUrlsRef.current = [];
  };

  const ingestFileList = async (fileList: FileList | File[], modeLabel: string, append = false) => {
    const rawFiles = Array.from(fileList).filter((f) => {
      if (f.type && f.type.startsWith('image/')) return true;
      return /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(f.name);
    });

    if (rawFiles.length === 0) {
      setErrorMsg('No supported image files found in the selected directory or files.');
      return;
    }

    setIsLoadingFiles(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setDiskSummary(null);

    if (!append) {
      clearPreviousObjectUrls();
    }

    const loaded: StudioDirectoryItem[] = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const file = rawFiles[i];
      const relPath =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const objectUrl = URL.createObjectURL(file);
      try {
        const dims = await readImageDimensions(objectUrl);
        revokableUrlsRef.current.push(objectUrl);
        loaded.push({
          id: `local_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          sourceKind: 'browser',
          relativePath: relPath,
          filename: file.name,
          previewUrl: objectUrl,
          objectUrlToRevoke: objectUrl,
          width: dims.width,
          height: dims.height,
          sizeBytes: file.size,
          format: (file.name.split('.').pop() || 'jpeg').toLowerCase(),
          selected: true,
          cropEnabled: false,
          cropRect: { x: 0, y: 0, width: dims.width, height: dims.height },
          hasCustomCrop: false,
        });
      } catch {
        URL.revokeObjectURL(objectUrl);
      }
    }

    if (loaded.length === 0) {
      setErrorMsg('Could not decode any images from the chosen directory.');
      setIsLoadingFiles(false);
      return;
    }

    loaded.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

    setItems((prev) => {
      const next = append ? [...prev, ...loaded] : loaded;
      if (!append || !activeId) {
        setActiveId(next[0].id);
      }
      return next;
    });

    if (!append) {
      const topFolder = loaded[0].relativePath.includes('/')
        ? loaded[0].relativePath.split('/')[0]
        : modeLabel;
      setFolderLabel(topFolder);
    }

    setStatusMsg(`Loaded ${loaded.length} image${loaded.length === 1 ? '' : 's'} ready to crop & resize.`);
    setIsLoadingFiles(false);
  };

  const handleLoadSampleFolder = async () => {
    setIsLoadingFiles(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setDiskSummary(null);
    setIntakeMode('browser');
    clearPreviousObjectUrls();

    try {
      const plates = await generateSampleDirectoryPlates();
      const loaded: StudioDirectoryItem[] = plates.map((p, idx) => {
        revokableUrlsRef.current.push(p.previewUrl);
        return {
          id: `sample_${Date.now()}_${idx}`,
          sourceKind: 'browser',
          relativePath: p.relativePath,
          filename: p.filename,
          previewUrl: p.previewUrl,
          objectUrlToRevoke: p.previewUrl,
          width: p.width,
          height: p.height,
          sizeBytes: p.sizeBytes,
          format: p.format,
          selected: true,
          cropEnabled: false,
          cropRect: { x: 0, y: 0, width: p.width, height: p.height },
          hasCustomCrop: false,
        };
      });

      setItems(loaded);
      setActiveId(loaded[0]?.id || null);
      setFolderLabel('sample_studio_directory');
      setStatusMsg(`Loaded ${loaded.length} sample directory plates across 4 subfolders.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to generate sample directory.');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleScanDiskDirectory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = diskPathInput.trim();
    if (!trimmed) {
      setErrorMsg('Enter a directory path on disk to scan.');
      return;
    }

    setIsScanningDisk(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setDiskSummary(null);

    try {
      const { ok, data, error } = await fetchApiJson<{
        resolvedRoot: string;
        images: {
          relativePath: string;
          filename: string;
          sizeBytes: number;
          width: number;
          height: number;
          format: string;
        }[];
        error?: string;
      }>('/api/crop-resize/scan-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directoryPath: trimmed, recursive: diskRecursive }),
      });

      if (!ok || !data) {
        throw new Error(data?.error || error || 'Could not scan directory path.');
      }

      if (data.images.length === 0) {
        setItems([]);
        setActiveId(null);
        setDiskScannedRoot(data.resolvedRoot);
        setErrorMsg(`No supported images found in ${data.resolvedRoot}.`);
        return;
      }

      clearPreviousObjectUrls();
      const loaded: StudioDirectoryItem[] = data.images.map((img, idx) => ({
        id: `disk_${Date.now()}_${idx}`,
        sourceKind: 'server',
        relativePath: img.relativePath,
        filename: img.filename,
        previewUrl: `/api/crop-resize/local-preview?root=${encodeURIComponent(
          data.resolvedRoot
        )}&file=${encodeURIComponent(img.relativePath)}`,
        width: img.width,
        height: img.height,
        sizeBytes: img.sizeBytes,
        format: img.format,
        selected: true,
        cropEnabled: false,
        cropRect: { x: 0, y: 0, width: img.width, height: img.height },
        hasCustomCrop: false,
      }));

      setItems(loaded);
      setActiveId(loaded[0].id);
      setDiskScannedRoot(data.resolvedRoot);
      setFolderLabel(data.resolvedRoot);
      if (!diskOutputDir.trim()) {
        setDiskOutputDir(`${data.resolvedRoot.replace(/\/+$/, '')}/output_cropped_resized`);
      }
      setStatusMsg(`Scanned ${loaded.length} images from ${data.resolvedRoot}.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Directory scan failed.');
    } finally {
      setIsScanningDisk(false);
    }
  };

  const updateActiveItem = (updater: (prev: StudioDirectoryItem) => StudioDirectoryItem) => {
    if (!activeItem) return;
    setItems((prev) => prev.map((it) => (it.id === activeItem.id ? updater(it) : it)));
  };

  const handleToggleCropEnabled = (enabled: boolean) => {
    if (!activeItem) return;
    updateActiveItem((it) => {
      if (!enabled) {
        return { ...it, cropEnabled: false };
      }
      const nextRect =
        aspectPreset === 'free' && !it.hasCustomCrop
          ? {
              x: Math.round(it.width * 0.1),
              y: Math.round(it.height * 0.1),
              width: Math.max(16, Math.round(it.width * 0.8)),
              height: Math.max(16, Math.round(it.height * 0.8)),
            }
          : aspectPreset !== 'free'
            ? computeAspectLockedCrop(it.width, it.height, aspectPreset)
            : it.cropRect;
      return {
        ...it,
        cropEnabled: true,
        cropRect: clampCropRect(nextRect, it.width, it.height),
        hasCustomCrop: true,
      };
    });
  };

  const handleSelectAspectPreset = (preset: AspectRatioPreset) => {
    setAspectPreset(preset);
    if (!activeItem) return;
    updateActiveItem((it) => {
      const nextCrop =
        preset === 'free'
          ? it.cropEnabled
            ? it.cropRect
            : { x: 0, y: 0, width: it.width, height: it.height }
          : computeAspectLockedCrop(it.width, it.height, preset);
      return {
        ...it,
        cropEnabled: preset === 'free' ? it.cropEnabled : true,
        cropRect: nextCrop,
        hasCustomCrop: preset !== 'free' || it.hasCustomCrop,
      };
    });
  };

  const handleCenterCrop = () => {
    if (!activeItem) return;
    updateActiveItem((it) => ({
      ...it,
      cropEnabled: true,
      cropRect: clampCropRect(
        {
          ...it.cropRect,
          x: Math.round((it.width - it.cropRect.width) / 2),
          y: Math.round((it.height - it.cropRect.height) / 2),
        },
        it.width,
        it.height
      ),
      hasCustomCrop: true,
    }));
  };

  const handleResetCrop = () => {
    if (!activeItem) return;
    setAspectPreset('free');
    updateActiveItem((it) => ({
      ...it,
      cropEnabled: false,
      cropRect: { x: 0, y: 0, width: it.width, height: it.height },
      hasCustomCrop: false,
    }));
  };

  const handleApplyCropToAllSelected = () => {
    if (!activeItem) return;
    const norm: NormalizedCropRect = normalizeCropRect(
      activeItem.cropRect,
      activeItem.width,
      activeItem.height
    );
    const applyEnabled = activeItem.cropEnabled;

    setItems((prev) =>
      prev.map((it) => {
        if (!it.selected) return it;
        const nextCrop =
          aspectPreset !== 'free' && applyEnabled
            ? computeAspectLockedCrop(it.width, it.height, aspectPreset)
            : denormalizeCropRect(norm, it.width, it.height);
        return {
          ...it,
          cropEnabled: applyEnabled,
          cropRect: nextCrop,
          hasCustomCrop: applyEnabled,
        };
      })
    );

    const count = selectedItems.length;
    setStatusMsg(
      applyEnabled
        ? `Applied ${aspectPreset === 'free' ? 'proportional' : aspectPreset} crop framing to ${count} selected image${count === 1 ? '' : 's'}.`
        : `Cleared crop framing across ${count} selected image${count === 1 ? '' : 's'}.`
    );
  };

  const handleUpdateCropNumeric = (field: keyof CropRect, rawValue: number) => {
    if (!activeItem) return;
    const val = Number.isFinite(rawValue) ? Math.round(rawValue) : 0;
    updateActiveItem((it) => ({
      ...it,
      cropEnabled: true,
      cropRect: clampCropRect({ ...it.cropRect, [field]: val }, it.width, it.height),
      hasCustomCrop: true,
    }));
  };

  const handleDownloadActiveSingle = async () => {
    if (!activeItem || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg(null);
    setProgressText(`Processing ${activeItem.filename}...`);
    try {
      const result = await processImageInBrowser(activeItem.previewUrl, activeItem.filename, {
        cropEnabled: activeItem.cropEnabled,
        cropRect: activeItem.cropRect,
        resize: resizeConfig,
        output: outputConfig,
      });
      const outName = buildOutputFilename(activeItem.relativePath, {
        ...outputConfig,
        preserveSubfolders: false,
      });
      triggerBlobDownload(result.blob, outName);
      const msg = `Downloaded ${outName} (${result.width}×${result.height}).`;
      setStatusMsg(msg);
      onNotify?.(msg);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process active image.');
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const handleBatchExportZip = async () => {
    if (selectedItems.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg(null);
    setDiskSummary(null);

    try {
      if (intakeMode === 'disk' && diskScannedRoot) {
        setProgressText(`Processing ${selectedItems.length} directory images with sharp...`);
        const response = await fetch('/api/crop-resize/download-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceDir: diskScannedRoot,
            items: selectedItems.map((it) => ({
              relativePath: it.relativePath,
              cropEnabled: it.cropEnabled,
              cropRect: it.cropRect,
            })),
            resize: resizeConfig,
            output: outputConfig,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || 'Server ZIP export failed.');
        }
        const blob = await response.blob();
        triggerBlobDownload(blob, `cropped_resized_${Date.now()}.zip`);
        const msg = `Exported ${selectedItems.length} cropped/resized images as ZIP.`;
        setStatusMsg(msg);
        onNotify?.(msg);
        return;
      }

      const zip = new JSZip();
      const usedPaths = new Set<string>();
      let processedCount = 0;

      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        setProgressText(`Processing ${i + 1} / ${selectedItems.length}: ${item.filename}`);
        const res = await processImageInBrowser(item.previewUrl, item.filename, {
          cropEnabled: item.cropEnabled,
          cropRect: item.cropRect,
          resize: resizeConfig,
          output: outputConfig,
        });

        let targetRelPath = buildOutputFilename(item.relativePath, outputConfig);
        if (usedPaths.has(targetRelPath)) {
          const dotIdx = targetRelPath.lastIndexOf('.');
          const base = dotIdx > 0 ? targetRelPath.slice(0, dotIdx) : targetRelPath;
          const ext = dotIdx > 0 ? targetRelPath.slice(dotIdx) : '';
          let counter = 1;
          while (usedPaths.has(`${base}_${counter}${ext}`)) counter++;
          targetRelPath = `${base}_${counter}${ext}`;
        }
        usedPaths.add(targetRelPath);
        zip.file(targetRelPath, res.blob);
        processedCount++;
      }

      setProgressText('Building ZIP archive...');
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      triggerBlobDownload(zipBlob, `cropped_resized_${Date.now()}.zip`);
      const msg = `Exported ${processedCount} cropped & resized image${processedCount === 1 ? '' : 's'} into ZIP!`;
      setStatusMsg(msg);
      onNotify?.(msg);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Batch ZIP export failed.');
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const handleSaveBrowserFolder = async () => {
    if (selectedItems.length === 0 || isProcessing) return;
    if (typeof (window as any).showDirectoryPicker !== 'function') {
      setErrorMsg('Direct folder writing is unavailable in this browser/frame. Use Export Selected (.ZIP).');
      return;
    }

    let rootHandle: any = null;
    try {
      rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setErrorMsg(`Folder picker unavailable: ${err?.message || 'Blocked inside embedded preview frame. Use Export ZIP.'}`);
      return;
    }

    setIsProcessing(true);
    setErrorMsg(null);
    let saved = 0;

    try {
      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        setProgressText(`Saving ${i + 1} / ${selectedItems.length}: ${item.filename}`);
        const res = await processImageInBrowser(item.previewUrl, item.filename, {
          cropEnabled: item.cropEnabled,
          cropRect: item.cropRect,
          resize: resizeConfig,
          output: outputConfig,
        });

        const relOut = buildOutputFilename(item.relativePath, outputConfig);
        const parts = relOut.split('/').filter(Boolean);
        const fileName = parts.pop() || `image_${i + 1}.jpg`;
        let dirHandle = rootHandle;
        for (const sub of parts) {
          dirHandle = await dirHandle.getDirectoryHandle(sub, { create: true });
        }
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(res.blob);
        await writable.close();
        saved++;
      }

      const msg = `Saved ${saved} processed images directly into your chosen folder!`;
      setStatusMsg(msg);
      onNotify?.(msg);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed while writing files to folder.');
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const handleProcessToDiskDirectory = async () => {
    if (!diskScannedRoot || selectedItems.length === 0 || isProcessing) return;
    setIsProcessing(true);
    setErrorMsg(null);
    setDiskSummary(null);
    setProgressText(`Processing ${selectedItems.length} images to directory...`);

    try {
      const { ok, data, error } = await fetchApiJson<{
        resolvedOutputDir: string;
        processed: { relativePath: string; outputRelativePath: string; width: number; height: number }[];
        errors: { relativePath: string; error: string }[];
        error?: string;
      }>('/api/crop-resize/process-dir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDir: diskScannedRoot,
          outputDir: diskOutputDir.trim() || undefined,
          overwrite: diskOverwrite,
          items: selectedItems.map((it) => ({
            relativePath: it.relativePath,
            cropEnabled: it.cropEnabled,
            cropRect: it.cropRect,
          })),
          resize: resizeConfig,
          output: outputConfig,
        }),
      });

      if (!ok || !data) {
        throw new Error(data?.error || error || 'Failed to process directory images.');
      }

      setDiskSummary({
        outputDir: data.resolvedOutputDir,
        count: data.processed.length,
        errors: data.errors.length,
      });
      const msg = `Saved ${data.processed.length} processed image${data.processed.length === 1 ? '' : 's'} to ${data.resolvedOutputDir}`;
      setStatusMsg(msg);
      onNotify?.(msg);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process directory on disk.');
    } finally {
      setIsProcessing(false);
      setProgressText(null);
    }
  };

  const [canDirectSaveToFolder, setCanDirectSaveToFolder] = useState(false);

  useEffect(() => {
    setCanDirectSaveToFolder(
      typeof window !== 'undefined' &&
        'showDirectoryPicker' in window &&
        window.self === window.top
    );
  }, []);

  const isAllSelected = items.length > 0 && selectedItems.length === items.length;

  return (
    <div className="space-y-6">
      {/* Hidden Folder & File Pickers */}
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
            ingestFileList(e.target.files, 'Local Folder', false);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            ingestFileList(e.target.files, 'Selected Files', items.length > 0);
          }
          e.target.value = '';
        }}
      />

      {/* Top Directory Intake Workbench */}
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
            setIntakeMode('browser');
            ingestFileList(e.dataTransfer.files, 'Dropped Files', false);
          }
        }}
        className={`bg-white dark:bg-[#111318] border rounded-2xl p-6 sm:p-8 transition-colors ${
          isDraggingFiles
            ? 'border-blue-600 ring-2 ring-blue-600/20'
            : 'border-zinc-200 dark:border-zinc-800'
        }`}
      >
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-6">
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-zinc-950 dark:text-zinc-50 tracking-tight leading-[1.15] [text-wrap:balance]">
              Crop &amp; resize images across an entire directory.
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mt-2">
              Open a local folder or scan a directory path on disk, frame interactive aspect crops, apply exact or proportional batch dimensions, and preserve subfolder structure on export.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Directory Intake Mode"
            className="grid grid-cols-2 sm:inline-flex items-center p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl shrink-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={intakeMode === 'browser'}
              onClick={() => setIntakeMode('browser')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setIntakeMode('disk');
                }
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                intakeMode === 'browser'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" />
              <span>Local Folder / Files</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={intakeMode === 'disk'}
              onClick={() => setIntakeMode('disk')}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setIntakeMode('browser');
                }
              }}
              className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                intakeMode === 'disk'
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              <FolderInput className="w-3.5 h-3.5 shrink-0" />
              <span>Disk Directory Path</span>
            </button>
          </div>
        </div>

        {/* Mode A: Local Folder / Files Picker */}
        {intakeMode === 'browser' && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800/80">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                disabled={isLoadingFiles}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
                <span>Open Folder</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoadingFiles}
                className="flex items-center gap-2 px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ImagePlus className="w-4 h-4 shrink-0 text-zinc-500" />
                <span>{items.length > 0 ? 'Add Images' : 'Select Files'}</span>
              </button>

              <button
                type="button"
                onClick={handleLoadSampleFolder}
                disabled={isLoadingFiles}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/60 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Load Sample Folder</span>
              </button>
            </div>

            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
              {folderLabel ? (
                <span>
                  Directory: <strong className="text-zinc-900 dark:text-zinc-100">{folderLabel}</strong> ·{' '}
                  {items.length} file{items.length === 1 ? '' : 's'}
                </span>
              ) : (
                <span>Drag &amp; drop images anywhere here, or open a folder</span>
              )}
            </div>
          </div>
        )}

        {/* Mode B: Disk Directory Path Scanner (Server + sharp) */}
        {intakeMode === 'disk' && (
          <form
            onSubmit={handleScanDiskDirectory}
            className="pt-4 border-t border-zinc-100 dark:border-zinc-800/80 space-y-3"
          >
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
                  <FolderInput className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={diskPathInput}
                  onChange={(e) => setDiskPathInput(e.target.value)}
                  placeholder="/path/to/your/image-directory or ./assets/photos"
                  className="w-full pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-xl font-mono text-xs sm:text-sm text-zinc-950 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={isScanningDisk || !diskPathInput.trim()}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isScanningDisk ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Scanning...</span>
                  </>
                ) : (
                  <span>Scan Directory</span>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={diskRecursive}
                  onChange={(e) => setDiskRecursive(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
                />
                <span>Include subdirectories recursively</span>
              </label>

              {diskScannedRoot && (
                <span className="font-mono text-zinc-500 dark:text-zinc-400 truncate max-w-md">
                  Scanned: {diskScannedRoot}
                </span>
              )}
            </div>
          </form>
        )}
      </section>

      {/* Alerts / Inline Progress */}
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

      {diskSummary && (
        <div className="px-4 py-3 bg-zinc-50 dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs font-mono text-zinc-700 dark:text-zinc-300 flex flex-wrap items-center justify-between gap-2">
          <span>
            Processed {diskSummary.count} file{diskSummary.count === 1 ? '' : 's'} into{' '}
            <strong className="text-zinc-950 dark:text-white">{diskSummary.outputDir}</strong>
          </span>
          {diskSummary.errors > 0 && (
            <span className="text-rose-600 dark:text-rose-400">
              {diskSummary.errors} failed
            </span>
          )}
        </div>
      )}

      {/* Empty State before images are loaded */}
      {!isLoadingFiles && items.length === 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">01.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Interactive Frame Cropper
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Drag 8 precision handles with rule-of-thirds guides, lock standard photo aspect ratios, and propagate proportions across the entire directory.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadSampleFolder}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Try Sample Directory &rarr;
            </button>
          </div>

          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">02.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Batch Resize &amp; Format Conversion
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Resize by exact dimensions, max edge limit, or percentage scale and transcode cleanly to JPEG, PNG, or WebP in parallel.
              </p>
            </div>
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Open Local Folder &rarr;
            </button>
          </div>

          <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 flex flex-col justify-between gap-3">
            <div>
              <div className="text-xs font-mono text-zinc-400 dark:text-zinc-500">03.</div>
              <h3 className="font-display text-base font-bold text-zinc-950 dark:text-white mt-1.5">
                Subfolder-Safe Output
              </h3>
              <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 mt-1.5 leading-relaxed">
                Export structured ZIP archives, save directly into a local folder, or write processed images cleanly using native sharp pipelines.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIntakeMode('disk')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline self-start cursor-pointer"
            >
              Scan Disk Path &rarr;
            </button>
          </div>
        </section>
      )}

      {/* Active Darkroom Workbench (Left Stage + Filmstrip | Right Inspector) */}
      {activeItem && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: Visual Crop Canvas + Directory Queue */}
          <div className="lg:col-span-8 space-y-5">
            <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
              {/* Stage Top Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-950 dark:text-white truncate">
                    {activeItem.relativePath}
                  </div>
                  <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400 mt-0.5">
                    <span>
                      {activeItem.width}×{activeItem.height}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="uppercase">{activeItem.format}</span>
                    {activeItem.sizeBytes > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{formatBytesCompact(activeItem.sizeBytes)}</span>
                      </>
                    )}
                    <span aria-hidden="true">&rarr;</span>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold">
                      Out {previewTargetDimensions.width}×{previewTargetDimensions.height}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleToggleCropEnabled(!activeItem.cropEnabled)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap cursor-pointer ${
                      activeItem.cropEnabled
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-800 hover:border-blue-500'
                    }`}
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>{activeItem.cropEnabled ? 'Crop Active' : 'Enable Crop'}</span>
                  </button>

                  {activeItem.cropEnabled && (
                    <>
                      <button
                        type="button"
                        onClick={handleCenterCrop}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <Maximize className="w-3.5 h-3.5" />
                        <span>Center</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleResetCrop}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset</span>
                      </button>
                    </>
                  )}

                  {selectedItems.length > 1 && (
                    <button
                      type="button"
                      onClick={handleApplyCropToAllSelected}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                      title="Propagate current crop proportions to all selected images in directory"
                    >
                      <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Apply Crop to All ({selectedItems.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Interactive Darkroom Crop Canvas */}
              <InteractiveCropCanvas
                src={activeItem.previewUrl}
                alt={activeItem.filename}
                naturalWidth={activeItem.width}
                naturalHeight={activeItem.height}
                cropEnabled={activeItem.cropEnabled}
                cropRect={activeItem.cropRect}
                aspectPreset={aspectPreset}
                onImageLoad={(natW, natH) => syncDecodedDimensions(activeItem.id, natW, natH)}
                onChangeCrop={(nextRect) =>
                  updateActiveItem((it) => ({
                    ...it,
                    cropEnabled: true,
                    cropRect: nextRect,
                    hasCustomCrop: true,
                  }))
                }
              />
            </div>

            {/* Directory Contact-Sheet Filmstrip */}
            <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() =>
                      setItems((prev) => prev.map((it) => ({ ...it, selected: !isAllSelected })))
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {isAllSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-zinc-400" />
                    )}
                    <span>{isAllSelected ? 'Deselect All' : 'Select All'}</span>
                  </button>

                  <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    <strong className="text-zinc-900 dark:text-white">{selectedItems.length}</strong> /{' '}
                    {items.length} selected
                  </span>

                  <button
                    type="button"
                    onClick={() => {
                      clearPreviousObjectUrls();
                      setItems([]);
                      setActiveId(null);
                      setFolderLabel('');
                      setDiskScannedRoot('');
                      setDiskSummary(null);
                    }}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>

                <div className="relative sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter folder path..."
                    className="w-full pl-8 pr-3 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-950 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[340px] overflow-y-auto pr-1">
                {filteredItems.map((item) => {
                  const isActive = item.id === activeItem.id;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className={`group relative rounded-xl border overflow-hidden cursor-pointer transition-all ${
                        isActive
                          ? 'border-blue-600 ring-2 ring-blue-600/20 bg-blue-50/30 dark:bg-blue-950/10'
                          : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-[#0B0C10] hover:border-zinc-400 dark:hover:border-zinc-600'
                      }`}
                    >
                      <div className="relative aspect-[4/3] bg-zinc-100 dark:bg-zinc-950 overflow-hidden">
                        <img
                          src={item.previewUrl}
                          alt={item.filename}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setItems((prev) =>
                              prev.map((it) =>
                                it.id === item.id ? { ...it, selected: !it.selected } : it
                              )
                            );
                          }}
                          aria-label={`Select ${item.relativePath}`}
                          aria-pressed={item.selected}
                          className={`absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center transition-colors cursor-pointer ${
                            item.selected
                              ? 'bg-blue-600 text-white'
                              : 'bg-zinc-950/60 text-white hover:bg-zinc-950/85'
                          }`}
                        >
                          {item.selected ? (
                            <Check className="w-3.5 h-3.5 stroke-[2.75]" />
                          ) : (
                            <div className="w-3 h-3 rounded-[2px] border border-white/75" />
                          )}
                        </button>
                      </div>

                      <div className="p-2.5 space-y-0.5">
                        <div
                          className="text-xs font-semibold text-zinc-950 dark:text-zinc-100 truncate"
                          title={item.relativePath}
                        >
                          {item.relativePath}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400 truncate">
                          <span>
                            {item.width}×{item.height}
                          </span>
                          {item.cropEnabled && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans font-semibold text-blue-600 dark:text-blue-400">
                                Cropped
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Precision Transform & Export Inspector */}
          <CropResizeInspector
            activeItem={activeItem}
            intakeMode={intakeMode}
            selectedCount={selectedItems.length}
            aspectPreset={aspectPreset}
            resizeConfig={resizeConfig}
            outputConfig={outputConfig}
            previewTargetDimensions={previewTargetDimensions}
            diskOutputDir={diskOutputDir}
            diskOverwrite={diskOverwrite}
            isProcessing={isProcessing}
            progressText={progressText}
            canDirectSaveToFolder={canDirectSaveToFolder}
            onToggleCropEnabled={handleToggleCropEnabled}
            onSelectAspectPreset={handleSelectAspectPreset}
            onUpdateCropNumeric={handleUpdateCropNumeric}
            onChangeResizeConfig={setResizeConfig}
            onChangeOutputConfig={setOutputConfig}
            onChangeDiskOutputDir={setDiskOutputDir}
            onChangeDiskOverwrite={setDiskOverwrite}
            onProcessToDiskDirectory={handleProcessToDiskDirectory}
            onBatchExportZip={handleBatchExportZip}
            onSaveBrowserFolder={handleSaveBrowserFolder}
            onDownloadActiveSingle={handleDownloadActiveSingle}
          />
        </section>
      )}
    </div>
  );
};
