/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  buildA1111Payload,
  buildComfyPromptPayload,
  buildCustomRestPayload,
  buildOpenAiImagesPayload,
  clampDimension,
  DEFAULT_SAMPLERS_BY_BACKEND,
  DiscoveredImageGenModel,
  extractComfyHistoryImages,
  extractImagesFromA1111Response,
  extractImagesFromCustomRestResponse,
  extractImagesFromOpenAiResponse,
  GeneratedImageArtifact,
  ImageGenBackendType,
  ImageGenEndpointSettings,
  ImageGenRequestParams,
  parseA1111Models,
  parseA1111Samplers,
  parseComfyModels,
  parseOpenAiImageModels,
  resolveConcreteSeed,
  resolveImageGenTransport,
  sanitizeCustomEndpointPath,
  stripDataUrlPrefix,
  validateImageGenEndpointUrl,
} from './localImageGenConfig';

export interface ImageGenDiscoveryResult {
  ok: boolean;
  models: DiscoveredImageGenModel[];
  samplers: string[];
  resolvedTransport: 'browser-direct' | 'server-proxy';
  normalizedBaseUrl?: string;
  error?: string;
}

export interface ImageGenProgressCallbacks {
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
  onProgress?: (fraction: number) => void;
}

function formatDirectBrowserConnectionError(
  err: unknown,
  backend: ImageGenBackendType,
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
    if (backend === 'comfyui') {
      return `Could not reach ComfyUI at ${targetUrl} from your browser (check that the server is running and CORS is enabled, e.g. --enable-cors-header).`;
    }
    if (backend === 'a1111') {
      return `Could not reach WebUI at ${targetUrl} from your browser (check --api and --cors-allow-origins flags).`;
    }
    return `Could not reach ${targetUrl} from your browser. Verify the server is running and allows browser origin requests (CORS), or switch routing to Server Proxy for remote hosts.`;
  }
  return msg;
}

async function discoverModelsDirectBrowser(
  backend: ImageGenBackendType,
  baseUrl: string,
  signal?: AbortSignal
): Promise<ImageGenDiscoveryResult> {
  try {
    if (backend === 'a1111') {
      const targetUrl = `${baseUrl}/sdapi/v1/sd-models`;
      const [modelsResp, samplersResp] = await Promise.all([
        fetch(targetUrl, {
          headers: { Accept: 'application/json' },
          signal: signal ?? AbortSignal.timeout(8000),
        }),
        fetch(`${baseUrl}/sdapi/v1/samplers`, {
          headers: { Accept: 'application/json' },
          signal: signal ?? AbortSignal.timeout(6000),
        }).catch(() => null),
      ]);

      if (!modelsResp.ok) {
        const txt = await modelsResp.text().catch(() => '');
        return {
          ok: false,
          models: [],
          samplers: DEFAULT_SAMPLERS_BY_BACKEND.a1111,
          resolvedTransport: 'browser-direct',
          normalizedBaseUrl: baseUrl,
          error: `HTTP ${modelsResp.status} from ${targetUrl}${txt ? `: ${txt.slice(0, 140)}` : ''}`,
        };
      }

      const modelsJson = await modelsResp.json();
      const samplersJson =
        samplersResp && samplersResp.ok ? await samplersResp.json().catch(() => []) : [];
      const parsedSamplers = parseA1111Samplers(samplersJson);
      return {
        ok: true,
        models: parseA1111Models(modelsJson),
        samplers:
          parsedSamplers.length > 0 ? parsedSamplers : DEFAULT_SAMPLERS_BY_BACKEND.a1111,
        resolvedTransport: 'browser-direct',
        normalizedBaseUrl: baseUrl,
      };
    }

    if (backend === 'comfyui') {
      const targetUrl = `${baseUrl}/object_info/CheckpointLoaderSimple`;
      const [ckptResp, ksamplerResp] = await Promise.all([
        fetch(targetUrl, {
          headers: { Accept: 'application/json' },
          signal: signal ?? AbortSignal.timeout(8000),
        }),
        fetch(`${baseUrl}/object_info/KSampler`, {
          headers: { Accept: 'application/json' },
          signal: signal ?? AbortSignal.timeout(6000),
        }).catch(() => null),
      ]);

      if (!ckptResp.ok) {
        const txt = await ckptResp.text().catch(() => '');
        return {
          ok: false,
          models: [],
          samplers: DEFAULT_SAMPLERS_BY_BACKEND.comfyui,
          resolvedTransport: 'browser-direct',
          normalizedBaseUrl: baseUrl,
          error: `HTTP ${ckptResp.status} from ${targetUrl}${txt ? `: ${txt.slice(0, 140)}` : ''}`,
        };
      }

      const ckptInfo = await ckptResp.json().catch(() => ({}));
      const samplerInfo =
        ksamplerResp && ksamplerResp.ok ? await ksamplerResp.json().catch(() => ({})) : {};
      const parsed = parseComfyModels({ ...ckptInfo, ...samplerInfo });

      // Fallback probe UNETLoader if CheckpointLoaderSimple returned 0 models (common on Flux/MOSS custom ComfyUI setups)
      let models = parsed.models;
      if (models.length === 0) {
        const unetResp = await fetch(`${baseUrl}/object_info/UNETLoader`, {
          headers: { Accept: 'application/json' },
          signal: signal ?? AbortSignal.timeout(5000),
        }).catch(() => null);
        if (unetResp && unetResp.ok) {
          const unetInfo = await unetResp.json().catch(() => ({}));
          models = parseComfyModels(unetInfo).models;
        }
      }

      return {
        ok: true,
        models,
        samplers:
          parsed.samplers.length > 0 ? parsed.samplers : DEFAULT_SAMPLERS_BY_BACKEND.comfyui,
        resolvedTransport: 'browser-direct',
        normalizedBaseUrl: baseUrl,
      };
    }

    // openai-images or custom-rest
    const targetUrl = `${baseUrl}/models`;
    const resp = await fetch(targetUrl, {
      headers: { Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return {
        ok: false,
        models: [],
        samplers: DEFAULT_SAMPLERS_BY_BACKEND[backend],
        resolvedTransport: 'browser-direct',
        normalizedBaseUrl: baseUrl,
        error: `HTTP ${resp.status} from ${targetUrl}${txt ? `: ${txt.slice(0, 140)}` : ''}`,
      };
    }
    const json = await resp.json();
    return {
      ok: true,
      models: parseOpenAiImageModels(json),
      samplers: DEFAULT_SAMPLERS_BY_BACKEND[backend],
      resolvedTransport: 'browser-direct',
      normalizedBaseUrl: baseUrl,
    };
  } catch (err) {
    return {
      ok: false,
      models: [],
      samplers: DEFAULT_SAMPLERS_BY_BACKEND[backend],
      resolvedTransport: 'browser-direct',
      normalizedBaseUrl: baseUrl,
      error: formatDirectBrowserConnectionError(err, backend, baseUrl),
    };
  }
}

export async function discoverImageGenModels(
  settings: ImageGenEndpointSettings,
  signal?: AbortSignal
): Promise<ImageGenDiscoveryResult> {
  const validation = validateImageGenEndpointUrl(settings.baseUrl, settings.backend);
  if (!validation.ok) {
    return {
      ok: false,
      models: [],
      samplers: DEFAULT_SAMPLERS_BY_BACKEND[settings.backend],
      resolvedTransport: 'browser-direct',
      error: validation.error,
    };
  }

  const baseUrl = validation.normalizedUrl;
  const transport = resolveImageGenTransport({
    transport: settings.transport,
    baseUrl,
  });

  if (transport === 'browser-direct') {
    return discoverModelsDirectBrowser(settings.backend, baseUrl, signal);
  }

  try {
    const resp = await fetch('/api/ai/local-image-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'models',
        backend: settings.backend,
        baseUrl,
      }),
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      if (settings.transport === 'auto') {
        const fallback = await discoverModelsDirectBrowser(settings.backend, baseUrl, signal);
        if (fallback.ok) return fallback;
      }
      return {
        ok: false,
        models: [],
        samplers: DEFAULT_SAMPLERS_BY_BACKEND[settings.backend],
        resolvedTransport: 'server-proxy',
        normalizedBaseUrl: baseUrl,
        error: data?.error || `HTTP ${resp.status} from server proxy`,
      };
    }

    if (settings.backend === 'a1111') {
      const parsedSamplers = parseA1111Samplers(data?.samplers);
      return {
        ok: true,
        models: parseA1111Models(data?.models),
        samplers:
          parsedSamplers.length > 0 ? parsedSamplers : DEFAULT_SAMPLERS_BY_BACKEND.a1111,
        resolvedTransport: 'server-proxy',
        normalizedBaseUrl: baseUrl,
      };
    }

    if (settings.backend === 'comfyui') {
      const parsed = parseComfyModels(data?.objectInfo || data);
      return {
        ok: true,
        models: parsed.models,
        samplers:
          parsed.samplers.length > 0 ? parsed.samplers : DEFAULT_SAMPLERS_BY_BACKEND.comfyui,
        resolvedTransport: 'server-proxy',
        normalizedBaseUrl: baseUrl,
      };
    }

    return {
      ok: true,
      models: parseOpenAiImageModels(data),
      samplers: DEFAULT_SAMPLERS_BY_BACKEND[settings.backend],
      resolvedTransport: 'server-proxy',
      normalizedBaseUrl: baseUrl,
    };
  } catch (err: any) {
    if (settings.transport === 'auto') {
      const fallback = await discoverModelsDirectBrowser(settings.backend, baseUrl, signal);
      if (fallback.ok) return fallback;
    }
    return {
      ok: false,
      models: [],
      samplers: DEFAULT_SAMPLERS_BY_BACKEND[settings.backend],
      resolvedTransport: 'server-proxy',
      normalizedBaseUrl: baseUrl,
      error: err?.message || 'Failed to discover models.',
    };
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const b64 = btoa(binary);
  const mime = (blob.type || 'image/png').split(';')[0] || 'image/png';
  return `data:${mime};base64,${b64}`;
}

async function ensureDisplayableDataUrl(urlOrDataUrl: string): Promise<string> {
  if (urlOrDataUrl.startsWith('data:image/')) {
    return urlOrDataUrl;
  }
  if (/^https?:\/\//i.test(urlOrDataUrl)) {
    try {
      const direct = await fetch(urlOrDataUrl);
      if (direct.ok) {
        return await blobToDataUrl(await direct.blob());
      }
    } catch {
      // Fallback via app proxy for CORS-restricted URLs
    }
    try {
      const proxied = await fetch(`/api/proxy?url=${encodeURIComponent(urlOrDataUrl)}`);
      if (proxied.ok) {
        return await blobToDataUrl(await proxied.blob());
      }
    } catch {
      // Keep original URL if proxy also fails
    }
  }
  return urlOrDataUrl;
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const ext =
    mime.includes('jpeg') || mime.includes('jpg')
      ? 'jpg'
      : mime.includes('webp')
        ? 'webp'
        : 'png';
  const b64 = stripDataUrlPrefix(dataUrl);
  const binStr = atob(b64);
  const len = binStr.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = binStr.charCodeAt(i);
  }
  return { blob: new Blob([arr], { type: mime }), ext };
}

export async function generateImagesWithLocalBackend(
  settings: ImageGenEndpointSettings,
  params: ImageGenRequestParams,
  callbacks: ImageGenProgressCallbacks = {}
): Promise<GeneratedImageArtifact[]> {
  const promptTrimmed = params.prompt.trim();
  if (!promptTrimmed) {
    throw new Error('Enter a prompt to generate an image.');
  }

  const validation = validateImageGenEndpointUrl(settings.baseUrl, settings.backend);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const baseUrl = validation.normalizedUrl;
  const transport = resolveImageGenTransport({
    transport: settings.transport,
    baseUrl,
  });

  const startedAt = Date.now();
  const concreteSeed = resolveConcreteSeed(params.seed);
  const effectiveParams: ImageGenRequestParams = {
    ...params,
    prompt: promptTrimmed,
    width: clampDimension(params.width),
    height: clampDimension(params.height),
    seed: concreteSeed,
  };

  const makeArtifacts = async (
    rawUrls: string[],
    resolvedSeed?: number
  ): Promise<GeneratedImageArtifact[]> => {
    const dataUrls = await Promise.all(rawUrls.map((u) => ensureDisplayableDataUrl(u)));
    const elapsed = Math.max(1, Date.now() - startedAt);
    const seedVal = resolvedSeed ?? concreteSeed;
    return dataUrls.map((dataUrl, idx) => ({
      id: `gen-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      dataUrl,
      width: effectiveParams.width,
      height: effectiveParams.height,
      seed: seedVal + idx,
      prompt: effectiveParams.prompt,
      negativePrompt: effectiveParams.negativePrompt,
      model: settings.model || settings.backend,
      backend: settings.backend,
      steps: effectiveParams.steps,
      cfgScale: effectiveParams.cfgScale,
      sampler: effectiveParams.sampler,
      mode: effectiveParams.mode,
      durationMs: elapsed,
      createdAt: Date.now(),
      ...(effectiveParams.mode === 'img2img' && effectiveParams.initImageDataUrl
        ? { sourceInitDataUrl: effectiveParams.initImageDataUrl }
        : {}),
    }));
  };

  // ---------------- Automatic1111 / Forge / SD.Next ----------------
  if (settings.backend === 'a1111') {
    const isImg2Img =
      effectiveParams.mode === 'img2img' && Boolean(effectiveParams.initImageDataUrl);
    const payload = buildA1111Payload(effectiveParams, settings.model);

    callbacks.onStatus?.(
      isImg2Img ? 'Running Img2Img diffusion pass...' : 'Generating with SD WebUI...'
    );
    callbacks.onProgress?.(0.08);

    // Optional live progress polling during generation
    let pollingActive = true;
    const pollLoop = (async () => {
      while (pollingActive && !callbacks.signal?.aborted) {
        await sleepAbortable(750, callbacks.signal).catch(() => {});
        if (!pollingActive || callbacks.signal?.aborted) break;
        try {
          const progResp =
            transport === 'browser-direct'
              ? await fetch(`${baseUrl}/sdapi/v1/progress?skip_current_image=true`, {
                  signal: callbacks.signal,
                })
              : await fetch('/api/ai/local-image-gen', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'a1111-progress',
                    backend: 'a1111',
                    baseUrl,
                  }),
                  signal: callbacks.signal,
                });
          if (progResp.ok) {
            const progData = await progResp.json().catch(() => null);
            if (typeof progData?.progress === 'number' && progData.progress > 0) {
              callbacks.onProgress?.(Math.min(0.96, Math.max(0.08, progData.progress)));
            }
          }
        } catch {
          // ignore progress poll hiccups
        }
      }
    })();

    try {
      let respJson: any;
      if (transport === 'browser-direct') {
        const endpoint = isImg2Img
          ? `${baseUrl}/sdapi/v1/img2img`
          : `${baseUrl}/sdapi/v1/txt2img`;
        let resp: Response;
        try {
          resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: callbacks.signal,
          });
        } catch (err: any) {
          if (err?.name === 'AbortError') throw err;
          throw new Error(formatDirectBrowserConnectionError(err, 'a1111', endpoint));
        }
        if (!resp.ok) {
          const errTxt = await resp.text().catch(() => '');
          throw new Error(
            `WebUI returned HTTP ${resp.status}${errTxt ? `: ${errTxt.slice(0, 220)}` : ''}`
          );
        }
        respJson = await resp.json();
      } else {
        const resp = await fetch('/api/ai/local-image-gen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'generate',
            backend: 'a1111',
            baseUrl,
            model: settings.model,
            params: effectiveParams,
          }),
          signal: callbacks.signal,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(data?.error || `HTTP ${resp.status} from image generation proxy`);
        }
        respJson = data;
      }

      const extracted = extractImagesFromA1111Response(respJson);
      if (extracted.images.length === 0) {
        throw new Error('The WebUI endpoint completed without returning any image data.');
      }
      callbacks.onProgress?.(1);
      return await makeArtifacts(extracted.images, extracted.seed);
    } finally {
      pollingActive = false;
      void pollLoop;
    }
  }

  // ---------------- ComfyUI API ----------------
  if (settings.backend === 'comfyui') {
    let uploadedInitFilename: string | undefined;
    if (effectiveParams.mode === 'img2img' && effectiveParams.initImageDataUrl) {
      callbacks.onStatus?.('Uploading reference image to ComfyUI...');
      callbacks.onProgress?.(0.1);
      if (transport === 'browser-direct') {
        const { blob, ext } = dataUrlToBlob(effectiveParams.initImageDataUrl);
        const form = new FormData();
        form.append('image', blob, `uip-init-${Date.now()}.${ext}`);
        form.append('overwrite', 'true');
        const upResp = await fetch(`${baseUrl}/upload/image`, {
          method: 'POST',
          body: form,
          signal: callbacks.signal,
        });
        if (!upResp.ok) {
          throw new Error(`ComfyUI image upload failed (HTTP ${upResp.status})`);
        }
        const upJson = await upResp.json();
        uploadedInitFilename = upJson?.name || upJson?.filename;
      } else {
        const upResp = await fetch('/api/ai/local-image-gen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'comfy-upload',
            backend: 'comfyui',
            baseUrl,
            initImageDataUrl: effectiveParams.initImageDataUrl,
          }),
          signal: callbacks.signal,
        });
        const upJson = await upResp.json().catch(() => ({}));
        if (!upResp.ok) {
          throw new Error(upJson?.error || `ComfyUI upload failed (HTTP ${upResp.status})`);
        }
        uploadedInitFilename = upJson?.name || upJson?.filename;
      }
    }

    callbacks.onStatus?.('Queueing ComfyUI workflow...');
    callbacks.onProgress?.(0.2);

    let promptId = '';
    let resolvedSeed = concreteSeed;

    if (transport === 'browser-direct') {
      const comfyPayload = buildComfyPromptPayload({
        params: effectiveParams,
        model: settings.model,
        customWorkflowTemplate: settings.comfyWorkflowTemplate,
        uploadedInitFilename,
      });
      resolvedSeed = comfyPayload.resolvedSeed;

      let queueResp: Response;
      try {
        queueResp = await fetch(`${baseUrl}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: comfyPayload.prompt,
            client_id: comfyPayload.client_id,
          }),
          signal: callbacks.signal,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        throw new Error(formatDirectBrowserConnectionError(err, 'comfyui', `${baseUrl}/prompt`));
      }
      if (!queueResp.ok) {
        const errTxt = await queueResp.text().catch(() => '');
        throw new Error(
          `ComfyUI rejected workflow (HTTP ${queueResp.status})${errTxt ? `: ${errTxt.slice(0, 220)}` : ''}`
        );
      }
      const qJson = await queueResp.json();
      promptId = String(qJson?.prompt_id || '').trim();
    } else {
      const queueResp = await fetch('/api/ai/local-image-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          backend: 'comfyui',
          baseUrl,
          model: settings.model,
          comfyWorkflowTemplate: settings.comfyWorkflowTemplate,
          uploadedInitFilename,
          params: effectiveParams,
        }),
        signal: callbacks.signal,
      });
      const qJson = await queueResp.json().catch(() => ({}));
      if (!queueResp.ok) {
        throw new Error(qJson?.error || `ComfyUI proxy error (HTTP ${queueResp.status})`);
      }
      promptId = String(qJson?.prompt_id || '').trim();
      if (typeof qJson?.resolvedSeed === 'number') {
        resolvedSeed = qJson.resolvedSeed;
      }
    }

    if (!promptId) {
      throw new Error('ComfyUI did not return a prompt_id.');
    }

    callbacks.onStatus?.('Executing nodes on ComfyUI...');
    const maxAttempts = 240; // ~4 minutes at 1s/poll
    let outputRefs: { filename: string; subfolder: string; type: string }[] = [];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (callbacks.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const histJson =
        transport === 'browser-direct'
          ? await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
              signal: callbacks.signal,
            }).then((r) => (r.ok ? r.json() : {}))
          : await fetch('/api/ai/local-image-gen', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'comfy-history',
                backend: 'comfyui',
                baseUrl,
                promptId,
              }),
              signal: callbacks.signal,
            }).then((r) => (r.ok ? r.json() : {}));

      const parsedHist = extractComfyHistoryImages(histJson, promptId);
      if (parsedHist.error) {
        throw new Error(parsedHist.error);
      }
      if (parsedHist.completed && parsedHist.images.length > 0) {
        outputRefs = parsedHist.images;
        break;
      }

      callbacks.onProgress?.(Math.min(0.9, 0.22 + attempt * 0.015));
      await sleepAbortable(900, callbacks.signal);
    }

    if (outputRefs.length === 0) {
      throw new Error('Timed out waiting for ComfyUI workflow outputs.');
    }

    callbacks.onStatus?.(`Fetching ${outputRefs.length} output image${outputRefs.length === 1 ? '' : 's'}...`);
    const resolvedDataUrls: string[] = [];

    for (const ref of outputRefs) {
      if (transport === 'browser-direct') {
        const qs = new URLSearchParams({
          filename: ref.filename,
          subfolder: ref.subfolder,
          type: ref.type,
        });
        const imgResp = await fetch(`${baseUrl}/view?${qs.toString()}`, {
          signal: callbacks.signal,
        });
        if (!imgResp.ok) {
          throw new Error(`Failed to fetch ComfyUI output ${ref.filename}`);
        }
        resolvedDataUrls.push(await blobToDataUrl(await imgResp.blob()));
      } else {
        const imgResp = await fetch('/api/ai/local-image-gen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'comfy-view',
            backend: 'comfyui',
            baseUrl,
            filename: ref.filename,
            subfolder: ref.subfolder,
            type: ref.type,
          }),
          signal: callbacks.signal,
        });
        const imgJson = await imgResp.json().catch(() => ({}));
        if (!imgResp.ok || !imgJson?.dataUrl) {
          throw new Error(imgJson?.error || `Failed to load output ${ref.filename}`);
        }
        resolvedDataUrls.push(String(imgJson.dataUrl));
      }
    }

    callbacks.onProgress?.(1);
    return await makeArtifacts(resolvedDataUrls, resolvedSeed);
  }

  // ---------------- OpenAI Images API (/images/generations) ----------------
  if (settings.backend === 'openai-images') {
    callbacks.onStatus?.('Generating via OpenAI-compatible Images API...');
    callbacks.onProgress?.(0.25);

    const payload = buildOpenAiImagesPayload(effectiveParams, settings.model);
    let respJson: any;

    if (transport === 'browser-direct') {
      const endpoint = `${baseUrl}/images/generations`;
      let resp: Response;
      try {
        resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: callbacks.signal,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') throw err;
        throw new Error(formatDirectBrowserConnectionError(err, 'openai-images', endpoint));
      }
      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => '');
        throw new Error(
          `Images endpoint returned HTTP ${resp.status}${errTxt ? `: ${errTxt.slice(0, 220)}` : ''}`
        );
      }
      respJson = await resp.json();
    } else {
      const resp = await fetch('/api/ai/local-image-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          backend: 'openai-images',
          baseUrl,
          model: settings.model,
          params: effectiveParams,
        }),
        signal: callbacks.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.error || `HTTP ${resp.status} from image generation proxy`);
      }
      respJson = data;
    }

    const images = extractImagesFromOpenAiResponse(respJson);
    if (images.length === 0) {
      throw new Error('The Images API completed without returning b64_json or url data.');
    }
    callbacks.onProgress?.(1);
    return await makeArtifacts(images, concreteSeed);
  }

  // ---------------- Custom REST (MOSS-Image / Diffusers / Custom API) ----------------
  callbacks.onStatus?.('Generating via custom local model API...');
  callbacks.onProgress?.(0.25);

  const customPath = sanitizeCustomEndpointPath(settings.customEndpointPath);
  const payload = buildCustomRestPayload(effectiveParams, settings.model);

  if (transport === 'browser-direct') {
    const endpoint = `${baseUrl}${customPath}`;
    let resp: Response;
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: callbacks.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      throw new Error(formatDirectBrowserConnectionError(err, 'custom-rest', endpoint));
    }

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => '');
      throw new Error(
        `Endpoint returned HTTP ${resp.status}${errTxt ? `: ${errTxt.slice(0, 220)}` : ''}`
      );
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('image/')) {
      const dataUrl = await blobToDataUrl(await resp.blob());
      callbacks.onProgress?.(1);
      return await makeArtifacts([dataUrl], concreteSeed);
    }

    const json = await resp.json();
    const extracted = extractImagesFromCustomRestResponse(json);
    if (extracted.images.length === 0) {
      throw new Error(
        'Custom endpoint responded with JSON, but no image field (images/image/data/output) was found.'
      );
    }
    callbacks.onProgress?.(1);
    return await makeArtifacts(extracted.images, extracted.seed ?? concreteSeed);
  }

  const proxyResp = await fetch('/api/ai/local-image-gen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'generate',
      backend: 'custom-rest',
      baseUrl,
      customEndpointPath: customPath,
      model: settings.model,
      params: effectiveParams,
    }),
    signal: callbacks.signal,
  });

  const proxyJson = await proxyResp.json().catch(() => ({}));
  if (!proxyResp.ok) {
    throw new Error(proxyJson?.error || `HTTP ${proxyResp.status} from image generation proxy`);
  }

  const extracted = extractImagesFromCustomRestResponse(proxyJson);
  if (extracted.images.length === 0) {
    throw new Error('Custom endpoint completed without returning any image output.');
  }
  callbacks.onProgress?.(1);
  return await makeArtifacts(extracted.images, extracted.seed ?? concreteSeed);
}
