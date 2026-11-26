'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  FolderOpen,
  ImagePlus,
  Sparkles,
  Trash2,
  Search,
  X,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
  LayoutGrid,
  Columns3,
  List as ListIcon,
  Star,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Check,
  Download,
  Crop,
  Wand2,
  Film,
  Maximize,
  Minimize,
} from 'lucide-react';
import {
  FolderGalleryItem,
  GalleryLayoutMode,
  GalleryOrientationFilter,
  GallerySortDirection,
  GallerySortField,
  extractImageFormat,
  extractSubfolderPath,
  filterFolderGalleryItems,
  formatGalleryDate,
  formatMegapixels,
  getGridColumnClasses,
  getMasonryColumnClasses,
  isSupportedGalleryImageFile,
  sortFolderGalleryItems,
  summarizeSubfolders,
} from '../utils/folderGalleryLogic';
import { formatBytesCompact } from '../utils/imageTransformLogic';
import { triggerBlobDownload } from '../utils/downloader';
import { ScrapedImage, classifyResolution, detectFormat } from '../utils/scraperLogic';
import { FolderLightboxModal } from './FolderLightboxModal';

import heroOpticalBenchImg from '../assets/images/hero_optical_bench_1795633734818.jpg';
import bentoPrismImg from '../assets/images/bento_prism_grading_1795633735516.jpg';
import studioDarkroomImg from '../assets/images/studio_hero_darkroom_1795110056551.jpg';
import studioLensImg from '../assets/images/studio_bento_lens_1795110057979.jpg';

interface FolderGalleryStudioProps {
  onNotify?: (msg: string) => void;
  onSendToCropResize?: (images: ScrapedImage[]) => void;
  onSendToFilterStudio?: (images: ScrapedImage[]) => void;
  onSendToGifMaker?: (images: ScrapedImage[]) => void;
}

interface DropFileWithPath {
  file: File;
  relativePath: string;
}

const SAMPLE_FOLDER_BLUEPRINT: Array<{
  filename: string;
  subfolder: string;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  lastModifiedOffsetDays: number;
  format: string;
  starred?: boolean;
}> = [
  {
    filename: 'optical_bench_01.jpg',
    subfolder: 'Studio Optics',
    previewUrl: heroOpticalBenchImg.src,
    width: 1920,
    height: 1080,
    sizeBytes: 1_842_100,
    lastModifiedOffsetDays: 1,
    format: 'JPG',
    starred: true,
  },
  {
    filename: 'prism_dispersion_02.jpg',
    subfolder: 'Studio Optics',
    previewUrl: bentoPrismImg.src,
    width: 1600,
    height: 1200,
    sizeBytes: 1_415_800,
    lastModifiedOffsetDays: 3,
    format: 'JPG',
  },
  {
    filename: 'darkroom_calibration_03.jpg',
    subfolder: 'Studio Optics',
    previewUrl: studioDarkroomImg.src,
    width: 1920,
    height: 1080,
    sizeBytes: 1_620_400,
    lastModifiedOffsetDays: 5,
    format: 'JPG',
    starred: true,
  },
  {
    filename: 'prime_lens_macro_04.jpg',
    subfolder: 'Studio Optics',
    previewUrl: studioLensImg.src,
    width: 1440,
    height: 1080,
    sizeBytes: 1_190_200,
    lastModifiedOffsetDays: 7,
    format: 'JPG',
  },
  {
    filename: 'portrait_session_01.jpg',
    subfolder: 'Portraits',
    previewUrl: '/samples/humans/random_001.jpg',
    width: 900,
    height: 1200,
    sizeBytes: 482_500,
    lastModifiedOffsetDays: 2,
    format: 'JPG',
    starred: true,
  },
  {
    filename: 'portrait_session_02.jpg',
    subfolder: 'Portraits',
    previewUrl: '/samples/humans/random_002.jpg',
    width: 900,
    height: 1200,
    sizeBytes: 518_900,
    lastModifiedOffsetDays: 4,
    format: 'JPG',
  },
  {
    filename: 'portrait_session_03.jpg',
    subfolder: 'Portraits',
    previewUrl: '/samples/humans/random_003.jpg',
    width: 1080,
    height: 1080,
    sizeBytes: 612_400,
    lastModifiedOffsetDays: 6,
    format: 'JPG',
  },
  {
    filename: 'portrait_session_04.jpg',
    subfolder: 'Portraits',
    previewUrl: '/samples/humans/random_004.jpg',
    width: 900,
    height: 1200,
    sizeBytes: 445_300,
    lastModifiedOffsetDays: 9,
    format: 'JPG',
  },
  {
    filename: 'portrait_session_05.jpg',
    subfolder: 'Portraits',
    previewUrl: '/samples/humans/random_005.jpg',
    width: 1200,
    height: 900,
    sizeBytes: 704_200,
    lastModifiedOffsetDays: 11,
    format: 'JPG',
  },
  {
    filename: 'portrait_session_06.jpg',
    subfolder: 'Portraits',
    previewUrl: '/samples/humans/random_006.jpg',
    width: 900,
    height: 1200,
    sizeBytes: 534_100,
    lastModifiedOffsetDays: 14,
    format: 'JPG',
  },
];

function probeImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve({ width: 0, height: 0 }), 5000);
    img.onload = () => {
      clearTimeout(timer);
      resolve({
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0,
      });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve({ width: 0, height: 0 });
    };
    img.src = src;
  });
}

async function readAllDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch || batch.length === 0) break;
    entries.push(...batch);
  }
  return entries;
}

async function collectDroppedEntryFiles(
  entry: FileSystemEntry,
  parentPath: string
): Promise<DropFileWithPath[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    const rel = parentPath ? `${parentPath}/${file.name}` : file.name;
    return [{ file, relativePath: rel }];
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const children = await readAllDirectoryEntries(reader);
    const nextPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const results: DropFileWithPath[] = [];
    for (const child of children) {
      const nested = await collectDroppedEntryFiles(child, nextPath);
      results.push(...nested);
    }
    return results;
  }
  return [];
}

function toScrapedImages(items: FolderGalleryItem[]): ScrapedImage[] {
  return items.map((item) => ({
    id: item.id,
    thumbnailUrl: item.previewUrl,
    fullUrl: item.previewUrl,
    altText: item.filename,
    filename: item.filename,
    format: detectFormat(item.filename),
    isUnshrunk: true,
    unshrinkMethod: 'Local Folder Master',
    resolutionTier: classifyResolution(item.width, item.height),
    width: item.width,
    height: item.height,
  }));
}

export const FolderGalleryStudio: React.FC<FolderGalleryStudioProps> = ({
  onNotify,
  onSendToCropResize,
  onSendToFilterStudio,
  onSendToGifMaker,
}) => {
  const [items, setItems] = useState<FolderGalleryItem[]>([]);
  const [folderName, setFolderName] = useState<string>('');
  const [isReadingFolder, setIsReadingFolder] = useState<boolean>(false);
  const [isDragActive, setIsDragActive] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);

  // Gallery View, Zoom & Sort State
  const [layoutMode, setLayoutMode] = useState<GalleryLayoutMode>('grid');
  const [gridZoom, setGridZoom] = useState<number>(3);
  const [gridFitMode, setGridFitMode] = useState<'cover' | 'contain'>('cover');
  const [sortField, setSortField] = useState<GallerySortField>('name');
  const [sortDirection, setSortDirection] = useState<GallerySortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [subfolderFilter, setSubfolderFilter] = useState<string>('all');
  const [orientationFilter, setOrientationFilter] =
    useState<GalleryOrientationFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxItemId, setLightboxItemId] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef<string[]>([]);

  const revokeStoredObjectUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    objectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    return () => {
      revokeStoredObjectUrls();
    };
  }, [revokeStoredObjectUrls]);

  const ingestFileList = useCallback(
    async (fileEntries: DropFileWithPath[], labelHint?: string) => {
      const imageEntries = fileEntries.filter(({ file }) =>
        isSupportedGalleryImageFile(file)
      );
      if (imageEntries.length === 0) {
        onNotify?.('No supported image files found in that folder.');
        return;
      }

      setIsReadingFolder(true);
      revokeStoredObjectUrls();
      setSelectedIds(new Set());
      setLightboxItemId(null);
      setSubfolderFilter('all');

      const firstPath = imageEntries[0].relativePath || '';
      const rootSegment = firstPath.includes('/') ? firstPath.split('/')[0] : '';
      const resolvedLabel = labelHint || rootSegment || 'Local Folder';

      const stamp = Date.now();
      const createdUrls: string[] = [];

      const initialItems: FolderGalleryItem[] = imageEntries.map(({ file, relativePath }, idx) => {
        const objUrl = URL.createObjectURL(file);
        createdUrls.push(objUrl);
        return {
          id: `fg_${stamp}_${idx}`,
          filename: file.name,
          relativePath: relativePath || file.name,
          subfolder: extractSubfolderPath(relativePath || file.name),
          previewUrl: objUrl,
          objectUrlToRevoke: objUrl,
          width: 0,
          height: 0,
          sizeBytes: file.size || 0,
          lastModified: file.lastModified || stamp,
          format: extractImageFormat(file.name, file.type),
          starred: false,
          rotationDeg: 0,
        };
      });

      objectUrlsRef.current = createdUrls;
      setFolderName(resolvedLabel);
      setItems(initialItems);
      setIsReadingFolder(false);
      onNotify?.(
        `Loaded ${initialItems.length} image${initialItems.length === 1 ? '' : 's'} from "${resolvedLabel}".`
      );

      const batchSize = 8;
      for (let i = 0; i < initialItems.length; i += batchSize) {
        const slice = initialItems.slice(i, i + batchSize);
        const dims = await Promise.all(
          slice.map(async (it) => ({
            id: it.id,
            ...(await probeImageDimensions(it.previewUrl)),
          }))
        );
        setItems((prev) => {
          const map = new Map(dims.map((d) => [d.id, d]));
          return prev.map((it) => {
            const match = map.get(it.id);
            if (match && match.width > 0 && match.height > 0) {
              return { ...it, width: match.width, height: match.height };
            }
            return it;
          });
        });
      }
    },
    [onNotify, revokeStoredObjectUrls]
  );

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const entries: DropFileWithPath[] = Array.from(fileList).map((file) => ({
      file,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));
    await ingestFileList(entries);
    e.target.value = '';
  };

  const handleFilesInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const entries: DropFileWithPath[] = Array.from(fileList).map((file) => ({
      file,
      relativePath: file.name,
    }));
    await ingestFileList(entries, 'Selected Images');
    e.target.value = '';
  };

  const handleLoadSampleFolder = async () => {
    revokeStoredObjectUrls();
    setSelectedIds(new Set());
    setLightboxItemId(null);
    setSubfolderFilter('all');
    setSearchQuery('');
    setOrientationFilter('all');
    setFavoritesOnly(false);

    const now = Date.now();
    const dayMs = 86_400_000;
    const sampleItems: FolderGalleryItem[] = SAMPLE_FOLDER_BLUEPRINT.map((bp, idx) => ({
      id: `sample_fg_${idx + 1}`,
      filename: bp.filename,
      relativePath: `Sample_Shoot/${bp.subfolder}/${bp.filename}`,
      subfolder: bp.subfolder,
      previewUrl: bp.previewUrl,
      width: bp.width,
      height: bp.height,
      sizeBytes: bp.sizeBytes,
      lastModified: now - bp.lastModifiedOffsetDays * dayMs,
      format: bp.format,
      starred: Boolean(bp.starred),
      rotationDeg: 0,
    }));

    setFolderName('Sample_Shoot');
    setItems(sampleItems);
    onNotify?.(`Loaded ${sampleItems.length} sample images across 2 subfolders.`);

    const dims = await Promise.all(
      sampleItems.map(async (it) => ({
        id: it.id,
        ...(await probeImageDimensions(it.previewUrl)),
      }))
    );
    setItems((prev) => {
      const map = new Map(dims.map((d) => [d.id, d]));
      return prev.map((it) => {
        const match = map.get(it.id);
        if (match && match.width > 0 && match.height > 0) {
          return { ...it, width: match.width, height: match.height };
        }
        return it;
      });
    });
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    const dataItems = e.dataTransfer?.items;
    if (dataItems && dataItems.length > 0) {
      const collected: DropFileWithPath[] = [];
      let usedEntries = false;
      for (const dtItem of Array.from(dataItems)) {
        const getEntry = (dtItem as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null })
          .webkitGetAsEntry;
        if (typeof getEntry === 'function') {
          const entry = getEntry.call(dtItem);
          if (entry) {
            usedEntries = true;
            const nested = await collectDroppedEntryFiles(entry, '');
            collected.push(...nested);
          }
        }
      }
      if (usedEntries && collected.length > 0) {
        await ingestFileList(collected);
        return;
      }
    }

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await ingestFileList(
        Array.from(files).map((file) => ({
          file,
          relativePath: file.name,
        })),
        'Dropped Images'
      );
    }
  };

  const handleClearGallery = () => {
    revokeStoredObjectUrls();
    setItems([]);
    setFolderName('');
    setSelectedIds(new Set());
    setLightboxItemId(null);
    setSearchQuery('');
    setSubfolderFilter('all');
    setOrientationFilter('all');
    setFavoritesOnly(false);
  };

  const handleToggleStar = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, starred: !item.starred } : item))
    );
  }, []);

  const handleRotateItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, rotationDeg: (item.rotationDeg + 90) % 360 } : item
      )
    );
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
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

  const subfolders = useMemo(() => summarizeSubfolders(items), [items]);
  const starredCount = useMemo(() => items.filter((i) => i.starred).length, [items]);
  const totalBytes = useMemo(
    () => items.reduce((acc, it) => acc + (it.sizeBytes || 0), 0),
    [items]
  );

  const visibleItems = useMemo(() => {
    const filtered = filterFolderGalleryItems(items, {
      query: searchQuery,
      subfolder: subfolderFilter,
      orientation: orientationFilter,
      favoritesOnly,
    });
    return sortFolderGalleryItems(filtered, sortField, sortDirection);
  }, [items, searchQuery, subfolderFilter, orientationFilter, favoritesOnly, sortField, sortDirection]);

  const activeLightboxItem = useMemo(
    () => (lightboxItemId ? visibleItems.find((it) => it.id === lightboxItemId) || null : null),
    [lightboxItemId, visibleItems]
  );

  const actionTargets = useMemo(() => {
    if (selectedIds.size > 0) {
      return visibleItems.filter((it) => selectedIds.has(it.id));
    }
    return visibleItems;
  }, [selectedIds, visibleItems]);

  const handleDownloadZip = async () => {
    if (actionTargets.length === 0 || isZipping) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      const usedPaths = new Set<string>();

      for (let i = 0; i < actionTargets.length; i++) {
        const it = actionTargets[i];
        try {
          const resp = await fetch(it.previewUrl);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          let targetPath = it.relativePath || it.filename;
          if (usedPaths.has(targetPath)) {
            targetPath = `${i + 1}_${it.filename}`;
          }
          usedPaths.add(targetPath);
          zip.file(targetPath, blob);
        } catch {
          // skip unreadable items
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const safeFolder = (folderName || 'folder_gallery').replace(/[^a-zA-Z0-9_-]+/g, '_');
      triggerBlobDownload(zipBlob, `${safeFolder}_${actionTargets.length}img.zip`);
      onNotify?.(`Downloaded ${actionTargets.length} images as .ZIP archive.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not build ZIP archive.';
      onNotify?.(msg);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <section
      aria-label="Local Folder Gallery Studio"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragActive(false);
        }
      }}
      onDrop={handleDrop}
      className="space-y-5"
    >
      {/* Hidden native inputs for reliable iframe & desktop folder/file picking */}
      <input
        ref={folderInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFolderInputChange}
        className="hidden"
        aria-hidden="true"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilesInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Studio Header Card */}
      <div className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-[#0F141F] dark:text-[#F3F6FA] tracking-tight">
              Folder Gallery
            </h1>
            {items.length > 0 ? (
              <p className="text-xs sm:text-sm font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {folderName} · {visibleItems.length}
                {visibleItems.length !== items.length ? ` of ${items.length}` : ''} images ·{' '}
                {subfolders.length} folder{subfolders.length === 1 ? '' : 's'}
                {totalBytes > 0 ? ` · ${formatBytesCompact(totalBytes)}` : ''}
                {starredCount > 0 ? ` · ${starredCount} starred` : ''}
              </p>
            ) : (
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Pick any local folder or drop directories to browse photos with live grid zooming, multi-field sorting, and a fullscreen lightbox viewer.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              disabled={isReadingFolder}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
              <span>{items.length > 0 ? 'Change Folder' : 'Pick Folder'}</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReadingFolder}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.1] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-100 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Pick Files</span>
            </button>

            <button
              type="button"
              onClick={handleLoadSampleFolder}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.1] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-100 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Try Sample Folder</span>
            </button>

            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClearGallery}
                aria-label="Clear loaded folder"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Empty Folder Intake Dropzone */}
      {items.length === 0 && (
        <div
          className={`bg-white dark:bg-[#0E121B] border-2 border-dashed rounded-2xl p-10 sm:p-14 text-center transition-colors ${
            isDragActive
              ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20'
              : 'border-[#DCE1EB] dark:border-white/[0.12]'
          }`}
        >
          <div className="max-w-lg mx-auto space-y-4">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#EEF1F6] dark:bg-white/[0.06] flex items-center justify-center text-blue-600 dark:text-blue-400">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="font-display text-lg font-bold text-[#0F141F] dark:text-[#F3F6FA]">
                Drop a folder here or pick a directory
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Supports nested subfolders, JPG, PNG, WebP, GIF, AVIF, and SVG. All thumbnails, sorting, and zooming stay 100% private in your browser.
              </p>
            </div>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Choose Local Folder</span>
              </button>
              <button
                type="button"
                onClick={handleLoadSampleFolder}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.1] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-100 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Load Sample Shoot (10 Photos)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Controls Bar & Views */}
      {items.length > 0 && (
        <>
          <div className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-4 space-y-3">
            {/* Row 1: Search, Filters, Sort, Zoom & View Switch */}
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* Search & Filter Group */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-40">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search filename..."
                    aria-label="Search gallery images"
                    className="w-full h-9 pl-8 pr-7 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] text-xs text-[#0F141F] dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {subfolders.length > 1 && (
                  <select
                    aria-label="Filter by subfolder"
                    value={subfolderFilter}
                    onChange={(e) => setSubfolderFilter(e.target.value)}
                    className="h-9 px-2.5 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] text-xs text-[#0F141F] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                  >
                    <option value="all">Folders ({items.length})</option>
                    {subfolders.map((sf) => (
                      <option key={sf.name} value={sf.name}>
                        {sf.name} ({sf.count})
                      </option>
                    ))}
                  </select>
                )}

                <select
                  aria-label="Filter by orientation"
                  value={orientationFilter}
                  onChange={(e) =>
                    setOrientationFilter(e.target.value as GalleryOrientationFilter)
                  }
                  className="h-9 px-2.5 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] text-xs text-[#0F141F] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                >
                  <option value="all">All Ratios</option>
                  <option value="landscape">Landscape</option>
                  <option value="portrait">Portrait</option>
                  <option value="square">Square</option>
                </select>

                <button
                  type="button"
                  onClick={() => setFavoritesOnly((f) => !f)}
                  aria-pressed={favoritesOnly}
                  aria-label="Filter starred favorites"
                  className={`h-9 px-2.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    favoritesOnly
                      ? 'bg-amber-500/15 border-amber-400/60 text-amber-700 dark:text-amber-300'
                      : 'bg-[#F4F6F9] dark:bg-[#090C12] border-[#DCE1EB] dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-white/20'
                  }`}
                >
                  <Star className={`w-3.5 h-3.5 ${favoritesOnly ? 'fill-amber-400' : ''}`} />
                  <span className="font-mono tabular-nums">{starredCount}</span>
                </button>
              </div>

              {/* Sort, Thumbnail Zoom & Layout Group */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl p-1">
                  <select
                    aria-label="Sort gallery by"
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as GallerySortField)}
                    className="h-7 px-1.5 bg-transparent text-xs font-medium text-[#0F141F] dark:text-slate-100 focus:outline-none cursor-pointer"
                  >
                    <option value="name">Sort: Name</option>
                    <option value="date">Sort: Date Modified</option>
                    <option value="size">Sort: File Size</option>
                    <option value="resolution">Sort: Resolution</option>
                    <option value="aspect">Sort: Aspect Ratio</option>
                    <option value="folder">Sort: Folder</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
                    }
                    aria-label={`Sort direction: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
                    title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                    className="h-7 px-2 rounded-lg bg-white dark:bg-[#151C28] border border-[#DCE1EB] dark:border-white/[0.08] text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    {sortDirection === 'asc' ? (
                      <>
                        <ArrowUpNarrowWide className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Asc</span>
                      </>
                    ) : (
                      <>
                        <ArrowDownWideNarrow className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Desc</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Grid Zoom Density Slider (Left = Smaller/Compact, Right = Larger Thumbnails) */}
                {layoutMode !== 'list' && (
                  <div className="inline-flex items-center gap-1.5 h-9 px-2 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1]">
                    <button
                      type="button"
                      onClick={() => setGridZoom((z) => Math.min(5, z + 1))}
                      aria-label="Smaller thumbnails"
                      title="Smaller thumbnails (more columns)"
                      className="text-slate-500 hover:text-[#0F141F] dark:hover:text-white cursor-pointer"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={6 - gridZoom}
                      onChange={(e) => setGridZoom(6 - Number(e.target.value))}
                      aria-label="Thumbnail zoom size"
                      className="w-14 accent-blue-600 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setGridZoom((z) => Math.max(1, z - 1))}
                      aria-label="Larger thumbnails"
                      title="Larger thumbnails"
                      className="text-slate-500 hover:text-[#0F141F] dark:hover:text-white cursor-pointer"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {layoutMode === 'grid' && (
                  <button
                    type="button"
                    onClick={() =>
                      setGridFitMode((m) => (m === 'cover' ? 'contain' : 'cover'))
                    }
                    aria-label={`Thumbnail framing: ${gridFitMode}`}
                    className="h-9 px-2.5 rounded-xl bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {gridFitMode === 'cover' ? (
                      <>
                        <Maximize className="w-3.5 h-3.5 text-slate-500" />
                        <span>Fill</span>
                      </>
                    ) : (
                      <>
                        <Minimize className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Fit</span>
                      </>
                    )}
                  </button>
                )}

                {/* Layout Mode Segmented Control */}
                <div
                  role="group"
                  aria-label="Gallery layout mode"
                  className="inline-flex items-center p-1 bg-[#F4F6F9] dark:bg-[#090C12] border border-[#DCE1EB] dark:border-white/[0.1] rounded-xl"
                >
                  {(
                    [
                      { id: 'grid', label: 'Grid', icon: LayoutGrid },
                      { id: 'masonry', label: 'Masonry', icon: Columns3 },
                      { id: 'list', label: 'List', icon: ListIcon },
                    ] as const
                  ).map(({ id, label, icon: Icon }) => {
                    const active = layoutMode === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setLayoutMode(id)}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                          active
                            ? 'bg-white dark:bg-[#182030] text-[#0F141F] dark:text-white shadow-xs'
                            : 'text-slate-500 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-slate-200'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Row 2: Batch Selection & Downstream Studio Handoff */}
            <div className="pt-2.5 border-t border-[#DCE1EB]/80 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      visibleItems.length > 0 &&
                      visibleItems.every((it) => selectedIds.has(it.id))
                    ) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(visibleItems.map((it) => it.id)));
                    }
                  }}
                  className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
                >
                  {visibleItems.length > 0 &&
                  visibleItems.every((it) => selectedIds.has(it.id))
                    ? 'Deselect All'
                    : `Select Visible (${visibleItems.length})`}
                </button>
                {selectedIds.size > 0 && (
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    · {selectedIds.size} selected
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={actionTargets.length === 0 || isZipping}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F141F] hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:opacity-50 text-white font-semibold transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {isZipping
                      ? 'Zipping...'
                      : `Download .ZIP (${actionTargets.length})`}
                  </span>
                </button>

                {onSendToCropResize && (
                  <button
                    type="button"
                    onClick={() => onSendToCropResize(toScrapedImages(actionTargets))}
                    disabled={actionTargets.length === 0}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-200 font-medium transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Crop className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Crop &amp; Resize</span>
                  </button>
                )}

                {onSendToFilterStudio && (
                  <button
                    type="button"
                    onClick={() => onSendToFilterStudio(toScrapedImages(actionTargets))}
                    disabled={actionTargets.length === 0}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-200 font-medium transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Filters</span>
                  </button>
                )}

                {onSendToGifMaker && (
                  <button
                    type="button"
                    onClick={() => onSendToGifMaker(toScrapedImages(actionTargets))}
                    disabled={actionTargets.length === 0}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] border border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20 text-[#0F141F] dark:text-slate-200 font-medium transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Film className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>GIF89a</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Empty Filter State */}
          {visibleItems.length === 0 ? (
            <div className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-[#0F141F] dark:text-slate-100">
                No images match the current filter criteria.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSubfolderFilter('all');
                  setOrientationFilter('all');
                  setFavoritesOnly(false);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : layoutMode === 'grid' ? (
            /* GRID VIEW */
            <div
              data-testid="folder-gallery-grid"
              className={`grid gap-4 ${getGridColumnClasses(gridZoom)}`}
            >
              {visibleItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <article
                    key={item.id}
                    className={`group bg-white dark:bg-[#0E121B] border rounded-xl overflow-hidden transition-all duration-150 ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-600/25'
                        : 'border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-300 dark:hover:border-white/20'
                    }`}
                  >
                    <div className="relative aspect-[4/3] bg-[#EEF1F6] dark:bg-[#090C12] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setLightboxItemId(item.id)}
                        aria-label={`Open ${item.filename} in viewer`}
                        className="w-full h-full block cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.previewUrl}
                          alt={item.filename}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          style={
                            item.rotationDeg
                              ? { transform: `rotate(${item.rotationDeg}deg)` }
                              : undefined
                          }
                          className={`w-full h-full transition-transform duration-300 group-hover:scale-[1.03] ${
                            gridFitMode === 'contain'
                              ? 'object-contain p-1.5'
                              : 'object-cover object-[50%_20%]'
                          }`}
                        />
                      </button>

                      {/* Top-left selection toggle */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleSelect(item.id);
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
                          handleToggleStar(item.id);
                        }}
                        aria-label={
                          item.starred
                            ? `Unstar ${item.filename}`
                            : `Star ${item.filename}`
                        }
                        aria-pressed={item.starred}
                        className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-xs transition-opacity cursor-pointer ${
                          item.starred
                            ? 'bg-amber-500/85 text-white opacity-100'
                            : 'bg-black/45 text-white/80 opacity-0 group-hover:opacity-100 hover:bg-black/65'
                        }`}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${item.starred ? 'fill-white' : ''}`}
                        />
                      </button>

                      {/* Subtle measured bottom hover bar */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 bg-gradient-to-t from-black/70 via-black/25 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between px-3 pb-2">
                        <span className="text-[11px] font-mono text-white/90 truncate">
                          {item.subfolder}
                        </span>
                        <Maximize2 className="w-3.5 h-3.5 text-white/90 shrink-0" />
                      </div>
                    </div>

                    <div className="px-3 py-2.5 space-y-0.5">
                      <div className="text-xs font-semibold text-[#0F141F] dark:text-[#F3F6FA] truncate">
                        {item.filename}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                        {item.width > 0 ? `${item.width}×${item.height}` : 'Loading'} ·{' '}
                        {item.format}
                        {item.sizeBytes > 0 ? ` · ${formatBytesCompact(item.sizeBytes)}` : ''}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : layoutMode === 'masonry' ? (
            /* MASONRY WATERFALL VIEW */
            <div
              data-testid="folder-gallery-masonry"
              className={`gap-4 space-y-4 ${getMasonryColumnClasses(gridZoom)}`}
            >
              {visibleItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const aspectRatio =
                  item.width > 0 && item.height > 0 ? `${item.width} / ${item.height}` : '4 / 3';
                return (
                  <article
                    key={item.id}
                    className={`break-inside-avoid group bg-white dark:bg-[#0E121B] border rounded-xl overflow-hidden transition-colors ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-600/25'
                        : 'border-[#DCE1EB] dark:border-white/[0.08]'
                    }`}
                  >
                    <div
                      className="relative bg-[#EEF1F6] dark:bg-[#090C12] overflow-hidden"
                      style={{ aspectRatio }}
                    >
                      <button
                        type="button"
                        onClick={() => setLightboxItemId(item.id)}
                        aria-label={`Open ${item.filename} in viewer`}
                        className="w-full h-full block cursor-zoom-in"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.previewUrl}
                          alt={item.filename}
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleStar(item.id)}
                        aria-label={`Star ${item.filename}`}
                        aria-pressed={item.starred}
                        className={`absolute top-2.5 right-2.5 w-7 h-7 rounded-lg flex items-center justify-center backdrop-blur-xs transition-opacity cursor-pointer ${
                          item.starred
                            ? 'bg-amber-500/85 text-white opacity-100'
                            : 'bg-black/45 text-white/80 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${item.starred ? 'fill-white' : ''}`}
                        />
                      </button>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0F141F] dark:text-[#F3F6FA] truncate">
                        {item.filename}
                      </span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                        {item.width > 0 ? `${item.width}×${item.height}` : item.format}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            /* LIST DETAILS VIEW */
            <div
              data-testid="folder-gallery-list"
              className="bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl overflow-x-auto"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#DCE1EB] dark:border-white/[0.08] text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3 font-semibold w-10">Sel</th>
                    <th className="py-2.5 px-3 font-semibold">Image</th>
                    <th className="py-2.5 px-3 font-semibold">Folder</th>
                    <th className="py-2.5 px-3 font-semibold">Dimensions</th>
                    <th className="py-2.5 px-3 font-semibold">MP</th>
                    <th className="py-2.5 px-3 font-semibold">Size</th>
                    <th className="py-2.5 px-3 font-semibold">Modified</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE1EB]/70 dark:divide-white/[0.06]">
                  {visibleItems.map((item) => {
                    const isSelected = selectedIds.has(item.id);
                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-[#F4F6F9]/75 dark:hover:bg-white/[0.03] transition-colors"
                      >
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelect(item.id)}
                            aria-label={`Select ${item.filename}`}
                            className="rounded border-slate-300 accent-blue-600 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            onClick={() => setLightboxItemId(item.id)}
                            className="flex items-center gap-2.5 text-left group cursor-pointer"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.previewUrl}
                              alt={item.filename}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-cover shrink-0 bg-[#EEF1F6] dark:bg-[#090C12]"
                            />
                            <span className="font-semibold text-[#0F141F] dark:text-[#F3F6FA] group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate max-w-[220px]">
                              {item.filename}
                            </span>
                          </button>
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                          {item.subfolder}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {item.width > 0 ? `${item.width}×${item.height}` : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {formatMegapixels(item.width, item.height)}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {item.sizeBytes > 0 ? formatBytesCompact(item.sizeBytes) : '—'}
                        </td>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatGalleryDate(item.lastModified)}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleToggleStar(item.id)}
                              aria-label={`Star ${item.filename}`}
                              className={`p-1.5 rounded-lg cursor-pointer ${
                                item.starred
                                  ? 'text-amber-500'
                                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                              }`}
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${item.starred ? 'fill-amber-400' : ''}`}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => setLightboxItemId(item.id)}
                              aria-label={`View ${item.filename}`}
                              className="px-2.5 py-1 rounded-lg bg-[#F4F6F9] dark:bg-white/[0.06] text-xs font-semibold text-[#0F141F] dark:text-slate-200 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
                            >
                              Open
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Fullscreen Lightbox Modal with Zoom, Pan, Rotate, Slideshow & Inspector */}
      <FolderLightboxModal
        item={activeLightboxItem}
        items={visibleItems}
        onClose={() => setLightboxItemId(null)}
        onSelectItem={(next) => setLightboxItemId(next.id)}
        onToggleStar={handleToggleStar}
        onRotateItem={handleRotateItem}
      />
    </section>
  );
};
