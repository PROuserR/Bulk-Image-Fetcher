/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { isPrivateOrLinkLocalHostname } from '@/utils/customLlmConfig';
import {
  buildA1111Payload,
  buildComfyPromptPayload,
  buildCustomRestPayload,
  buildOpenAiImagesPayload,
  ImageGenBackendType,
  ImageGenRequestParams,
  sanitizeCustomEndpointPath,
  stripDataUrlPrefix,
  validateImageGenEndpointUrl,
} from '@/utils/localImageGenConfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPrivateIpAddress(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '');
  if (net.isIPv4(clean)) {
    return isPrivateOrLinkLocalHostname(clean);
  }
  if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80:')
    );
  }
  return false;
}

async function assertServerProxyAllowed(parsed: URL): Promise<void> {
  const allowLocal = process.env.ALLOW_LOCAL_LLM_PROXY === 'true';
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.goog' ||
    hostname === '100.100.100.200'
  ) {
    throw new Error('Metadata service endpoints are blocked.');
  }

  if (allowLocal) {
    return;
  }

  if (isPrivateOrLinkLocalHostname(hostname)) {
    throw new Error(
      'Localhost and private LAN endpoints are reached directly from your browser. Switch Connection Routing to "Browser Direct (Offline)" for local models.'
    );
  }

  try {
    const resolved = await dns.lookup(hostname, { all: true });
    for (const addr of resolved) {
      if (isPrivateIpAddress(addr.address)) {
        throw new Error(
          'Resolved host points to a private or loopback IP. Use "Browser Direct (Offline)" for local networks.'
        );
      }
    }
  } catch (err: any) {
    if (err?.message?.includes('private') || err?.message?.includes('loopback')) {
      throw err;
    }
  }
}

function buildOptionalServerAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const serverApiKey = (process.env.CUSTOM_IMAGE_GEN_API_KEY || '').trim();
  if (serverApiKey) {
    headers.Authorization = `Bearer ${serverApiKey}`;
  }
  return headers;
}

function normalizeBackend(raw: unknown): ImageGenBackendType {
  if (
    raw === 'a1111' ||
    raw === 'comfyui' ||
    raw === 'openai-images' ||
    raw === 'custom-rest'
  ) {
    return raw;
  }
  return 'a1111';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || 'generate');
    const backend = normalizeBackend(body?.backend);

    const validation = validateImageGenEndpointUrl(String(body?.baseUrl || ''), backend);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    try {
      await assertServerProxyAllowed(validation.parsed);
    } catch (policyErr: any) {
      return NextResponse.json(
        { error: policyErr?.message || 'Endpoint blocked by server proxy policy.' },
        { status: 403 }
      );
    }

    const baseUrl = validation.normalizedUrl;
    const optionalAuth = buildOptionalServerAuthHeaders();

    if (action === 'models') {
      if (backend === 'a1111') {
        const [modelsResp, samplersResp] = await Promise.all([
          fetch(`${baseUrl}/sdapi/v1/sd-models`, {
            headers: { Accept: 'application/json', ...optionalAuth },
            signal: req.signal ?? AbortSignal.timeout(10_000),
          }),
          fetch(`${baseUrl}/sdapi/v1/samplers`, {
            headers: { Accept: 'application/json', ...optionalAuth },
            signal: req.signal ?? AbortSignal.timeout(10_000),
          }).catch(() => null),
        ]);

        if (!modelsResp.ok) {
          const text = await modelsResp.text().catch(() => '');
          return NextResponse.json(
            {
              error: `Upstream WebUI returned HTTP ${modelsResp.status}: ${text.slice(0, 220) || modelsResp.statusText}`,
            },
            { status: modelsResp.status >= 400 && modelsResp.status < 600 ? modelsResp.status : 502 }
          );
        }

        const models = await modelsResp.json();
        const samplers =
          samplersResp && samplersResp.ok ? await samplersResp.json().catch(() => []) : [];
        return NextResponse.json({ models, samplers });
      }

      if (backend === 'comfyui') {
        const [ckptResp, ksamplerResp] = await Promise.all([
          fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`, {
            headers: { Accept: 'application/json', ...optionalAuth },
            signal: req.signal ?? AbortSignal.timeout(10_000),
          }),
          fetch(`${baseUrl}/object_info/KSampler`, {
            headers: { Accept: 'application/json', ...optionalAuth },
            signal: req.signal ?? AbortSignal.timeout(10_000),
          }).catch(() => null),
        ]);

        if (!ckptResp.ok) {
          const text = await ckptResp.text().catch(() => '');
          return NextResponse.json(
            {
              error: `ComfyUI returned HTTP ${ckptResp.status}: ${text.slice(0, 220) || ckptResp.statusText}`,
            },
            { status: ckptResp.status >= 400 && ckptResp.status < 600 ? ckptResp.status : 502 }
          );
        }

        const ckptInfo = await ckptResp.json().catch(() => ({}));
        const samplerInfo =
          ksamplerResp && ksamplerResp.ok ? await ksamplerResp.json().catch(() => ({})) : {};
        return NextResponse.json({
          objectInfo: {
            ...ckptInfo,
            ...samplerInfo,
          },
        });
      }

      // openai-images or custom-rest
      const targetUrl =
        backend === 'openai-images' ? `${baseUrl}/models` : `${baseUrl}/models`;
      const modelsResp = await fetch(targetUrl, {
        headers: { Accept: 'application/json', ...optionalAuth },
        signal: req.signal ?? AbortSignal.timeout(10_000),
      });

      if (!modelsResp.ok) {
        const text = await modelsResp.text().catch(() => '');
        return NextResponse.json(
          {
            error: `Upstream endpoint returned HTTP ${modelsResp.status}: ${text.slice(0, 220) || modelsResp.statusText}`,
          },
          { status: modelsResp.status >= 400 && modelsResp.status < 600 ? modelsResp.status : 502 }
        );
      }
      const data = await modelsResp.json();
      return NextResponse.json(data);
    }

    if (action === 'a1111-progress' && backend === 'a1111') {
      const resp = await fetch(`${baseUrl}/sdapi/v1/progress?skip_current_image=true`, {
        headers: { Accept: 'application/json', ...optionalAuth },
        signal: req.signal ?? AbortSignal.timeout(5_000),
      });
      if (!resp.ok) {
        return NextResponse.json({ progress: 0 }, { status: 200 });
      }
      const data = await resp.json().catch(() => ({ progress: 0 }));
      return NextResponse.json(data);
    }

    if (action === 'comfy-upload' && backend === 'comfyui') {
      const initImageDataUrl = String(body?.initImageDataUrl || '').trim();
      if (!initImageDataUrl) {
        return NextResponse.json({ error: 'Init image data is required.' }, { status: 400 });
      }
      const b64 = stripDataUrlPrefix(initImageDataUrl);
      const mimeMatch = initImageDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
      const mime = mimeMatch ? mimeMatch[1] : 'image/png';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
      const bytes = Buffer.from(b64, 'base64');
      const form = new FormData();
      form.append('image', new Blob([bytes], { type: mime }), `uip-init-${Date.now()}.${ext}`);
      form.append('overwrite', 'true');

      const uploadResp = await fetch(`${baseUrl}/upload/image`, {
        method: 'POST',
        headers: { ...optionalAuth },
        body: form,
        signal: req.signal ?? AbortSignal.timeout(30_000),
      });
      if (!uploadResp.ok) {
        const errTxt = await uploadResp.text().catch(() => '');
        return NextResponse.json(
          { error: `ComfyUI upload failed (HTTP ${uploadResp.status}): ${errTxt.slice(0, 200)}` },
          { status: 502 }
        );
      }
      const uploadJson = await uploadResp.json();
      return NextResponse.json(uploadJson);
    }

    if (action === 'comfy-history' && backend === 'comfyui') {
      const promptId = String(body?.promptId || '').trim();
      if (!promptId || !/^[a-zA-Z0-9_-]{4,128}$/.test(promptId)) {
        return NextResponse.json({ error: 'Invalid ComfyUI promptId.' }, { status: 400 });
      }
      const histResp = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
        headers: { Accept: 'application/json', ...optionalAuth },
        signal: req.signal ?? AbortSignal.timeout(10_000),
      });
      if (!histResp.ok) {
        return NextResponse.json(
          { error: `ComfyUI history check failed (HTTP ${histResp.status})` },
          { status: 502 }
        );
      }
      const histJson = await histResp.json().catch(() => ({}));
      return NextResponse.json(histJson);
    }

    if (action === 'comfy-view' && backend === 'comfyui') {
      const filename = String(body?.filename || '').trim();
      const subfolder = String(body?.subfolder || '').trim();
      const type = String(body?.type || 'output').trim();
      if (!filename) {
        return NextResponse.json({ error: 'Filename is required.' }, { status: 400 });
      }
      const qs = new URLSearchParams({ filename, subfolder, type });
      const viewResp = await fetch(`${baseUrl}/view?${qs.toString()}`, {
        headers: { ...optionalAuth },
        signal: req.signal ?? AbortSignal.timeout(30_000),
      });
      if (!viewResp.ok) {
        return NextResponse.json(
          { error: `ComfyUI image view failed (HTTP ${viewResp.status})` },
          { status: 502 }
        );
      }
      const contentType = viewResp.headers.get('content-type') || 'image/png';
      const arrBuf = await viewResp.arrayBuffer();
      const b64 = Buffer.from(arrBuf).toString('base64');
      return NextResponse.json({
        dataUrl: `data:${contentType.split(';')[0]};base64,${b64}`,
      });
    }

    // Generate action
    const params = body?.params as ImageGenRequestParams | undefined;
    const model = String(body?.model || '').trim();
    if (!params || !String(params.prompt || '').trim()) {
      return NextResponse.json({ error: 'Generation prompt is required.' }, { status: 400 });
    }

    if (backend === 'a1111') {
      const isImg2Img = params.mode === 'img2img' && Boolean(params.initImageDataUrl);
      const endpoint = isImg2Img ? `${baseUrl}/sdapi/v1/img2img` : `${baseUrl}/sdapi/v1/txt2img`;
      const payload = buildA1111Payload(params, model);
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...optionalAuth },
        body: JSON.stringify(payload),
        signal: req.signal ?? AbortSignal.timeout(300_000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return NextResponse.json(
          {
            error: `SD WebUI error (HTTP ${resp.status}): ${errText.slice(0, 300) || resp.statusText}`,
          },
          { status: resp.status >= 400 && resp.status < 600 ? resp.status : 502 }
        );
      }
      const json = await resp.json();
      return NextResponse.json(json);
    }

    if (backend === 'comfyui') {
      const comfyPayload = buildComfyPromptPayload({
        params,
        model,
        customWorkflowTemplate: String(body?.comfyWorkflowTemplate || ''),
        uploadedInitFilename: body?.uploadedInitFilename
          ? String(body.uploadedInitFilename)
          : undefined,
      });
      const resp = await fetch(`${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...optionalAuth },
        body: JSON.stringify({
          prompt: comfyPayload.prompt,
          client_id: comfyPayload.client_id,
        }),
        signal: req.signal ?? AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return NextResponse.json(
          {
            error: `ComfyUI queue error (HTTP ${resp.status}): ${errText.slice(0, 300) || resp.statusText}`,
          },
          { status: resp.status >= 400 && resp.status < 600 ? resp.status : 502 }
        );
      }
      const json = await resp.json();
      return NextResponse.json({
        ...json,
        resolvedSeed: comfyPayload.resolvedSeed,
      });
    }

    if (backend === 'openai-images') {
      const payload = buildOpenAiImagesPayload(params, model);
      const resp = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...optionalAuth },
        body: JSON.stringify(payload),
        signal: req.signal ?? AbortSignal.timeout(300_000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return NextResponse.json(
          {
            error: `Images API error (HTTP ${resp.status}): ${errText.slice(0, 300) || resp.statusText}`,
          },
          { status: resp.status >= 400 && resp.status < 600 ? resp.status : 502 }
        );
      }
      const json = await resp.json();
      return NextResponse.json(json);
    }

    // custom-rest (MOSS-Image / Diffusers / Custom FastAPI)
    const customPath = sanitizeCustomEndpointPath(String(body?.customEndpointPath || '/generate'));
    const targetUrl = `${baseUrl}${customPath}`;
    const payload = buildCustomRestPayload(params, model);
    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...optionalAuth },
      body: JSON.stringify(payload),
      signal: req.signal ?? AbortSignal.timeout(300_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return NextResponse.json(
        {
          error: `Custom endpoint error (HTTP ${resp.status}): ${errText.slice(0, 300) || resp.statusText}`,
        },
        { status: resp.status >= 400 && resp.status < 600 ? resp.status : 502 }
      );
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (contentType.startsWith('image/')) {
      const buf = await resp.arrayBuffer();
      const b64 = Buffer.from(buf).toString('base64');
      return NextResponse.json({
        images: [`data:${contentType.split(';')[0]};base64,${b64}`],
        seed: payload.seed,
      });
    }

    const json = await resp.json();
    return NextResponse.json(json);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to connect to local image generation backend.' },
      { status: 502 }
    );
  }
}
