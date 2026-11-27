import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverImageGenModels,
  generateImagesWithLocalBackend,
} from './localImageGenClient';
import type { ImageGenEndpointSettings, ImageGenRequestParams } from './localImageGenConfig';

const BASE_PARAMS: ImageGenRequestParams = {
  mode: 'txt2img',
  prompt: 'architectural glass pavilion at twilight',
  negativePrompt: 'blurry',
  width: 1024,
  height: 1024,
  steps: 20,
  cfgScale: 7,
  sampler: 'euler',
  seed: 314159,
  batchCount: 1,
  denoisingStrength: 0.65,
};

test('discoverImageGenModels connects browser-direct to local A1111 and ComfyUI endpoints', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:7860/sdapi/v1/sd-models') {
        return new Response(
          JSON.stringify([{ title: 'sd_xl_base.safetensors', model_name: 'sd_xl_base' }]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === 'http://127.0.0.1:7860/sdapi/v1/samplers') {
        return new Response(JSON.stringify([{ name: 'DPM++ 2M' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'http://127.0.0.1:8188/object_info/CheckpointLoaderSimple') {
        return new Response(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: { required: { ckpt_name: [['moss_diffusion.safetensors']] } },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === 'http://127.0.0.1:8188/object_info/KSampler') {
        return new Response(
          JSON.stringify({
            KSampler: { input: { required: { sampler_name: [['euler', 'dpmpp_2m']] } } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const a1111 = await discoverImageGenModels({
      backend: 'a1111',
      baseUrl: 'http://127.0.0.1:7860',
      customEndpointPath: '',
      model: '',
      transport: 'auto',
      comfyWorkflowTemplate: '',
    });
    assert.equal(a1111.ok, true);
    assert.equal(a1111.resolvedTransport, 'browser-direct');
    assert.equal(a1111.models[0].id, 'sd_xl_base.safetensors');
    assert.deepEqual(a1111.samplers, ['DPM++ 2M']);

    const comfy = await discoverImageGenModels({
      backend: 'comfyui',
      baseUrl: 'http://127.0.0.1:8188',
      customEndpointPath: '',
      model: '',
      transport: 'auto',
      comfyWorkflowTemplate: '',
    });
    assert.equal(comfy.ok, true);
    assert.equal(comfy.models[0].id, 'moss_diffusion.safetensors');
    assert.deepEqual(comfy.samplers, ['euler', 'dpmpp_2m']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateImagesWithLocalBackend runs full ComfyUI queue -> history -> view workflow directly offline', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let historyCalls = 0;
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:8188/prompt' && init?.method === 'POST') {
        return new Response(JSON.stringify({ prompt_id: 'comfy-job-99' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'http://127.0.0.1:8188/history/comfy-job-99') {
        historyCalls += 1;
        return new Response(
          JSON.stringify({
            'comfy-job-99': {
              status: { completed: true },
              outputs: {
                '8': {
                  images: [{ filename: 'moss_out.png', subfolder: '', type: 'output' }],
                },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.startsWith('http://127.0.0.1:8188/view?')) {
        return new Response(pngBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const settings: ImageGenEndpointSettings = {
      backend: 'comfyui',
      baseUrl: 'http://127.0.0.1:8188',
      customEndpointPath: '',
      model: 'moss_diffusion.safetensors',
      transport: 'auto',
      comfyWorkflowTemplate: '',
    };

    const artifacts = await generateImagesWithLocalBackend(settings, BASE_PARAMS);
    assert.equal(historyCalls, 1);
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(artifacts[0].seed, 314159);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('generateImagesWithLocalBackend supports binary PNG and JSON responses on MOSS/Custom REST endpoints', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'http://127.0.0.1:8000/moss/generate') {
        return new Response(pngBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }
      if (url === 'http://127.0.0.1:8000/v1/images/generations') {
        return new Response(
          JSON.stringify({
            data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAE=' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const customArtifacts = await generateImagesWithLocalBackend(
      {
        backend: 'custom-rest',
        baseUrl: 'http://127.0.0.1:8000',
        customEndpointPath: '/moss/generate',
        model: 'moss-image',
        transport: 'auto',
        comfyWorkflowTemplate: '',
      },
      BASE_PARAMS
    );
    assert.equal(customArtifacts.length, 1);
    assert.ok(customArtifacts[0].dataUrl.startsWith('data:image/png;base64,'));

    const oaiArtifacts = await generateImagesWithLocalBackend(
      {
        backend: 'openai-images',
        baseUrl: 'http://127.0.0.1:8000/v1',
        customEndpointPath: '',
        model: 'moss-image',
        transport: 'auto',
        comfyWorkflowTemplate: '',
      },
      BASE_PARAMS
    );
    assert.equal(oaiArtifacts.length, 1);
    assert.ok(oaiArtifacts[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(oaiArtifacts[0].sourceInitDataUrl, undefined);

    const img2imgArtifacts = await generateImagesWithLocalBackend(
      {
        backend: 'custom-rest',
        baseUrl: 'http://127.0.0.1:8000',
        customEndpointPath: '/moss/generate',
        model: 'moss-image',
        transport: 'auto',
        comfyWorkflowTemplate: '',
      },
      {
        ...BASE_PARAMS,
        mode: 'img2img',
        initImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }
    );
    assert.equal(img2imgArtifacts.length, 1);
    assert.equal(
      img2imgArtifacts[0].sourceInitDataUrl,
      'data:image/png;base64,iVBORw0KGgo='
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('discoverImageGenModels falls back to browser-direct in Auto mode when remote proxy rejects private/Tailscale domain', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/ai/local-image-gen') {
        return new Response(
          JSON.stringify({ error: 'Resolved host points to a private IP.' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url === 'https://my-gpu.ts.net/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'moss-image-xl' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    const res = await discoverImageGenModels({
      backend: 'openai-images',
      baseUrl: 'https://my-gpu.ts.net/v1',
      customEndpointPath: '',
      model: '',
      transport: 'auto',
      comfyWorkflowTemplate: '',
    });
    assert.equal(res.ok, true);
    assert.equal(res.resolvedTransport, 'browser-direct');
    assert.equal(res.models[0].id, 'moss-image-xl');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
