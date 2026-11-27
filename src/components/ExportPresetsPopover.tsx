'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkCheck,
  Check,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { ArchiveFormat } from '../utils/downloader';
import type { OutputFormat, ResizeFit, ResizeMode } from '../utils/imageTransformLogic';
import {
  BATCH_EXPORT_PRESETS_EVENT,
  BatchExportPreset,
  BatchExportPresetsEventDetail,
  NAMING_TEMPLATE_TOKENS,
  deleteBatchExportPreset,
  formatPresetSummary,
  getActiveExportPreset,
  loadBatchExportPresets,
  previewPresetFilename,
  setActiveExportPresetId,
  upsertBatchExportPreset,
} from '../utils/batchExportPresets';

interface ExportPresetsPopoverProps {
  onNotify?: (msg: string) => void;
}

interface PresetDraft {
  id?: string;
  name: string;
  outputFormat: OutputFormat;
  quality: number;
  archiveFormat: ArchiveFormat;
  resizeMode: ResizeMode;
  width: number;
  height: number;
  maxEdge: number;
  percent: number;
  lockAspect: boolean;
  fit: ResizeFit;
  namingTemplate: string;
  preserveSubfolders: boolean;
}

function emptyDraft(preset?: BatchExportPreset | null): PresetDraft {
  if (!preset) {
    return {
      name: '',
      outputFormat: 'webp',
      quality: 88,
      archiveFormat: 'zip',
      resizeMode: 'maxEdge',
      width: 1920,
      height: 1080,
      maxEdge: 1600,
      percent: 100,
      lockAspect: true,
      fit: 'cover',
      namingTemplate: '{index3}_{name}_{w}x{h}',
      preserveSubfolders: true,
    };
  }
  return {
    id: preset.isBuiltIn ? undefined : preset.id,
    name: preset.isBuiltIn ? `${preset.name} (Custom)` : preset.name,
    outputFormat: preset.outputFormat,
    quality: preset.quality,
    archiveFormat: preset.archiveFormat,
    resizeMode: preset.resize.mode,
    width: preset.resize.width,
    height: preset.resize.height,
    maxEdge: preset.resize.maxEdge,
    percent: preset.resize.percent,
    lockAspect: preset.resize.lockAspect,
    fit: preset.resize.fit,
    namingTemplate: preset.namingTemplate,
    preserveSubfolders: preset.preserveSubfolders,
  };
}

export const ExportPresetsPopover: React.FC<ExportPresetsPopoverProps> = ({
  onNotify,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [presets, setPresets] = useState<BatchExportPreset[]>(() =>
    loadBatchExportPresets()
  );
  const [activePreset, setActivePreset] = useState<BatchExportPreset | null>(() =>
    getActiveExportPreset()
  );
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<PresetDraft>(() => emptyDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<BatchExportPresetsEventDetail>).detail;
      if (detail) {
        setPresets(detail.presets);
        setActivePreset(detail.activePreset);
      }
    };
    window.addEventListener(BATCH_EXPORT_PRESETS_EVENT, onChanged);
    return () => window.removeEventListener(BATCH_EXPORT_PRESETS_EVENT, onChanged);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [isOpen]);

  const draftPreview = useMemo(() => {
    return previewPresetFilename(
      {
        outputFormat: draft.outputFormat,
        quality: draft.quality,
        namingTemplate: draft.namingTemplate || '{name}',
        preserveSubfolders: draft.preserveSubfolders,
        resize: {
          mode: draft.resizeMode,
          width: draft.width,
          height: draft.height,
          maxEdge: draft.maxEdge,
          percent: draft.percent,
          lockAspect: draft.lockAspect,
          fit: draft.fit,
        },
      },
      'shoot/DSC_0412.JPG'
    );
  }, [draft]);

  const handleApplyPreset = (preset: BatchExportPreset) => {
    const isSame = activePreset?.id === preset.id;
    const next = setActiveExportPresetId(isSame ? null : preset.id);
    setActivePreset(next);
    onNotify?.(
      next
        ? `Export preset "${next.name}" applied across studios.`
        : 'Cleared active batch export preset.'
    );
  };

  const handleStartNew = () => {
    setFormError(null);
    setDraft(emptyDraft());
    setIsEditing(true);
  };

  const handleEditPreset = (preset: BatchExportPreset) => {
    setFormError(null);
    setDraft(emptyDraft(preset));
    setIsEditing(true);
  };

  const handleSaveDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = draft.name.trim();
    if (!cleanName) {
      setFormError('Enter a preset name before saving.');
      return;
    }
    const cleanTemplate = draft.namingTemplate.trim();
    if (!cleanTemplate) {
      setFormError('Enter a naming template (for example: {index3}_{name}).');
      return;
    }

    const { saved } = upsertBatchExportPreset(
      {
        id: draft.id,
        name: cleanName,
        outputFormat: draft.outputFormat,
        quality: draft.quality,
        archiveFormat: draft.archiveFormat,
        resize: {
          mode: draft.resizeMode,
          width: draft.width,
          height: draft.height,
          maxEdge: draft.maxEdge,
          percent: draft.percent,
          lockAspect: draft.lockAspect,
          fit: draft.fit,
        },
        namingTemplate: cleanTemplate,
        preserveSubfolders: draft.preserveSubfolders,
      },
      true
    );

    setIsEditing(false);
    setFormError(null);
    onNotify?.(`Saved & applied export preset "${saved.name}".`);
  };

  const handleDelete = (preset: BatchExportPreset) => {
    deleteBatchExportPreset(preset.id);
    onNotify?.(`Removed export preset "${preset.name}".`);
  };

  const appendToken = (token: string) => {
    setDraft((prev) => ({
      ...prev,
      namingTemplate: prev.namingTemplate
        ? `${prev.namingTemplate}${prev.namingTemplate.endsWith('_') || prev.namingTemplate.endsWith('-') ? '' : '_'}${token}`
        : token,
    }));
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label={
          activePreset
            ? `Export Presets (${activePreset.name})`
            : 'Export Presets'
        }
        className={`w-8 sm:w-auto h-8 sm:h-9 sm:px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          isOpen || activePreset
            ? 'border-blue-600/40 bg-blue-600/10 text-blue-700 dark:text-blue-300'
            : 'border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#131823] text-slate-700 dark:text-slate-200 hover:bg-[#E7EBF2] dark:hover:bg-white/[0.08]'
        }`}
      >
        <BookmarkCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden lg:inline max-w-[140px] truncate">
          {activePreset ? activePreset.name : 'Export Presets'}
        </span>
        <span className="hidden sm:inline lg:hidden">Presets</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Batch Export Presets"
          className="fixed sm:absolute right-3 sm:right-0 left-3 sm:left-auto top-14 sm:top-11 z-50 sm:w-[460px] max-h-[84vh] overflow-y-auto bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.12] rounded-2xl shadow-2xl p-4 space-y-4 animate-fadeIn"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DCE1EB] dark:border-white/[0.08]">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="font-display text-sm font-bold text-[#0F141F] dark:text-white">
                Batch Export Presets
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {!isEditing && (
                <button
                  type="button"
                  onClick={handleStartNew}
                  className="h-7 px-2.5 rounded-lg bg-[#0F141F] dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>New Preset</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close Batch Export Presets"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#0F141F] dark:hover:text-white hover:bg-[#F4F6F9] dark:hover:bg-white/[0.06] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {isEditing ? (
            <form onSubmit={handleSaveDraft} className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="export-preset-name"
                  className="block font-semibold text-[#0F141F] dark:text-slate-200 mb-1"
                >
                  Preset Name
                </label>
                <input
                  id="export-preset-name"
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Client Proof WebP 2K"
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {/* Format + Archive + Quality */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label
                    htmlFor="export-preset-format"
                    className="block font-semibold text-[#0F141F] dark:text-slate-200 mb-1"
                  >
                    Image Format
                  </label>
                  <select
                    id="export-preset-format"
                    value={draft.outputFormat}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        outputFormat: e.target.value as OutputFormat,
                      }))
                    }
                    className="w-full h-8 px-2 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="keep">Keep Original</option>
                    <option value="webp">WebP</option>
                    <option value="jpeg">JPEG</option>
                    <option value="png">PNG (Lossless)</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="export-preset-archive"
                    className="block font-semibold text-[#0F141F] dark:text-slate-200 mb-1"
                  >
                    Archive Container
                  </label>
                  <select
                    id="export-preset-archive"
                    value={draft.archiveFormat}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        archiveFormat: e.target.value as ArchiveFormat,
                      }))
                    }
                    className="w-full h-8 px-2 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="7z">.7z (LZMA2)</option>
                    <option value="zip">.zip (Standard)</option>
                  </select>
                </div>
              </div>

              {draft.outputFormat !== 'png' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-[#0F141F] dark:text-slate-200">
                      Encoding Quality
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {draft.quality}%
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Preset encoding quality"
                    min={50}
                    max={100}
                    value={draft.quality}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, quality: Number(e.target.value) }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              )}

              {/* Resize Dimensions */}
              <div className="space-y-2 p-2.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08]">
                <div className="font-semibold text-[#0F141F] dark:text-slate-200">
                  Resize Dimensions
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(
                    [
                      { id: 'original', label: 'Original' },
                      { id: 'maxEdge', label: 'Max Edge' },
                      { id: 'exact', label: 'Exact W×H' },
                      { id: 'percent', label: 'Scale %' },
                    ] as { id: ResizeMode; label: string }[]
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setDraft((p) => ({ ...p, resizeMode: m.id }))}
                      className={`py-1 px-1.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                        draft.resizeMode === m.id
                          ? 'bg-white dark:bg-[#1A202E] text-[#0F141F] dark:text-white shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-white'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {draft.resizeMode === 'maxEdge' && (
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="export-preset-max-edge"
                      className="text-[11px] text-slate-600 dark:text-slate-400"
                    >
                      Longest Side (px)
                    </label>
                    <input
                      id="export-preset-max-edge"
                      type="number"
                      min={32}
                      max={12000}
                      value={draft.maxEdge}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          maxEdge: Math.max(32, Number(e.target.value) || 32),
                        }))
                      }
                      className="w-24 h-7 px-2 rounded-lg bg-white dark:bg-[#131823] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-right text-[#0F141F] dark:text-white"
                    />
                  </div>
                )}

                {draft.resizeMode === 'exact' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor="export-preset-width"
                          className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5"
                        >
                          Width (px)
                        </label>
                        <input
                          id="export-preset-width"
                          type="number"
                          min={1}
                          max={12000}
                          value={draft.width}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              width: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                          className="w-full h-7 px-2 rounded-lg bg-white dark:bg-[#131823] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[#0F141F] dark:text-white"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="export-preset-height"
                          className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5"
                        >
                          Height (px)
                        </label>
                        <input
                          id="export-preset-height"
                          type="number"
                          min={1}
                          max={12000}
                          value={draft.height}
                          onChange={(e) =>
                            setDraft((p) => ({
                              ...p,
                              height: Math.max(1, Number(e.target.value) || 1),
                            }))
                          }
                          className="w-full h-7 px-2 rounded-lg bg-white dark:bg-[#131823] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[#0F141F] dark:text-white"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={draft.lockAspect}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, lockAspect: e.target.checked }))
                          }
                          className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                        />
                        <span>Lock aspect ratio</span>
                      </label>
                      {!draft.lockAspect && (
                        <select
                          aria-label="Exact resize fit mode"
                          value={draft.fit}
                          onChange={(e) =>
                            setDraft((p) => ({ ...p, fit: e.target.value as ResizeFit }))
                          }
                          className="h-6 px-1.5 rounded bg-white dark:bg-[#131823] border border-[#DCE1EB] dark:border-white/[0.1] text-[#0F141F] dark:text-white"
                        >
                          <option value="cover">Cover</option>
                          <option value="contain">Contain</option>
                          <option value="fill">Stretch</option>
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {draft.resizeMode === 'percent' && (
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="export-preset-percent"
                      className="text-[11px] text-slate-600 dark:text-slate-400"
                    >
                      Scale Percentage
                    </label>
                    <input
                      id="export-preset-percent"
                      type="number"
                      min={10}
                      max={400}
                      value={draft.percent}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          percent: Math.max(10, Math.min(400, Number(e.target.value) || 100)),
                        }))
                      }
                      className="w-24 h-7 px-2 rounded-lg bg-white dark:bg-[#131823] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-right text-[#0F141F] dark:text-white"
                    />
                  </div>
                )}
              </div>

              {/* Naming Template */}
              <div className="space-y-1.5">
                <label
                  htmlFor="export-preset-naming"
                  className="block font-semibold text-[#0F141F] dark:text-slate-200"
                >
                  Naming Template
                </label>
                <input
                  id="export-preset-naming"
                  type="text"
                  value={draft.namingTemplate}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, namingTemplate: e.target.value }))
                  }
                  placeholder="{index3}_{name}_{w}x{h}"
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <div className="flex flex-wrap gap-1">
                  {NAMING_TEMPLATE_TOKENS.map((t) => (
                    <button
                      key={t.token}
                      type="button"
                      title={t.description}
                      onClick={() => appendToken(t.token)}
                      className="px-1.5 py-0.5 rounded border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-blue-500/40 font-mono text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer"
                    >
                      +{t.label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  Preview: <span className="text-blue-600 dark:text-blue-400">{draftPreview}</span>
                </div>

                <label className="flex items-center gap-2 pt-0.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.preserveSubfolders}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, preserveSubfolders: e.target.checked }))
                    }
                    className="rounded border-slate-300 dark:border-slate-700 text-blue-600"
                  />
                  <span>Preserve folder hierarchy inside exports</span>
                </label>
              </div>

              {formError && (
                <div className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setFormError(null);
                  }}
                  className="h-8 px-3 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-slate-600 dark:text-slate-300 font-semibold hover:bg-[#F4F6F9] dark:hover:bg-white/[0.06] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-8 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                >
                  Save &amp; Apply Preset
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-2.5">
              {presets.map((preset) => {
                const isActive = activePreset?.id === preset.id;
                const sampleOut = previewPresetFilename(preset);
                return (
                  <div
                    key={preset.id}
                    className={`p-3 rounded-xl border transition-colors ${
                      isActive
                        ? 'border-blue-500/50 bg-blue-600/[0.06]'
                        : 'border-[#DCE1EB] dark:border-white/[0.08] bg-[#F4F6F9]/70 dark:bg-[#0B0D13]/70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-display text-xs font-bold text-[#0F141F] dark:text-white truncate">
                            {preset.name}
                          </span>
                          {isActive && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-semibold shrink-0">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 mt-0.5">
                          {formatPresetSummary(preset)}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-500 mt-0.5 truncate">
                          {sampleOut}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApplyPreset(preset)}
                          className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'bg-white dark:bg-[#171C28] border border-[#DCE1EB] dark:border-white/[0.1] text-[#0F141F] dark:text-slate-200 hover:border-blue-500/40'
                          }`}
                        >
                          {isActive && <Check className="w-3 h-3" />}
                          <span>{isActive ? 'Applied' : 'Apply'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditPreset(preset)}
                          aria-label={`Edit preset ${preset.name}`}
                          className="w-7 h-7 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-white dark:bg-[#171C28] flex items-center justify-center text-slate-500 hover:text-[#0F141F] dark:hover:text-white cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        {presets.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDelete(preset)}
                            aria-label={`Delete preset ${preset.name}`}
                            className="w-7 h-7 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-white dark:bg-[#171C28] flex items-center justify-center text-slate-500 hover:text-red-500 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                Active presets automatically sync format, resize dimensions, archive container, and naming templates across studios.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
