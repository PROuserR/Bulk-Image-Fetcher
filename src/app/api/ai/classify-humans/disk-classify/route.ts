import path from 'path';
import { NextRequest } from 'next/server';
import { scanDirectoryImages, isWithinRoot } from '@/server/directoryImageService';
import {
  analyzeHumanImageBatch,
  clusterHumanProfilesOffline,
  mapClassifierError,
} from '@/server/humanClassifierService';
import {
  chunkItemsForAnalysis,
  FolderNamingMode,
  HumanImageBiometricProfile,
} from '@/utils/humanClassifierLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { sourceDir, recursive = true, folderNamingMode = 'indexed', limit = 200 } = body || {};

  const mode: FolderNamingMode =
    folderNamingMode === 'descriptive' ? 'descriptive' : 'indexed';

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

        const safeLimit = Math.max(1, Math.min(250, Number(limit) || 200));
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
          imageId: `disk_${idx + 1}`,
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

        const batches = chunkItemsForAnalysis(indexedItems, 10);
        const allProfiles: HumanImageBiometricProfile[] = [];
        let processedCount = 0;

        for (const batch of batches) {
          const payloadImages = [];
          for (const item of batch) {
            const absPath = path.resolve(resolvedRoot, item.relativePath);
            if (!isWithinRoot(resolvedRoot, absPath)) continue;
            payloadImages.push({
              imageId: item.imageId,
              filename: item.filename,
              filePath: absPath,
            });
          }

          const batchProfiles = await analyzeHumanImageBatch(payloadImages);
          allProfiles.push(...batchProfiles);
          processedCount += batchProfiles.length;

          send({
            type: 'progress',
            stage: 'analyzing',
            processed: processedCount,
            total: indexedItems.length,
          });
        }

        send({
          type: 'progress',
          stage: 'clustering',
          processed: indexedItems.length,
          total: indexedItems.length,
        });

        const { clusters, manifest } = await clusterHumanProfilesOffline(allProfiles, mode);

        send({
          type: 'done',
          resolvedSourceDir: resolvedRoot,
          images: indexedItems,
          profiles: allProfiles,
          clusters,
          manifest,
        });
      } catch (err: unknown) {
        const mapped = mapClassifierError(err);
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
