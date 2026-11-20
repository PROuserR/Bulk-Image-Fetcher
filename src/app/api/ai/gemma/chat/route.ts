import { NextRequest } from 'next/server';
import {
  fetchRemoteImageAsDataUrl,
  mapGemmaError,
  runGemmaChatTurn,
} from '@/server/gemmaChatService';
import { GemmaChatTurn, GemmaImageAttachment } from '@/utils/gemmaCaptionLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    history = [],
    userText = '',
    userImages = [],
    systemPrompt,
    temperature,
    maxTokens,
  } = body || {};

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        const cleanText = String(userText || '').trim();
        const incomingImages = Array.isArray(userImages) ? userImages.slice(0, 6) : [];

        if (!cleanText && incomingImages.length === 0) {
          send({
            type: 'error',
            error: 'Please enter a message or attach at least one image.',
            status: 400,
          });
          controller.close();
          return;
        }

        send({ type: 'status', message: 'Preparing local Gemma 4 E2B model...' });

        const resolvedImages: GemmaImageAttachment[] = [];
        for (let idx = 0; idx < incomingImages.length; idx++) {
          const item = incomingImages[idx] || {};
          const filename = String(item.filename || `image_${idx + 1}.jpg`);
          const id = String(item.id || `att_${idx + 1}`);
          if (typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:')) {
            resolvedImages.push({ id, filename, dataUrl: item.dataUrl });
          } else if (typeof item.remoteUrl === 'string' && item.remoteUrl.startsWith('http')) {
            const dataUrl = await fetchRemoteImageAsDataUrl(
              item.remoteUrl,
              typeof item.referer === 'string' ? item.referer : undefined,
              640
            );
            resolvedImages.push({ id, filename, dataUrl });
          }
        }

        const safeHistory: GemmaChatTurn[] = Array.isArray(history)
          ? history
              .filter(
                (t: any) =>
                  t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string'
              )
              .map((t: any) => ({
                role: t.role,
                text: t.text,
                images: Array.isArray(t.images)
                  ? t.images
                      .filter(
                        (img: any) =>
                          img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:')
                      )
                      .slice(0, 4)
                  : undefined,
              }))
          : [];

        send({ type: 'status', message: 'Generating response with Gemma 4 E2B...' });

        const result = await runGemmaChatTurn({
          history: safeHistory,
          userText: cleanText,
          userImages: resolvedImages,
          systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : undefined,
          temperature: typeof temperature === 'number' ? temperature : 0.35,
          maxTokens: typeof maxTokens === 'number' ? maxTokens : 700,
          signal: req.signal,
          onDelta: (delta) => {
            send({ type: 'delta', text: delta });
          },
        });

        send({
          type: 'done',
          reply: result.reply,
          durationMs: result.durationMs,
        });
      } catch (err) {
        const mapped = mapGemmaError(err);
        send({ type: 'error', error: mapped.message, status: mapped.status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
