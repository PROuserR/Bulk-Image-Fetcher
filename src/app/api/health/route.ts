import { NextRequest, NextResponse } from 'next/server';
import { COLOR_PRESETS } from '@/utils/imageFilterLogic';
import { MAX_PROCESS_DIMENSION, MAX_PROCESS_IMAGE_BYTES } from '@/server/imageProcessService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Reports service health, version, active AI/imaging capabilities, supported formats,
 * and available color-grading presets for external REST API consumers.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;

  return NextResponse.json({
    status: 'ok',
    app: 'Ultimate Image Processor',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      openapi: `${origin}/api/openapi.json`,
      process: `${origin}/api/process`,
      scrape: `${origin}/api/scrape`,
      discoverGalleries: `${origin}/api/scrape/discover-galleries`,
      nestedScrape: `${origin}/api/scrape/nested`,
      humanFaceFilter: `${origin}/api/ai/human-face-filter`,
      downloadArchive: `${origin}/api/download-zip`,
      links: `${origin}/api/links`,
    },
    capabilities: {
      sharpNative: true,
      archive7zLzma2: true,
      archiveZip: true,
      geminiFaceFilterConfigured: Boolean((process.env.GEMINI_API_KEY || '').trim()),
      gemmaServerUrlConfigured: Boolean((process.env.GEMMA_SERVER_URL || '').trim()),
    },
    limits: {
      maxProcessImageBytes: MAX_PROCESS_IMAGE_BYTES,
      maxProcessDimension: MAX_PROCESS_DIMENSION,
      maxFaceFilterBatch: 12,
    },
    supportedOutputFormats: ['jpeg', 'png', 'webp', 'avif'],
    presets: COLOR_PRESETS.map((p) => ({ id: p.id, label: p.label, tagline: p.tagline })),
  });
}
