import { NextRequest, NextResponse } from 'next/server';
import { extractImagesFromHtml } from '@/utils/htmlExtractor';
import { SAMPLE_PRESETS } from '@/utils/samplePages';
import { DEFAULT_USER_AGENT } from '@/server/fetchHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleLinks(req: NextRequest) {
  try {
    const queryUrl = req.nextUrl.searchParams.get('url');
    const queryFormat = req.nextUrl.searchParams.get('format');
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    const url = (queryUrl || (body?.url as string) || '').trim();
    const format = (queryFormat || (body?.format as string) || 'json').toLowerCase();
    let images = body?.images as any[];

    if ((!images || images.length === 0) && url) {
      if (url.startsWith('preset:') || url.startsWith('mock:')) {
        const presetId = url.replace(/^(preset|mock):/, '');
        const matchingPreset = SAMPLE_PRESETS.find((p) => p.id === presetId || p.url === url);
        if (matchingPreset) {
          images = extractImagesFromHtml(matchingPreset.html, matchingPreset.url).images;
        }
      } else if (/13643086|33802089|jessie.*rogers/i.test(url)) {
        const jessiePreset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_jessie_rogers');
        if (jessiePreset) {
          images = extractImagesFromHtml(jessiePreset.html, jessiePreset.url).images;
        }
      } else {
        let liveFetchUrl = url;
        if (/imagefap\.com\/pictures\//i.test(liveFetchUrl) && !liveFetchUrl.includes('view=')) {
          liveFetchUrl += (liveFetchUrl.includes('?') ? '&' : '?') + 'view=2';
        }
        const resp = await fetch(liveFetchUrl, {
          headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,*/*' },
          signal: AbortSignal.timeout(12000),
        });
        if (resp.ok) {
          const html = await resp.text();
          images = extractImagesFromHtml(html, resp.url || liveFetchUrl).images;
        }
      }
    }

    if (!images || !Array.isArray(images)) {
      return NextResponse.json(
        { error: 'Please provide an "images" array or a valid "url" query parameter.' },
        { status: 400 }
      );
    }

    if (format === 'txt' || format === 'text') {
      const content = images
        .map((img) => img.fullUrl || img.url)
        .filter(Boolean)
        .join('\n');
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="full_image_links.txt"',
        },
      });
    }

    if (format === 'csv') {
      const rows = [
        'Index,Filename,DirectMasterUrl,WebpageUrl',
        ...images.map(
          (img, i) =>
            `${i + 1},"${(img.filename || '').replace(/"/g, '""')}","${(img.fullUrl || img.url || '').replace(/"/g, '""')}","${(img.linkedPageUrl || '').replace(/"/g, '""')}"`
        ),
      ];
      return new Response(rows.join('\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="full_image_links.csv"',
        },
      });
    }

    return NextResponse.json({
      total: images.length,
      directLinks: images.map((img) => img.fullUrl || img.url).filter(Boolean),
      webpageLinks: images
        .map((img) => img.linkedPageUrl || img.fullUrl || img.url)
        .filter(Boolean),
      images: images.map((img, i) => ({
        index: i + 1,
        filename: img.filename,
        directMasterUrl: img.fullUrl || img.url,
        webpageUrl: img.linkedPageUrl || null,
        width: img.width,
        height: img.height,
        resolutionTier: img.resolutionTier,
        isUnshrunk: img.isUnshrunk,
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to export links: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleLinks(req);
}

export async function POST(req: NextRequest) {
  return handleLinks(req);
}
