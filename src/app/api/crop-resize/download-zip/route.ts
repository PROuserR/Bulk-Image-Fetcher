import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import { isWithinRoot, processSingleServerImage } from '@/server/directoryImageService';
import { buildOutputFilename } from '@/utils/imageTransformLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sourceDir, items, resize, output } = body || {};
    if (!sourceDir || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Source directory and at least one image are required.' },
        { status: 400 }
      );
    }

    const resolvedSourceDir = path.resolve(String(sourceDir));
    const zip = new JSZip();
    let addedCount = 0;

    for (const item of items) {
      const inputPath = path.resolve(resolvedSourceDir, item.relativePath);
      if (!isWithinRoot(resolvedSourceDir, inputPath) || !fs.existsSync(inputPath)) {
        continue;
      }
      const result = await processSingleServerImage(inputPath, {
        cropEnabled: item.cropEnabled,
        cropRect: item.cropRect,
        normalizedCrop: item.normalizedCrop,
        resize,
        output,
      });
      const outRel = buildOutputFilename(item.relativePath, output);
      zip.file(outRel, result.buffer);
      addedCount++;
    }

    if (addedCount === 0) {
      return NextResponse.json({ error: 'No valid images found to package.' }, { status: 400 });
    }

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return new Response(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': zipBuf.length.toString(),
        'Content-Disposition': `attachment; filename="cropped_resized_${Date.now()}.zip"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to build ZIP archive.' },
      { status: 500 }
    );
  }
}
