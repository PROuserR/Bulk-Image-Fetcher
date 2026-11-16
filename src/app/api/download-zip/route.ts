import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import { unshrinkImageUrl, isLowResUrl } from '@/utils/scraperLogic';
import {
  DEFAULT_USER_AGENT,
  HTML_ACCEPT_HEADER,
  sanitizeDownloadFilename,
  ensureUniqueFilename,
  resolveImageBufferWithFallbacks,
} from '@/server/fetchHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ZipImageInput {
  url: string;
  fallbackUrl?: string;
  linkedPageUrl?: string;
  filename?: string;
  onlyFullRes?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { images, referer, onlyFullRes: globalOnlyFullRes } = body || {};
    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json({ error: 'No images provided for batch zip' }, { status: 400 });
    }

    const zip = new JSZip();
    const seenNames = new Set<string>();
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
          const uniqueName = ensureUniqueFilename(rawName, seenNames);

          const resolveDetailUrl = async (detailUrl: string): Promise<string | null> => {
            const subResp = await fetch(detailUrl, {
              headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: HTML_ACCEPT_HEADER },
              signal: AbortSignal.timeout(7000),
            });
            if (!subResp.ok) return null;
            const subHtml = await subResp.text();
            const resolved = extractBestImageFromDetailPage(subHtml, subResp.url || detailUrl);
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
