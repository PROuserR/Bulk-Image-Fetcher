import { NextRequest, NextResponse } from 'next/server';
import {
  analyzeHumanImageBatch,
  mapClassifierError,
} from '@/server/humanClassifierService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { images } = body || {};

    if (!Array.isArray(images) || images.length === 0) {
      return NextResponse.json(
        { error: 'At least one image payload is required for facial and body analysis.' },
        { status: 400 }
      );
    }

    const profiles = await analyzeHumanImageBatch(images);
    return NextResponse.json({ profiles });
  } catch (err: unknown) {
    const mapped = mapClassifierError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
