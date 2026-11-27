import {
  buildCaptionPrompt,
  buildOpenAiChatMessages,
  CaptionedImageResult,
  CaptionStyle,
  GemmaChatTurn,
  GemmaImageAttachment,
  OpenAiChatMessage,
  parseCaptionModelOutput,
  stripModelThoughtBlocks,
} from './gemmaCaptionLogic';
import {
  buildOllamaChatPayload,
  buildOpenAiCompatChatPayload,
  consumeOllamaNdjsonResponse,
  consumeOpenAiChatResponse,
  CustomLlmSettings,
  DiscoveredLlmModel,
  LlmProviderMode,
  parseOllamaTagsResponse,
  parseOpenAiModelsResponse,
  resolveEffectiveTransport,
  validateLlmEndpointUrl,
} from './customLlmConfig';

export interface CustomLlmModelDiscoveryResult {
  ok: boolean;
  models: DiscoveredLlmModel[];
  resolvedTransport: 'browser-direct' | 'server-proxy';
  normalizedBaseUrl?: string;
  error?: string;
}

export interface CustomLlmCompletionParams {
  messages: OpenAiChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

function formatDirectBrowserError(
  err: unknown,
  provider: Exclude<LlmProviderMode, 'builtin'>,
  targetUrl: string
): string {
  const msg = err instanceof Error ? err.message : String(err || 'Connection failed');
  const lower = msg.toLowerCase();
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('cors')
  ) {
    if (provider === 'ollama') {
      return `Could not reach your Ollama endpoint at ${targetUrl} from the browser (check that the URL is reachable and allows this origin via OLLAMA_ORIGINS).`;
    }
    return `Could not reach ${targetUrl} directly from the browser. Ensure the endpoint allows this origin or switch Connection Routing to Server Proxy for remote URLs.`;
  }
  return msg;
}

async function fetchModelsDirectBrowser(
  provider: Exclude<LlmProviderMode, 'builtin'>,
  baseUrl: string,
  signal?: AbortSignal
): Promise<CustomLlmModelDiscoveryResult> {
  const targetUrl =
    provider === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`;
  try {
    const resp = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        ok: false,
        models: [],
        resolvedTransport: 'browser-direct',
        normalizedBaseUrl: baseUrl,
        error: `HTTP ${resp.status} from ${targetUrl}${txt ? `: ${txt.slice(0, 160)}` : ''}`,
      };
    }
    const data = await resp.json();
    const models =
      provider === 'ollama'
        ? parseOllamaTagsResponse(data)
        : parseOpenAiModelsResponse(data);
    return {
      ok: true,
      models,
      resolvedTransport: 'browser-direct',
      normalizedBaseUrl: baseUrl,
    };
  } catch (err) {
    return {
      ok: false,
      models: [],
      resolvedTransport: 'browser-direct',
      normalizedBaseUrl: baseUrl,
      error: formatDirectBrowserError(err, provider, targetUrl),
    };
  }
}

export async function fetchCustomLlmModels(
  settings: CustomLlmSettings,
  signal?: AbortSignal
): Promise<CustomLlmModelDiscoveryResult> {
  if (settings.provider === 'builtin') {
    return {
      ok: true,
      models: [],
      resolvedTransport: 'server-proxy',
    };
  }

  const provider = settings.provider;
  const validation = validateLlmEndpointUrl(settings.baseUrl, provider);
  if (!validation.ok) {
    return {
      ok: false,
      models: [],
      resolvedTransport: 'browser-direct',
      error: validation.error,
    };
  }

  const baseUrl = validation.normalizedUrl;
  const transport = resolveEffectiveTransport({
    transport: settings.transport,
    baseUrl,
  });

  if (transport === 'browser-direct') {
    return fetchModelsDirectBrowser(provider, baseUrl, signal);
  }

  // Server Proxy path
  try {
    const resp = await fetch('/api/ai/custom-llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'models',
        provider,
        baseUrl,
      }),
      signal: signal ?? AbortSignal.timeout(12000),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      // In Auto mode, if server proxy cannot reach a private/VPN/Tailscale host, try direct browser fetch
      if (settings.transport === 'auto') {
        const directFallback = await fetchModelsDirectBrowser(provider, baseUrl, signal);
        if (directFallback.ok) {
          return directFallback;
        }
      }
      return {
        ok: false,
        models: [],
        resolvedTransport: 'server-proxy',
        normalizedBaseUrl: baseUrl,
        error: data?.error || `HTTP ${resp.status} via server proxy`,
      };
    }

    const models =
      provider === 'ollama'
        ? parseOllamaTagsResponse(data)
        : parseOpenAiModelsResponse(data);
    return {
      ok: true,
      models,
      resolvedTransport: 'server-proxy',
      normalizedBaseUrl: baseUrl,
    };
  } catch (err: any) {
    if (settings.transport === 'auto') {
      const directFallback = await fetchModelsDirectBrowser(provider, baseUrl, signal);
      if (directFallback.ok) {
        return directFallback;
      }
    }
    return {
      ok: false,
      models: [],
      resolvedTransport: 'server-proxy',
      normalizedBaseUrl: baseUrl,
      error: err?.message || 'Failed to query server proxy for models.',
    };
  }
}

export async function runCustomLlmCompletion(
  settings: CustomLlmSettings,
  params: CustomLlmCompletionParams
): Promise<string> {
  if (settings.provider === 'builtin') {
    throw new Error('Built-in engine does not use custom LLM client.');
  }

  const provider = settings.provider;
  const validation = validateLlmEndpointUrl(settings.baseUrl, provider);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const baseUrl = validation.normalizedUrl;
  const model = settings.model.trim();
  if (!model) {
    throw new Error('Please select or enter a model name first.');
  }

  const transport = resolveEffectiveTransport({
    transport: settings.transport,
    baseUrl,
  });
  const stream = Boolean(params.onDelta);

  if (transport === 'browser-direct') {
    const targetUrl =
      provider === 'ollama' ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
    const payload =
      provider === 'ollama'
        ? buildOllamaChatPayload({
            model,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            stream,
          })
        : buildOpenAiCompatChatPayload({
            model,
            messages: params.messages,
            temperature: params.temperature,
            maxTokens: params.maxTokens,
            stream,
          });

    let resp: Response;
    try {
      resp = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: params.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      throw new Error(formatDirectBrowserError(err, provider, targetUrl));
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(
        `LLM returned HTTP ${resp.status}${txt ? `: ${txt.slice(0, 220)}` : ''}`
      );
    }

    return provider === 'ollama'
      ? consumeOllamaNdjsonResponse(resp, params.onDelta)
      : consumeOpenAiChatResponse(resp, params.onDelta);
  }

  // Server Proxy path
  const resp = await fetch('/api/ai/custom-llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'chat',
      provider,
      baseUrl,
      model,
      messages: params.messages,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      stream,
    }),
    signal: params.signal,
  });

  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}));
    throw new Error(errJson?.error || `HTTP ${resp.status} from custom LLM proxy`);
  }

  return provider === 'ollama'
    ? consumeOllamaNdjsonResponse(resp, params.onDelta)
    : consumeOpenAiChatResponse(resp, params.onDelta);
}

export async function runCustomLlmChatTurn(
  settings: CustomLlmSettings,
  params: {
    history: GemmaChatTurn[];
    userText: string;
    userImages?: GemmaImageAttachment[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  }
): Promise<{ reply: string; durationMs: number }> {
  const startedAt = Date.now();
  const defaultSystem =
    'You are a helpful multimodal vision assistant running via the user-configured LLM endpoint. Answer concisely and accurately about attached images and follow-up questions.';
  const messages = buildOpenAiChatMessages({
    systemPrompt: settings.systemPrompt.trim() || defaultSystem,
    history: params.history,
    userText: params.userText,
    userImages: params.userImages,
  });

  const reply = await runCustomLlmCompletion(settings, {
    messages,
    temperature: params.temperature ?? 0.35,
    maxTokens: params.maxTokens ?? 750,
    signal: params.signal,
    onDelta: params.onDelta,
  });

  return {
    reply: stripModelThoughtBlocks(reply),
    durationMs: Date.now() - startedAt,
  };
}

export async function ensureImageDataUrlInBrowser(
  urlOrDataUrl: string,
  maxEdge = 640
): Promise<string> {
  if (urlOrDataUrl.startsWith('data:image/')) {
    return urlOrDataUrl;
  }

  const fetchTarget =
    urlOrDataUrl.startsWith('http://') || urlOrDataUrl.startsWith('https://')
      ? `/api/proxy?url=${encodeURIComponent(urlOrDataUrl)}`
      : urlOrDataUrl;

  const resp = await fetch(fetchTarget);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} loading image for LLM vision`);
  }
  const blob = await resp.blob();
  const objUrl = URL.createObjectURL(blob);

  try {
    return await new Promise<string>((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('Image decode timed out')), 12000);
      img.onload = () => {
        clearTimeout(timer);
        const natW = Math.max(1, img.naturalWidth || img.width || 1);
        const natH = Math.max(1, img.naturalHeight || img.height || 1);
        const scale = Math.min(1, maxEdge / Math.max(natW, natH));
        const targetW = Math.max(1, Math.round(natW * scale));
        const targetH = Math.max(1, Math.round(natH * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Failed to decode image'));
      };
      img.src = objUrl;
    });
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

export async function captionSingleImageWithCustomLlm(
  settings: CustomLlmSettings,
  params: {
    id: string;
    filename: string;
    relativePath: string;
    dataUrl: string;
    style: CaptionStyle;
    customPrompt?: string;
    signal?: AbortSignal;
  }
): Promise<CaptionedImageResult> {
  const startedAt = Date.now();
  try {
    const promptText = buildCaptionPrompt(params.style, params.customPrompt);
    const rawOutput = await runCustomLlmCompletion(settings, {
      messages: [
        {
          role: 'system',
          content:
            settings.systemPrompt.trim() ||
            'You are an objective computer-vision image captioner. Describe only what is visibly present.',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: params.dataUrl } },
            { type: 'text', text: promptText },
          ],
        },
      ],
      temperature: params.style === 'structured' ? 0.15 : 0.25,
      maxTokens: params.style === 'concise' || params.style === 'alt_text' ? 140 : 280,
      signal: params.signal,
    });

    const parsed = parseCaptionModelOutput(rawOutput, params.style);
    return {
      id: params.id,
      filename: params.filename,
      relativePath: params.relativePath,
      style: params.style,
      caption: parsed.caption,
      detailedDescription: parsed.detailedDescription,
      subjects: parsed.subjects,
      tags: parsed.tags,
      setting: parsed.setting,
      durationMs: Date.now() - startedAt,
    };
  } catch (err: any) {
    return {
      id: params.id,
      filename: params.filename,
      relativePath: params.relativePath,
      style: params.style,
      caption: '',
      detailedDescription: '',
      subjects: [],
      tags: [],
      setting: '',
      durationMs: Date.now() - startedAt,
      error: err?.message || 'Captioning failed',
    };
  }
}

export interface CustomFaceScanDecision {
  id: string;
  hasHumanFace: boolean;
  faceCount: number;
  confidence: number;
  subjectSummary: string;
  error?: string;
}

export async function scanHumanFaceWithCustomLlm(
  settings: CustomLlmSettings,
  item: { id: string; imageDataUrl: string; signal?: AbortSignal }
): Promise<CustomFaceScanDecision> {
  try {
    const raw = await runCustomLlmCompletion(settings, {
      messages: [
        {
          role: 'system',
          content:
            'You are a strict computer-vision human face detector. Respond ONLY with a compact JSON object.',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: item.imageDataUrl } },
            {
              type: 'text',
              text:
                'Does this image contain at least one clearly visible real human face (portrait, selfie, group photo, person)? Return ONLY raw JSON: {"hasHumanFace": boolean, "faceCount": number, "confidence": number, "subjectSummary": "short 3-6 word label"}',
            },
          ],
        },
      ],
      temperature: 0.1,
      maxTokens: 120,
      signal: item.signal,
    });

    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1].trim() : raw.trim();
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(body.slice(start, end + 1));
      const hasHumanFace = Boolean(parsed.hasHumanFace);
      return {
        id: item.id,
        hasHumanFace,
        faceCount: Number(parsed.faceCount ?? (hasHumanFace ? 1 : 0)) || 0,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.8) || 0.8)),
        subjectSummary: String(parsed.subjectSummary || (hasHumanFace ? 'Human portrait' : 'No human face')),
      };
    }

    const lower = raw.toLowerCase();
    const inferredFace =
      /\btrue\b|\byes\b|\bperson\b|\bportrait\b|\bface\b/.test(lower) &&
      !/\bno human\b|\bno face\b|\bfalse\b/.test(lower);
    return {
      id: item.id,
      hasHumanFace: inferredFace,
      faceCount: inferredFace ? 1 : 0,
      confidence: 0.7,
      subjectSummary: raw.slice(0, 60) || (inferredFace ? 'Human detected' : 'Non-human'),
    };
  } catch (err: any) {
    return {
      id: item.id,
      hasHumanFace: false,
      faceCount: 0,
      confidence: 0,
      subjectSummary: '',
      error: err?.message || 'Custom LLM face scan failed',
    };
  }
}
