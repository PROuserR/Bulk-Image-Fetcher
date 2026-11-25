import { NextRequest, NextResponse } from 'next/server';
import { COLOR_PRESETS, DEFAULT_ADJUSTMENTS } from '@/utils/imageFilterLogic';
import { HumanFaceFilterError } from '@/server/humanFaceFilterService';
import {
  decodeInputBase64Image,
  fetchPublicImageBuffer,
  ImageProcessError,
  MAX_PROCESS_DIMENSION,
  MAX_PROCESS_IMAGE_BYTES,
  parseProcessRequestOptions,
  processImageBuffer,
} from '@/server/imageProcessService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/process
 * Returns the parameter contract, supported color presets, adjustment keys,
 * and output formats accepted by `POST /api/process`.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: '/api/process',
    method: 'POST',
    accepts: ['application/json', 'multipart/form-data'],
    presets: COLOR_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      tagline: p.tagline,
    })),
    adjustmentKeys: Object.keys(DEFAULT_ADJUSTMENTS),
    resizeModes: ['original', 'exact', 'maxEdge', 'percent'],
    resizeFits: ['cover', 'contain', 'fill'],
    outputFormats: ['keep', 'jpeg', 'png', 'webp', 'avif'],
    responseTypes: ['binary', 'json'],
    limits: {
      maxInputBytes: MAX_PROCESS_IMAGE_BYTES,
      maxDimensionPx: MAX_PROCESS_DIMENSION,
    },
  });
}

/**
 * POST /api/process
 * Stateless headless image processing API.
 * Accepts either JSON (`imageUrl` or `imageBase64`) or `multipart/form-data` (`file`),
 * applies crop, resize, studio color presets / 14 tone-FX sliders, and format encoding
 * via `sharp`, with optional Gemini human-face detection (`detectFaces: true`).
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = (req.headers.get('content-type') || '').toLowerCase();
    let rawParams: Record<string, any> = {};
    let inputBuffer: Buffer | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const fileEntry = formData.get('file');
      if (!fileEntry || typeof fileEntry === 'string') {
        return NextResponse.json(
          { error: 'Multipart requests must include a binary "file" field.' },
          { status: 400 }
        );
      }
      if (fileEntry.size > MAX_PROCESS_IMAGE_BYTES) {
        return NextResponse.json(
          { error: 'Uploaded file exceeds the 25 MB processing limit.' },
          { status: 413 }
        );
      }
      inputBuffer = Buffer.from(await fileEntry.arrayBuffer());

      const optionsJson = formData.get('options');
      if (typeof optionsJson === 'string' && optionsJson.trim()) {
        try {
          rawParams = JSON.parse(optionsJson);
        } catch {
          return NextResponse.json(
            { error: 'Invalid JSON inside multipart "options" field.' },
            { status: 400 }
          );
        }
      } else {
        for (const key of ['preset', 'format', 'quality', 'responseType', 'detectFaces']) {
          const val = formData.get(key);
          if (typeof val === 'string') rawParams[key] = val;
        }
      }
    } else {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return NextResponse.json(
          { error: 'Expected JSON body with "imageUrl" or "imageBase64", or multipart/form-data with "file".' },
          { status: 400 }
        );
      }
      rawParams = body;

      if (typeof body.imageBase64 === 'string' && body.imageBase64.trim()) {
        inputBuffer = decodeInputBase64Image(body.imageBase64);
      } else if (typeof body.imageUrl === 'string' && body.imageUrl.trim()) {
        inputBuffer = await fetchPublicImageBuffer(body.imageUrl);
      } else {
        return NextResponse.json(
          { error: 'Provide either "imageUrl", "imageBase64", or a multipart "file" upload.' },
          { status: 400 }
        );
      }
    }

    const options = parseProcessRequestOptions(rawParams);
    const result = await processImageBuffer(inputBuffer, options);

    if (options.responseType === 'json') {
      const base64 = result.buffer.toString('base64');
      return NextResponse.json({
        success: true,
        format: result.format,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        sourceWidth: result.sourceWidth,
        sourceHeight: result.sourceHeight,
        sizeBytes: result.sizeBytes,
        appliedPreset: result.appliedPreset,
        ...(result.faceDetection !== undefined ? { faceDetection: result.faceDetection } : {}),
        imageBase64: base64,
        dataUri: `data:${result.mimeType};base64,${base64}`,
      });
    }

    const ext = result.format === 'jpeg' ? 'jpg' : result.format;
    return new Response(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': result.sizeBytes.toString(),
        'Content-Disposition': `inline; filename="processed_${result.appliedPreset}.${ext}"`,
        'X-Image-Width': result.width.toString(),
        'X-Image-Height': result.height.toString(),
        'X-Image-Format': result.format,
        'X-Image-Preset': result.appliedPreset,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: unknown) {
    if (err instanceof ImageProcessError || err instanceof HumanFaceFilterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Unknown image processing error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
