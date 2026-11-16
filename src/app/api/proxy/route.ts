import { NextRequest } from 'next/server';
import {
  resolveImageReferer,
  fetchImageWithRefererFallback,
} from '@/server/fetchHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const imageUrl = req.nextUrl.searchParams.get('url');
    if (!imageUrl) {
      return new Response('Missing url query parameter', { status: 400 });
    }

    const referer = resolveImageReferer(
      imageUrl,
      req.nextUrl.searchParams.get('referer') || undefined
    );
    let imageResponse: globalThis.Response;
    try {
      imageResponse = await fetchImageWithRefererFallback(imageUrl, referer, 8000);
    } catch (err: any) {
      return new Response(`Remote image fetch timeout: ${err?.message || 'Timeout'}`, {
        status: 504,
      });
    }

    if (!imageResponse.ok) {
      return new Response('Failed to fetch remote image', {
        status: imageResponse.status,
      });
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    return new Response(new Uint8Array(arrayBuffer), {
      status: 200,
      headers: {
        'Content-Type': imageResponse.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err: any) {
    return new Response(`Proxy error: ${err?.message || 'Unknown error'}`, {
      status: 502,
    });
  }
}
