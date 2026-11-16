import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { isWithinRoot, isSupportedImageFilename } from '@/server/directoryImageService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

export async function GET(req: NextRequest) {
  try {
    const root = String(req.nextUrl.searchParams.get('root') || '').trim();
    const file = String(req.nextUrl.searchParams.get('file') || '').trim();
    if (!root || !file) {
      return NextResponse.json(
        { error: 'Missing root or file query parameter.' },
        { status: 400 }
      );
    }

    const resolvedRoot = path.resolve(root);
    const targetPath = path.resolve(resolvedRoot, file);
    if (!isWithinRoot(resolvedRoot, targetPath) || !isSupportedImageFilename(targetPath)) {
      return NextResponse.json(
        { error: 'Forbidden path or unsupported file type.' },
        { status: 403 }
      );
    }

    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return NextResponse.json({ error: 'Image file not found.' }, { status: 404 });
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
    const fileBuffer = fs.readFileSync(targetPath);

    return new Response(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.byteLength.toString(),
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to read image preview.' },
      { status: 500 }
    );
  }
}
