/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ArchiveFormat } from './downloader';
import {
  computeTargetDimensions,
  resolveOutputExtension,
  buildOutputFilename,
  type OutputConfig,
  type OutputFormat,
  type ResizeConfig,
} from './imageTransformLogic';

export interface BatchExportPreset {
  id: string;
  name: string;
  outputFormat: OutputFormat;
  quality: number;
  archiveFormat: ArchiveFormat;
  resize: ResizeConfig;
  namingTemplate: string;
  preserveSubfolders: boolean;
  isBuiltIn?: boolean;
  updatedAt: number;
}

export interface BatchExportPresetsEventDetail {
  presets: BatchExportPreset[];
  activePreset: BatchExportPreset | null;
}

export const BATCH_EXPORT_PRESETS_STORAGE_KEY = 'fv_batch_export_presets_v1';
export const ACTIVE_EXPORT_PRESET_STORAGE_KEY = 'fv_active_export_preset_id_v1';
export const BATCH_EXPORT_PRESETS_EVENT = 'fv:batch-export-presets-changed';

export const NAMING_TEMPLATE_TOKENS: Array<{
  token: string;
  label: string;
  description: string;
}> = [
  { token: '{name}', label: '{name}', description: 'Original base filename' },
  { token: '{index3}', label: '{index3}', description: 'Zero-padded sequence (001)' },
  { token: '{index}', label: '{index}', description: 'Sequence number (1)' },
  { token: '{w}', label: '{w}', description: 'Output width in px' },
  { token: '{h}', label: '{h}', description: 'Output height in px' },
  { token: '{date}', label: '{date}', description: 'YYYY-MM-DD export date' },
  { token: '{format}', label: '{format}', description: 'Target file extension' },
];

export const DEFAULT_EXPORT_PRESETS: BatchExportPreset[] = [
  {
    id: 'preset-archival-original',
    name: 'Archival Original (.7z)',
    outputFormat: 'keep',
    quality: 95,
    archiveFormat: '7z',
    resize: {
      mode: 'original',
      width: 1920,
      height: 1080,
      maxEdge: 1600,
      percent: 100,
      lockAspect: true,
      fit: 'cover',
    },
    namingTemplate: '{name}',
    preserveSubfolders: true,
    isBuiltIn: true,
    updatedAt: 1,
  },
  {
    id: 'preset-web-webp-1600',
    name: 'Web Gallery WebP 1600px',
    outputFormat: 'webp',
    quality: 86,
    archiveFormat: 'zip',
    resize: {
      mode: 'maxEdge',
      width: 1600,
      height: 1600,
      maxEdge: 1600,
      percent: 100,
      lockAspect: true,
      fit: 'contain',
    },
    namingTemplate: '{index3}_{name}_{w}x{h}',
    preserveSubfolders: false,
    isBuiltIn: true,
    updatedAt: 2,
  },
  {
    id: 'preset-social-square-1080',
    name: 'Social Square 1080×1080',
    outputFormat: 'jpeg',
    quality: 90,
    archiveFormat: 'zip',
    resize: {
      mode: 'exact',
      width: 1080,
      height: 1080,
      maxEdge: 1080,
      percent: 100,
      lockAspect: false,
      fit: 'cover',
    },
    namingTemplate: '{index3}_{name}_sq',
    preserveSubfolders: false,
    isBuiltIn: true,
    updatedAt: 3,
  },
];

export function sanitizeBatchExportPreset(
  raw: Partial<BatchExportPreset>,
  fallbackId?: string
): BatchExportPreset {
  const name = (raw.name || '').trim().slice(0, 64) || 'Untitled Preset';
  const outputFormat: OutputFormat =
    raw.outputFormat === 'jpeg' ||
    raw.outputFormat === 'png' ||
    raw.outputFormat === 'webp' ||
    raw.outputFormat === 'keep'
      ? raw.outputFormat
      : 'keep';
  const quality = Math.max(50, Math.min(100, Math.round(Number(raw.quality) || 90)));
  const archiveFormat: ArchiveFormat = raw.archiveFormat === 'zip' ? 'zip' : '7z';
  const r = raw.resize || ({} as Partial<ResizeConfig>);
  const mode =
    r.mode === 'exact' || r.mode === 'maxEdge' || r.mode === 'percent' || r.mode === 'original'
      ? r.mode
      : 'original';

  const resize: ResizeConfig = {
    mode,
    width: Math.max(1, Math.min(12000, Math.round(Number(r.width) || 1920))),
    height: Math.max(1, Math.min(12000, Math.round(Number(r.height) || 1080))),
    maxEdge: Math.max(32, Math.min(12000, Math.round(Number(r.maxEdge) || 1600))),
    percent: Math.max(10, Math.min(400, Math.round(Number(r.percent) || 100))),
    lockAspect: typeof r.lockAspect === 'boolean' ? r.lockAspect : true,
    fit: r.fit === 'contain' || r.fit === 'fill' || r.fit === 'cover' ? r.fit : 'cover',
  };

  const namingTemplate =
    (raw.namingTemplate ?? '{name}').trim().slice(0, 120) || '{name}';

  return {
    id:
      (raw.id || '').trim() ||
      fallbackId ||
      `preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    outputFormat,
    quality,
    archiveFormat,
    resize,
    namingTemplate,
    preserveSubfolders:
      typeof raw.preserveSubfolders === 'boolean' ? raw.preserveSubfolders : true,
    isBuiltIn: Boolean(raw.isBuiltIn),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function dispatchPresetsChanged(
  presets: BatchExportPreset[],
  activePreset: BatchExportPreset | null
): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent<BatchExportPresetsEventDetail>(BATCH_EXPORT_PRESETS_EVENT, {
        detail: { presets, activePreset },
      })
    );
  }
}

export function loadBatchExportPresets(): BatchExportPreset[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_EXPORT_PRESETS.map((p) => ({ ...p, resize: { ...p.resize } }));
  }
  try {
    const raw = window.localStorage.getItem(BATCH_EXPORT_PRESETS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_EXPORT_PRESETS.map((p) => ({ ...p, resize: { ...p.resize } }));
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return DEFAULT_EXPORT_PRESETS.map((p) => ({ ...p, resize: { ...p.resize } }));
    }
    return parsed.map((item, idx) =>
      sanitizeBatchExportPreset(item, `preset-restored-${idx + 1}`)
    );
  } catch {
    return DEFAULT_EXPORT_PRESETS.map((p) => ({ ...p, resize: { ...p.resize } }));
  }
}

export function loadActiveExportPresetId(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_EXPORT_PRESET_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function getActiveExportPreset(): BatchExportPreset | null {
  const activeId = loadActiveExportPresetId();
  if (!activeId) return null;
  const presets = loadBatchExportPresets();
  return presets.find((p) => p.id === activeId) || null;
}

export function saveBatchExportPresets(presets: BatchExportPreset[]): BatchExportPreset[] {
  const sanitized = presets.map((p, idx) =>
    sanitizeBatchExportPreset(p, `preset-${idx + 1}`)
  );
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(BATCH_EXPORT_PRESETS_STORAGE_KEY, JSON.stringify(sanitized));
    } catch {
      // ignore storage quota errors
    }
  }
  const activeId = loadActiveExportPresetId();
  const activePreset = activeId ? sanitized.find((p) => p.id === activeId) || null : null;
  dispatchPresetsChanged(sanitized, activePreset);
  return sanitized;
}

export function setActiveExportPresetId(id: string | null): BatchExportPreset | null {
  const presets = loadBatchExportPresets();
  const matched = id ? presets.find((p) => p.id === id) || null : null;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (matched) {
        window.localStorage.setItem(ACTIVE_EXPORT_PRESET_STORAGE_KEY, matched.id);
      } else {
        window.localStorage.removeItem(ACTIVE_EXPORT_PRESET_STORAGE_KEY);
      }
    } catch {
      // ignore storage restrictions
    }
  }
  dispatchPresetsChanged(presets, matched);
  return matched;
}

export function upsertBatchExportPreset(
  draft: Omit<BatchExportPreset, 'id' | 'updatedAt'> & { id?: string },
  activate = true
): { presets: BatchExportPreset[]; saved: BatchExportPreset } {
  const existing = loadBatchExportPresets();
  const saved = sanitizeBatchExportPreset({
    ...draft,
    isBuiltIn: false,
    updatedAt: Date.now(),
  });
  const idx = existing.findIndex((p) => p.id === saved.id);
  const next =
    idx >= 0
      ? existing.map((p, i) => (i === idx ? saved : p))
      : [saved, ...existing];

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(BATCH_EXPORT_PRESETS_STORAGE_KEY, JSON.stringify(next));
      if (activate) {
        window.localStorage.setItem(ACTIVE_EXPORT_PRESET_STORAGE_KEY, saved.id);
      }
    } catch {
      // ignore quota errors
    }
  }
  const activeId = activate ? saved.id : loadActiveExportPresetId();
  const activePreset = activeId ? next.find((p) => p.id === activeId) || null : null;
  dispatchPresetsChanged(next, activePreset);
  return { presets: next, saved };
}

export function deleteBatchExportPreset(id: string): {
  presets: BatchExportPreset[];
  activePreset: BatchExportPreset | null;
} {
  const existing = loadBatchExportPresets();
  const filtered = existing.filter((p) => p.id !== id);
  const finalPresets =
    filtered.length > 0
      ? filtered
      : DEFAULT_EXPORT_PRESETS.map((p) => ({ ...p, resize: { ...p.resize } }));

  const currentActiveId = loadActiveExportPresetId();
  const nextActiveId =
    currentActiveId && finalPresets.some((p) => p.id === currentActiveId)
      ? currentActiveId
      : null;

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(
        BATCH_EXPORT_PRESETS_STORAGE_KEY,
        JSON.stringify(finalPresets)
      );
      if (nextActiveId) {
        window.localStorage.setItem(ACTIVE_EXPORT_PRESET_STORAGE_KEY, nextActiveId);
      } else {
        window.localStorage.removeItem(ACTIVE_EXPORT_PRESET_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
  const activePreset = nextActiveId
    ? finalPresets.find((p) => p.id === nextActiveId) || null
    : null;
  dispatchPresetsChanged(finalPresets, activePreset);
  return { presets: finalPresets, activePreset };
}

export function exportPresetToOutputConfig(preset: BatchExportPreset): OutputConfig {
  return {
    format: preset.outputFormat,
    quality: preset.quality,
    suffix: '',
    namingTemplate: preset.namingTemplate,
    preserveSubfolders: preset.preserveSubfolders,
  };
}

export function formatPresetResizeLabel(resize: ResizeConfig): string {
  if (resize.mode === 'original') return 'Original px';
  if (resize.mode === 'maxEdge') return `Max ${resize.maxEdge}px`;
  if (resize.mode === 'percent') return `${resize.percent}% scale`;
  if (resize.lockAspect) return `${resize.width}w (locked)`;
  return `${resize.width}×${resize.height} ${resize.fit}`;
}

export function formatPresetSummary(preset: BatchExportPreset): string {
  const fmt =
    preset.outputFormat === 'keep'
      ? 'Original fmt'
      : `${preset.outputFormat.toUpperCase()}${
          preset.outputFormat === 'png' ? '' : ` ${preset.quality}%`
        }`;
  const resize = formatPresetResizeLabel(preset.resize);
  const arch = `.${preset.archiveFormat.toUpperCase()}`;
  return `${fmt} · ${resize} · ${arch}`;
}

export function previewPresetFilename(
  preset: Pick<
    BatchExportPreset,
    'outputFormat' | 'quality' | 'namingTemplate' | 'preserveSubfolders' | 'resize'
  >,
  sampleRelativePath = 'shoot/DSC_0412.JPG'
): string {
  const sampleDims = computeTargetDimensions(2400, 1600, preset.resize);
  const { ext } = resolveOutputExtension(sampleRelativePath, preset.outputFormat);
  const resolved = buildOutputFilename(
    sampleRelativePath,
    {
      format: preset.outputFormat,
      quality: preset.quality,
      suffix: '',
      namingTemplate: preset.namingTemplate,
      preserveSubfolders: preset.preserveSubfolders,
    },
    {
      index: 1,
      width: sampleDims.width,
      height: sampleDims.height,
      dateStr: '2026-11-27',
    }
  );
  return resolved || `001_DSC_0412.${ext}`;
}
