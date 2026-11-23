import { NextRequest } from 'next/server';
import { fetchValidImageBuffer } from '@/server/fetchHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const imageUrl = req.nextUrl.searchParams.get('url');
    if (!imageUrl) {
      return new Response('Missing url query parameter', { status: 400 });
    }

    const referer = req.nextUrl.searchParams.get('referer') || undefined;
    const relayUrl = req.nextUrl.searchParams.get('relayUrl') || undefined;

    const cachedOrFetched = await fetchValidImageBuffer(imageUrl, {
      explicitReferer: referer,
      relayUrl,
      timeoutMs: 8000,
    });

    if (!cachedOrFetched) {
      return new Response('Failed to fetch remote image', { status: 502 });
    }

    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch === cachedOrFetched.etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: cachedOrFetched.etag,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'X-Image-Cache': cachedOrFetched.fromCache ? 'HIT' : 'MISS',
        },
      });
    }

    return new Response(new Uint8Array(cachedOrFetched.buf), {
      status: 200,
      headers: {
        'Content-Type': cachedOrFetched.contentType || 'image/jpeg',
        'Content-Length': cachedOrFetched.buf.byteLength.toString(),
        ETag: cachedOrFetched.etag,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Image-Cache': cachedOrFetched.fromCache ? 'HIT' : 'MISS',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return new Response(`Proxy error: ${err?.message || 'Unknown error'}`, {
      status: 502,
    });
  }
}

