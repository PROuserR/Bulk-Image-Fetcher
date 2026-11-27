'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  Crop,
  Dices,
  Download,
  FileArchive,
  Film,
  Globe,
  ImagePlus,
  Images,
  Loader2,
  Lock,
  Maximize2,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  SplitSquareHorizontal,
  Layers,
  Trash2,
  Upload,
  Wand2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  clampDimension,
  DEFAULT_IMAGE_GEN_SETTINGS,
  DEFAULT_SAMPLERS_BY_BACKEND,
  DiscoveredImageGenModel,
  GeneratedImageArtifact,
  generatedArtifactToScrapedImage,
  getDefaultBaseUrlForBackend,
  IMAGE_GEN_ASPECT_PRESETS,
  IMAGE_GEN_BACKEND_PRESETS,
  ImageGenBackendType,
  ImageGenEndpointSettings,
  ImageGenGenerationMode,
  ImageGenRequestParams,
  ImageGenTransportMode,
  LOCAL_IMAGE_GEN_SETTINGS_EVENT,
  loadImageGenSettings,
  normalizeImageGenBaseUrl,
  resolveImageGenTransport,
  sanitizeCustomEndpointPath,
  saveImageGenSettings,
  STARTER_IMAGE_PROMPTS,
} from '../utils/localImageGenConfig';
import {
  discoverImageGenModels,
  generateImagesWithLocalBackend,
} from '../utils/localImageGenClient';
import { triggerBlobDownload } from '../utils/downloader';
import type { ScrapedImage } from '../utils/scraperLogic';

interface ImageGenStudioProps {
  onNotify?: (message: string) => void;
  onStageInTray?: (targets: ScrapedImage[]) => void;
  onSendToCropResize?: (targets: ScrapedImage[]) => void;
  onSendToFilterStudio?: (targets: ScrapedImage[]) => void;
  onSendToGifMaker?: (targets: ScrapedImage[]) => void;
  onSendToGemmaCaptioner?: (targets: ScrapedImage[]) => void;
}

const SAMPLE_CUSTOM_COMFY_WORKFLOW = JSON.stringify(
  {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: '{{model}}' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{prompt}}', clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: '{{negative_prompt}}', clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: '{{width}}', height: '{{height}}', batch_size: '{{batch_size}}' },
    },
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed: '{{seed}}',
        steps: '{{steps}}',
        cfg: '{{cfg}}',
        sampler_name: '{{sampler}}',
        scheduler: 'normal',
        denoise: '{{denoise}}',
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: { samples: ['6', 0], vae: ['1', 2] },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'uip_custom', images: ['7', 0] },
    },
  },
  null,
  2
);

export const ImageGenStudio: React.FC<ImageGenStudioProps> = ({
  onNotify,
  onStageInTray,
  onSendToCropResize,
  onSendToFilterStudio,
  onSendToGifMaker,
  onSendToGemmaCaptioner,
}) => {
  const [settings, setSettings] = useState<ImageGenEndpointSettings>(() =>
    loadImageGenSettings()
  );
  const [isConnectorOpen, setIsConnectorOpen] = useState<boolean>(true);
  const [showComfyWorkflowEditor, setShowComfyWorkflowEditor] = useState<boolean>(false);

  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredImageGenModel[]>([]);
  const [availableSamplers, setAvailableSamplers] = useState<string[]>(
    DEFAULT_SAMPLERS_BY_BACKEND[settings.backend]
  );
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<{
    status: 'idle' | 'ok' | 'error';
    message: string;
    transport?: 'browser-direct' | 'server-proxy';
  }>({ status: 'idle', message: '' });

  // Generation parameters
  const [mode, setMode] = useState<ImageGenGenerationMode>('txt2img');
  const [prompt, setPrompt] = useState<string>('');
  const [negativePrompt, setNegativePrompt] = useState<string>(
    'blurry, low quality, distorted anatomy, artifacts, watermark'
  );
  const [width, setWidth] = useState<number>(1024);
  const [height, setHeight] = useState<number>(1024);
  const [steps, setSteps] = useState<number>(28);
  const [cfgScale, setCfgScale] = useState<number>(7);
  const [sampler, setSampler] = useState<string>(
    DEFAULT_SAMPLERS_BY_BACKEND[settings.backend][0] || 'euler'
  );
  const [seed, setSeed] = useState<number>(-1);
  const [batchCount, setBatchCount] = useState<number>(1);
  const [denoisingStrength, setDenoisingStrength] = useState<number>(0.65);
  const [initImageDataUrl, setInitImageDataUrl] = useState<string>('');

  // Generation runtime & outputs
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [genStatus, setGenStatus] = useState<string>('');
  const [genProgress, setGenProgress] = useState<number>(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [history, setHistory] = useState<GeneratedImageArtifact[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [lightboxArtifact, setLightboxArtifact] = useState<GeneratedImageArtifact | null>(null);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [isDragOverImg2Img, setIsDragOverImg2Img] = useState<boolean>(false);
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [splitPercent, setSplitPercent] = useState<number>(50);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeArtifact =
    history.find((item) => item.id === selectedArtifactId) ?? history[0] ?? null;

  const effectiveTransport = resolveImageGenTransport(settings);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<ImageGenEndpointSettings>).detail;
      if (detail) {
        setSettings(detail);
        setAvailableSamplers(DEFAULT_SAMPLERS_BY_BACKEND[detail.backend]);
      }
    };
    window.addEventListener(LOCAL_IMAGE_GEN_SETTINGS_EVENT, onSettingsChanged);
    return () => {
      window.removeEventListener(LOCAL_IMAGE_GEN_SETTINGS_EVENT, onSettingsChanged);
    };
  }, []);

  useEffect(() => {
    if (!activeArtifact?.sourceInitDataUrl) {
      setCompareMode(false);
    }
  }, [activeArtifact?.id, activeArtifact?.sourceInitDataUrl]);

  const updateSettings = useCallback((next: ImageGenEndpointSettings) => {
    const saved = saveImageGenSettings(next);
    setSettings(saved);
  }, []);

  const handleSelectBackend = (backend: ImageGenBackendType) => {
    const preset = IMAGE_GEN_BACKEND_PRESETS.find((p) => p.backend === backend);
    const defaultUrl = getDefaultBaseUrlForBackend(backend);
    const prevWasDefault = IMAGE_GEN_BACKEND_PRESETS.some(
      (p) => normalizeImageGenBaseUrl(p.baseUrl, p.backend) === settings.baseUrl
    );

    const nextSettings: ImageGenEndpointSettings = {
      ...settings,
      backend,
      baseUrl: prevWasDefault || !settings.baseUrl ? defaultUrl : settings.baseUrl,
      customEndpointPath:
        preset?.customEndpointPath || settings.customEndpointPath || '/generate',
      model: preset?.suggestedModel ?? settings.model,
    };

    updateSettings(nextSettings);
    setConnectionState({ status: 'idle', message: '' });
    setDiscoveredModels([]);
    const samplersForBackend = DEFAULT_SAMPLERS_BY_BACKEND[backend];
    setAvailableSamplers(samplersForBackend);
    setSampler(preset?.defaultSampler || samplersForBackend[0] || 'euler');
    if (preset) {
      setSteps(preset.defaultSteps);
      setCfgScale(preset.defaultCfg);
    }
  };

  const handleConnectAndLoadModels = async () => {
    if (isProbing) return;
    setIsProbing(true);
    setConnectionState({ status: 'idle', message: '' });

    const normalizedUrl = normalizeImageGenBaseUrl(settings.baseUrl, settings.backend);
    const normalizedSettings: ImageGenEndpointSettings = {
      ...settings,
      baseUrl: normalizedUrl,
      customEndpointPath:
        settings.backend === 'custom-rest'
          ? sanitizeCustomEndpointPath(settings.customEndpointPath)
          : settings.customEndpointPath,
    };
    updateSettings(normalizedSettings);

    const res = await discoverImageGenModels(normalizedSettings);
    setIsProbing(false);

    if (!res.ok) {
      setConnectionState({
        status: 'error',
        message: res.error || 'Could not reach the image generation endpoint.',
        transport: res.resolvedTransport,
      });
      return;
    }

    setDiscoveredModels(res.models);
    if (res.samplers.length > 0) {
      setAvailableSamplers(res.samplers);
      if (!res.samplers.includes(sampler)) {
        setSampler(res.samplers[0]);
      }
    }

    const firstModelId = res.models[0]?.id;
    if (firstModelId && (!normalizedSettings.model.trim() || !res.models.some((m) => m.id === normalizedSettings.model))) {
      updateSettings({ ...normalizedSettings, model: firstModelId });
    }

    const viaLabel =
      res.resolvedTransport === 'browser-direct' ? 'Browser Direct (Offline)' : 'Server Proxy';
    const msg =
      res.models.length > 0
        ? `Connected via ${viaLabel} · ${res.models.length} model${res.models.length === 1 ? '' : 's'} loaded`
        : `Connected via ${viaLabel} · Ready (enter model ID manually if required)`;

    setConnectionState({
      status: 'ok',
      message: msg,
      transport: res.resolvedTransport,
    });
    onNotify?.(msg);
  };

  const handleResetEndpointDefaults = () => {
    setDiscoveredModels([]);
    setConnectionState({ status: 'idle', message: '' });
    setAvailableSamplers(DEFAULT_SAMPLERS_BY_BACKEND[DEFAULT_IMAGE_GEN_SETTINGS.backend]);
    updateSettings({ ...DEFAULT_IMAGE_GEN_SETTINGS });
  };

  const handleSelectAspectPreset = (presetWidth: number, presetHeight: number) => {
    setWidth(presetWidth);
    setHeight(presetHeight);
  };

  const handleSwapDimensions = () => {
    setWidth(height);
    setHeight(width);
  };

  const readInitImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setGenError('Please upload an image file (PNG, JPG, WebP) for Image-to-Image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setInitImageDataUrl(reader.result);
        setMode('img2img');
        setGenError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!prompt.trim()) {
      setGenError('Enter a prompt describing the image you want to generate.');
      return;
    }
    if (mode === 'img2img' && !initImageDataUrl) {
      setGenError('Upload or select a reference image for Image-to-Image generation.');
      return;
    }

    setGenError(null);
    setIsGenerating(true);
    setGenStatus('Sending request to model API...');
    setGenProgress(0.06);

    const controller = new AbortController();
    abortRef.current = controller;

    const reqParams: ImageGenRequestParams = {
      mode,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim(),
      width: clampDimension(width),
      height: clampDimension(height),
      steps,
      cfgScale,
      sampler,
      seed,
      batchCount,
      denoisingStrength,
      initImageDataUrl: mode === 'img2img' ? initImageDataUrl : undefined,
    };

    try {
      const results = await generateImagesWithLocalBackend(settings, reqParams, {
        signal: controller.signal,
        onStatus: setGenStatus,
        onProgress: setGenProgress,
      });

      setHistory((prev) => [...results, ...prev]);
      setSelectedArtifactId(results[0].id);
      setGenStatus('');
      setGenProgress(1);
      onNotify?.(
        `Generated ${results.length} image${results.length === 1 ? '' : 's'} (${(
          results[0].durationMs / 1000
        ).toFixed(1)}s)`
      );
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setGenError('Generation cancelled.');
      } else {
        setGenError(err?.message || 'Image generation failed.');
      }
    } finally {
      abortRef.current = null;
      setIsGenerating(false);
    }
  };

  const handleCancelGeneration = () => {
    abortRef.current?.abort();
  };

  const handleDownloadSingle = async (artifact: GeneratedImageArtifact) => {
    try {
      const resp = await fetch(artifact.dataUrl);
      const blob = await resp.blob();
      const slug = artifact.prompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
      triggerBlobDownload(blob, `${slug || 'generated'}-${artifact.seed}.png`);
    } catch {
      setGenError('Could not prepare PNG file for download.');
    }
  };

  const handleExportSessionZip = async () => {
    if (history.length === 0 || isExportingZip) return;
    setIsExportingZip(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < history.length; i++) {
        const item = history[i];
        const resp = await fetch(item.dataUrl);
        const blob = await resp.blob();
        const slug = item.prompt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 28);
        zip.file(`${String(i + 1).padStart(2, '0')}-${slug || 'image'}-${item.seed}.png`, blob);
      }
      const archiveBlob = await zip.generateAsync({ type: 'blob' });
      triggerBlobDownload(archiveBlob, `local-ai-renders-${history.length}.zip`);
      onNotify?.(`Exported ${history.length} generated images as ZIP`);
    } catch {
      setGenError('Failed to package generated images into ZIP.');
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleUseAsImg2Img = (artifact: GeneratedImageArtifact) => {
    setInitImageDataUrl(artifact.dataUrl);
    setMode('img2img');
    onNotify?.('Loaded generated image into Image-to-Image input');
  };

  const handleReuseParameters = (artifact: GeneratedImageArtifact) => {
    setPrompt(artifact.prompt);
    setNegativePrompt(artifact.negativePrompt);
    setWidth(artifact.width);
    setHeight(artifact.height);
    setSteps(artifact.steps);
    setCfgScale(artifact.cfgScale);
    setSampler(artifact.sampler);
    setSeed(artifact.seed);
    onNotify?.(`Applied prompt & seed ${artifact.seed}`);
  };

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxArtifact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxArtifact(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxArtifact]);

  const supportsSampler =
    settings.backend === 'a1111' ||
    settings.backend === 'comfyui' ||
    settings.backend === 'custom-rest';

  return (
    <section
      aria-label="Local AI Image Generation Studio"
      className="space-y-5"
    >
      {/* Top Endpoint Connector Card */}
      <div className="bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl transition-colors">
        <div className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-sm sm:text-base font-bold text-[#0F141F] dark:text-[#F3F6FA] tracking-tight">
                Local AI Image Studio
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  {settings.baseUrl}
                </span>
                {' · '}
                <span>{settings.model || 'Default loaded model'}</span>
                {' · '}
                <span className="inline-flex items-center gap-1">
                  {effectiveTransport === 'browser-direct' ? (
                    <>
                      <WifiOff className="w-3 h-3 text-emerald-600 dark:text-emerald-400 inline" />
                      <span>Offline Direct</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3 h-3 text-blue-600 dark:text-blue-400 inline" />
                      <span>Server Proxy</span>
                    </>
                  )}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {connectionState.status === 'ok' && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Connected</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsConnectorOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:bg-[#EAEFF6] dark:hover:bg-white/[0.08] text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{isConnectorOpen ? 'Hide Endpoint' : 'Configure API'}</span>
              {isConnectorOpen ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {isConnectorOpen && (
          <div className="px-4 sm:px-5 pb-4 pt-3 border-t border-[#DCE1EB] dark:border-white/[0.08] space-y-4">
            {/* Backend Protocol Selector */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div
                role="radiogroup"
                aria-label="Image Generation API Backend"
                className="inline-flex flex-wrap p-1 bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08] rounded-xl gap-1"
              >
                {IMAGE_GEN_BACKEND_PRESETS.map((preset) => {
                  const isActive = settings.backend === preset.backend;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => handleSelectBackend(preset.backend)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-white dark:bg-[#1A202E] text-[#0F141F] dark:text-white shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                {settings.backend === 'comfyui' && (
                  <button
                    type="button"
                    onClick={() => setShowComfyWorkflowEditor((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      showComfyWorkflowEditor || settings.comfyWorkflowTemplate.trim()
                        ? 'border-blue-600/40 bg-blue-600/10 text-blue-700 dark:text-blue-300'
                        : 'border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>
                      {settings.comfyWorkflowTemplate.trim()
                        ? 'Custom Workflow Active'
                        : 'Workflow JSON'}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleResetEndpointDefaults}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-white transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* URL, Endpoint Path, Model, Transport Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div
                className={
                  settings.backend === 'custom-rest' ? 'md:col-span-3' : 'md:col-span-4'
                }
              >
                <label
                  htmlFor="img-gen-base-url"
                  className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                >
                  API Base URL
                </label>
                <input
                  id="img-gen-base-url"
                  type="url"
                  value={settings.baseUrl}
                  onChange={(e) => {
                    setConnectionState({ status: 'idle', message: '' });
                    updateSettings({ ...settings, baseUrl: e.target.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleConnectAndLoadModels();
                    }
                  }}
                  placeholder={getDefaultBaseUrlForBackend(settings.backend)}
                  className="w-full h-9 px-3 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-mono text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              {settings.backend === 'custom-rest' && (
                <div className="md:col-span-2">
                  <label
                    htmlFor="img-gen-custom-path"
                    className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Generate Path
                  </label>
                  <input
                    id="img-gen-custom-path"
                    type="text"
                    value={settings.customEndpointPath}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        customEndpointPath: e.target.value,
                      })
                    }
                    placeholder="/generate"
                    className="w-full h-9 px-3 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-mono text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              )}

              <div
                className={
                  settings.backend === 'custom-rest' ? 'md:col-span-3' : 'md:col-span-4'
                }
              >
                <label
                  htmlFor="img-gen-model-input"
                  className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                >
                  Model / Checkpoint
                </label>
                {discoveredModels.length > 0 ? (
                  <div className="flex gap-1.5">
                    <select
                      id="img-gen-model-select"
                      aria-label="Discovered models"
                      value={
                        discoveredModels.some((m) => m.id === settings.model)
                          ? settings.model
                          : ''
                      }
                      onChange={(e) => {
                        if (e.target.value) {
                          updateSettings({ ...settings, model: e.target.value });
                        }
                      }}
                      className="w-full h-9 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-mono text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {!discoveredModels.some((m) => m.id === settings.model) && (
                        <option value="">Custom ({settings.model || 'enter below'})</option>
                      )}
                      {discoveredModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input
                    id="img-gen-model-input"
                    type="text"
                    value={settings.model}
                    onChange={(e) => updateSettings({ ...settings, model: e.target.value })}
                    placeholder={
                      settings.backend === 'a1111'
                        ? 'Current WebUI checkpoint (optional)'
                        : settings.backend === 'comfyui'
                          ? 'moss_image.safetensors or click Connect'
                          : 'moss-image'
                    }
                    className="w-full h-9 px-3 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-mono text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                )}
              </div>

              <div className="md:col-span-4 flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="img-gen-routing"
                    className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
                  >
                    Routing
                  </label>
                  <select
                    id="img-gen-routing"
                    value={settings.transport}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        transport: e.target.value as ImageGenTransportMode,
                      })
                    }
                    className="w-full h-9 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="auto">Auto (Offline)</option>
                    <option value="browser-direct">Browser Direct</option>
                    <option value="server-proxy">Server Proxy</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => void handleConnectAndLoadModels()}
                  disabled={isProbing}
                  className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-[#0F141F] hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  {isProbing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3.5 h-3.5" />
                  )}
                  <span>Connect</span>
                </button>
              </div>
            </div>

            {/* Custom Model Override Input when models dropdown is displayed */}
            {discoveredModels.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Active model ID:</span>
                <input
                  id="img-gen-model-input"
                  type="text"
                  value={settings.model}
                  onChange={(e) => updateSettings({ ...settings, model: e.target.value })}
                  aria-label="Override active model ID"
                  className="h-7 px-2.5 rounded-md bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-xs text-[#0F141F] dark:text-white min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {/* ComfyUI Custom API Workflow JSON Editor */}
            {settings.backend === 'comfyui' && showComfyWorkflowEditor && (
              <div className="p-3.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[#0F141F] dark:text-white">
                      Custom ComfyUI API Workflow JSON (Optional)
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Paste an exported ComfyUI API workflow for Flux, MOSS-Image, or custom LoRA pipelines. Placeholders:{' '}
                      <span className="font-mono">
                        {'{{prompt}} {{negative_prompt}} {{width}} {{height}} {{steps}} {{cfg}} {{seed}} {{batch_size}} {{sampler}} {{model}} {{denoise}} {{init_image}}'}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateSettings({
                          ...settings,
                          comfyWorkflowTemplate: SAMPLE_CUSTOM_COMFY_WORKFLOW,
                        })
                      }
                      className="px-2.5 py-1 rounded-md border border-[#DCE1EB] dark:border-white/[0.1] bg-white dark:bg-[#131823] text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-blue-500/40 cursor-pointer"
                    >
                      Insert Example Graph
                    </button>
                    {settings.comfyWorkflowTemplate.trim() && (
                      <button
                        type="button"
                        onClick={() =>
                          updateSettings({ ...settings, comfyWorkflowTemplate: '' })
                        }
                        className="px-2.5 py-1 rounded-md border border-[#DCE1EB] dark:border-white/[0.1] text-[11px] font-medium text-slate-500 hover:text-red-500 cursor-pointer"
                      >
                        Use Built-in Graph
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  rows={6}
                  value={settings.comfyWorkflowTemplate}
                  onChange={(e) =>
                    updateSettings({
                      ...settings,
                      comfyWorkflowTemplate: e.target.value,
                    })
                  }
                  placeholder="Leave blank to use the standard CheckpointLoaderSimple -> KSampler -> VAEDecode -> SaveImage graph, or paste ComfyUI API JSON here..."
                  className="w-full p-2.5 rounded-lg bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-[11px] text-[#0F141F] dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            )}

            {/* Connection Status Feedback */}
            {connectionState.status !== 'idle' && (
              <div
                role="status"
                className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                  connectionState.status === 'ok'
                    ? 'bg-emerald-500/8 border-emerald-500/25 text-emerald-800 dark:text-emerald-300'
                    : 'bg-red-500/8 border-red-500/25 text-red-700 dark:text-red-300'
                }`}
              >
                {connectionState.status === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{connectionState.message}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Two-Column Image Studio Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Control Rail */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-4">
          {/* Generation Mode Switch */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#0F141F] dark:text-slate-200 whitespace-nowrap">
              Mode
            </span>
            <div
              role="radiogroup"
              aria-label="Generation Mode"
              className="inline-flex p-0.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08] shrink-0"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'txt2img'}
                onClick={() => setMode('txt2img')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'txt2img'
                    ? 'bg-white dark:bg-[#1A202E] text-[#0F141F] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Text to Image
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'img2img'}
                onClick={() => setMode('img2img')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  mode === 'img2img'
                    ? 'bg-white dark:bg-[#1A202E] text-[#0F141F] dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Image to Image
              </button>
            </div>
          </div>

          {/* Image-to-Image Dropzone + Denoise */}
          {mode === 'img2img' && (
            <div className="p-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#0F141F] dark:text-slate-200">
                  Reference Image
                </span>
                {initImageDataUrl && (
                  <button
                    type="button"
                    onClick={() => setInitImageDataUrl('')}
                    className="text-[11px] text-slate-500 hover:text-red-500 font-medium cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readInitImageFile(file);
                  e.target.value = '';
                }}
              />

              {initImageDataUrl ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={initImageDataUrl}
                    alt="Image to image reference"
                    className="w-16 h-16 rounded-lg object-cover border border-[#DCE1EB] dark:border-white/[0.1] bg-[#0B0E14] shrink-0"
                  />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-600 dark:text-slate-300 font-medium">
                        Denoising Strength
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-[#0F141F] dark:text-white">
                        {denoisingStrength.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={denoisingStrength}
                      onChange={(e) => setDenoisingStrength(Number(e.target.value))}
                      aria-label="Denoising Strength"
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOverImg2Img(true);
                  }}
                  onDragLeave={() => setIsDragOverImg2Img(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOverImg2Img(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) readInitImageFile(file);
                  }}
                  className={`w-full py-5 px-3 rounded-lg border border-dashed flex flex-col items-center justify-center gap-1.5 text-center transition-colors cursor-pointer ${
                    isDragOverImg2Img
                      ? 'border-blue-600 bg-blue-600/8 text-blue-600 dark:text-blue-400'
                      : 'border-slate-300 dark:border-white/[0.14] text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/25'
                  }`}
                >
                  <Upload className="w-4 h-4" />
                  <span className="text-xs font-medium">
                    Drop reference image or click to upload
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Prompt */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="img-gen-prompt"
                className="text-xs font-semibold text-[#0F141F] dark:text-slate-200"
              >
                Prompt
              </label>
              {prompt && (
                <button
                  type="button"
                  onClick={() => setPrompt('')}
                  className="text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              id="img-gen-prompt"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleGenerate();
                }
              }}
              placeholder="Describe subject, composition, lighting, lens, materials... (Ctrl/Cmd + Enter to generate)"
              className="w-full p-3 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs sm:text-[13px] leading-relaxed text-[#0F141F] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
            />
          </div>

          {/* Negative Prompt */}
          <div className="space-y-1.5">
            <label
              htmlFor="img-gen-negative-prompt"
              className="block text-xs font-semibold text-[#0F141F] dark:text-slate-200"
            >
              Negative Prompt
            </label>
            <textarea
              id="img-gen-negative-prompt"
              rows={2}
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Things to avoid (blurry, watermark, artifacts...)"
              className="w-full p-2.5 rounded-xl bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] text-xs leading-relaxed text-[#0F141F] dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 resize-y"
            />
          </div>

          {/* Aspect Ratio Presets & Dimensions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0F141F] dark:text-slate-200">
                Canvas Resolution
              </span>
              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                {width} × {height}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {IMAGE_GEN_ASPECT_PRESETS.map((preset) => {
                const isSelected = width === preset.width && height === preset.height;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectAspectPreset(preset.width, preset.height)}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600/10 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'border-[#DCE1EB] dark:border-white/[0.08] bg-[#F4F6F9] dark:bg-[#0B0D13] text-slate-600 dark:text-slate-400 hover:text-[#0F141F] dark:hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-11 gap-2 items-center pt-1">
              <div className="col-span-5">
                <label htmlFor="img-gen-width" className="sr-only">
                  Width
                </label>
                <input
                  id="img-gen-width"
                  type="number"
                  min={64}
                  max={4096}
                  step={64}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value) || 1024)}
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-xs tabular-nums text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="col-span-1 flex justify-center">
                <button
                  type="button"
                  onClick={handleSwapDimensions}
                  aria-label="Swap width and height"
                  className="p-1 text-slate-400 hover:text-[#0F141F] dark:hover:text-white cursor-pointer"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="col-span-5">
                <label htmlFor="img-gen-height" className="sr-only">
                  Height
                </label>
                <input
                  id="img-gen-height"
                  type="number"
                  min={64}
                  max={4096}
                  step={64}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value) || 1024)}
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-xs tabular-nums text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>
          </div>

          {/* Sampling Parameters Grid */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <label
                  htmlFor="img-gen-steps"
                  className="font-semibold text-slate-600 dark:text-slate-400"
                >
                  Steps
                </label>
                <span className="font-mono tabular-nums text-[#0F141F] dark:text-white font-semibold">
                  {steps}
                </span>
              </div>
              <input
                id="img-gen-steps"
                type="range"
                min={1}
                max={80}
                step={1}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <label
                  htmlFor="img-gen-cfg"
                  className="font-semibold text-slate-600 dark:text-slate-400"
                >
                  CFG Scale
                </label>
                <span className="font-mono tabular-nums text-[#0F141F] dark:text-white font-semibold">
                  {cfgScale.toFixed(1)}
                </span>
              </div>
              <input
                id="img-gen-cfg"
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={cfgScale}
                onChange={(e) => setCfgScale(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            <div>
              <label
                htmlFor="img-gen-seed"
                className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
              >
                Seed (-1 random)
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="img-gen-seed"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                  className="w-full h-8 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-xs tabular-nums text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setSeed(-1)}
                  title="Randomize seed"
                  aria-label="Randomize seed"
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#0B0D13] text-slate-600 dark:text-slate-300 hover:text-[#0F141F] dark:hover:text-white shrink-0 cursor-pointer"
                >
                  <Dices className="w-3.5 h-3.5" />
                </button>
                {activeArtifact && (
                  <button
                    type="button"
                    onClick={() => setSeed(activeArtifact.seed)}
                    title={`Lock active seed (${activeArtifact.seed})`}
                    aria-label="Lock active seed"
                    className="h-8 w-8 flex items-center justify-center rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#0B0D13] text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 shrink-0 cursor-pointer"
                  >
                    <Lock className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label
                htmlFor="img-gen-batch"
                className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
              >
                Batch Count
              </label>
              <div
                id="img-gen-batch"
                role="radiogroup"
                aria-label="Batch Count"
                className="grid grid-cols-4 gap-1 h-8"
              >
                {[1, 2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    role="radio"
                    aria-checked={batchCount === count}
                    onClick={() => setBatchCount(count)}
                    className={`rounded-lg border font-mono text-xs font-semibold transition-colors cursor-pointer ${
                      batchCount === count
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-[#0B0D13] text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sampler Selector */}
          {supportsSampler && (
            <div>
              <label
                htmlFor="img-gen-sampler"
                className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1"
              >
                Sampler
              </label>
              <select
                id="img-gen-sampler"
                value={
                  availableSamplers.includes(sampler) ? sampler : availableSamplers[0] || ''
                }
                onChange={(e) => setSampler(e.target.value)}
                className="w-full h-9 px-2.5 rounded-lg bg-[#F4F6F9] dark:bg-[#0B0D13] border border-[#DCE1EB] dark:border-white/[0.1] font-mono text-xs text-[#0F141F] dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {availableSamplers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error Banner */}
          {genError && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-xl bg-red-500/8 border border-red-500/25 text-xs text-red-700 dark:text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{genError}</span>
            </div>
          )}

          {/* Primary Generate / Cancel CTA */}
          <div className="pt-1 space-y-2">
            {isGenerating ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleCancelGeneration}
                  className="w-full h-10 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Cancel Generation</span>
                </button>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate">{genStatus || 'Generating...'}</span>
                    <span className="font-mono tabular-nums">
                      {Math.round(genProgress * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#EAEFF6] dark:bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${Math.max(8, Math.round(genProgress * 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleGenerate()}
                className="w-full h-10 px-4 rounded-xl bg-[#0F141F] hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {mode === 'img2img'
                    ? 'Transform Image'
                    : batchCount > 1
                      ? `Generate ${batchCount} Images`
                      : 'Generate Image'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Right Canvas & Session History */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-5 min-w-0">
          {/* Active Canvas Output Stage */}
          <div className="bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl overflow-hidden">
            {activeArtifact ? (
              <div>
                {/* Crisp Dark/Light Calibrated Stage (with optional Img2Img Split Compare) */}
                <div className="relative bg-[#ECEFF5] dark:bg-[#090B10] flex items-center justify-center p-4 sm:p-6 min-h-[360px] max-h-[640px]">
                  {compareMode && activeArtifact.sourceInitDataUrl ? (
                    <div className="relative inline-block max-w-full max-h-[560px] rounded-lg overflow-hidden select-none shadow-sm">
                      {/* After: Generated Render */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeArtifact.dataUrl}
                        alt={`After: ${activeArtifact.prompt}`}
                        className="max-w-full max-h-[560px] w-auto h-auto object-contain block"
                      />
                      {/* Before: Img2Img Reference Clipped */}
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 overflow-hidden"
                        style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeArtifact.sourceInitDataUrl}
                          alt="Before reference input"
                          className="w-full h-full object-contain block"
                        />
                      </div>
                      {/* Divider Hairline */}
                      <div
                        aria-hidden="true"
                        className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(0,0,0,0.65)] pointer-events-none"
                        style={{ left: `${splitPercent}%` }}
                      />
                      <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/70 text-[10px] font-mono text-white pointer-events-none">
                        Before (Input)
                      </span>
                      <span className="absolute top-2.5 right-12 px-2 py-0.5 rounded bg-black/70 text-[10px] font-mono text-white pointer-events-none">
                        After (Generated)
                      </span>
                      <input
                        type="range"
                        min={2}
                        max={98}
                        value={splitPercent}
                        onChange={(e) => setSplitPercent(Number(e.target.value))}
                        aria-label="Before and after split comparison position"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
                      />
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={activeArtifact.dataUrl}
                      alt={activeArtifact.prompt}
                      onClick={() => setLightboxArtifact(activeArtifact)}
                      className="max-w-full max-h-[560px] w-auto h-auto rounded-lg object-contain shadow-sm cursor-zoom-in"
                    />
                  )}

                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    {activeArtifact.sourceInitDataUrl && (
                      <button
                        type="button"
                        onClick={() => setCompareMode((prev) => !prev)}
                        className={`h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                          compareMode
                            ? 'bg-blue-600 text-white'
                            : 'bg-black/60 hover:bg-black/80 text-white'
                        }`}
                      >
                        <SplitSquareHorizontal className="w-3.5 h-3.5" />
                        <span>{compareMode ? 'Single View' : 'Split Compare'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setLightboxArtifact(activeArtifact)}
                      aria-label="Inspect full resolution"
                      className="w-8 h-8 rounded-lg bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Unboxed Inline Telemetry & Prompt Summary */}
                <div className="p-4 sm:p-5 border-t border-[#DCE1EB] dark:border-white/[0.08] space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    <span>
                      {activeArtifact.width}×{activeArtifact.height} · {activeArtifact.steps} steps · CFG {activeArtifact.cfgScale} · Seed {activeArtifact.seed} · {(activeArtifact.durationMs / 1000).toFixed(1)}s
                    </span>
                    <span className="truncate max-w-[260px]">
                      {activeArtifact.model}
                    </span>
                  </div>

                  <p className="text-xs sm:text-[13px] text-[#0F141F] dark:text-slate-200 leading-relaxed line-clamp-2">
                    {activeArtifact.prompt}
                  </p>

                  {/* Primary & Cross-Studio Action Row */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => void handleDownloadSingle(activeArtifact)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F141F] hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-[#0F141F] text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PNG</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleUseAsImg2Img(activeArtifact)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-slate-300 dark:hover:border-white/20 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <ImagePlus className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Use for Img2Img</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleReuseParameters(activeArtifact)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-slate-300 dark:hover:border-white/20 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reuse Prompt &amp; Seed</span>
                    </button>

                    {onStageInTray && (
                      <button
                        type="button"
                        onClick={() =>
                          onStageInTray([generatedArtifactToScrapedImage(activeArtifact)])
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-600/8 transition-colors cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>+ Tray</span>
                      </button>
                    )}

                    {onSendToCropResize && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendToCropResize([generatedArtifactToScrapedImage(activeArtifact)])
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F141F] dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <Crop className="w-3.5 h-3.5" />
                        <span>Crop</span>
                      </button>
                    )}

                    {onSendToFilterStudio && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendToFilterStudio([generatedArtifactToScrapedImage(activeArtifact)])
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F141F] dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Filters</span>
                      </button>
                    )}

                    {onSendToGifMaker && history.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendToGifMaker(
                            history.map((item) => generatedArtifactToScrapedImage(item))
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F141F] dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <Film className="w-3.5 h-3.5" />
                        <span>GIF89a</span>
                      </button>
                    )}

                    {onSendToGemmaCaptioner && (
                      <button
                        type="button"
                        onClick={() =>
                          onSendToGemmaCaptioner([generatedArtifactToScrapedImage(activeArtifact)])
                        }
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F141F] dark:hover:text-white transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Ask Vision</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              /* Clean Empty Studio Canvas */
              <div className="p-6 sm:p-10 flex flex-col items-center justify-center text-center min-h-[380px] space-y-6">
                <div className="w-12 h-12 rounded-2xl bg-[#F4F6F9] dark:bg-white/[0.05] border border-[#DCE1EB] dark:border-white/[0.08] flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Images className="w-6 h-6" />
                </div>

                <div className="max-w-md space-y-1.5">
                  <h2 className="font-display text-base sm:text-lg font-bold text-[#0F141F] dark:text-white tracking-tight">
                    Ready for Local Image Synthesis
                  </h2>
                  <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Point the studio to your existing SD WebUI, ComfyUI, OpenAI-compatible Images API, or MOSS-Image endpoint, then generate or iterate with Img2Img.
                  </p>
                </div>

                <div className="w-full max-w-xl space-y-2 text-left">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
                    Starter Prompts
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {STARTER_IMAGE_PROMPTS.map((starter) => (
                      <button
                        key={starter.label}
                        type="button"
                        onClick={() => {
                          setPrompt(starter.prompt);
                          setNegativePrompt(starter.negative);
                        }}
                        className="p-3 rounded-xl border border-[#DCE1EB] dark:border-white/[0.08] bg-[#F4F6F9] dark:bg-[#0B0D13] hover:border-blue-500/40 text-left transition-colors cursor-pointer space-y-1"
                      >
                        <div className="text-xs font-semibold text-[#0F141F] dark:text-white">
                          {starter.label}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">
                          {starter.prompt}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Session Render History Filmstrip */}
          {history.length > 0 && (
            <div className="bg-white dark:bg-[#111318] border border-[#DCE1EB] dark:border-white/[0.08] rounded-2xl p-4 sm:p-5 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-sm font-bold text-[#0F141F] dark:text-white">
                    Session Outputs
                  </h2>
                  <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {history.length} render{history.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleExportSessionZip()}
                    disabled={isExportingZip}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] bg-[#F4F6F9] dark:bg-white/[0.04] hover:border-slate-300 dark:hover:border-white/20 text-xs font-semibold text-[#0F141F] dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isExportingZip ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileArchive className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    )}
                    <span>Export ZIP</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistory([]);
                      setSelectedArtifactId(null);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#DCE1EB] dark:border-white/[0.1] text-xs font-medium text-slate-500 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
                {history.map((item) => {
                  const isSelected = activeArtifact?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedArtifactId(item.id)}
                      className={`group relative aspect-square rounded-xl overflow-hidden border text-left transition-all cursor-pointer bg-[#0B0E14] ${
                        isSelected
                          ? 'border-blue-600 ring-2 ring-blue-600/40'
                          : 'border-[#DCE1EB] dark:border-white/[0.08] hover:border-slate-400 dark:hover:border-white/25'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.dataUrl}
                        alt={item.prompt}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-[10px] font-mono tabular-nums text-white truncate">
                        #{item.seed} · {item.width}×{item.height}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fullscreen Lightbox Inspection Modal */}
      {lightboxArtifact && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Inspect Generated Image"
          onClick={() => setLightboxArtifact(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-5xl w-full max-h-full flex flex-col items-center gap-3"
          >
            <button
              type="button"
              onClick={() => setLightboxArtifact(null)}
              aria-label="Close inspection"
              className="self-end w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxArtifact.dataUrl}
              alt={lightboxArtifact.prompt}
              className="max-w-full max-h-[82vh] rounded-xl object-contain shadow-2xl"
            />
            <div className="text-xs font-mono tabular-nums text-slate-300 text-center">
              {lightboxArtifact.width}×{lightboxArtifact.height} · Seed {lightboxArtifact.seed} · {lightboxArtifact.model}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
