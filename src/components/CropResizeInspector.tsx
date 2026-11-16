'use client';

import React from 'react';
import {
  Download,
  FileArchive,
  FolderDown,
  Loader2,
  Lock,
  Unlock,
} from 'lucide-react';
import {
  AspectRatioPreset,
  CropRect,
  OutputConfig,
  OutputFormat,
  ResizeConfig,
  ResizeFit,
  ResizeMode,
} from '../utils/imageTransformLogic';

export const ASPECT_PRESETS: { id: AspectRatioPreset; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: '1:1', label: '1:1' },
  { id: '16:9', label: '16:9' },
  { id: '4:3', label: '4:3' },
  { id: '3:2', label: '3:2' },
  { id: '4:5', label: '4:5' },
  { id: '9:16', label: '9:16' },
];

const DIMENSION_PRESETS = [
  { label: '1920×1080', width: 1920, height: 1080 },
  { label: '1080×1080', width: 1080, height: 1080 },
  { label: '1200×630', width: 1200, height: 630 },
  { label: '800×600', width: 800, height: 600 },
];

interface CropResizeInspectorProps {
  activeItem: {
    width: number;
    height: number;
    cropEnabled: boolean;
    cropRect: CropRect;
  };
  intakeMode: 'browser' | 'disk';
  selectedCount: number;
  aspectPreset: AspectRatioPreset;
  resizeConfig: ResizeConfig;
  outputConfig: OutputConfig;
  previewTargetDimensions: { width: number; height: number };
  diskOutputDir: string;
  diskOverwrite: boolean;
  isProcessing: boolean;
  progressText: string | null;
  canDirectSaveToFolder: boolean;
  onToggleCropEnabled: (enabled: boolean) => void;
  onSelectAspectPreset: (preset: AspectRatioPreset) => void;
  onUpdateCropNumeric: (field: keyof CropRect, value: number) => void;
  onChangeResizeConfig: React.Dispatch<React.SetStateAction<ResizeConfig>>;
  onChangeOutputConfig: React.Dispatch<React.SetStateAction<OutputConfig>>;
  onChangeDiskOutputDir: (val: string) => void;
  onChangeDiskOverwrite: (val: boolean) => void;
  onProcessToDiskDirectory: () => void;
  onBatchExportZip: () => void;
  onSaveBrowserFolder: () => void;
  onDownloadActiveSingle: () => void;
}

export const CropResizeInspector: React.FC<CropResizeInspectorProps> = ({
  activeItem,
  intakeMode,
  selectedCount,
  aspectPreset,
  resizeConfig,
  outputConfig,
  previewTargetDimensions,
  diskOutputDir,
  diskOverwrite,
  isProcessing,
  progressText,
  canDirectSaveToFolder,
  onToggleCropEnabled,
  onSelectAspectPreset,
  onUpdateCropNumeric,
  onChangeResizeConfig,
  onChangeOutputConfig,
  onChangeDiskOutputDir,
  onChangeDiskOverwrite,
  onProcessToDiskDirectory,
  onBatchExportZip,
  onSaveBrowserFolder,
  onDownloadActiveSingle,
}) => {
  return (
    <aside className="lg:col-span-4 bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 space-y-6">
      {/* Section 1: Crop Framing */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-zinc-950 dark:text-white">
            1. Crop Framing
          </h2>
          <button
            type="button"
            onClick={() => onToggleCropEnabled(!activeItem.cropEnabled)}
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            {activeItem.cropEnabled ? 'Disable' : 'Enable'}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelectAspectPreset(preset.id)}
              className={`py-1.5 px-2 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap cursor-pointer border ${
                aspectPreset === preset.id
                  ? 'bg-zinc-950 text-white border-zinc-950 dark:bg-white dark:text-zinc-950 dark:border-white'
                  : 'bg-zinc-50 dark:bg-[#0B0C10] text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div>
            <label className="block text-zinc-500 dark:text-zinc-400 mb-1">X Offset (px)</label>
            <input
              type="number"
              min={0}
              max={Math.max(0, activeItem.width - 1)}
              value={activeItem.cropRect.x}
              onChange={(e) => onUpdateCropNumeric('x', Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-zinc-500 dark:text-zinc-400 mb-1">Y Offset (px)</label>
            <input
              type="number"
              min={0}
              max={Math.max(0, activeItem.height - 1)}
              value={activeItem.cropRect.y}
              onChange={(e) => onUpdateCropNumeric('y', Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-zinc-500 dark:text-zinc-400 mb-1">Crop Width</label>
            <input
              type="number"
              min={1}
              max={activeItem.width}
              value={activeItem.cropRect.width}
              onChange={(e) => onUpdateCropNumeric('width', Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="block text-zinc-500 dark:text-zinc-400 mb-1">Crop Height</label>
            <input
              type="number"
              min={1}
              max={activeItem.height}
              value={activeItem.cropRect.height}
              onChange={(e) => onUpdateCropNumeric('height', Number(e.target.value))}
              className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </div>

      {/* Section 2: Resize Dimensions */}
      <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
        <h2 className="font-display text-sm font-bold text-zinc-950 dark:text-white">
          2. Resize Dimensions
        </h2>

        <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200/80 dark:border-zinc-800">
          {(
            [
              { id: 'original', label: 'Original' },
              { id: 'exact', label: 'Exact' },
              { id: 'maxEdge', label: 'Max Edge' },
              { id: 'percent', label: 'Scale %' },
            ] as { id: ResizeMode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChangeResizeConfig((prev) => ({ ...prev, mode: m.id }))}
              className={`py-1.5 px-1.5 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap cursor-pointer ${
                resizeConfig.mode === m.id
                  ? 'bg-white dark:bg-[#1A1D26] text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {resizeConfig.mode === 'exact' && (
          <div className="space-y-3 text-xs">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="block text-zinc-500 dark:text-zinc-400 mb-1">Width (px)</label>
                <input
                  type="number"
                  min={1}
                  max={12000}
                  value={resizeConfig.width}
                  onChange={(e) => {
                    const w = Math.max(1, Number(e.target.value) || 1);
                    onChangeResizeConfig((prev) => {
                      if (prev.lockAspect) {
                        const cropW = activeItem.cropEnabled
                          ? activeItem.cropRect.width
                          : activeItem.width;
                        const cropH = activeItem.cropEnabled
                          ? activeItem.cropRect.height
                          : activeItem.height;
                        return {
                          ...prev,
                          width: w,
                          height: Math.max(1, Math.round(w * (cropH / cropW))),
                        };
                      }
                      return { ...prev, width: w };
                    });
                  }}
                  className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  onChangeResizeConfig((prev) => ({ ...prev, lockAspect: !prev.lockAspect }))
                }
                title={resizeConfig.lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                aria-label={resizeConfig.lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                  resizeConfig.lockAspect
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-zinc-50 dark:bg-[#0B0C10] text-zinc-500 border-zinc-200 dark:border-zinc-800'
                }`}
              >
                {resizeConfig.lockAspect ? (
                  <Lock className="w-3.5 h-3.5" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
              </button>

              <div className="flex-1">
                <label className="block text-zinc-500 dark:text-zinc-400 mb-1">Height (px)</label>
                <input
                  type="number"
                  min={1}
                  max={12000}
                  disabled={resizeConfig.lockAspect}
                  value={
                    resizeConfig.lockAspect
                      ? previewTargetDimensions.height
                      : resizeConfig.height
                  }
                  onChange={(e) =>
                    onChangeResizeConfig((prev) => ({
                      ...prev,
                      height: Math.max(1, Number(e.target.value) || 1),
                    }))
                  }
                  className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-zinc-950 dark:text-white disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {!resizeConfig.lockAspect && (
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-500 dark:text-zinc-400 mr-1">Fit:</span>
                {(['cover', 'contain', 'fill'] as ResizeFit[]).map((fitOpt) => (
                  <button
                    key={fitOpt}
                    type="button"
                    onClick={() => onChangeResizeConfig((prev) => ({ ...prev, fit: fitOpt }))}
                    className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors border cursor-pointer ${
                      resizeConfig.fit === fitOpt
                        ? 'bg-zinc-950 text-white border-zinc-950 dark:bg-white dark:text-zinc-950 dark:border-white'
                        : 'bg-zinc-50 dark:bg-[#0B0C10] text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    {fitOpt}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {DIMENSION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() =>
                    onChangeResizeConfig((prev) => ({
                      ...prev,
                      mode: 'exact',
                      width: p.width,
                      height: p.height,
                      lockAspect: false,
                      fit: 'cover',
                    }))
                  }
                  className="px-2 py-1 rounded-md bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {resizeConfig.mode === 'maxEdge' && (
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <label className="text-zinc-500 dark:text-zinc-400">Longest Side Cap (px)</label>
              <input
                type="number"
                min={32}
                max={12000}
                value={resizeConfig.maxEdge}
                onChange={(e) =>
                  onChangeResizeConfig((prev) => ({
                    ...prev,
                    maxEdge: Math.max(32, Number(e.target.value) || 32),
                  }))
                }
                className="w-28 px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono tabular-nums text-right text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[640, 1080, 1600, 2048, 3840].map((edge) => (
                <button
                  key={edge}
                  type="button"
                  onClick={() => onChangeResizeConfig((prev) => ({ ...prev, maxEdge: edge }))}
                  className={`px-2 py-1 rounded-md font-mono text-[11px] cursor-pointer ${
                    resizeConfig.maxEdge === edge
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {edge}px
                </button>
              ))}
            </div>
          </div>
        )}

        {resizeConfig.mode === 'percent' && (
          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 dark:text-zinc-400">Scale Factor</span>
              <span className="font-mono font-semibold tabular-nums text-zinc-950 dark:text-white">
                {resizeConfig.percent}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={200}
              step={5}
              value={resizeConfig.percent}
              onChange={(e) =>
                onChangeResizeConfig((prev) => ({ ...prev, percent: Number(e.target.value) }))
              }
              className="w-full accent-blue-600 cursor-pointer"
            />
            <div className="flex gap-1.5">
              {[25, 50, 75, 100, 150].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => onChangeResizeConfig((prev) => ({ ...prev, percent: pct }))}
                  className={`px-2 py-1 rounded-md font-mono text-[11px] cursor-pointer ${
                    resizeConfig.percent === pct
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Output Format & Naming */}
      <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-3 text-xs">
        <h2 className="font-display text-sm font-bold text-zinc-950 dark:text-white">
          3. Output &amp; Directory Naming
        </h2>

        <div className="grid grid-cols-4 gap-1.5">
          {(
            [
              { id: 'keep', label: 'Keep' },
              { id: 'jpeg', label: 'JPEG' },
              { id: 'png', label: 'PNG' },
              { id: 'webp', label: 'WebP' },
            ] as { id: OutputFormat; label: string }[]
          ).map((fmt) => (
            <button
              key={fmt.id}
              type="button"
              onClick={() => onChangeOutputConfig((prev) => ({ ...prev, format: fmt.id }))}
              className={`py-1.5 rounded-lg font-semibold transition-colors border cursor-pointer ${
                outputConfig.format === fmt.id
                  ? 'bg-zinc-950 text-white border-zinc-950 dark:bg-white dark:text-zinc-950 dark:border-white'
                  : 'bg-zinc-50 dark:bg-[#0B0C10] text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'
              }`}
            >
              {fmt.label}
            </button>
          ))}
        </div>

        {outputConfig.format !== 'png' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-400">
              <span>Quality</span>
              <span className="font-mono font-semibold tabular-nums text-zinc-950 dark:text-white">
                {outputConfig.quality}%
              </span>
            </div>
            <input
              type="range"
              min={50}
              max={100}
              value={outputConfig.quality}
              onChange={(e) =>
                onChangeOutputConfig((prev) => ({ ...prev, quality: Number(e.target.value) }))
              }
              className="w-full accent-blue-600 cursor-pointer"
            />
          </div>
        )}

        <div className="space-y-2">
          <div>
            <label className="block text-zinc-500 dark:text-zinc-400 mb-1">Filename Suffix</label>
            <input
              type="text"
              value={outputConfig.suffix}
              onChange={(e) =>
                onChangeOutputConfig((prev) => ({ ...prev, suffix: e.target.value }))
              }
              placeholder="_resized"
              className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={outputConfig.preserveSubfolders}
              onChange={(e) =>
                onChangeOutputConfig((prev) => ({
                  ...prev,
                  preserveSubfolders: e.target.checked,
                }))
              }
              className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
            />
            <span>Preserve directory subfolder structure</span>
          </label>

          {intakeMode === 'disk' && (
            <div className="pt-2 space-y-2">
              <div>
                <label className="block text-zinc-500 dark:text-zinc-400 mb-1">
                  Output Directory Path
                </label>
                <input
                  type="text"
                  value={diskOutputDir}
                  onChange={(e) => onChangeDiskOutputDir(e.target.value)}
                  disabled={diskOverwrite}
                  placeholder="Defaults to <source>/output_cropped_resized"
                  className="w-full px-2.5 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg font-mono text-zinc-950 dark:text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none text-amber-700 dark:text-amber-400">
                <input
                  type="checkbox"
                  checked={diskOverwrite}
                  onChange={(e) => onChangeDiskOverwrite(e.target.checked)}
                  className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-blue-600 focus:ring-blue-600"
                />
                <span>Overwrite files inside source directory</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Export Actions */}
      <div className="pt-5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
        {progressText && (
          <div className="text-xs font-mono text-blue-600 dark:text-blue-400 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="truncate">{progressText}</span>
          </div>
        )}

        {intakeMode === 'disk' ? (
          <>
            <button
              type="button"
              disabled={selectedCount === 0 || isProcessing}
              onClick={onProcessToDiskDirectory}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <FolderDown className="w-4 h-4 shrink-0" />
              <span className="tabular-nums">
                Process &amp; Save to Directory ({selectedCount})
              </span>
            </button>

            <button
              type="button"
              disabled={selectedCount === 0 || isProcessing}
              onClick={onBatchExportZip}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-45 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <FileArchive className="w-4 h-4 shrink-0" />
              <span>Download Processed (.ZIP)</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={selectedCount === 0 || isProcessing}
              onClick={onBatchExportZip}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              <FileArchive className="w-4 h-4 shrink-0" />
              <span className="tabular-nums">
                Export Selected (.ZIP) ({selectedCount})
              </span>
            </button>

            {canDirectSaveToFolder && (
              <button
                type="button"
                disabled={selectedCount === 0 || isProcessing}
                onClick={onSaveBrowserFolder}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-45 text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
              >
                <FolderDown className="w-4 h-4 shrink-0" />
                <span>Save to Output Folder</span>
              </button>
            )}

            <button
              type="button"
              disabled={isProcessing}
              onClick={onDownloadActiveSingle}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-45 text-zinc-700 dark:text-zinc-300 rounded-xl text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              <span>Download Active Image</span>
            </button>
          </>
        )}
      </div>
    </aside>
  );
};
