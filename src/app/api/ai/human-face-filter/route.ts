import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeImagesForHumanFaces,
  mapGeminiFaceError,
  type HumanFaceScanInput,
} from '@/server/humanFaceFilterService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/human-face-filter
 * Evaluates up to 12 scraped images per batch via Gemini multimodal vision to detect
 * visible human faces ("Only Person · Exclude Landscape (AI)") with server LRU caching.
 */
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
        referer: typeof img.referer === 'string' ? img.referer : undefined,
        previewDataUrl:
          typeof img.previewDataUrl === 'string' &&
          img.previewDataUrl.startsWith('data:image/') &&
          img.previewDataUrl.length <= 1_500_000
            ? img.previewDataUrl
            : undefined,
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
