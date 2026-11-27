import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildA1111Payload,
  buildComfyPromptPayload,
  buildCustomRestPayload,
  buildOpenAiImagesPayload,
  clampDimension,
  extractComfyHistoryImages,
  extractImagesFromA1111Response,
  extractImagesFromCustomRestResponse,
  extractImagesFromOpenAiResponse,
  generatedArtifactToScrapedImage,
  loadImageGenSettings,
  LOCAL_IMAGE_GEN_SETTINGS_EVENT,
  normalizeImageGenBaseUrl,
  parseA1111Models,
  parseA1111Samplers,
  parseComfyModels,
  parseOpenAiImageModels,
  resolveImageGenTransport,
  sanitizeCustomEndpointPath,
  saveImageGenSettings,
  validateImageGenEndpointUrl,
} from './localImageGenConfig';

test('normalizeImageGenBaseUrl normalizes backend-specific suffixes cleanly', () => {
  assert.equal(
    normalizeImageGenBaseUrl('http://127.0.0.1:7860/sdapi/v1/txt2img/', 'a1111'),
    'http://127.0.0.1:7860'
  );
  assert.equal(
    normalizeImageGenBaseUrl('127.0.0.1:8188/prompt', 'comfyui'),
    'http://127.0.0.1:8188'
  );
  assert.equal(
    normalizeImageGenBaseUrl('http://127.0.0.1:8000', 'openai-images'),
    'http://127.0.0.1:8000/v1'
  );
  assert.equal(
    normalizeImageGenBaseUrl('https://render.example.com/v1/images/generations', 'openai-images'),
    'https://render.example.com/v1'
  );
  assert.equal(
    normalizeImageGenBaseUrl('http://127.0.0.1:9090/moss/', 'custom-rest'),
    'http://127.0.0.1:9090/moss'
  );
});

test('validateImageGenEndpointUrl blocks credentials and cloud metadata hosts', () => {
  const creds = validateImageGenEndpointUrl('http://user:pass@127.0.0.1:7860', 'a1111');
  assert.equal(creds.ok, false);

  const meta = validateImageGenEndpointUrl('http://169.254.169.254/', 'custom-rest');
  assert.equal(meta.ok, false);

  const scheme = validateImageGenEndpointUrl('ftp://127.0.0.1:7860', 'a1111');
  assert.equal(scheme.ok, false);

  const okLocal = validateImageGenEndpointUrl('192.168.1.44:8188', 'comfyui');
  assert.equal(okLocal.ok, true);
  if (okLocal.ok) {
    assert.equal(okLocal.normalizedUrl, 'http://192.168.1.44:8188');
  }
});

test('resolveImageGenTransport routes local/LAN directly offline and remote via proxy', () => {
  assert.equal(
    resolveImageGenTransport({ transport: 'auto', baseUrl: 'http://127.0.0.1:7860' }),
    'browser-direct'
  );
  assert.equal(
    resolveImageGenTransport({ transport: 'auto', baseUrl: 'http://10.0.0.25:8188' }),
    'browser-direct'
  );
  assert.equal(
    resolveImageGenTransport({ transport: 'auto', baseUrl: 'https://gpu.example.org/v1' }),
    'server-proxy'
  );
  assert.equal(
    resolveImageGenTransport({ transport: 'browser-direct', baseUrl: 'https://gpu.example.org/v1' }),
    'browser-direct'
  );
});

test('parseA1111Models, parseComfyModels, and parseOpenAiImageModels extract checkpoints & samplers', () => {
  const a1111Models = parseA1111Models([
    { title: 'flux1-dev.safetensors [abc123]', model_name: 'flux1-dev' },
    { title: 'juggernautXL.safetensors', model_name: 'juggernautXL' },
  ]);
  assert.deepEqual(a1111Models, [
    { id: 'flux1-dev.safetensors [abc123]', label: 'flux1-dev' },
    { id: 'juggernautXL.safetensors', label: 'juggernautXL' },
  ]);

  const samplers = parseA1111Samplers([{ name: 'DPM++ 2M' }, { name: 'Euler a' }]);
  assert.deepEqual(samplers, ['DPM++ 2M', 'Euler a']);

  const comfy = parseComfyModels({
    CheckpointLoaderSimple: {
      input: {
        required: {
          ckpt_name: [['moss_image_v1.safetensors', 'sdxl_base.safetensors']],
        },
      },
    },
    KSampler: {
      input: {
        required: {
          sampler_name: [['euler', 'dpmpp_2m']],
        },
      },
    },
  });
  assert.equal(comfy.models.length, 2);
  assert.equal(comfy.models[0].id, 'moss_image_v1.safetensors');
  assert.deepEqual(comfy.samplers, ['euler', 'dpmpp_2m']);

  const oaiModels = parseOpenAiImageModels({
    data: [{ id: 'moss-image-1' }, { id: 'sdxl-turbo' }],
  });
  assert.deepEqual(
    oaiModels.map((m) => m.id),
    ['moss-image-1', 'sdxl-turbo']
  );
});

test('buildA1111Payload and buildOpenAiImagesPayload and buildCustomRestPayload build valid txt2img and img2img payloads', () => {
  const params = {
    mode: 'img2img' as const,
    prompt: 'cinematic desert sunset',
    negativePrompt: 'blurry',
    width: 1024,
    height: 768,
    steps: 25,
    cfgScale: 6.5,
    sampler: 'Euler a',
    seed: 12345,
    batchCount: 2,
    denoisingStrength: 0.55,
    initImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  };

  const a1111 = buildA1111Payload(params, 'moss-sdxl.safetensors');
  assert.equal(a1111.prompt, 'cinematic desert sunset');
  assert.equal(a1111.denoising_strength, 0.55);
  assert.deepEqual(a1111.init_images, ['data:image/png;base64,iVBORw0KGgo=']);
  assert.deepEqual(a1111.override_settings, { sd_model_checkpoint: 'moss-sdxl.safetensors' });

  const oai = buildOpenAiImagesPayload(params, 'moss-image');
  assert.equal(oai.size, '1024x768');
  assert.equal(oai.n, 2);
  assert.equal(oai.strength, 0.55);

  const custom = buildCustomRestPayload(params, 'moss-image');
  assert.equal(custom.num_inference_steps, 25);
  assert.equal(custom.init_image, 'data:image/png;base64,iVBORw0KGgo=');
});

test('buildComfyPromptPayload constructs default txt2img/img2img graphs and substitutes custom workflow tokens', () => {
  const defaultTxt = buildComfyPromptPayload({
    params: {
      mode: 'txt2img',
      prompt: 'mountain lake',
      negativePrompt: 'lowres',
      width: 1024,
      height: 1024,
      steps: 20,
      cfgScale: 7,
      sampler: 'euler',
      seed: 42,
      batchCount: 1,
      denoisingStrength: 0.7,
    },
    model: 'sdxl.safetensors',
    clientId: 'test-client',
  });
  assert.equal((defaultTxt.prompt['2'] as any).inputs.text, 'mountain lake');
  assert.equal((defaultTxt.prompt['6'] as any).inputs.seed, 42);
  assert.equal((defaultTxt.prompt['4'] as any).class_type, 'EmptyLatentImage');

  const customTpl = JSON.stringify({
    '10': {
      class_type: 'MossSampler',
      inputs: {
        prompt: '{{prompt}}',
        seed: '{{seed}}',
        width: '{{width}}',
        model: '{{model}}',
      },
    },
  });
  const customBuilt = buildComfyPromptPayload({
    params: {
      mode: 'txt2img',
      prompt: 'neon city',
      negativePrompt: '',
      width: 1344,
      height: 768,
      steps: 28,
      cfgScale: 5,
      sampler: 'euler',
      seed: 999,
      batchCount: 1,
      denoisingStrength: 0.7,
    },
    model: 'moss-image-v2',
    customWorkflowTemplate: customTpl,
  });
  assert.equal((customBuilt.prompt['10'] as any).inputs.prompt, 'neon city');
  assert.equal((customBuilt.prompt['10'] as any).inputs.seed, 999);
  assert.equal((customBuilt.prompt['10'] as any).inputs.width, 1344);
  assert.equal((customBuilt.prompt['10'] as any).inputs.model, 'moss-image-v2');
});

test('response extractors normalize base64 payloads, OpenAI data arrays, custom REST payloads, and ComfyUI history', () => {
  const a1111 = extractImagesFromA1111Response({
    images: ['iVBORw0KGgoAAAANSUhEUgAAAAE='],
    info: JSON.stringify({ seed: 777 }),
  });
  assert.equal(a1111.seed, 777);
  assert.ok(a1111.images[0].startsWith('data:image/png;base64,'));

  const oai = extractImagesFromOpenAiResponse({
    data: [{ b64_json: '/9j/4AAQSkZJRg==' }, { url: 'https://cdn.local/out.png' }],
  });
  assert.equal(oai.length, 2);
  assert.ok(oai[0].startsWith('data:image/jpeg;base64,'));
  assert.equal(oai[1], 'https://cdn.local/out.png');

  const custom = extractImagesFromCustomRestResponse({
    image: 'UklGRgAAAABXRUJQ',
    actual_seed: 888,
  });
  assert.equal(custom.seed, 888);
  assert.ok(custom.images[0].startsWith('data:image/webp;base64,'));

  const comfyHist = extractComfyHistoryImages(
    {
      'pid-1': {
        status: { completed: true },
        outputs: {
          '8': {
            images: [{ filename: 'out_00001_.png', subfolder: '', type: 'output' }],
          },
        },
      },
    },
    'pid-1'
  );
  assert.equal(comfyHist.completed, true);
  assert.equal(comfyHist.images[0].filename, 'out_00001_.png');
});

test('dimension clamping, endpoint path sanitization, ScrapedImage handoff, and storage persistence work cleanly', () => {
  assert.equal(clampDimension(1027), 1024);
  assert.equal(clampDimension(32, 512), 512);
  assert.equal(sanitizeCustomEndpointPath('v1/moss/generate'), '/v1/moss/generate');

  const scraped = generatedArtifactToScrapedImage({
    id: 'art-1',
    dataUrl: 'data:image/png;base64,AAA=',
    width: 1024,
    height: 1024,
    seed: 55,
    prompt: 'Brass Astronomical Astrolabe',
    negativePrompt: '',
    model: 'moss-image',
    backend: 'custom-rest',
    steps: 28,
    cfgScale: 5,
    sampler: 'euler',
    mode: 'txt2img',
    durationMs: 1200,
    createdAt: Date.now(),
  });
  assert.equal(scraped.resolutionTier, 'medium');
  assert.equal(scraped.format, 'png');
  assert.equal(scraped.filename, 'brass-astronomical-astrolabe-55.png');

  const prevWindow = (globalThis as any).window;
  const prevCustomEvent = (globalThis as any).CustomEvent;
  const store = new Map<string, string>();
  const dispatchedEvents: string[] = [];
  try {
    (globalThis as any).CustomEvent = class MockCustomEvent {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
      dispatchEvent: (ev: { type: string }) => {
        dispatchedEvents.push(ev.type);
        return true;
      },
    };
    const saved = saveImageGenSettings({
      backend: 'comfyui',
      baseUrl: 'http://127.0.0.1:8188/prompt',
      customEndpointPath: '/generate',
      model: 'moss.safetensors',
      transport: 'auto',
      comfyWorkflowTemplate: '',
    });
    assert.equal(saved.baseUrl, 'http://127.0.0.1:8188');
    assert.equal(loadImageGenSettings().backend, 'comfyui');
    assert.equal(loadImageGenSettings().model, 'moss.safetensors');
    assert.deepEqual(dispatchedEvents, [LOCAL_IMAGE_GEN_SETTINGS_EVENT]);
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = prevWindow;
    }
    if (prevCustomEvent === undefined) {
      delete (globalThis as any).CustomEvent;
    } else {
      (globalThis as any).CustomEvent = prevCustomEvent;
    }
  }
});
