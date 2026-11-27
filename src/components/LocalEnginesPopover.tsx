'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  ImagePlus,
  Loader2,
  RefreshCw,
  Server,
  SlidersHorizontal,
  Sparkles,
  WifiOff,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  CUSTOM_LLM_SETTINGS_EVENT,
  CustomLlmSettings,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_COMPAT_BASE_URL,
  DiscoveredLlmModel,
  LlmProviderMode,
  loadCustomLlmSettings,
  normalizeLlmBaseUrl,
  saveCustomLlmSettings,
} from '../utils/customLlmConfig';
import { fetchCustomLlmModels } from '../utils/customLlmClient';
import {
  DiscoveredImageGenModel,
  getDefaultBaseUrlForBackend,
  IMAGE_GEN_BACKEND_PRESETS,
  ImageGenBackendType,
  ImageGenEndpointSettings,
  LOCAL_IMAGE_GEN_SETTINGS_EVENT,
  loadImageGenSettings,
  normalizeImageGenBaseUrl,
  saveImageGenSettings,
} from '../utils/localImageGenConfig';
import { discoverImageGenModels } from '../utils/localImageGenClient';

interface LocalEnginesPopoverProps {
  onNotify?: (msg: string) => void;
  onOpenImageStudio?: () => void;
  onOpenVisionStudio?: () => void;
}

export const LocalEnginesPopover: React.FC<LocalEnginesPopoverProps> = ({
  onNotify,
  onOpenImageStudio,
  onOpenVisionStudio,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState<CustomLlmSettings>(() =>
    loadCustomLlmSettings()
  );
  const [imgSettings, setImgSettings] = useState<ImageGenEndpointSettings>(() =>
    loadImageGenSettings()
  );

  const [llmModels, setLlmModels] = useState<DiscoveredLlmModel[]>([]);
  const [llmTesting, setLlmTesting] = useState(false);
  const [llmStatus, setLlmStatus] = useState<{
    type: 'idle' | 'ok' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });

  const [imgModels, setImgModels] = useState<DiscoveredImageGenModel[]>([]);
  const [imgTesting, setImgTesting] = useState(false);
  const [imgStatus, setImgStatus] = useState<{
    type: 'idle' | 'ok' | 'error';
    text: string;
  }>({ type: 'idle', text: '' });

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onLlmChanged = (e: Event) => {
      const detail = (e as CustomEvent<CustomLlmSettings>).detail;
      if (detail) setLlmSettings(detail);
    };
    const onImgChanged = (e: Event) => {
      const detail = (e as CustomEvent<ImageGenEndpointSettings>).detail;
      if (detail) setImgSettings(detail);
    };
    window.addEventListener(CUSTOM_LLM_SETTINGS_EVENT, onLlmChanged);
    window.addEventListener(LOCAL_IMAGE_GEN_SETTINGS_EVENT, onImgChanged);
    return () => {
      window.removeEventListener(CUSTOM_LLM_SETTINGS_EVENT, onLlmChanged);
      window.removeEventListener(LOCAL_IMAGE_GEN_SETTINGS_EVENT, onImgChanged);
    };
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

  const updateLlm = (next: CustomLlmSettings) => {
    const saved = saveCustomLlmSettings(next);
    setLlmSettings(saved);
  };

  const updateImg = (next: ImageGenEndpointSettings) => {
    const saved = saveImageGenSettings(next);
    setImgSettings(saved);
  };

  const handleLlmProviderSwitch = (provider: LlmProviderMode) => {
    setLlmStatus({ type: 'idle', text: '' });
    if (provider === 'builtin') {
      updateLlm({ ...llmSettings, provider: 'builtin' });
      return;
    }
    const baseUrl =
      provider === 'ollama'
        ? llmSettings.provider === 'ollama' && llmSettings.baseUrl
          ? llmSettings.baseUrl
          : DEFAULT_OLLAMA_BASE_URL
        : llmSettings.provider === 'openai-compat' && llmSettings.baseUrl
          ? llmSettings.baseUrl
          : DEFAULT_OPENAI_COMPAT_BASE_URL;
    const model =
      provider === 'ollama'
        ? llmSettings.provider === 'ollama' && llmSettings.model
          ? llmSettings.model
          : 'gemma3:4b'
        : llmSettings.provider === 'openai-compat' && llmSettings.model
          ? llmSettings.model
          : 'local-model';
    updateLlm({ ...llmSettings, provider, baseUrl, model });
  };

  const handleTestLlm = async () => {
    if (llmSettings.provider === 'builtin' || llmTesting) return;
    setLlmTesting(true);
    setLlmStatus({ type: 'idle', text: '' });
    const normalized = {
      ...llmSettings,
      baseUrl: normalizeLlmBaseUrl(llmSettings.baseUrl, llmSettings.provider),
    };
    updateLlm(normalized);
    const res = await fetchCustomLlmModels(normalized);
    setLlmTesting(false);
    if (!res.ok) {
      setLlmStatus({ type: 'error', text: res.error || 'Connection failed' });
      return;
    }
    setLlmModels(res.models);
    if (res.models[0]?.id && !res.models.some((m) => m.id === normalized.model)) {
      updateLlm({ ...normalized, model: res.models[0].id });
    }
    const text =
      res.models.length > 0
        ? `${res.models.length} model${res.models.length === 1 ? '' : 's'} ready`
        : 'Endpoint reachable';
    setLlmStatus({ type: 'ok', text });
    onNotify?.(`LLM endpoint connected (${text})`);
  };

  const handleImgBackendSwitch = (backend: ImageGenBackendType) => {
    setImgStatus({ type: 'idle', text: '' });
    setImgModels([]);
    const preset = IMAGE_GEN_BACKEND_PRESETS.find((p) => p.backend === backend);
    updateImg({
      ...imgSettings,
      backend,
      baseUrl: getDefaultBaseUrlForBackend(backend),
      customEndpointPath: preset?.customEndpointPath || '/generate',
      model: preset?.suggestedModel ?? '',
    });
  };

  const handleTestImg = async () => {
    if (imgTesting) return;
    setImgTesting(true);
    setImgStatus({ type: 'idle', text: '' });
    const normalized = {
      ...imgSettings,
      baseUrl: normalizeImageGenBaseUrl(imgSettings.baseUrl, imgSettings.backend),
    };
    updateImg(normalized);
    const res = await discoverImageGenModels(normalized);
    setImgTesting(false);
    if (!res.ok) {
      setImgStatus({ type: 'error', text: res.error || 'Connection failed' });
      return;
    }
    setImgModels(res.models);
    if (res.models[0]?.id && !res.models.some((m) => m.id === normalized.model)) {
      updateImg({ ...normalized, model: res.models[0].id });
    }
    const text =
      res.models.length > 0
        ? `${res.models.length} checkpoint${res.models.length === 1 ? '' : 's'} loaded`
        : 'Endpoint reachable';
    setImgStatus({ type: 'ok', text });
    onNotify?.(`Image endpoint connected (${text})`);
  };

  const hasCustomLlm = llmSettings.provider !== 'builtin';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Local Engines"
        className={`w-8 sm:w-auto h-8 sm:h-9 sm:px-3 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
          isOpen || hasCustomLlm
            ? 'border-blue-600/40 bg-blue-600/10 text-blue-700 dark:text-blue-300'
            : 'border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#131823] text-slate-700 dark:text-slate-200 hover:bg-[#E7EBF2] dark:hover:bg-white/[0.08]'
        }`}
      >
        <Server className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">Local Engines</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Local Offline AI Engines"
          className="fixed sm:absolute right-3 sm:right-0 left-3 sm:left-auto top-14 sm:top-11 z-50 sm:w-[440px] max-h-[82vh] overflow-y-auto bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.12] rounded-2xl shadow-2xl p-4 space-y-4 animate-fadeIn"
        >
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DCE1EB] dark:border-white/[0.08]">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="font-display text-sm font-bold text-[#0F141F] dark:text-white">
                Local AI Engines
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close Local Engines"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#0F141F] dark:hover:text-white hover:bg-[#F4F6F9] dark:hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Section 1: Vision & Text LLM */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F141F] dark:text-slate-100">
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Vision &amp; Chat LLM</span>
              </div>
              {onOpenVisionStudio && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenVisionStudio();
                  }}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Open Studio
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08]">
              {(
                [
                  { id: 'builtin', label: 'Built-in' },
                  { id: 'ollama', label: 'Ollama' },
                  { id: 'openai-compat', label: 'OpenAI API' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleLlmProviderSwitch(opt.id)}
                  className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    llmSettings.provider === opt.id
                      ? 'bg-white dark:bg-[#1A202E] text-[#0F141F] dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {llmSettings.provider === 'builtin' ? (
              <div className="px-3 py-2 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08] text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Using built-in Gemma 4 E2B multimodal engine.</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  <input
                    type="url"
                    aria-label="LLM API Base URL"
                    value={llmSettings.baseUrl}
                    onChange={(e) => updateLlm({ ...llmSettings, baseUrl: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleTestLlm();
                      }
                    }}
                    placeholder={DEFAULT_OLLAMA_BASE_URL}
                    className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => void handleTestLlm()}
                    disabled={llmTesting}
                    className="h-8 px-2.5 rounded-lg bg-[#0F141F] dark:bg-blue-600 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    {llmTesting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    <span>Connect</span>
                  </button>
                </div>

                {llmModels.length > 0 ? (
                  <select
                    aria-label="Discovered LLM model"
                    value={
                      llmModels.some((m) => m.id === llmSettings.model)
                        ? llmSettings.model
                        : ''
                    }
                    onChange={(e) => {
                      if (e.target.value) updateLlm({ ...llmSettings, model: e.target.value });
                    }}
                    className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {llmModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    aria-label="LLM Model Name"
                    value={llmSettings.model}
                    onChange={(e) => updateLlm({ ...llmSettings, model: e.target.value })}
                    placeholder="gemma3:4b"
                    className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                )}

                {llmStatus.type !== 'idle' && (
                  <div
                    className={`flex items-center gap-1.5 text-[11px] ${
                      llmStatus.type === 'ok'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {llmStatus.type === 'ok' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="truncate">{llmStatus.text}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-[#DCE1EB] dark:border-white/[0.08]" />

          {/* Section 2: Local Image Generation Engine */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F141F] dark:text-slate-100">
                <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Image Generation API</span>
              </div>
              {onOpenImageStudio && (
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenImageStudio();
                  }}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Open Studio
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08]">
              {IMAGE_GEN_BACKEND_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleImgBackendSwitch(preset.backend)}
                  className={`py-1.5 px-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap truncate cursor-pointer ${
                    imgSettings.backend === preset.backend
                      ? 'bg-white dark:bg-[#1A202E] text-[#0F141F] dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-white'
                  }`}
                >
                  {preset.backend === 'a1111'
                    ? 'SD WebUI'
                    : preset.backend === 'comfyui'
                      ? 'ComfyUI'
                      : preset.backend === 'openai-images'
                        ? 'OpenAI API'
                        : 'MOSS / REST'}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="url"
                  aria-label="Image Generation API Base URL"
                  value={imgSettings.baseUrl}
                  onChange={(e) => updateImg({ ...imgSettings, baseUrl: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleTestImg();
                    }
                  }}
                  placeholder={getDefaultBaseUrlForBackend(imgSettings.backend)}
                  className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => void handleTestImg()}
                  disabled={imgTesting}
                  className="h-8 px-2.5 rounded-lg bg-[#0F141F] dark:bg-blue-600 text-white text-[11px] font-semibold flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-60"
                >
                  {imgTesting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  <span>Connect</span>
                </button>
              </div>

              {imgModels.length > 0 ? (
                <select
                  aria-label="Discovered image model"
                  value={
                    imgModels.some((m) => m.id === imgSettings.model) ? imgSettings.model : ''
                  }
                  onChange={(e) => {
                    if (e.target.value) updateImg({ ...imgSettings, model: e.target.value });
                  }}
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {imgModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  aria-label="Image Model or Checkpoint"
                  value={imgSettings.model}
                  onChange={(e) => updateImg({ ...imgSettings, model: e.target.value })}
                  placeholder="moss-image or checkpoint name"
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}

              {imgStatus.type !== 'idle' && (
                <div
                  className={`flex items-center gap-1.5 text-[11px] ${
                    imgStatus.type === 'ok'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {imgStatus.type === 'ok' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="truncate">{imgStatus.text}</span>
                </div>
              )}
            </div>
          </div>

          <div className="pt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <WifiOff className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Local &amp; LAN URLs connect directly offline from your browser.</span>
          </div>
        </div>
      )}
    </div>
  );
};
