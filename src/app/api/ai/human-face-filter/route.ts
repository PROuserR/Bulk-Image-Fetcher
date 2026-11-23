import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeImagesForHumanFaces,
  mapGeminiFaceError,
  type HumanFaceScanInput,
} from '@/server/humanFaceFilterService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { images, referer, relayUrl } = body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: 'Please provide at least one image to scan for human faces.' },
        { status: 400 }
      );
    }

    const sanitizedInputs: HumanFaceScanInput[] = images
      .slice(0, 12)
      .filter((img: any) => img && typeof img.id === 'string' && typeof img.url === 'string')
      .map((img: any) => ({
        id: img.id,
        url: img.url,
        thumbnailUrl: typeof img.thumbnailUrl === 'string' ? img.thumbnailUrl : undefined,
        fallbackUrl: typeof img.fallbackUrl === 'string' ? img.fallbackUrl : undefined,
        linkedPageUrl: typeof img.linkedPageUrl === 'string' ? img.linkedPageUrl : undefined,
        filename: typeof img.filename === 'string' ? img.filename : undefined,
      }));

    if (sanitizedInputs.length === 0) {
      return NextResponse.json(
        { error: 'No valid image entries provided for AI face detection.' },
        { status: 400 }
      );
    }

    const outcome = await analyzeImagesForHumanFaces(sanitizedInputs, {
      referer: typeof referer === 'string' ? referer : undefined,
      relayUrl: typeof relayUrl === 'string' ? relayUrl : undefined,
    });

    return NextResponse.json(outcome);
  } catch (err: unknown) {
    const mapped = mapGeminiFaceError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
