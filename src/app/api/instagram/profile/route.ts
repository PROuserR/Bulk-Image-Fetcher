import { NextRequest, NextResponse } from 'next/server';
import { parseInstagramProfileUrl } from '@/utils/instagramExtractor';
import { scrapeInstagramProfile } from '@/server/instagramService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      profileUrl,
      url,
      sessionCookie,
      maxPosts,
      relayUrl,
      resumeUserId,
      resumeCursor,
      resumeMaxId,
    } = body || {};
    const rawInput = String(profileUrl || url || '').trim();
    const igTarget = parseInstagramProfileUrl(rawInput);

    if (!igTarget) {
      return NextResponse.json(
        {
          error:
            'Please enter a valid Instagram profile URL (e.g. https://www.instagram.com/natgeo/ or @username).',
        },
        { status: 400 }
      );
    }

    const igResult = await scrapeInstagramProfile({
      profileUrl: igTarget.profileUrl,
      username: igTarget.username,
      sessionCookie,
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
          username: igTarget.username,
        },
        { status: igResult.status }
      );
    }

    return NextResponse.json(igResult.data);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Instagram profile fetch failed: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
