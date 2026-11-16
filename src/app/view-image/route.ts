import { NextRequest } from 'next/server';
import { renderViewImageHtml } from '@/server/viewImageTemplate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const imageUrl = req.nextUrl.searchParams.get('url') || '';
  if (!imageUrl) {
    return new Response('Missing url query parameter', { status: 400 });
  }

  const html = renderViewImageHtml({
    imageUrl,
    title: req.nextUrl.searchParams.get('title') || 'Full-Sized Image Master',
    sourcePage: req.nextUrl.searchParams.get('sourcePage') || '',
    linkedPage: req.nextUrl.searchParams.get('linkedPage') || '',
    method: req.nextUrl.searchParams.get('method') || 'Full-Resolution Master',
  });

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}
