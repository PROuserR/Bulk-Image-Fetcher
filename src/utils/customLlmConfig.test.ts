import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOllamaChatPayload,
  buildOpenAiCompatChatPayload,
  consumeOllamaNdjsonResponse,
  consumeOpenAiChatResponse,
  extractRawBase64FromImageUrl,
  isLoopbackLlmUrl,
  isPrivateOrLinkLocalHostname,
  loadCustomLlmSettings,
  normalizeLlmBaseUrl,
  parseOllamaTagsResponse,
  parseOpenAiModelsResponse,
  resolveEffectiveTransport,
  sanitizeCustomLlmSettings,
  saveCustomLlmSettings,
  validateLlmEndpointUrl,
} from './customLlmConfig';

test('normalizeLlmBaseUrl strips accidentally pasted endpoint paths cleanly', () => {
  assert.equal(
    normalizeLlmBaseUrl('http://localhost:11434/api/chat/', 'ollama'),
    'http://localhost:11434'
  );
  assert.equal(
    normalizeLlmBaseUrl('127.0.0.1:11434/api/tags', 'ollama'),
    'http://127.0.0.1:11434'
  );
  assert.equal(
    normalizeLlmBaseUrl('http://localhost:1234/v1/chat/completions', 'openai-compat'),
    'http://localhost:1234/v1'
  );
  assert.equal(
    normalizeLlmBaseUrl('http://localhost:8080', 'openai-compat'),
    'http://localhost:8080/v1'
  );
});

test('validateLlmEndpointUrl blocks unsafe schemes, embedded creds, and cloud metadata hosts', () => {
  assert.equal(validateLlmEndpointUrl('http://localhost:11434', 'ollama').ok, true);
  assert.equal(validateLlmEndpointUrl('https://llm.example.com/v1', 'openai-compat').ok, true);

  const badScheme = validateLlmEndpointUrl('file:///etc/passwd', 'ollama');
  assert.equal(badScheme.ok, false);

  const embeddedCreds = validateLlmEndpointUrl('http://user:pass@localhost:11434', 'ollama');
  assert.equal(embeddedCreds.ok, false);

  const metadata = validateLlmEndpointUrl('http://169.254.169.254/latest', 'ollama');
  assert.equal(metadata.ok, false);
});

test('loopback and private hostname detection resolves auto transport accurately', () => {
  assert.equal(isLoopbackLlmUrl('http://localhost:11434'), true);
  assert.equal(isLoopbackLlmUrl('http://127.0.0.1:11434'), true);
  assert.equal(isLoopbackLlmUrl('https://api.example.com/v1'), false);

  assert.equal(isPrivateOrLinkLocalHostname('192.168.1.42'), true);
  assert.equal(isPrivateOrLinkLocalHostname('10.0.0.15'), true);
  assert.equal(isPrivateOrLinkLocalHostname('172.16.0.8'), true);
  assert.equal(isPrivateOrLinkLocalHostname('llm.mydomain.com'), false);

  assert.equal(
    resolveEffectiveTransport({
      transport: 'auto',
      baseUrl: 'http://localhost:11434',
    }),
    'browser-direct'
  );
  assert.equal(
    resolveEffectiveTransport({
      transport: 'auto',
      baseUrl: 'http://192.168.1.55:11434',
    }),
    'browser-direct'
  );
  assert.equal(
    resolveEffectiveTransport({
      transport: 'auto',
      baseUrl: 'https://ollama.example.com',
    }),
    'server-proxy'
  );
  assert.equal(
    resolveEffectiveTransport({
      transport: 'browser-direct',
      baseUrl: 'https://ollama.example.com',
    }),
    'browser-direct'
  );
});

test('parseOllamaTagsResponse and parseOpenAiModelsResponse extract model metadata cleanly', () => {
  const ollamaModels = parseOllamaTagsResponse({
    models: [
      {
        name: 'gemma3:4b',
        size: 3338801804,
        details: { parameter_size: '4.3B', quantization_level: 'Q4_K_M' },
      },
      { name: 'llava:latest' },
      { name: 'gemma3:4b' }, // duplicate filtered
    ],
  });
  assert.equal(ollamaModels.length, 2);
  assert.equal(ollamaModels[0].id, 'gemma3:4b');
  assert.equal(ollamaModels[0].label, 'gemma3:4b (4.3B · Q4_K_M)');
  assert.equal(ollamaModels[1].label, 'llava:latest');

  const openaiModels = parseOpenAiModelsResponse({
    data: [{ id: 'qwen2.5-vl-7b-instruct' }, { id: 'gemma-3-12b-it' }],
  });
  assert.deepEqual(
    openaiModels.map((m) => m.id),
    ['qwen2.5-vl-7b-instruct', 'gemma-3-12b-it']
  );
});

test('buildOllamaChatPayload extracts base64 images and preserves multimodal prompt', () => {
  assert.equal(
    extractRawBase64FromImageUrl('data:image/jpeg;base64,ABC123=='),
    'ABC123=='
  );

  const payload = buildOllamaChatPayload({
    model: 'gemma3:4b',
    messages: [
      { role: 'system', content: 'Be brief.' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,IMGDATA1' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,IMGDATA2' } },
          { type: 'text', text: 'Compare these two portraits.' },
        ],
      },
    ],
    temperature: 0.25,
    maxTokens: 300,
    stream: true,
  });

  assert.equal(payload.model, 'gemma3:4b');
  assert.equal(payload.stream, true);
  assert.equal(payload.options.temperature, 0.25);
  assert.equal(payload.options.num_predict, 300);
  assert.equal(payload.messages.length, 2);
  assert.deepEqual(payload.messages[1].images, ['IMGDATA1', 'IMGDATA2']);
  assert.equal(payload.messages[1].content, 'Compare these two portraits.');

  const openaiPayload = buildOpenAiCompatChatPayload({
    model: 'local-model',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
  });
  assert.equal(openaiPayload.model, 'local-model');
  assert.equal(openaiPayload.stream, false);
});

test('consumeOllamaNdjsonResponse streams deltas and strips thought blocks', async () => {
  const ndjson =
    [
      JSON.stringify({ message: { role: 'assistant', content: '<thought>hmm</thought>' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: 'Hello ' }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: 'offline world!' }, done: true }),
    ].join('\n') + '\n';

  const mockResp = new Response(ndjson, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  });

  const deltas: string[] = [];
  const full = await consumeOllamaNdjsonResponse(mockResp, (d) => deltas.push(d));
  assert.deepEqual(deltas, ['Hello ', 'offline world!']);
  assert.equal(full, 'Hello offline world!');
});

test('consumeOpenAiChatResponse handles SSE streams and JSON fallbacks', async () => {
  const sseBody = [
    'data: {"choices":[{"delta":{"content":"First "}}]}',
    'data: {"choices":[{"delta":{"content":"second."}}]}',
    'data: [DONE]',
  ].join('\n\n');

  const sseResp = new Response(sseBody, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

  const chunks: string[] = [];
  const sseText = await consumeOpenAiChatResponse(sseResp, (d) => chunks.push(d));
  assert.deepEqual(chunks, ['First ', 'second.']);
  assert.equal(sseText, 'First second.');

  const jsonResp = new Response(
    JSON.stringify({ choices: [{ message: { content: 'Non-stream reply' } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
  const jsonText = await consumeOpenAiChatResponse(jsonResp);
  assert.equal(jsonText, 'Non-stream reply');
});

test('sanitizeCustomLlmSettings and storage persistence handle invalid payloads safely', () => {
  const sanitized = sanitizeCustomLlmSettings({
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/api/chat',
    model: '  llama3.2-vision ',
    transport: 'browser-direct',
  });
  assert.equal(sanitized.provider, 'ollama');
  assert.equal(sanitized.baseUrl, 'http://localhost:11434');
  assert.equal(sanitized.model, 'llama3.2-vision');
  assert.equal(sanitized.transport, 'browser-direct');

  // Verify localStorage helpers work cleanly when window is mocked
  const store = new Map<string, string>();
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    dispatchEvent: () => true,
  };
  (globalThis as any).CustomEvent = class {
    type: string;
    detail: any;
    constructor(type: string, init?: any) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  try {
    saveCustomLlmSettings(sanitized);
    const loaded = loadCustomLlmSettings();
    assert.deepEqual(loaded, sanitized);
  } finally {
    (globalThis as any).window = prevWindow;
  }
});
