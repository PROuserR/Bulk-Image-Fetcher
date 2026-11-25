import JSZip from 'jszip';
import { NextResponse } from 'next/server';
import { addDirectoryToZip } from '@/server/scrapeRouteHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const zip = new JSZip();
    const excluded = new Set([
      'node_modules',
      '.git',
      '.next',
      'dist',
      '.playwright-cli',
      '.venv',
      'venv',
      'models',
      '__pycache__',
    ]);
    addDirectoryToZip(process.cwd(), zip, excluded);

    const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return new Response(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="ultimate_image_processor_codebase.zip"',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to package full codebase: ${err?.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
