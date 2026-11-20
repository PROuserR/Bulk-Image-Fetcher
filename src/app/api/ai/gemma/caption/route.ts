import { NextRequest } from 'next/server';
import {
  captionSingleImageWithGemma,
  fetchRemoteImageAsDataUrl,
  mapGemmaError,
} from '@/server/gemmaChatService';
import { getGemmaServerManager } from '@/server/gemmaServerManager';
import { CaptionedImageResult, CaptionStyle } from '@/utils/gemmaCaptionLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeStyle(raw: unknown): CaptionStyle {
  if (raw === 'concise' || raw === 'structured' || raw === 'alt_text') {
    return raw;
  }
  return 'detailed';
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { images = [], style = 'detailed', customPrompt = '' } = body || {};
  const captionStyle = normalizeStyle(style);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        if (!Array.isArray(images) || images.length === 0) {
          send({ type: 'error', error: 'Select at least one image to caption.', status: 400 });
          controller.close();
          return;
        }

        const safeItems = images.slice(0, 120);
        send({
          type: 'status',
          message: 'Starting local Gemma 4 E2B vision server...',
          total: safeItems.length,
        });

        await getGemmaServerManager().ensureReady();

        const results: CaptionedImageResult[] = [];
        for (let i = 0; i < safeItems.length; i++) {
          if (req.signal?.aborted) break;
          const item = safeItems[i] || {};
          const id = String(item.id || `img_${i + 1}`);
          const filename = String(item.filename || `image_${i + 1}.jpg`);
          const relativePath = String(item.relativePath || filename);

          send({
            type: 'progress',
            current: i + 1,
            total: safeItems.length,
            filename,
          });

          let dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : '';
          if (!dataUrl && typeof item.remoteUrl === 'string' && item.remoteUrl.startsWith('http')) {
            try {
              dataUrl = await fetchRemoteImageAsDataUrl(
                item.remoteUrl,
                typeof item.referer === 'string' ? item.referer : undefined,
                640
              );
            } catch (fetchErr: any) {
              const errResult: CaptionedImageResult = {
                id,
                filename,
                relativePath,
                style: captionStyle,
                caption: '',
                detailedDescription: '',
                subjects: [],
                tags: [],
                setting: '',
                durationMs: 0,
                error: fetchErr?.message || 'Failed to download image',
              };
              results.push(errResult);
              send({ type: 'item', index: i, total: safeItems.length, result: errResult });
              continue;
            }
          }

          if (!dataUrl) {
            const missingResult: CaptionedImageResult = {
              id,
              filename,
              relativePath,
              style: captionStyle,
              caption: '',
              detailedDescription: '',
              subjects: [],
              tags: [],
              setting: '',
              durationMs: 0,
              error: 'Missing image payload',
            };
            results.push(missingResult);
            send({ type: 'item', index: i, total: safeItems.length, result: missingResult });
            continue;
          }

          const captioned = await captionSingleImageWithGemma({
            id,
            filename,
            relativePath,
            dataUrl,
            style: captionStyle,
            customPrompt: typeof customPrompt === 'string' ? customPrompt : undefined,
            signal: req.signal,
          });

          results.push(captioned);
          send({ type: 'item', index: i, total: safeItems.length, result: captioned });
        }

        send({ type: 'done', results });
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
