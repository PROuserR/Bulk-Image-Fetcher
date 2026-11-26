/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure TypeScript sorting, filtering, subfolder grouping, zoom stepping, and formatting
 * logic for the local Folder Gallery viewer. Zero DOM dependencies so all logic runs
 * cleanly under `tsx --test` / `node:test`.
 */

import {
  buildProxyImageUrl,
  getFullResReusablePreviewUrl,
  getOrCreateCachedBlobUrl,
  isSameOriginOrLocalImageUrl,
} from './clientImageCache';

export type GallerySortField =
  | 'name'
  | 'date'
  | 'size'
  | 'resolution'
  | 'aspect'
  | 'folder';

export type GallerySortDirection = 'asc' | 'desc';

export type GalleryLayoutMode = 'grid' | 'masonry' | 'list';

export type GalleryOrientationFilter = 'all' | 'landscape' | 'portrait' | 'square';

export interface FolderGalleryItem {
  id: string;
  filename: string;
  relativePath: string;
  subfolder: string; // 'Root' or 'Sub/Path'
  previewUrl: string;
  objectUrlToRevoke?: string;
  width: number;
  height: number;
  sizeBytes: number;
  lastModified: number;
  format: string;
  starred: boolean;
  rotationDeg: number; // 0 | 90 | 180 | 270
}

export interface FolderGalleryFilterOptions {
  query: string;
  subfolder: string; // 'all' or specific subfolder
  orientation: GalleryOrientationFilter;
  favoritesOnly: boolean;
}

export interface SubfolderSummary {
  name: string;
  count: number;
}

const SUPPORTED_IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif|bmp|svg|ico|tiff?)$/i;

export const ZOOM_LEVEL_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6] as const;

export function isSupportedGalleryImageFile(file: { name: string; type?: string }): boolean {
  if (file.type && file.type.toLowerCase().startsWith('image/')) {
    return true;
  }
  return SUPPORTED_IMAGE_EXT_RE.test(file.name || '');
}

export function extractImageFormat(filename: string, mimeType?: string): string {
  const match = (filename || '').match(/\.([a-zA-Z0-9]+)$/);
  if (match) {
    const ext = match[1].toUpperCase();
    return ext === 'JPEG' ? 'JPG' : ext;
  }
  if (mimeType && mimeType.startsWith('image/')) {
    const sub = mimeType.slice(6).split('+')[0].toUpperCase();
    return sub === 'JPEG' ? 'JPG' : sub;
  }
  return 'IMG';
}

export function extractSubfolderPath(relativePath: string): string {
  const normalized = (relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return 'Root';
  // If picked via webkitdirectory, parts[0] is the picked folder root name; keep nested subfolder if >=3 parts, or root folder name if 2 parts
  if (parts.length === 2) return 'Root';
  return parts.slice(1, -1).join('/');
}

export function summarizeSubfolders(items: Pick<FolderGalleryItem, 'subfolder'>[]): SubfolderSummary[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.subfolder || 'Root';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => {
      if (a === 'Root') return -1;
      if (b === 'Root') return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    })
    .map(([name, count]) => ({ name, count }));
}

export function classifyItemOrientation(
  width: number,
  height: number
): Exclude<GalleryOrientationFilter, 'all'> {
  if (!width || !height) return 'square';
  const ratio = width / height;
  if (ratio > 1.08) return 'landscape';
  if (ratio < 0.92) return 'portrait';
  return 'square';
}

export function filterFolderGalleryItems(
  items: FolderGalleryItem[],
  options: FolderGalleryFilterOptions
): FolderGalleryItem[] {
  const q = options.query.trim().toLowerCase();
  return items.filter((item) => {
    if (options.favoritesOnly && !item.starred) return false;
    if (options.subfolder !== 'all' && item.subfolder !== options.subfolder) return false;
    if (options.orientation !== 'all') {
      if (classifyItemOrientation(item.width, item.height) !== options.orientation) {
        return false;
      }
    }
    if (q) {
      const hay = `${item.filename} ${item.relativePath} ${item.subfolder} ${item.format}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortFolderGalleryItems(
  items: FolderGalleryItem[],
  field: GallerySortField,
  direction: GallerySortDirection
): FolderGalleryItem[] {
  const mult = direction === 'asc' ? 1 : -1;
  const copy = [...items];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (field) {
      case 'date': {
        cmp = a.lastModified - b.lastModified;
        break;
      }
      case 'size': {
        cmp = a.sizeBytes - b.sizeBytes;
        break;
      }
      case 'resolution': {
        cmp = a.width * a.height - b.width * b.height;
        break;
      }
      case 'aspect': {
        const ra = a.height > 0 ? a.width / a.height : 1;
        const rb = b.height > 0 ? b.width / b.height : 1;
        cmp = ra - rb;
        break;
      }
      case 'folder': {
        cmp = a.subfolder.localeCompare(b.subfolder, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        break;
      }
      case 'name':
      default: {
        cmp = a.filename.localeCompare(b.filename, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        break;
      }
    }

    if (cmp !== 0) return cmp * mult;
    // Stable deterministic tie-breaker by natural filename
    return (
      a.filename.localeCompare(b.filename, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) * mult
    );
  });
  return copy;
}

export function clampLightboxZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(0.25, Math.min(6, Math.round(zoom * 100) / 100));
}

export function computeSteppedZoom(currentZoom: number, direction: 'in' | 'out'): number {
  const safe = clampLightboxZoom(currentZoom);
  if (direction === 'in') {
    for (const step of ZOOM_LEVEL_STEPS) {
      if (step > safe + 0.01) return step;
    }
    return 6;
  } else {
    for (let i = ZOOM_LEVEL_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_LEVEL_STEPS[i] < safe - 0.01) return ZOOM_LEVEL_STEPS[i];
    }
    return 0.25;
  }
}

export function clampPanOffset(
  panX: number,
  panY: number,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  if (zoom <= 1.01) return { x: 0, y: 0 };
  const maxX = Math.max(80, Math.round((viewportWidth * (zoom - 1)) / 2 + 120));
  const maxY = Math.max(80, Math.round((viewportHeight * (zoom - 1)) / 2 + 120));
  return {
    x: Math.max(-maxX, Math.min(maxX, panX)),
    y: Math.max(-maxY, Math.min(maxY, panY)),
  };
}

export function formatMegapixels(width: number, height: number): string {
  if (!width || !height) return '—';
  const mp = (width * height) / 1_000_000;
  if (mp < 0.1) return `${Math.round((width * height) / 1000)} KP`;
  return `${mp.toFixed(mp >= 10 ? 1 : 2)} MP`;
}

export function formatGalleryDate(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '—';
  const d = new Date(timestampMs);
  if (Number.isNaN(d.getTime())) return '—';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getGridColumnClasses(gridZoomLevel: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(gridZoomLevel)));
  switch (clamped) {
    case 1:
      // Extra-large cinema cards
      return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-2';
    case 2:
      // Large gallery cards
      return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
    case 3:
      // Standard modern gallery grid
      return 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
    case 4:
      // Compact dense grid
      return 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
    case 5:
    default:
      // Contact-sheet overview
      return 'grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7';
  }
}

export function getMasonryColumnClasses(gridZoomLevel: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(gridZoomLevel)));
  switch (clamped) {
    case 1:
      return 'columns-1 sm:columns-2';
    case 2:
      return 'columns-1 sm:columns-2 lg:columns-3';
    case 3:
      return 'columns-2 sm:columns-3 lg:columns-4';
    case 4:
      return 'columns-2 sm:columns-4 lg:columns-5';
    case 5:
    default:
      return 'columns-3 sm:columns-5 lg:columns-6';
  }
}

export function resolveSeededPreviewUrl(url: string, referer?: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (/^(blob:|data:|\/)/i.test(trimmed)) {
    return trimmed;
  }
  const cachedBlobUrl = getOrCreateCachedBlobUrl(trimmed);
  if (cachedBlobUrl) {
    return cachedBlobUrl;
  }
  const reusablePreview = getFullResReusablePreviewUrl(trimmed);
  if (reusablePreview && isSameOriginOrLocalImageUrl(reusablePreview)) {
    return reusablePreview;
  }
  return buildProxyImageUrl(trimmed, referer || '');
}

