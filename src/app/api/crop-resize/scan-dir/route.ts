import { NextRequest, NextResponse } from 'next/server';
import { scanDirectoryImages } from '@/server/directoryImageService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { directoryPath, recursive = true } = body || {};
    const scan = await scanDirectoryImages(String(directoryPath || ''), {
      recursive: Boolean(recursive),
    });
    return NextResponse.json(scan);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to scan directory.' },
      { status: 400 }
    );
  }
}
