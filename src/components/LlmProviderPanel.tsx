'use client';

import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Globe,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
  SlidersHorizontal,
  WifiOff,
  AlertCircle,
} from 'lucide-react';
import {
  CustomLlmSettings,
  DEFAULT_CUSTOM_LLM_SETTINGS,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OPENAI_COMPAT_BASE_URL,
  DiscoveredLlmModel,
  LLM_ENDPOINT_PRESETS,
  LlmProviderMode,
  LlmTransportMode,
  normalizeLlmBaseUrl,
  resolveEffectiveTransport,
} from '../utils/customLlmConfig';
import { fetchCustomLlmModels } from '../utils/customLlmClient';

interface LlmProviderPanelProps {
  settings: CustomLlmSettings;
  onChange: (next: CustomLlmSettings) => void;
  compact?: boolean;
  onNotify?: (message: string) => void;
}

export const LlmProviderPanel: React.FC<LlmProviderPanelProps> = ({
  settings,
  onChange,
  compact = false,
  onNotify,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(
    () => settings.provider !== 'builtin'
  );
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredLlmModel[]>([]);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<{
    status: 'idle' | 'ok' | 'error';
    message: string;
    transport?: 'browser-direct' | 'server-proxy';
  }>({ status: 'idle', message: '' });

  useEffect(() => {
    if (settings.provider !== 'builtin') {
      setIsExpanded(true);
    }
  }, [settings.provider]);

  const effectiveTransport = resolveEffectiveTransport(settings);

  const handleSelectProvider = (provider: LlmProviderMode) => {
    setConnectionState({ status: 'idle', message: '' });
    setDiscoveredModels([]);

    if (provider === 'builtin') {
      onChange({
        ...settings,
        provider: 'builtin',
      });
      return;
    }

    const nextBaseUrl =
      provider === 'ollama'
        ? settings.provider === 'ollama' && settings.baseUrl
          ? settings.baseUrl
          : DEFAULT_OLLAMA_BASE_URL
        : settings.provider === 'openai-compat' && settings.baseUrl
          ? settings.baseUrl
          : DEFAULT_OPENAI_COMPAT_BASE_URL;

    const nextModel =
      provider === 'ollama'
        ? settings.provider === 'ollama' && settings.model
          ? settings.model
          : 'gemma3:4b'
        : settings.provider === 'openai-compat' && settings.model
          ? settings.model
          : 'local-model';

    const nextSettings: CustomLlmSettings = {
      ...settings,
      provider,
      baseUrl: nextBaseUrl,
      model: nextModel,
    };
    onChange(nextSettings);
    setIsExpanded(true);

    // Silently auto-discover models if the user's existing endpoint already responds
    void fetchCustomLlmModels(nextSettings).then((res) => {
      if (!res.ok) return;
      setDiscoveredModels(res.models);
      const firstId = res.models[0]?.id;
      if (firstId && !res.models.some((m) => m.id === nextSettings.model)) {
        onChange({ ...nextSettings, model: firstId });
      }
      if (res.models.length > 0) {
        setConnectionState({
          status: 'ok',
          message: `Connected · ${res.models.length} existing model${res.models.length === 1 ? '' : 's'} loaded.`,
          transport: res.resolvedTransport,
        });
      }
    });
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = LLM_ENDPOINT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setConnectionState({ status: 'idle', message: '' });
    setDiscoveredModels([]);
    onChange({
      ...settings,
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: preset.suggestedModel,
      transport: 'auto',
    });
  };

  const handleTestAndFetchModels = async () => {
    if (settings.provider === 'builtin' || isTesting) return;
    setIsTesting(true);
    setConnectionState({ status: 'idle', message: '' });

    const normalizedUrl = normalizeLlmBaseUrl(settings.baseUrl, settings.provider);
    const normalizedSettings: CustomLlmSettings = {
      ...settings,
      baseUrl: normalizedUrl,
    };
    if (normalizedUrl !== settings.baseUrl) {
      onChange(normalizedSettings);
    }

    const result = await fetchCustomLlmModels(normalizedSettings);
    setIsTesting(false);

    if (!result.ok) {
      setConnectionState({
        status: 'error',
        message: result.error || 'Unable to connect to LLM endpoint.',
        transport: result.resolvedTransport,
      });
      return;
    }

    setDiscoveredModels(result.models);
    const firstModelId = result.models[0]?.id;
    const currentModelExists = result.models.some((m) => m.id === normalizedSettings.model);
    if (firstModelId && (!normalizedSettings.model.trim() || !currentModelExists)) {
      onChange({
        ...normalizedSettings,
        model: firstModelId,
      });
    }

    const viaLabel =
      result.resolvedTransport === 'browser-direct'
        ? 'Browser Direct (Offline Ready)'
        : 'Server Proxy';
    const msg =
      result.models.length > 0
        ? `Connected via ${viaLabel} · ${result.models.length} model${result.models.length === 1 ? '' : 's'} detected.`
        : `Connected via ${viaLabel} · Endpoint reachable (enter model name manually).`;

    setConnectionState({
      status: 'ok',
      message: msg,
      transport: result.resolvedTransport,
    });
    onNotify?.(msg);
  };

  const handleResetDefault = () => {
    setDiscoveredModels([]);
    setConnectionState({ status: 'idle', message: '' });
    onChange({ ...DEFAULT_CUSTOM_LLM_SETTINGS });
  };

  return (
    <section
      aria-label="LLM Provider and Offline Endpoint Settings"
      className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5 space-y-4 transition-colors"
    >
      {/* Top Row: Provider Mode Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h2 className="text-xs sm:text-sm font-display font-bold text-zinc-950 dark:text-white">
              LLM Inference Backend
            </h2>
            {settings.provider !== 'builtin' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25">
                {effectiveTransport === 'browser-direct' ? (
                  <WifiOff className="w-3 h-3" />
                ) : (
                  <Globe className="w-3 h-3" />
                )}
                <span>
                  {effectiveTransport === 'browser-direct'
                    ? 'Offline Direct'
                    : 'Server Proxy'}
                </span>
              </span>
            )}
          </div>
          {!compact && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Use the built-in server engine or paste the URL of your existing{' '}
              <span className="font-mono text-zinc-700 dark:text-zinc-300">Ollama</span>{' '}
              or OpenAI-compatible LLM instance.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="radiogroup"
            aria-label="Select LLM Provider"
            className="inline-flex flex-wrap p-1 bg-zinc-100 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg"
          >
            <button
              type="button"
              role="radio"
              aria-checked={settings.provider === 'builtin'}
              onClick={() => handleSelectProvider('builtin')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                settings.provider === 'builtin'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Built-in Server</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.provider === 'ollama'}
              onClick={() => handleSelectProvider('ollama')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                settings.provider === 'ollama'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Ollama (Local / Offline)</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={settings.provider === 'openai-compat'}
              onClick={() => handleSelectProvider('openai-compat')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                settings.provider === 'openai-compat'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Custom OpenAI-Compat</span>
            </button>
          </div>

          {settings.provider !== 'builtin' && (
            <button
              type="button"
              onClick={() => setIsExpanded((v) => !v)}
              aria-expanded={isExpanded}
              className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:border-blue-500 transition-colors cursor-pointer"
            >
              {isExpanded ? 'Hide Config' : 'Configure URL'}
            </button>
          )}
        </div>
      </div>

      {/* Custom / Ollama Endpoint Form */}
      {settings.provider !== 'builtin' && isExpanded && (
        <div className="pt-3.5 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mr-1">
              Presets:
            </span>
            {LLM_ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleApplyPreset(preset.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                  settings.provider === preset.provider &&
                  normalizeLlmBaseUrl(settings.baseUrl, settings.provider) === preset.baseUrl
                    ? 'bg-blue-600/10 border-blue-500/40 text-blue-700 dark:text-blue-300'
                    : 'bg-zinc-50 dark:bg-[#0B0C10] border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-blue-500'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* URL + Test + Model + Transport Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end">
            <div className="md:col-span-5 space-y-1.5">
              <label
                htmlFor="custom-llm-base-url"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                {settings.provider === 'ollama'
                  ? 'Ollama API URL'
                  : 'OpenAI-Compatible Base URL'}
              </label>
              <input
                id="custom-llm-base-url"
                type="url"
                value={settings.baseUrl}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    baseUrl: e.target.value,
                  })
                }
                onBlur={() => {
                  const clean = normalizeLlmBaseUrl(settings.baseUrl, settings.provider);
                  if (clean !== settings.baseUrl) {
                    onChange({ ...settings, baseUrl: clean });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleTestAndFetchModels();
                  }
                }}
                placeholder={
                  settings.provider === 'ollama'
                    ? 'http://localhost:11434 or your Ollama URL'
                    : 'http://localhost:1234/v1'
                }
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm font-mono text-zinc-950 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="md:col-span-4 space-y-1.5">
              <label
                htmlFor="custom-llm-model"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                Vision / Chat Model Name
              </label>
              {discoveredModels.length > 0 ? (
                <div className="flex gap-1.5">
                  <select
                    aria-label="Discovered Models"
                    value={
                      discoveredModels.some((m) => m.id === settings.model)
                        ? settings.model
                        : '__custom__'
                    }
                    onChange={(e) => {
                      if (e.target.value !== '__custom__') {
                        onChange({ ...settings, model: e.target.value });
                      }
                    }}
                    className="flex-1 min-w-0 px-2.5 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-mono text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {discoveredModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                    <option value="__custom__">Custom tag...</option>
                  </select>
                  <input
                    id="custom-llm-model"
                    type="text"
                    value={settings.model}
                    onChange={(e) =>
                      onChange({ ...settings, model: e.target.value })
                    }
                    placeholder="model:tag"
                    className="w-32 px-2.5 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-mono text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              ) : (
                <input
                  id="custom-llm-model"
                  type="text"
                  value={settings.model}
                  onChange={(e) => onChange({ ...settings, model: e.target.value })}
                  placeholder={
                    settings.provider === 'ollama'
                      ? 'e.g. gemma3:4b, llava:latest, qwen2.5vl:7b'
                      : 'e.g. local-model, gemma-3-12b-it'
                  }
                  className="w-full px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm font-mono text-zinc-950 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              )}
            </div>

            <div className="md:col-span-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleTestAndFetchModels}
                disabled={isTesting}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{isTesting ? 'Checking...' : 'Test & Fetch Models'}</span>
              </button>
              <button
                type="button"
                onClick={handleResetDefault}
                title="Reset to Built-in Server Engine"
                aria-label="Reset to Built-in Server Engine"
                className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:text-rose-600 hover:border-rose-400 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Routing & Optional System Prompt */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
            <div className="md:col-span-4 space-y-1.5">
              <label
                htmlFor="custom-llm-transport"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                Connection Routing
              </label>
              <select
                id="custom-llm-transport"
                value={settings.transport}
                onChange={(e) =>
                  onChange({
                    ...settings,
                    transport: e.target.value as LlmTransportMode,
                  })
                }
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="auto">
                  Auto (Direct Offline for localhost · Proxy Remote)
                </option>
                <option value="browser-direct">
                  Browser Direct (100% Offline Local)
                </option>
                <option value="server-proxy">
                  Server Proxy (Remote Host / No CORS)
                </option>
              </select>
            </div>

            <div className="md:col-span-8 space-y-1.5">
              <label
                htmlFor="custom-llm-system-prompt"
                className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
              >
                Optional Custom System Prompt
              </label>
              <input
                id="custom-llm-system-prompt"
                type="text"
                value={settings.systemPrompt}
                onChange={(e) =>
                  onChange({ ...settings, systemPrompt: e.target.value })
                }
                placeholder="Leave blank to use optimized multimodal vision defaults"
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs text-zinc-950 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          {/* Connection Feedback Banner */}
          {connectionState.status === 'ok' && (
            <div className="px-3.5 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{connectionState.message}</span>
            </div>
          )}

          {connectionState.status === 'error' && (
            <div className="px-3.5 py-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="space-y-1">
                <div>{connectionState.message}</div>
                {settings.provider === 'ollama' &&
                  effectiveTransport === 'browser-direct' && (
                    <div className="text-[11px] text-rose-700 dark:text-rose-300">
                      For an existing local Ollama instance, ensure{' '}
                      <code className="px-1 py-0.5 rounded bg-rose-200/50 dark:bg-rose-900/60 font-mono">
                        OLLAMA_ORIGINS
                      </code>{' '}
                      permits this page, or paste your remote Ollama URL with Auto/Server Proxy routing.
                    </div>
                  )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
