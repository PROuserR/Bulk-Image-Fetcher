import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captionSingleImageWithCustomLlm,
  fetchCustomLlmModels,
  runCustomLlmChatTurn,
  scanHumanFaceWithCustomLlm,
} from './customLlmClient';
import type { CustomLlmSettings } from './customLlmConfig';

test('fetchCustomLlmModels queries Ollama /api/tags directly for localhost', async () => {
  const prevFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    capturedUrl = String(input);
    return new Response(
      JSON.stringify({
        models: [
          { name: 'gemma3:4b', details: { parameter_size: '4.3B', quantization_level: 'Q4_K_M' } },
          { name: 'llava:latest' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const settings: CustomLlmSettings = {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'gemma3:4b',
      transport: 'auto',
      systemPrompt: '',
    };
    const res = await fetchCustomLlmModels(settings);
    assert.equal(res.ok, true);
    assert.equal(res.resolvedTransport, 'browser-direct');
    assert.equal(capturedUrl, 'http://localhost:11434/api/tags');
    assert.equal(res.models.length, 2);
    assert.equal(res.models[0].id, 'gemma3:4b');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('runCustomLlmChatTurn sends multimodal images to Ollama /api/chat and streams reply', async () => {
  const prevFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody: any = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body || '{}'));
    const ndjson =
      [
        JSON.stringify({ message: { role: 'assistant', content: 'A smiling ' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: 'portrait.' }, done: true }),
      ].join('\n') + '\n';
    return new Response(ndjson, {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }) as typeof fetch;

  try {
    const settings: CustomLlmSettings = {
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'gemma3:4b',
      transport: 'browser-direct',
      systemPrompt: '',
    };
    const deltas: string[] = [];
    const result = await runCustomLlmChatTurn(settings, {
      history: [],
      userText: 'What is in this photo?',
      userImages: [
        {
          id: 'img1',
          filename: 'face.jpg',
          dataUrl: 'data:image/jpeg;base64,FAKEBASE64DATA',
        },
      ],
      onDelta: (d) => deltas.push(d),
    });

    assert.equal(capturedUrl, 'http://localhost:11434/api/chat');
    assert.equal(capturedBody.model, 'gemma3:4b');
    assert.equal(capturedBody.stream, true);
    assert.deepEqual(capturedBody.messages[1].images, ['FAKEBASE64DATA']);
    assert.deepEqual(deltas, ['A smiling ', 'portrait.']);
    assert.equal(result.reply, 'A smiling portrait.');
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('captionSingleImageWithCustomLlm parses structured JSON output via server proxy for remote OpenAI endpoints', async () => {
  const prevFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody: any = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                caption: 'Studio portrait in warm light.',
                detailedDescription: 'A crisp studio portrait lit with warm key lighting.',
                subjects: ['woman in black jacket'],
                tags: ['portrait', 'studio', 'warm'],
                setting: 'minimal studio backdrop',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const settings: CustomLlmSettings = {
      provider: 'openai-compat',
      baseUrl: 'https://llm.example.com/v1',
      model: 'qwen2.5-vl-7b',
      transport: 'auto',
      systemPrompt: '',
    };
    const captioned = await captionSingleImageWithCustomLlm(settings, {
      id: 'c1',
      filename: 'studio.jpg',
      relativePath: 'studio.jpg',
      dataUrl: 'data:image/jpeg;base64,AAAA',
      style: 'structured',
    });

    assert.equal(capturedUrl, '/api/ai/custom-llm');
    assert.equal(capturedBody.action, 'chat');
    assert.equal(capturedBody.provider, 'openai-compat');
    assert.equal(captioned.error, undefined);
    assert.equal(captioned.caption, 'Studio portrait in warm light.');
    assert.deepEqual(captioned.tags, ['portrait', 'studio', 'warm']);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('scanHumanFaceWithCustomLlm parses JSON face verdicts accurately', async () => {
  const prevFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        message: {
          content: '{"hasHumanFace": true, "faceCount": 2, "confidence": 0.94, "subjectSummary": "two people smiling"}',
        },
        done: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const verdict = await scanHumanFaceWithCustomLlm(
      {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'gemma3:4b',
        transport: 'browser-direct',
        systemPrompt: '',
      },
      { id: 'img_42', imageDataUrl: 'data:image/jpeg;base64,XYZ' }
    );

    assert.equal(verdict.id, 'img_42');
    assert.equal(verdict.hasHumanFace, true);
    assert.equal(verdict.faceCount, 2);
    assert.equal(verdict.subjectSummary, 'two people smiling');
  } finally {
    globalThis.fetch = prevFetch;
  }
});
