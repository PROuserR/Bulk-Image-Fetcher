import { NextRequest, NextResponse } from 'next/server';
import { processDirectoryImages } from '@/server/directoryImageService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sourceDir, outputDir, items, resize, output, overwrite } = body || {};
    if (!sourceDir || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Source directory and at least one selected image are required.' },
        { status: 400 }
      );
    }

    const result = await processDirectoryImages({
      sourceDir,
      outputDir,
      items,
      resize,
      output,
      overwrite: Boolean(overwrite),
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Directory processing failed.' },
      { status: 500 }
    );
  }
}
