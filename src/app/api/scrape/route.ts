import { NextRequest, NextResponse } from 'next/server';
import { parseInstagramProfileUrl } from '@/utils/instagramExtractor';
import { scrapeInstagramProfile } from '@/server/instagramService';
import { scrapeSingleGallery } from '@/server/galleryScraperService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      url,
      customHtml,
      followLinkedPages,
      relayUrl,
      instagramSession,
      maxPosts,
      resumeUserId,
      resumeCursor,
      resumeMaxId,
    } = body || {};
    const targetUrl = String(url || '').trim();

    if (!targetUrl && !customHtml) {
      return NextResponse.json(
        {
          error:
            'Please provide a valid webpage URL, Instagram profile, preview image URL(s), HTML, or JSON manifest.',
        },
        { status: 400 }
      );
    }

    // Direct Instagram profile handling when entered into the main URL bar without customHtml
    if (!customHtml && targetUrl) {
      const igProfile = parseInstagramProfileUrl(targetUrl);
      if (igProfile) {
        const igResult = await scrapeInstagramProfile({
          profileUrl: igProfile.profileUrl,
          username: igProfile.username,
          sessionCookie: instagramSession,
          maxPosts,
          relayUrl,
          resumeUserId,
          resumeCursor,
          resumeMaxId,
        });
        if (!igResult.ok || !igResult.data) {
          return NextResponse.json(
            {
              error: igResult.error,
              loginRequired: igResult.loginRequired,
              sessionExpired: igResult.sessionExpired,
              instagramProfile: true,
              username: igProfile.username,
            },
            { status: igResult.status }
          );
        }
        return NextResponse.json(igResult.data);
      }
    }

    const scrapeOutcome = await scrapeSingleGallery({
      url: targetUrl,
      customHtml,
      followLinkedPages: followLinkedPages ?? true,
      relayUrl,
    });

    if (!scrapeOutcome.ok || !scrapeOutcome.result) {
      return NextResponse.json(
        {
          error: scrapeOutcome.error || 'Failed to scrape target webpage.',
          geoBlocked: scrapeOutcome.geoBlocked,
        },
        { status: scrapeOutcome.status || 500 }
      );
    }

    return NextResponse.json({
      ...scrapeOutcome.result,
      geoBlocked: Boolean(scrapeOutcome.geoBlocked),
      notice: scrapeOutcome.notice,
      suggestedNestedHub: Boolean(scrapeOutcome.suggestedNestedHub),
      suggestedNestedCount: scrapeOutcome.suggestedNestedCount || 0,
    });
  } catch (err: any) {
    console.error('Scrape error:', err);
    return NextResponse.json(
      { error: `Internal scraping error: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
