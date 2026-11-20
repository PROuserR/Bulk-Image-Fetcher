import fs from 'fs';
import sharp from 'sharp';
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
} from '../utils/gemmaCaptionLogic.ts';
import { GemmaRuntimeError, getGemmaServerManager } from './gemmaServerManager.ts';

export const GEMMA_MODEL_LABEL = 'Gemma 4 E2B (Open-Source Local Q4_K_M)';

export interface CompletionOptions {
  messages: OpenAiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  enableThinking?: boolean;
  signal?: AbortSignal;
  onDelta?: (tokenText: string) => void;
}

export type CompletionRunner = (opts: CompletionOptions) => Promise<string>;

export async function normalizeBufferToJpegDataUrl(
  input: Buffer,
  maxEdge = 640
): Promise<string> {
  const jpegBuffer = await sharp(input, { animated: false })
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  return `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`;
}

export async function normalizeFileToJpegDataUrl(
  absPath: string,
  maxEdge = 640
): Promise<string> {
  const buf = fs.readFileSync(absPath);
  return normalizeBufferToJpegDataUrl(buf, maxEdge);
}

export async function normalizeIncomingDataUrl(
  rawDataUrl: string,
  maxEdge = 640
): Promise<string> {
  const match = rawDataUrl.match(/^data:[^;]+;base64,(.+)$/i);
  if (!match) return rawDataUrl;
  try {
    const rawBuf = Buffer.from(match[1], 'base64');
    if (rawBuf.length === 0) return rawDataUrl;
    return await normalizeBufferToJpegDataUrl(rawBuf, maxEdge);
  } catch {
    return rawDataUrl;
  }
}

export async function fetchRemoteImageAsDataUrl(
  remoteUrl: string,
  referer?: string,
  maxEdge = 640
): Promise<string> {
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  if (referer && referer.startsWith('http')) {
    headers.Referer = referer;
  }

  const resp = await fetch(remoteUrl, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${remoteUrl}`);
  }
  const arrayBuf = await resp.arrayBuffer();
  return normalizeBufferToJpegDataUrl(Buffer.from(arrayBuf), maxEdge);
}

export async function runLocalGemmaCompletion(
  opts: CompletionOptions
): Promise<string> {
  const serverUrl = await getGemmaServerManager().ensureReady();
  const stream = Boolean(opts.onDelta);

  const response = await fetch(`${serverUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemma-4-e2b',
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.3,
      stream,
      chat_template_kwargs: {
        enable_thinking: opts.enableThinking ?? false,
      },
    }),
    signal: opts.signal ?? AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new GemmaRuntimeError(
      `Gemma 4 inference failed (HTTP ${response.status}): ${errText || response.statusText}`,
      response.status >= 400 && response.status < 600 ? response.status : 500
    );
  }

  if (!stream) {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const msg = data?.choices?.[0]?.message;
    const raw = (msg?.content && msg.content.trim()) ? msg.content : msg?.reasoning_content || '';
    return stripModelThoughtBlocks(raw);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let inThoughtBlock = false;

  const filterAndEmit = (chunkText: string) => {
    accumulated += chunkText;
    // Suppress emitting internal thought markers while streaming live tokens
    if (chunkText.includes('<|channel>thought') || chunkText.includes('<thought>')) {
      inThoughtBlock = true;
      return;
    }
    if (inThoughtBlock) {
      const endMarker = chunkText.includes('<channel|>')
        ? '<channel|>'
        : chunkText.includes('</thought>')
          ? '</thought>'
          : '';
      if (endMarker) {
        inThoughtBlock = false;
        const after = chunkText.split(endMarker).slice(1).join(endMarker);
        if (after && opts.onDelta) opts.onDelta(after);
      }
      return;
    }
    if (chunkText && opts.onDelta) {
      opts.onDelta(chunkText);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payloadStr = line.slice(5).trim();
      if (payloadStr === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payloadStr) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          filterAndEmit(delta);
        }
      } catch {
        // ignore partial SSE comments/chunks
      }
    }
  }

  return stripModelThoughtBlocks(accumulated);
}

export async function runGemmaChatTurn(
  params: {
    history: GemmaChatTurn[];
    userText: string;
    userImages?: GemmaImageAttachment[];
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  },
  runner: CompletionRunner = runLocalGemmaCompletion
): Promise<{ reply: string; durationMs: number }> {
  const startedAt = Date.now();
  const normalizedImages: GemmaImageAttachment[] = [];

  for (const img of (params.userImages || []).slice(0, 6)) {
    const compactUrl = await normalizeIncomingDataUrl(img.dataUrl, 640);
    normalizedImages.push({
      ...img,
      dataUrl: compactUrl,
    });
  }

  const messages = buildOpenAiChatMessages({
    systemPrompt:
      params.systemPrompt ||
      'You are Gemma 4, a helpful multimodal vision assistant running locally on-device. Answer concisely and accurately about any attached images and follow-up questions.',
    history: params.history,
    userText: params.userText,
    userImages: normalizedImages,
  });

  const reply = await runner({
    messages,
    temperature: params.temperature ?? 0.35,
    maxTokens: params.maxTokens ?? 700,
    signal: params.signal,
    onDelta: params.onDelta,
  });

  return {
    reply: stripModelThoughtBlocks(reply),
    durationMs: Date.now() - startedAt,
  };
}

export async function captionSingleImageWithGemma(
  params: {
    id: string;
    filename: string;
    relativePath: string;
    dataUrl: string;
    style: CaptionStyle;
    customPrompt?: string;
    signal?: AbortSignal;
  },
  runner: CompletionRunner = runLocalGemmaCompletion
): Promise<CaptionedImageResult> {
  const startedAt = Date.now();
  try {
    const compactDataUrl = await normalizeIncomingDataUrl(params.dataUrl, 448);
    const promptText = buildCaptionPrompt(params.style, params.customPrompt);
    const rawOutput = await runner({
      messages: [
        {
          role: 'system',
          content:
            'You are Gemma 4 acting as an objective computer-vision image captioner. Describe only what is visibly present.',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: compactDataUrl } },
            { type: 'text', text: promptText },
          ],
        },
      ],
      temperature: params.style === 'structured' ? 0.15 : 0.25,
      maxTokens: params.style === 'concise' || params.style === 'alt_text' ? 128 : 260,
      enableThinking: false,
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

export function mapGemmaError(err: unknown): { message: string; status: number } {
  if (err instanceof GemmaRuntimeError) {
    return { message: err.message, status: err.status };
  }
  const msg = err instanceof Error ? err.message : String(err || 'Gemma 4 service error');
  return { message: msg, status: 500 };
}
