import { NextRequest } from 'next/server';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import {
  DEFAULT_USER_AGENT,
  HTML_ACCEPT_HEADER,
  sanitizeDownloadFilename,
  resolveImageBufferWithFallbacks,
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
    const relayUrl = sp.get('relayUrl') || '';
    const fallbackUrl = sp.get('fallbackUrl') || '';
    const linkedPageUrl = sp.get('linkedPageUrl') || '';

    const result = await resolveImageBufferWithFallbacks({
      imageUrl,
      explicitReferer,
      relayUrl,
      fallbackUrl,
      linkedPageUrl,
      resolveDetailPageUrl: async (detailUrl) => {
        const subResp = await fetch(detailUrl, {
          headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: HTML_ACCEPT_HEADER },
          signal: AbortSignal.timeout(7000),
        });
        if (!subResp.ok) return null;
        const subHtml = await subResp.text();
        return extractBestImageFromDetailPage(subHtml, subResp.url || detailUrl)?.url || null;
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
