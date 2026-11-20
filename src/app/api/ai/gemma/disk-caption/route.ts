import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { isWithinRoot, scanDirectoryImages } from '@/server/directoryImageService';
import {
  captionSingleImageWithGemma,
  mapGemmaError,
  normalizeFileToJpegDataUrl,
} from '@/server/gemmaChatService';
import { getGemmaServerManager } from '@/server/gemmaServerManager';
import {
  buildSidecarCaptionFilename,
  buildSidecarTextContent,
  CaptionedImageResult,
  CaptionStyle,
} from '@/utils/gemmaCaptionLogic';

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
  const {
    sourceDir,
    recursive = true,
    limit = 100,
    style = 'detailed',
    customPrompt = '',
    writeSidecars = false,
  } = body || {};

  const captionStyle = normalizeStyle(style);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        if (!sourceDir || typeof sourceDir !== 'string' || !sourceDir.trim()) {
          send({ type: 'error', error: 'Directory path is required.', status: 400 });
          controller.close();
          return;
        }

        const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
        const { resolvedRoot, images } = await scanDirectoryImages(sourceDir, {
          recursive: Boolean(recursive),
          limit: safeLimit,
        });

        if (images.length === 0) {
          send({
            type: 'error',
            error: `No supported images found inside ${resolvedRoot}.`,
            status: 400,
          });
          controller.close();
          return;
        }

        const indexedItems = images.map((img, idx) => ({
          id: `disk_${idx + 1}`,
          relativePath: img.relativePath,
          filename: img.filename,
          width: img.width,
          height: img.height,
          sizeBytes: img.sizeBytes,
          format: img.format,
        }));

        send({
          type: 'scanned',
          resolvedSourceDir: resolvedRoot,
          total: indexedItems.length,
          images: indexedItems,
        });

        send({
          type: 'status',
          message: 'Loading local Gemma 4 E2B multimodal model...',
          total: indexedItems.length,
        });

        await getGemmaServerManager().ensureReady();

        const results: CaptionedImageResult[] = [];
        let sidecarsWritten = 0;

        for (let i = 0; i < indexedItems.length; i++) {
          if (req.signal?.aborted) break;
          const item = indexedItems[i];

          send({
            type: 'progress',
            current: i + 1,
            total: indexedItems.length,
            filename: item.relativePath,
          });

          const absPath = path.resolve(/*turbopackIgnore: true*/ resolvedRoot, item.relativePath);
          if (!isWithinRoot(resolvedRoot, absPath) || !fs.existsSync(/*turbopackIgnore: true*/ absPath)) {
            const errItem: CaptionedImageResult = {
              id: item.id,
              filename: item.filename,
              relativePath: item.relativePath,
              style: captionStyle,
              caption: '',
              detailedDescription: '',
              subjects: [],
              tags: [],
              setting: '',
              durationMs: 0,
              error: 'Image file missing or outside root directory',
            };
            results.push(errItem);
            send({ type: 'item', index: i, total: indexedItems.length, result: errItem });
            continue;
          }

          const dataUrl = await normalizeFileToJpegDataUrl(absPath, 448);
          const captioned = await captionSingleImageWithGemma({
            id: item.id,
            filename: item.filename,
            relativePath: item.relativePath,
            dataUrl,
            style: captionStyle,
            customPrompt: typeof customPrompt === 'string' ? customPrompt : undefined,
            signal: req.signal,
          });

          if (writeSidecars && !captioned.error) {
            const sidecarRel = buildSidecarCaptionFilename(item.relativePath);
            const sidecarAbs = path.resolve(/*turbopackIgnore: true*/ resolvedRoot, sidecarRel);
            if (isWithinRoot(resolvedRoot, sidecarAbs)) {
              fs.writeFileSync(sidecarAbs, buildSidecarTextContent(captioned), 'utf8');
              sidecarsWritten++;
            }
          }

          results.push(captioned);
          send({ type: 'item', index: i, total: indexedItems.length, result: captioned });
        }

        send({
          type: 'done',
          resolvedSourceDir: resolvedRoot,
          results,
          sidecarsWritten,
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
