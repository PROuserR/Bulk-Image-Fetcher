import { NextRequest, NextResponse } from 'next/server';
import { buildClassifiedDiskZip } from '@/server/humanClassifierService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sourceDir, clusters, profiles, imageRelativePaths } = body || {};

    if (!sourceDir || !Array.isArray(clusters) || !Array.isArray(profiles)) {
      return NextResponse.json(
        { error: 'sourceDir, clusters, and profiles are required.' },
        { status: 400 }
      );
    }

    const zipBuf = await buildClassifiedDiskZip({
      sourceDir,
      clusters,
      profiles,
      imageRelativePaths: imageRelativePaths || {},
    });

    return new Response(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': zipBuf.length.toString(),
        'Content-Disposition': `attachment; filename="classified_humans_${Date.now()}.zip"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to build classified ZIP archive.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
