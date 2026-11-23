import { NextRequest } from 'next/server';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import {
  sanitizeDownloadFilename,
  resolveImageBufferWithFallbacks,
  fetchDetailPageHtmlSmart,
} from '@/server/fetchHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const imageUrl = sp.get('url');
    if (!imageUrl) {
      return new Response('Missing url query parameter', { status: 400 });
    }

    const cleanFilename = sanitizeDownloadFilename(sp.get('filename') || undefined, imageUrl);
    const explicitReferer = sp.get('referer') || '';
    const relayUrl = sp.get('relayUrl') || sp.get('relay') || '';
    const fallbackUrl = sp.get('fallbackUrl') || '';
    const linkedPageUrl = sp.get('linkedPageUrl') || '';

    const result = await resolveImageBufferWithFallbacks({
      imageUrl,
      explicitReferer,
      relayUrl,
      fallbackUrl,
      linkedPageUrl,
      resolveDetailPageUrl: async (detailUrl) => {
        const subResp = await fetchDetailPageHtmlSmart(detailUrl, {
          relayUrl: relayUrl && detailUrl.includes(relayUrl) ? '' : relayUrl,
          timeoutMs: 9000,
        });
        if (!subResp.ok) return null;
        return extractBestImageFromDetailPage(subResp.html, subResp.url || detailUrl)?.url || null;
      },
    });

    if (!result) {
      return new Response('Failed to fetch remote image', { status: 502 });
    }

    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === result.etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: result.etag,
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          'X-Image-Cache': result.fromCache ? 'HIT' : 'MISS',
        },
      });
    }

    return new Response(new Uint8Array(result.buf), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${cleanFilename}"`,
        ETag: result.etag,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Image-Cache': result.fromCache ? 'HIT' : 'MISS',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': result.buf.byteLength.toString(),
      },
    });
  } catch (err: any) {
    return new Response(`Download error: ${err?.message || 'Unknown error'}`, { status: 502 });
  }
}

