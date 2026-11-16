import { NextRequest, NextResponse } from 'next/server';
import { writeClassifiedDiskFolders } from '@/server/humanClassifierService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sourceDir, outputDir, clusters, profiles, imageRelativePaths } = body || {};

    if (!sourceDir || !Array.isArray(clusters) || !Array.isArray(profiles)) {
      return NextResponse.json(
        { error: 'sourceDir, clusters, and profiles are required.' },
        { status: 400 }
      );
    }

    const result = await writeClassifiedDiskFolders({
      sourceDir,
      outputDir,
      clusters,
      profiles,
      imageRelativePaths: imageRelativePaths || {},
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to write classified folders.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
