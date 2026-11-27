/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isPrivateOrLinkLocalHostname } from './customLlmConfig';
import { classifyResolution, type ScrapedImage } from './scraperLogic';

export type ImageGenBackendType = 'a1111' | 'comfyui' | 'openai-images' | 'custom-rest';
export type ImageGenTransportMode = 'auto' | 'browser-direct' | 'server-proxy';
export type ImageGenGenerationMode = 'txt2img' | 'img2img';

export interface ImageGenEndpointSettings {
  backend: ImageGenBackendType;
  baseUrl: string;
  customEndpointPath: string;
  model: string;
  transport: ImageGenTransportMode;
  comfyWorkflowTemplate: string;
}

export interface DiscoveredImageGenModel {
  id: string;
  label: string;
}

export interface ImageGenAspectPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface ImageGenRequestParams {
  mode: ImageGenGenerationMode;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  sampler: string;
  seed: number;
  batchCount: number;
  denoisingStrength: number;
  initImageDataUrl?: string;
}

export interface GeneratedImageArtifact {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  seed: number;
  prompt: string;
  negativePrompt: string;
  model: string;
  backend: ImageGenBackendType;
  steps: number;
  cfgScale: number;
  sampler: string;
  mode: ImageGenGenerationMode;
  durationMs: number;
  createdAt: number;
  sourceInitDataUrl?: string;
}

export interface ImageGenBackendPreset {
  id: string;
  label: string;
  backend: ImageGenBackendType;
  baseUrl: string;
  customEndpointPath: string;
  suggestedModel: string;
  defaultSampler: string;
  defaultSteps: number;
  defaultCfg: number;
}

export const LOCAL_IMAGE_GEN_STORAGE_KEY = 'uip_local_image_gen_settings_v1';
export const LOCAL_IMAGE_GEN_SETTINGS_EVENT = 'uip:local-image-gen-settings-changed';

export const DEFAULT_A1111_BASE_URL = 'http://127.0.0.1:7860';
export const DEFAULT_COMFYUI_BASE_URL = 'http://127.0.0.1:8188';
export const DEFAULT_OPENAI_IMAGES_BASE_URL = 'http://127.0.0.1:8000/v1';
export const DEFAULT_CUSTOM_REST_BASE_URL = 'http://127.0.0.1:8000';
export const DEFAULT_CUSTOM_REST_PATH = '/generate';

export const IMAGE_GEN_BACKEND_PRESETS: ImageGenBackendPreset[] = [
  {
    id: 'a1111',
    label: 'SD WebUI / Forge',
    backend: 'a1111',
    baseUrl: DEFAULT_A1111_BASE_URL,
    customEndpointPath: '',
    suggestedModel: '',
    defaultSampler: 'DPM++ 2M',
    defaultSteps: 28,
    defaultCfg: 7,
  },
  {
    id: 'comfyui',
    label: 'ComfyUI',
    backend: 'comfyui',
    baseUrl: DEFAULT_COMFYUI_BASE_URL,
    customEndpointPath: '',
    suggestedModel: '',
    defaultSampler: 'euler',
    defaultSteps: 24,
    defaultCfg: 7,
  },
  {
    id: 'openai-images',
    label: 'OpenAI Images API',
    backend: 'openai-images',
    baseUrl: DEFAULT_OPENAI_IMAGES_BASE_URL,
    customEndpointPath: '',
    suggestedModel: 'moss-image',
    defaultSampler: 'default',
    defaultSteps: 28,
    defaultCfg: 5,
  },
  {
    id: 'custom-rest',
    label: 'MOSS / Custom REST',
    backend: 'custom-rest',
    baseUrl: DEFAULT_CUSTOM_REST_BASE_URL,
    customEndpointPath: DEFAULT_CUSTOM_REST_PATH,
    suggestedModel: 'moss-image',
    defaultSampler: 'euler',
    defaultSteps: 28,
    defaultCfg: 5,
  },
];

export const IMAGE_GEN_ASPECT_PRESETS: ImageGenAspectPreset[] = [
  { id: '1:1', label: '1:1 Square', width: 1024, height: 1024 },
  { id: '3:4', label: '3:4 Portrait', width: 896, height: 1152 },
  { id: '4:3', label: '4:3 Classic', width: 1152, height: 896 },
  { id: '16:9', label: '16:9 Wide', width: 1344, height: 768 },
  { id: '9:16', label: '9:16 Vertical', width: 768, height: 1344 },
  { id: '512', label: '512 SD1.5', width: 512, height: 512 },
];

export const DEFAULT_SAMPLERS_BY_BACKEND: Record<ImageGenBackendType, string[]> = {
  a1111: [
    'DPM++ 2M',
    'DPM++ 2M Karras',
    'Euler a',
    'Euler',
    'DPM++ SDE',
    'DDIM',
    'UniPC',
  ],
  comfyui: [
    'euler',
    'euler_ancestral',
    'dpmpp_2m',
    'dpmpp_2m_sde',
    'dpmpp_3m_sde',
    'ddim',
    'uni_pc',
  ],
  'openai-images': ['default'],
  'custom-rest': ['euler', 'dpmpp_2m', 'flow_match', 'default'],
};

export const STARTER_IMAGE_PROMPTS: { label: string; prompt: string; negative: string }[] = [
  {
    label: 'Architectural Light Study',
    prompt:
      'Minimalist brutalist concrete gallery bathed in golden hour sunlight, sharp geometric shadows, warm travertine floor, architectural digest photography, 35mm lens, crisp texture',
    negative: 'blurry, low contrast, oversaturated, distorted perspective, watermark, text',
  },
  {
    label: 'Studio Product Macro',
    prompt:
      'Matte anodized aluminum mechanical camera lens resting on dark slate stone, dramatic studio rim lighting, subtle specular highlights, crisp optical glass reflections, commercial photography',
    negative: 'plastic texture, noisy, cluttered background, lowres, artifacts',
  },
  {
    label: 'Rainy Neon Alley',
    prompt:
      'Atmospheric night street in Tokyo after rain, wet asphalt reflecting soft cyan and amber signage, cinematic 50mm anamorphic bokeh, moody film still, rich dynamic range',
    negative: 'cartoon, flat lighting, overexposed highlights, deformed geometry, text',
  },
];

export const DEFAULT_IMAGE_GEN_SETTINGS: ImageGenEndpointSettings = {
  backend: 'a1111',
  baseUrl: DEFAULT_A1111_BASE_URL,
  customEndpointPath: DEFAULT_CUSTOM_REST_PATH,
  model: '',
  transport: 'auto',
  comfyWorkflowTemplate: '',
};

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  '169.254.169.254',
  '100.100.100.200',
]);

export function getDefaultBaseUrlForBackend(backend: ImageGenBackendType): string {
  switch (backend) {
    case 'comfyui':
      return DEFAULT_COMFYUI_BASE_URL;
    case 'openai-images':
      return DEFAULT_OPENAI_IMAGES_BASE_URL;
    case 'custom-rest':
      return DEFAULT_CUSTOM_REST_BASE_URL;
    case 'a1111':
    default:
      return DEFAULT_A1111_BASE_URL;
  }
}

export function normalizeImageGenBaseUrl(
  rawUrl: string,
  backend: ImageGenBackendType
): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return getDefaultBaseUrlForBackend(backend);
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

  if (backend === 'a1111') {
    cleanPath = cleanPath
      .replace(/\/sdapi\/v1(\/.*)?$/i, '')
      .replace(/\/sdapi$/i, '');
  } else if (backend === 'comfyui') {
    cleanPath = cleanPath
      .replace(/\/(prompt|history|view|object_info|queue|upload\/image)(\/.*)?$/i, '');
  } else if (backend === 'openai-images') {
    cleanPath = cleanPath
      .replace(/\/images\/(generations|edits|variations)$/i, '')
      .replace(/\/models$/i, '');
    if (!cleanPath) {
      cleanPath = '/v1';
    }
  } else if (backend === 'custom-rest') {
    // Keep custom base path as supplied (strip only trailing slash)
    cleanPath = cleanPath === '/' ? '' : cleanPath;
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  return `${origin}${cleanPath}`.replace(/\/+$/, '');
}

export function sanitizeCustomEndpointPath(rawPath: string): string {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return DEFAULT_CUSTOM_REST_PATH;
  const cleaned = trimmed.replace(/\s+/g, '');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned)) {
    try {
      const parsed = new URL(cleaned);
      return `${parsed.pathname || '/'}${parsed.search || ''}`;
    } catch {
      return DEFAULT_CUSTOM_REST_PATH;
    }
  }
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

export type ImageGenEndpointValidationResult =
  | { ok: true; normalizedUrl: string; parsed: URL; error?: undefined }
  | { ok: false; error: string; normalizedUrl?: undefined; parsed?: undefined };

export function validateImageGenEndpointUrl(
  rawUrl: string,
  backend: ImageGenBackendType
): ImageGenEndpointValidationResult {
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

  const normalizedUrl = normalizeImageGenBaseUrl(rawUrl, backend);
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

export function resolveImageGenTransport(
  settings: Pick<ImageGenEndpointSettings, 'transport' | 'baseUrl'>
): 'browser-direct' | 'server-proxy' {
  if (settings.transport === 'browser-direct') return 'browser-direct';
  if (settings.transport === 'server-proxy') return 'server-proxy';
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(settings.baseUrl)
      ? settings.baseUrl
      : `http://${settings.baseUrl}`;
    const parsed = new URL(withScheme);
    if (isPrivateOrLinkLocalHostname(parsed.hostname)) {
      return 'browser-direct';
    }
  } catch {
    // default to browser-direct for invalid local input
  }
  return 'server-proxy';
}

export function sanitizeImageGenSettings(
  raw: Partial<ImageGenEndpointSettings> | null | undefined
): ImageGenEndpointSettings {
  const backend: ImageGenBackendType =
    raw?.backend === 'a1111' ||
    raw?.backend === 'comfyui' ||
    raw?.backend === 'openai-images' ||
    raw?.backend === 'custom-rest'
      ? raw.backend
      : 'a1111';

  const transport: ImageGenTransportMode =
    raw?.transport === 'browser-direct' || raw?.transport === 'server-proxy'
      ? raw.transport
      : 'auto';

  const fallbackUrl = getDefaultBaseUrlForBackend(backend);
  const baseUrl = normalizeImageGenBaseUrl(
    typeof raw?.baseUrl === 'string' && raw.baseUrl.trim() ? raw.baseUrl : fallbackUrl,
    backend
  );

  const customEndpointPath = sanitizeCustomEndpointPath(
    typeof raw?.customEndpointPath === 'string' ? raw.customEndpointPath : DEFAULT_CUSTOM_REST_PATH
  );

  const model = typeof raw?.model === 'string' ? raw.model.trim().slice(0, 240) : '';
  const comfyWorkflowTemplate =
    typeof raw?.comfyWorkflowTemplate === 'string'
      ? raw.comfyWorkflowTemplate.slice(0, 120_000)
      : '';

  return {
    backend,
    baseUrl,
    customEndpointPath,
    model,
    transport,
    comfyWorkflowTemplate,
  };
}

export function loadImageGenSettings(): ImageGenEndpointSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_IMAGE_GEN_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_IMAGE_GEN_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_IMAGE_GEN_SETTINGS };
    return sanitizeImageGenSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_IMAGE_GEN_SETTINGS };
  }
}

export function saveImageGenSettings(
  settings: ImageGenEndpointSettings
): ImageGenEndpointSettings {
  const sanitized = sanitizeImageGenSettings(settings);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LOCAL_IMAGE_GEN_STORAGE_KEY, JSON.stringify(sanitized));
      window.dispatchEvent(
        new CustomEvent<ImageGenEndpointSettings>(LOCAL_IMAGE_GEN_SETTINGS_EVENT, {
          detail: sanitized,
        })
      );
    } catch {
      // ignore quota errors
    }
  }
  return sanitized;
}

export function resolveConcreteSeed(seed: number): number {
  if (!Number.isFinite(seed) || seed < 0) {
    return Math.floor(Math.random() * 2_147_483_646) + 1;
  }
  return Math.floor(seed);
}

export function clampDimension(value: number, fallback = 1024): number {
  if (!Number.isFinite(value) || value < 64) return fallback;
  const clamped = Math.min(4096, Math.max(64, Math.round(value)));
  return Math.max(64, Math.round(clamped / 8) * 8);
}

export function parseA1111Models(payload: unknown): DiscoveredImageGenModel[] {
  if (!Array.isArray(payload)) return [];
  const out: DiscoveredImageGenModel[] = [];
  const seen = new Set<string>();
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const title = String(rec.title || rec.model_name || rec.filename || '').trim();
    const label = String(rec.model_name || rec.title || '').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({ id: title, label: label || title });
  }
  return out;
}

export function parseA1111Samplers(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of payload) {
    if (typeof item === 'string') {
      const clean = item.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
      continue;
    }
    if (item && typeof item === 'object') {
      const name = String((item as Record<string, unknown>).name || '').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

export function parseComfyModels(payload: unknown): {
  models: DiscoveredImageGenModel[];
  samplers: string[];
} {
  const models: DiscoveredImageGenModel[] = [];
  const samplers: string[] = [];
  const seenModels = new Set<string>();
  const seenSamplers = new Set<string>();

  const root = payload && typeof payload === 'object' ? (payload as Record<string, any>) : {};

  const pushModelsFromNode = (nodeName: string, fieldName: string) => {
    const options = root?.[nodeName]?.input?.required?.[fieldName]?.[0];
    if (!Array.isArray(options)) return;
    for (const entry of options) {
      const id = String(entry || '').trim();
      if (!id || seenModels.has(id)) continue;
      seenModels.add(id);
      models.push({ id, label: id });
    }
  };

  pushModelsFromNode('CheckpointLoaderSimple', 'ckpt_name');
  pushModelsFromNode('UNETLoader', 'unet_name');
  pushModelsFromNode('DiffusionModelLoader', 'model_name');

  const samplerList = root?.KSampler?.input?.required?.sampler_name?.[0];
  if (Array.isArray(samplerList)) {
    for (const entry of samplerList) {
      const name = String(entry || '').trim();
      if (name && !seenSamplers.has(name)) {
        seenSamplers.add(name);
        samplers.push(name);
      }
    }
  }

  return { models, samplers };
}

export function parseOpenAiImageModels(payload: unknown): DiscoveredImageGenModel[] {
  const list = Array.isArray((payload as any)?.data)
    ? (payload as any).data
    : Array.isArray((payload as any)?.models)
      ? (payload as any).models
      : Array.isArray(payload)
        ? payload
        : [];
  const out: DiscoveredImageGenModel[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item === 'string') {
      const id = item.trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push({ id, label: id });
      }
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id || rec.name || rec.model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  return out;
}

export function ensureImageDataUrl(rawValue: string, defaultMime = 'image/png'): string {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const cleanB64 = trimmed.replace(/\s+/g, '');
  let mime = defaultMime;
  if (cleanB64.startsWith('/9j/')) mime = 'image/jpeg';
  else if (cleanB64.startsWith('UklGR')) mime = 'image/webp';
  else if (cleanB64.startsWith('iVBOR')) mime = 'image/png';
  return `data:${mime};base64,${cleanB64}`;
}

export function stripDataUrlPrefix(dataUrlOrBase64: string): string {
  const trimmed = String(dataUrlOrBase64 || '').trim();
  const match = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  if (match) return match[1].replace(/\s+/g, '');
  return trimmed;
}

export function buildA1111Payload(
  params: ImageGenRequestParams,
  model?: string
): Record<string, unknown> {
  const width = clampDimension(params.width);
  const height = clampDimension(params.height);
  const concreteSeed = resolveConcreteSeed(params.seed);

  const base: Record<string, unknown> = {
    prompt: params.prompt,
    negative_prompt: params.negativePrompt,
    width,
    height,
    steps: Math.max(1, Math.min(150, Math.round(params.steps || 28))),
    cfg_scale: Math.max(1, Math.min(30, Number(params.cfgScale ?? 7))),
    sampler_name: params.sampler || 'DPM++ 2M',
    seed: concreteSeed,
    batch_size: Math.max(1, Math.min(4, Math.round(params.batchCount || 1))),
    n_iter: 1,
    send_images: true,
    save_images: false,
  };

  if (model && model.trim()) {
    base.override_settings = {
      sd_model_checkpoint: model.trim(),
    };
  }

  if (params.mode === 'img2img' && params.initImageDataUrl) {
    base.init_images = [params.initImageDataUrl];
    base.denoising_strength = Math.max(
      0.01,
      Math.min(1, Number(params.denoisingStrength ?? 0.65))
    );
  }

  return base;
}

export function buildOpenAiImagesPayload(
  params: ImageGenRequestParams,
  model: string
): Record<string, unknown> {
  const width = clampDimension(params.width);
  const height = clampDimension(params.height);
  const concreteSeed = resolveConcreteSeed(params.seed);

  const payload: Record<string, unknown> = {
    model: model.trim() || 'moss-image',
    prompt: params.prompt,
    n: Math.max(1, Math.min(4, Math.round(params.batchCount || 1))),
    size: `${width}x${height}`,
    response_format: 'b64_json',
    seed: concreteSeed,
  };

  if (params.negativePrompt.trim()) {
    payload.negative_prompt = params.negativePrompt.trim();
  }
  if (params.steps > 0) {
    payload.num_inference_steps = Math.round(params.steps);
  }
  if (Number.isFinite(params.cfgScale)) {
    payload.guidance_scale = Number(params.cfgScale);
  }
  if (params.mode === 'img2img' && params.initImageDataUrl) {
    payload.image = params.initImageDataUrl;
    payload.strength = Math.max(0.01, Math.min(1, Number(params.denoisingStrength ?? 0.65)));
  }

  return payload;
}

export function buildCustomRestPayload(
  params: ImageGenRequestParams,
  model: string
): Record<string, unknown> {
  const width = clampDimension(params.width);
  const height = clampDimension(params.height);
  const concreteSeed = resolveConcreteSeed(params.seed);

  const payload: Record<string, unknown> = {
    prompt: params.prompt,
    negative_prompt: params.negativePrompt,
    width,
    height,
    steps: Math.max(1, Math.min(150, Math.round(params.steps || 28))),
    num_inference_steps: Math.max(1, Math.min(150, Math.round(params.steps || 28))),
    guidance_scale: Number(params.cfgScale ?? 5),
    cfg_scale: Number(params.cfgScale ?? 5),
    seed: concreteSeed,
    num_images: Math.max(1, Math.min(4, Math.round(params.batchCount || 1))),
    batch_size: Math.max(1, Math.min(4, Math.round(params.batchCount || 1))),
    sampler: params.sampler || 'euler',
    response_format: 'b64_json',
  };

  if (model.trim()) {
    payload.model = model.trim();
  }

  if (params.mode === 'img2img' && params.initImageDataUrl) {
    payload.init_image = params.initImageDataUrl;
    payload.image = params.initImageDataUrl;
    payload.strength = Math.max(0.01, Math.min(1, Number(params.denoisingStrength ?? 0.65)));
    payload.denoising_strength = payload.strength;
  }

  return payload;
}

export function buildDefaultComfyPromptGraph(options: {
  params: ImageGenRequestParams;
  model: string;
  uploadedInitFilename?: string;
}): Record<string, unknown> {
  const { params, model, uploadedInitFilename } = options;
  const width = clampDimension(params.width);
  const height = clampDimension(params.height);
  const seed = resolveConcreteSeed(params.seed);
  const steps = Math.max(1, Math.min(150, Math.round(params.steps || 24)));
  const cfg = Math.max(1, Math.min(30, Number(params.cfgScale ?? 7)));
  const batchSize = Math.max(1, Math.min(4, Math.round(params.batchCount || 1)));
  const samplerName = params.sampler || 'euler';
  const ckptName = model.trim() || 'v1-5-pruned-emaonly.safetensors';
  const isImg2Img = params.mode === 'img2img' && Boolean(uploadedInitFilename);

  const graph: Record<string, unknown> = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: {
        ckpt_name: ckptName,
      },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: params.prompt,
        clip: ['1', 1],
      },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: params.negativePrompt,
        clip: ['1', 1],
      },
    },
    '4': isImg2Img
      ? {
          class_type: 'LoadImage',
          inputs: {
            image: uploadedInitFilename,
          },
        }
      : {
          class_type: 'EmptyLatentImage',
          inputs: {
            width,
            height,
            batch_size: batchSize,
          },
        },
    ...(isImg2Img
      ? {
          '5': {
            class_type: 'VAEEncode',
            inputs: {
              pixels: ['4', 0],
              vae: ['1', 2],
            },
          },
        }
      : {}),
    '6': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler: 'normal',
        denoise: isImg2Img
          ? Math.max(0.01, Math.min(1, Number(params.denoisingStrength ?? 0.65)))
          : 1.0,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: isImg2Img ? ['5', 0] : ['4', 0],
      },
    },
    '7': {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['6', 0],
        vae: ['1', 2],
      },
    },
    '8': {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: 'uip_generated',
        images: ['7', 0],
      },
    },
  };

  return graph;
}

function replaceComfyTokensInValue(
  value: unknown,
  tokens: Record<string, string | number>
): unknown {
  if (typeof value === 'string') {
    const exactMatch = value.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    if (exactMatch && exactMatch[1] in tokens) {
      return tokens[exactMatch[1]];
    }
    return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_full, key: string) => {
      if (key in tokens) return String(tokens[key]);
      return _full;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceComfyTokensInValue(item, tokens));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = replaceComfyTokensInValue(v, tokens);
    }
    return out;
  }
  return value;
}

export function buildComfyPromptPayload(options: {
  params: ImageGenRequestParams;
  model: string;
  customWorkflowTemplate?: string;
  uploadedInitFilename?: string;
  clientId?: string;
}): { prompt: Record<string, unknown>; client_id: string; resolvedSeed: number } {
  const resolvedSeed = resolveConcreteSeed(options.params.seed);
  const effectiveParams: ImageGenRequestParams = {
    ...options.params,
    seed: resolvedSeed,
  };
  const clientId = options.clientId || `uip-${Date.now().toString(36)}`;
  const trimmedTemplate = (options.customWorkflowTemplate || '').trim();

  if (trimmedTemplate) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedTemplate);
    } catch {
      throw new Error('Custom ComfyUI Workflow JSON is invalid JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Custom ComfyUI Workflow JSON must be an object.');
    }

    const baseWorkflow =
      'prompt' in (parsed as Record<string, unknown>) &&
      typeof (parsed as Record<string, unknown>).prompt === 'object' &&
      (parsed as Record<string, unknown>).prompt !== null
        ? (parsed as Record<string, unknown>).prompt
        : parsed;

    const tokens: Record<string, string | number> = {
      prompt: effectiveParams.prompt,
      negative_prompt: effectiveParams.negativePrompt,
      width: clampDimension(effectiveParams.width),
      height: clampDimension(effectiveParams.height),
      steps: Math.max(1, Math.round(effectiveParams.steps || 24)),
      cfg: Number(effectiveParams.cfgScale ?? 7),
      seed: resolvedSeed,
      batch_size: Math.max(1, Math.round(effectiveParams.batchCount || 1)),
      sampler: effectiveParams.sampler || 'euler',
      model: options.model.trim(),
      denoise:
        effectiveParams.mode === 'img2img'
          ? Math.max(0.01, Math.min(1, Number(effectiveParams.denoisingStrength ?? 0.65)))
          : 1.0,
      init_image: options.uploadedInitFilename || '',
    };

    const hydrated = replaceComfyTokensInValue(baseWorkflow, tokens) as Record<
      string,
      unknown
    >;
    return {
      prompt: hydrated,
      client_id: clientId,
      resolvedSeed,
    };
  }

  return {
    prompt: buildDefaultComfyPromptGraph({
      params: effectiveParams,
      model: options.model,
      uploadedInitFilename: options.uploadedInitFilename,
    }),
    client_id: clientId,
    resolvedSeed,
  };
}

export interface ComfyOutputImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

export function extractComfyHistoryImages(
  historyPayload: unknown,
  promptId: string
): {
  completed: boolean;
  error?: string;
  images: ComfyOutputImageRef[];
} {
  if (!historyPayload || typeof historyPayload !== 'object') {
    return { completed: false, images: [] };
  }

  const root = historyPayload as Record<string, any>;
  const entry = root[promptId] ?? (root.outputs || root.status ? root : null);
  if (!entry || typeof entry !== 'object') {
    return { completed: false, images: [] };
  }

  const statusObj = entry.status;
  if (statusObj?.status_str === 'error') {
    const messages = Array.isArray(statusObj.messages) ? statusObj.messages : [];
    const errDetail = messages
      .map((m: unknown) => (Array.isArray(m) ? JSON.stringify(m[1] ?? m[0]) : String(m)))
      .join(' ');
    return {
      completed: true,
      error: errDetail || 'ComfyUI execution failed.',
      images: [],
    };
  }

  const images: ComfyOutputImageRef[] = [];
  const outputs = entry.outputs;
  if (outputs && typeof outputs === 'object') {
    for (const nodeOutput of Object.values(outputs as Record<string, any>)) {
      if (!nodeOutput || typeof nodeOutput !== 'object') continue;
      if (Array.isArray(nodeOutput.images)) {
        for (const img of nodeOutput.images) {
          if (!img || typeof img !== 'object' || !img.filename) continue;
          images.push({
            filename: String(img.filename),
            subfolder: String(img.subfolder || ''),
            type: String(img.type || 'output'),
          });
        }
      }
    }
  }

  const completed = Boolean(statusObj?.completed) || images.length > 0;
  return { completed, images };
}

export function extractImagesFromA1111Response(payload: unknown): {
  images: string[];
  seed?: number;
} {
  const rec = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;
  const rawImages = Array.isArray(rec.images) ? rec.images : [];
  const images = rawImages
    .map((item) => (typeof item === 'string' ? ensureImageDataUrl(item) : ''))
    .filter(Boolean);

  let seed: number | undefined;
  if (typeof rec.info === 'string') {
    try {
      const infoJson = JSON.parse(rec.info);
      if (typeof infoJson?.seed === 'number') {
        seed = infoJson.seed;
      }
    } catch {
      // ignore non-json info
    }
  }
  return { images, seed };
}

export function extractImagesFromOpenAiResponse(payload: unknown): string[] {
  const rec = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;
  const dataList = Array.isArray(rec.data) ? rec.data : [];
  const out: string[] = [];
  for (const item of dataList) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.b64_json === 'string' && entry.b64_json.trim()) {
      out.push(ensureImageDataUrl(entry.b64_json));
    } else if (typeof entry.url === 'string' && entry.url.trim()) {
      out.push(entry.url.trim());
    }
  }
  return out;
}

export function extractImagesFromCustomRestResponse(payload: unknown): {
  images: string[];
  seed?: number;
} {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return { images: [] };
    return { images: [ensureImageDataUrl(trimmed)] };
  }

  if (Array.isArray(payload)) {
    const out: string[] = [];
    for (const item of payload) {
      out.push(...extractImagesFromCustomRestResponse(item).images);
    }
    return { images: out };
  }

  if (!payload || typeof payload !== 'object') {
    return { images: [] };
  }

  const rec = payload as Record<string, unknown>;
  const out: string[] = [];

  if (Array.isArray(rec.data)) {
    out.push(...extractImagesFromOpenAiResponse(rec));
  }
  if (Array.isArray(rec.images)) {
    for (const item of rec.images) {
      if (typeof item === 'string' && item.trim()) {
        out.push(ensureImageDataUrl(item));
      } else if (item && typeof item === 'object') {
        const sub = item as Record<string, unknown>;
        const raw =
          (typeof sub.b64_json === 'string' && sub.b64_json) ||
          (typeof sub.base64 === 'string' && sub.base64) ||
          (typeof sub.image === 'string' && sub.image) ||
          (typeof sub.url === 'string' && sub.url) ||
          '';
        if (raw) out.push(ensureImageDataUrl(raw));
      }
    }
  }
  if (Array.isArray(rec.output)) {
    for (const item of rec.output) {
      if (typeof item === 'string' && item.trim()) {
        out.push(ensureImageDataUrl(item));
      }
    }
  }

  const singleFields = ['image', 'image_base64', 'b64_json', 'result', 'url'];
  for (const key of singleFields) {
    const val = rec[key];
    if (typeof val === 'string' && val.trim()) {
      out.push(ensureImageDataUrl(val));
    }
  }

  const seed =
    typeof rec.seed === 'number'
      ? rec.seed
      : typeof rec.actual_seed === 'number'
        ? rec.actual_seed
        : undefined;

  return {
    images: Array.from(new Set(out.filter(Boolean))),
    seed,
  };
}

export function generatedArtifactToScrapedImage(
  artifact: GeneratedImageArtifact
): ScrapedImage {
  const shortSlug = artifact.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  const filename = `${shortSlug || 'generated'}-${artifact.seed}.png`;
  return {
    id: artifact.id,
    thumbnailUrl: artifact.dataUrl,
    fullUrl: artifact.dataUrl,
    altText: artifact.prompt,
    filename,
    format: 'png',
    isUnshrunk: true,
    unshrinkMethod: `Local AI (${artifact.backend})`,
    resolutionTier: classifyResolution(artifact.width, artifact.height),
    width: artifact.width,
    height: artifact.height,
  };
}
