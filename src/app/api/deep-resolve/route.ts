import { NextRequest, NextResponse } from 'next/server';
import { extractBestImageFromDetailPage } from '@/utils/htmlExtractor';
import {
  DEFAULT_USER_AGENT,
  buildRelayTarget,
  isGeoBlockedHtml,
} from '@/server/fetchHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { linkedPageUrl, relayUrl } = body || {};
    if (!linkedPageUrl) {
      return NextResponse.json({ error: 'Missing linkedPageUrl parameter' }, { status: 400 });
    }

    const subResp = await fetch(buildRelayTarget(linkedPageUrl, relayUrl), {
      headers: { 'User-Agent': DEFAULT_USER_AGENT, Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(9000),
    });

    if (!subResp.ok) {
      return NextResponse.json(
        { error: `Detail page returned HTTP ${subResp.status}` },
        { status: subResp.status }
      );
    }

    const subHtml = await subResp.text();
    if (isGeoBlockedHtml(subHtml, subResp.url)) {
      return NextResponse.json(
        {
          geoBlocked: true,
          error:
            'Target detail page hit UK geo-block (uk_ban_ifap). Use a Relay Worker URL or Open-Tab Harvester in your browser.',
        },
        { status: 403 }
      );
    }

    const resolved = extractBestImageFromDetailPage(subHtml, subResp.url || linkedPageUrl);
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
