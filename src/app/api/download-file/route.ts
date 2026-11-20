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

    return new Response(new Uint8Array(result.buf), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${cleanFilename}"`,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': result.buf.byteLength.toString(),
      },
    });
  } catch (err: any) {
    return new Response(`Download error: ${err?.message || 'Unknown error'}`, { status: 502 });
  }
}
