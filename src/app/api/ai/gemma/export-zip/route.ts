import JSZip from 'jszip';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildCaptionsCsv,
  buildCaptionsJson,
  buildCaptionsMarkdown,
  buildSidecarCaptionFilename,
  buildSidecarTextContent,
  CaptionedImageResult,
  CaptionStyle,
} from '@/utils/gemmaCaptionLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const items: CaptionedImageResult[] = Array.isArray(body?.items) ? body.items : [];
    const sourceLabel = String(body?.sourceLabel || 'Selected Images');
    const style: CaptionStyle =
      body?.style === 'concise' || body?.style === 'structured' || body?.style === 'alt_text'
        ? body.style
        : 'detailed';

    if (items.length === 0) {
      return NextResponse.json({ error: 'No captioned items to export.' }, { status: 400 });
    }

    const zip = new JSZip();
    const meta = { model: 'Gemma 4 E2B (Open-Source Local)', sourceLabel, style };

    zip.file('captions.json', buildCaptionsJson(items, meta));
    zip.file('captions.csv', buildCaptionsCsv(items));
    zip.file('captions.md', buildCaptionsMarkdown(items, meta));

    const sidecarsFolder = zip.folder('sidecars');
    if (sidecarsFolder) {
      for (const item of items) {
        if (item.error) continue;
        const sidecarName = buildSidecarCaptionFilename(item.relativePath || item.filename);
        sidecarsFolder.file(sidecarName, buildSidecarTextContent(item));
      }
    }

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="gemma4_captions_${Date.now()}.zip"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to package captions ZIP archive.' },
      { status: 500 }
    );
  }
}
