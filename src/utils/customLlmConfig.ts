import { OpenAiChatMessage, stripModelThoughtBlocks } from './gemmaCaptionLogic';

export type LlmProviderMode = 'builtin' | 'ollama' | 'openai-compat';
export type LlmTransportMode = 'auto' | 'browser-direct' | 'server-proxy';

export interface CustomLlmSettings {
  provider: LlmProviderMode;
  baseUrl: string;
  model: string;
  transport: LlmTransportMode;
  systemPrompt: string;
}

export interface DiscoveredLlmModel {
  id: string;
  label: string;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
}

export const CUSTOM_LLM_STORAGE_KEY = 'uip_custom_llm_settings_v1';
export const CUSTOM_LLM_SETTINGS_EVENT = 'uip:custom-llm-settings-changed';

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
export const DEFAULT_OPENAI_COMPAT_BASE_URL = 'http://localhost:1234/v1';

export const DEFAULT_CUSTOM_LLM_SETTINGS: CustomLlmSettings = {
  provider: 'builtin',
  baseUrl: DEFAULT_OLLAMA_BASE_URL,
  model: 'gemma3:4b',
  transport: 'auto',
  systemPrompt: '',
};

export interface LlmEndpointPreset {
  id: string;
  label: string;
  provider: Exclude<LlmProviderMode, 'builtin'>;
  baseUrl: string;
  suggestedModel: string;
}

export const LLM_ENDPOINT_PRESETS: LlmEndpointPreset[] = [
  {
    id: 'ollama-local',
    label: 'Ollama (Local)',
    provider: 'ollama',
    baseUrl: 'http://localhost:11434',
    suggestedModel: 'gemma3:4b',
  },
  {
    id: 'lm-studio',
    label: 'LM Studio',
    provider: 'openai-compat',
    baseUrl: 'http://localhost:1234/v1',
    suggestedModel: 'local-model',
  },
  {
    id: 'llama-cpp',
    label: 'llama.cpp Server',
    provider: 'openai-compat',
    baseUrl: 'http://localhost:8080/v1',
    suggestedModel: 'gemma-4',
  },
  {
    id: 'vllm',
    label: 'vLLM / LocalAI',
    provider: 'openai-compat',
    baseUrl: 'http://localhost:8000/v1',
    suggestedModel: 'default',
  },
];

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
  '100.100.100.200',
]);

export function normalizeLlmBaseUrl(
  rawUrl: string,
  provider: LlmProviderMode
): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return provider === 'openai-compat'
      ? DEFAULT_OPENAI_COMPAT_BASE_URL
      : DEFAULT_OLLAMA_BASE_URL;
  }

  let withScheme = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(withScheme)) {
    withScheme = `http://${withScheme}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return trimmed.replace(/\/+$/, '');
  }

  let cleanPath = parsed.pathname.replace(/\/+$/, '');
  if (provider === 'ollama') {
    cleanPath = cleanPath
      .replace(/\/api\/(tags|chat|generate|show|version)$/i, '')
      .replace(/\/api$/i, '')
      .replace(/\/v1(\/.*)?$/i, '');
  } else if (provider === 'openai-compat') {
    cleanPath = cleanPath
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/models$/i, '');
    if (!cleanPath || cleanPath === '') {
      cleanPath = '/v1';
    }
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  return `${origin}${cleanPath}`.replace(/\/+$/, '');
}

export type LlmEndpointValidationResult =
  | { ok: true; normalizedUrl: string; parsed: URL; error?: undefined }
  | { ok: false; error: string; normalizedUrl?: undefined; parsed?: undefined };

export function validateLlmEndpointUrl(
  rawUrl: string,
  provider: Exclude<LlmProviderMode, 'builtin'>
): LlmEndpointValidationResult {
  const trimmed = String(rawUrl || '').trim();
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : trimmed
      ? `http://${trimmed}`
      : '';
  if (withScheme) {
    try {
      const rawParsed = new URL(withScheme);
      if (rawParsed.username || rawParsed.password) {
        return {
          ok: false,
          error: 'Credentials embedded in the URL are not permitted.',
        };
      }
      if (rawParsed.protocol !== 'http:' && rawParsed.protocol !== 'https:') {
        return { ok: false, error: 'Only http:// and https:// endpoints are supported.' };
      }
    } catch {
      return { ok: false, error: 'Enter a valid http:// or https:// endpoint URL.' };
    }
  }

  const normalizedUrl = normalizeLlmBaseUrl(rawUrl, provider);
  let parsed: URL;
  try {
    parsed = new URL(normalizedUrl);
  } catch {
    return { ok: false, error: 'Enter a valid http:// or https:// endpoint URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// endpoints are supported.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || METADATA_HOSTNAMES.has(hostname)) {
    return { ok: false, error: 'This hostname is blocked for security reasons.' };
  }

  return { ok: true, normalizedUrl, parsed };
}

export function isLoopbackHostname(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!clean) return false;
  if (clean === 'localhost' || clean === '::1' || clean === '0.0.0.0') {
    return true;
  }
  if (clean.endsWith('.localhost')) {
    return true;
  }
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(clean)) {
    return true;
  }
  return false;
}

export function isPrivateOrLinkLocalHostname(hostname: string): boolean {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHostname(clean)) return true;
  if (METADATA_HOSTNAMES.has(clean)) return true;

  // IPv4 private / link-local ranges
  const ipv4Match = clean.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 0) return true;
  }

  // IPv6 ULA / link-local
  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
    return true;
  }
  if (clean.endsWith('.local') || clean.endsWith('.internal')) {
    return true;
  }

  return false;
}

export function isLoopbackLlmUrl(rawUrl: string): boolean {
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl)
      ? rawUrl
      : `http://${rawUrl}`;
    const parsed = new URL(withScheme);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveEffectiveTransport(
  settings: Pick<CustomLlmSettings, 'transport' | 'baseUrl'>
): 'browser-direct' | 'server-proxy' {
  if (settings.transport === 'browser-direct') return 'browser-direct';
  if (settings.transport === 'server-proxy') return 'server-proxy';
  // Auto mode: use Browser Direct for localhost/loopback/private LAN so offline/local Ollama works
  // even if the web app is hosted remotely, and Server Proxy for public endpoints to avoid CORS.
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(settings.baseUrl)
      ? settings.baseUrl
      : `http://${settings.baseUrl}`;
    const parsed = new URL(withScheme);
    if (isPrivateOrLinkLocalHostname(parsed.hostname)) {
      return 'browser-direct';
    }
  } catch {
    // default to browser-direct
  }
  return 'server-proxy';
}

export function sanitizeCustomLlmSettings(
  raw: Partial<CustomLlmSettings> | null | undefined
): CustomLlmSettings {
  const provider: LlmProviderMode =
    raw?.provider === 'ollama' || raw?.provider === 'openai-compat'
      ? raw.provider
      : 'builtin';

  const transport: LlmTransportMode =
    raw?.transport === 'browser-direct' || raw?.transport === 'server-proxy'
      ? raw.transport
      : 'auto';

  const defaultUrl =
    provider === 'openai-compat'
      ? DEFAULT_OPENAI_COMPAT_BASE_URL
      : DEFAULT_OLLAMA_BASE_URL;

  const baseUrl = normalizeLlmBaseUrl(
    typeof raw?.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl : defaultUrl,
    provider
  );

  const model =
    typeof raw?.model === 'string' && raw.model.trim()
      ? raw.model.trim()
      : provider === 'openai-compat'
        ? 'local-model'
        : 'gemma3:4b';

  const systemPrompt =
    typeof raw?.systemPrompt === 'string' ? raw.systemPrompt.slice(0, 2000) : '';

  return {
    provider,
    baseUrl,
    model,
    transport,
    systemPrompt,
  };
}

export function loadCustomLlmSettings(): CustomLlmSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_CUSTOM_LLM_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(CUSTOM_LLM_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CUSTOM_LLM_SETTINGS };
    const parsed = JSON.parse(raw);
    return sanitizeCustomLlmSettings(parsed);
  } catch {
    return { ...DEFAULT_CUSTOM_LLM_SETTINGS };
  }
}

export function saveCustomLlmSettings(settings: CustomLlmSettings): CustomLlmSettings {
  const sanitized = sanitizeCustomLlmSettings(settings);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(CUSTOM_LLM_STORAGE_KEY, JSON.stringify(sanitized));
      window.dispatchEvent(
        new CustomEvent<CustomLlmSettings>(CUSTOM_LLM_SETTINGS_EVENT, {
          detail: sanitized,
        })
      );
    } catch {
      // ignore storage quota errors
    }
  }
  return sanitized;
}

export function getActiveEngineDisplayName(settings: CustomLlmSettings): string {
  if (settings.provider === 'ollama') {
    return `Ollama · ${settings.model || 'custom model'}`;
  }
  if (settings.provider === 'openai-compat') {
    return `Custom LLM · ${settings.model || 'local-model'}`;
  }
  return 'Gemma 4 E2B (Open-Source Local)';
}

export function parseOllamaTagsResponse(payload: unknown): DiscoveredLlmModel[] {
  const modelsRaw = (payload as { models?: unknown[] })?.models;
  if (!Array.isArray(modelsRaw)) return [];

  const out: DiscoveredLlmModel[] = [];
  const seen = new Set<string>();

  for (const entry of modelsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, any>;
    const id = String(rec.name || rec.model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const details = rec.details && typeof rec.details === 'object' ? rec.details : {};
    const paramSize =
      typeof details.parameter_size === 'string' ? details.parameter_size : undefined;
    const quant =
      typeof details.quantization_level === 'string'
        ? details.quantization_level
        : undefined;
    const sizeBytes = typeof rec.size === 'number' ? rec.size : undefined;

    const metaParts = [paramSize, quant].filter(Boolean);
    const label = metaParts.length > 0 ? `${id} (${metaParts.join(' · ')})` : id;

    out.push({
      id,
      label,
      sizeBytes,
      parameterSize: paramSize,
      quantization: quant,
    });
  }

  return out;
}

export function parseOpenAiModelsResponse(payload: unknown): DiscoveredLlmModel[] {
  const rawList = Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : Array.isArray((payload as any)?.models)
      ? (payload as any).models
      : Array.isArray(payload)
        ? payload
        : [];

  const out: DiscoveredLlmModel[] = [];
  const seen = new Set<string>();

  for (const item of rawList) {
    if (typeof item === 'string') {
      const id = item.trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, label: id });
      }
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, any>;
    const id = String(rec.id || rec.name || rec.model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }

  return out;
}

export function extractRawBase64FromImageUrl(imageUrl: string): string {
  const trimmed = String(imageUrl || '').trim();
  const match = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  if (match) {
    return match[1].replace(/\s+/g, '');
  }
  return trimmed;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export function buildOllamaChatPayload(params: {
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}): {
  model: string;
  messages: OllamaChatMessage[];
  stream: boolean;
  options: { temperature: number; num_predict: number };
} {
  const ollamaMessages: OllamaChatMessage[] = params.messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return {
        role: msg.role,
        content: msg.content,
      };
    }

    const textParts: string[] = [];
    const images: string[] = [];
    for (const part of msg.content) {
      if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text);
      } else if (part.type === 'image_url' && part.image_url?.url) {
        const b64 = extractRawBase64FromImageUrl(part.image_url.url);
        if (b64) images.push(b64);
      }
    }

    return {
      role: msg.role,
      content: textParts.join('\n').trim(),
      ...(images.length > 0 ? { images } : {}),
    };
  });

  return {
    model: params.model,
    messages: ollamaMessages,
    stream: Boolean(params.stream),
    options: {
      temperature: params.temperature ?? 0.3,
      num_predict: params.maxTokens ?? 700,
    },
  };
}

export function buildOpenAiCompatChatPayload(params: {
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}): {
  model: string;
  messages: OpenAiChatMessage[];
  temperature: number;
  max_tokens: number;
  stream: boolean;
} {
  return {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? 0.3,
    max_tokens: params.maxTokens ?? 700,
    stream: Boolean(params.stream),
  };
}

function createThoughtSafeEmitter(onDelta?: (delta: string) => void) {
  let accumulated = '';
  let inThoughtBlock = false;

  const push = (chunkText: string) => {
    if (!chunkText) return;
    accumulated += chunkText;
    if (!onDelta) return;

    let remaining = chunkText;
    while (remaining.length > 0) {
      if (inThoughtBlock) {
        const endMarker = remaining.includes('<channel|>')
          ? '<channel|>'
          : remaining.includes('</thought>')
            ? '</thought>'
            : '';
        if (!endMarker) {
          return;
        }
        const endIdx = remaining.indexOf(endMarker);
        inThoughtBlock = false;
        remaining = remaining.slice(endIdx + endMarker.length);
        continue;
      }

      const startMarkers = ['<|channel>thought', '<thought>'];
      let earliestIdx = -1;
      let matchedStart = '';
      for (const marker of startMarkers) {
        const idx = remaining.indexOf(marker);
        if (idx !== -1 && (earliestIdx === -1 || idx < earliestIdx)) {
          earliestIdx = idx;
          matchedStart = marker;
        }
      }

      if (earliestIdx === -1) {
        onDelta(remaining);
        return;
      }

      const before = remaining.slice(0, earliestIdx);
      if (before) onDelta(before);
      inThoughtBlock = true;
      remaining = remaining.slice(earliestIdx + matchedStart.length);
    }
  };

  return {
    push,
    getAccumulated: () => accumulated,
  };
}

export async function consumeOllamaNdjsonResponse(
  response: Response,
  onDelta?: (delta: string) => void
): Promise<string> {
  if (!response.body) {
    const json = await response.json().catch(() => ({}));
    if (json?.error) throw new Error(String(json.error));
    const text = String(json?.message?.content || json?.response || '');
    return stripModelThoughtBlocks(text);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const emitter = createThoughtSafeEmitter(onDelta);
  const emitChunk = emitter.push;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed?.error) {
        throw new Error(String(parsed.error));
      }
      const chunk =
        typeof parsed?.message?.content === 'string'
          ? parsed.message.content
          : typeof parsed?.response === 'string'
            ? parsed.response
            : '';
      if (chunk) emitChunk(chunk);
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    try {
      const parsed = JSON.parse(trailing);
      if (parsed?.error) throw new Error(String(parsed.error));
      const chunk =
        typeof parsed?.message?.content === 'string'
          ? parsed.message.content
          : typeof parsed?.response === 'string'
            ? parsed.response
            : '';
      if (chunk) emitChunk(chunk);
    } catch (err: any) {
      if (err?.message && !/JSON/i.test(err.message)) throw err;
    }
  }

  return stripModelThoughtBlocks(emitter.getAccumulated());
}

export async function consumeOpenAiChatResponse(
  response: Response,
  onDelta?: (delta: string) => void
): Promise<string> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // Handle non-streaming JSON responses cleanly even when stream was requested
  if (!response.body || contentType.includes('application/json')) {
    const data = await response.json().catch(() => ({}));
    if (data?.error) {
      const errMsg =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || JSON.stringify(data.error);
      throw new Error(errMsg);
    }
    const msg = data?.choices?.[0]?.message;
    const raw =
      (typeof msg?.content === 'string' && msg.content.trim())
        ? msg.content
        : typeof msg?.reasoning_content === 'string'
          ? msg.reasoning_content
          : '';
    const cleaned = stripModelThoughtBlocks(raw);
    if (cleaned && onDelta) onDelta(cleaned);
    return cleaned;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawNonSseFallback = '';
  let sawSseEvent = false;
  const emitter = createThoughtSafeEmitter(onDelta);
  const emitChunk = emitter.push;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const decoded = decoder.decode(value, { stream: true });
    rawNonSseFallback += decoded;
    buffer += decoded;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      sawSseEvent = true;
      const payloadStr = line.slice(5).trim();
      if (payloadStr === '[DONE]') continue;

      let parsed: any;
      try {
        parsed = JSON.parse(payloadStr);
      } catch {
        continue;
      }
      if (parsed?.error) {
        const errMsg =
          typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error?.message || 'LLM completion error';
        throw new Error(errMsg);
      }
      const delta =
        parsed?.choices?.[0]?.delta?.content ??
        parsed?.choices?.[0]?.message?.content ??
        '';
      if (typeof delta === 'string' && delta.length > 0) {
        emitChunk(delta);
      }
    }
  }

  if (!sawSseEvent && rawNonSseFallback.trim().startsWith('{')) {
    try {
      const data = JSON.parse(rawNonSseFallback.trim());
      if (data?.error) {
        throw new Error(
          typeof data.error === 'string' ? data.error : data.error?.message || 'LLM error'
        );
      }
      const msg = data?.choices?.[0]?.message?.content || '';
      const cleaned = stripModelThoughtBlocks(String(msg));
      if (cleaned && onDelta) onDelta(cleaned);
      return cleaned;
    } catch (err: any) {
      if (err?.message && !/JSON/i.test(err.message)) throw err;
    }
  }

  return stripModelThoughtBlocks(emitter.getAccumulated());
}
