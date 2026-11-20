import { NextRequest, NextResponse } from 'next/server';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import {
  isGeoBlockedHtml,
  fetchDetailPageHtmlSmart,
} from '@/server/fetchHelpers';
import { resolveVirtualPresetHtml } from '@/server/galleryScraperService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { linkedPageUrl, relayUrl } = body || {};
    if (!linkedPageUrl) {
      return NextResponse.json({ error: 'Missing linkedPageUrl parameter' }, { status: 400 });
    }

    const virtualMatch = resolveVirtualPresetHtml(linkedPageUrl);
    const subResp = virtualMatch
      ? { ok: true, status: 200, statusText: 'OK', url: virtualMatch.url, html: virtualMatch.html }
      : await fetchDetailPageHtmlSmart(linkedPageUrl, {
          relayUrl,
          timeoutMs: 12000,
        });

    if (!subResp.ok) {
      return NextResponse.json(
        { error: `Detail page returned HTTP ${subResp.status}` },
        { status: subResp.status }
      );
    }

    if (isGeoBlockedHtml(subResp.html, subResp.url)) {
      return NextResponse.json(
        {
          geoBlocked: true,
          error:
            'Target detail page hit UK geo-block (uk_ban_ifap). Use a Relay Worker URL or Open-Tab Harvester in your browser.',
        },
        { status: 403 }
      );
    }

    const resolved = extractBestImageFromDetailPage(subResp.html, subResp.url || linkedPageUrl);
    if (!resolved) {
      return NextResponse.json(
        { error: 'Could not extract high-res image from linked detail page' },
        { status: 404 }
      );
    }

    return NextResponse.json(resolved);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Deep resolve failed: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
