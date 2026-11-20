import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import { unshrinkImageUrl, isLowResUrl } from '@/utils/scraperLogic';
import {
  sanitizeDownloadFilename,
  ensureUniqueFilename,
  resolveImageBufferWithFallbacks,
  fetchDetailPageHtmlSmart,
} from '@/server/fetchHelpers';

import { sanitizeGalleryFolderName } from '@/utils/nestedGalleryLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ZipImageInput {
  url: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  filename?: string;
  galleryTitle?: string;
  galleryId?: string;
  onlyFullRes?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { images, referer, relayUrl, onlyFullRes: globalOnlyFullRes } = body || {};
    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'No images provided for batch zip' }, { status: 400 });
    }

    const cleanRelayUrl = typeof relayUrl === 'string' ? relayUrl.trim() : '';
    const zip = new JSZip();
    const seenByFolder = new Map<string, Set<string>>();
    let addedCount = 0;

    const BATCH_SIZE = 6;
    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE) as ZipImageInput[];
      await Promise.all(
        batch.map(async (item, batchIdx) => {
          const onlyFullRes = item.onlyFullRes ?? globalOnlyFullRes ?? true;
          const rawUrl = item.url || item.linkedPageUrl;
          if (!rawUrl) return;

          const unshrinkAttempt = unshrinkImageUrl(rawUrl);
          let targetUrl = unshrinkAttempt.fullUrl || rawUrl;

          const rawName = sanitizeDownloadFilename(
            item.filename || `image_${i + batchIdx + 1}.jpg`
          );
          const folderKey = item.galleryTitle
            ? sanitizeGalleryFolderName(item.galleryTitle, item.galleryId || 'gallery')
            : '';
          let folderSeen = seenByFolder.get(folderKey);
          if (!folderSeen) {
            folderSeen = new Set<string>();
            seenByFolder.set(folderKey, folderSeen);
          }
          const uniqueFile = ensureUniqueFilename(rawName, folderSeen);
          const uniqueName = folderKey ? `${folderKey}/${uniqueFile}` : uniqueFile;

          const resolveDetailUrl = async (detailUrl: string): Promise<string | null> => {
            const subResp = await fetchDetailPageHtmlSmart(detailUrl, {
              relayUrl: detailUrl.includes('r.jina.ai') || (cleanRelayUrl && detailUrl.includes(cleanRelayUrl)) ? '' : cleanRelayUrl,
              timeoutMs: 9000,
            });
            if (!subResp.ok) return null;
            const resolved = extractBestImageFromDetailPage(subResp.html, subResp.url || detailUrl);
            return resolved?.url || null;
          };

          if (isLowResUrl(targetUrl) && item.linkedPageUrl) {
            try {
              const masterUrl = await resolveDetailUrl(item.linkedPageUrl);
              if (masterUrl && !isLowResUrl(masterUrl)) {
                targetUrl = masterUrl;
              }
            } catch {
              // ignore detail lookup failure
            }
          }

          if (onlyFullRes && isLowResUrl(targetUrl) && !item.linkedPageUrl) {
            return;
          }

          const result = await resolveImageBufferWithFallbacks({
            imageUrl: targetUrl,
            explicitReferer: referer,
            relayUrl: cleanRelayUrl,
            fallbackUrl: item.fallbackUrl,
            linkedPageUrl: item.linkedPageUrl,
            minBytes: 1500,
            allowFallbackUrl: !onlyFullRes || !isLowResUrl(item.fallbackUrl),
            resolveDetailPageUrl: resolveDetailUrl,
          });

          if (result?.buf) {
            zip.file(uniqueName, result.buf);
            addedCount++;
          }
        })
      );
    }

    if (addedCount === 0) {
      return NextResponse.json(
        {
          error:
            'Remote servers rejected or timed out image downloads. Use the in-browser direct download option.',
        },
        { status: 502 }
      );
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': zipBuffer.length.toString(),
        'Content-Disposition': `attachment; filename="scraped_images_${Date.now()}.zip"`,
      },
    });
  } catch (err: any) {
    console.error('Zip generation error:', err);
    return NextResponse.json(
      { error: `Failed to generate zip: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
