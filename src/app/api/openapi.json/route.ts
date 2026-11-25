import { NextRequest, NextResponse } from 'next/server';
import { buildOpenApiDocument } from '@/server/openApiSpec';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/openapi.json
 * Returns the machine-readable OpenAPI 3.1.0 JSON specification for the
 * Ultimate Image Processor REST API.
 */
export async function GET(req: NextRequest) {
  const baseUrl = process.env.APP_URL?.trim() || req.nextUrl.origin;
  const spec = buildOpenApiDocument(baseUrl);

  return NextResponse.json(spec, {
    headers: {
      'Cache-Control': 'public, max-age=300',
    },
  });
}
