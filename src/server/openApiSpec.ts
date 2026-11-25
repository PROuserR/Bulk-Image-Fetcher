/**
 * @module openApiSpec
 * Generates a machine-readable OpenAPI 3.1.0 specification (`GET /api/openapi.json`)
 * describing the Ultimate Image Processor REST API for Swagger/OpenAPI clients, SDKs,
 * automation pipelines, and curl consumers.
 */
import { COLOR_PRESETS, DEFAULT_ADJUSTMENTS } from '../utils/imageFilterLogic.ts';

/**
 * Builds the complete OpenAPI 3.1.0 schema object for the running service instance.
 */
export function buildOpenApiDocument(serverUrl = 'http://localhost:3000') {
  const cleanServerUrl = (serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
  const presetEnum = COLOR_PRESETS.map((p) => p.id);

  return {
    openapi: '3.1.0',
    info: {
      title: 'Ultimate Image Processor REST API',
      version: '1.0.0',
      description:
        'Full-resolution web & Instagram extraction, AI human-face filtering, stateless image crop/resize/color-grading, compressed .7z/.zip archive streaming, offline human clustering, and Gemma 4 Vision endpoints.',
      license: {
        name: 'Apache-2.0',
      },
    },
    servers: [
      {
        url: cleanServerUrl,
        description: 'Active Ultimate Image Processor Server',
      },
    ],
    tags: [
      { name: 'System', description: 'Health, capabilities, and OpenAPI schema discovery' },
      { name: 'Processing', description: 'Stateless server-side image crop, resize, color grading, and format conversion' },
      { name: 'Capture', description: 'Webpage, nested gallery hub, Instagram, and deep link extraction' },
      { name: 'AI Vision', description: 'Gemini human-face isolation, InsightFace clustering, and Gemma 4 Vision' },
      { name: 'Delivery', description: 'Resumable .7z/.zip archive packaging, proxies, and link exports' },
    ],
    paths: {
      '/api/health': {
        get: {
          tags: ['System'],
          summary: 'Check service health and available capabilities',
          responses: {
            '200': {
              description: 'Service metadata, configured AI integrations, and supported formats/presets.',
            },
          },
        },
      },
      '/api/openapi.json': {
        get: {
          tags: ['System'],
          summary: 'Retrieve the OpenAPI 3.1.0 specification',
          responses: {
            '200': {
              description: 'OpenAPI 3.1.0 JSON schema document.',
            },
          },
        },
      },
      '/api/process': {
        get: {
          tags: ['Processing'],
          summary: 'Inspect supported presets, adjustments, and parameter defaults',
          responses: {
            '200': {
              description: 'Supported presets, adjustment parameter bounds, resize modes, and formats.',
            },
          },
        },
        post: {
          tags: ['Processing'],
          summary: 'Crop, resize, color-grade, and convert an image via URL, base64, or multipart upload',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    imageUrl: { type: 'string', format: 'uri', description: 'Public http/https URL to fetch and process.' },
                    imageBase64: { type: 'string', description: 'Raw base64 or data:image/*;base64,... payload.' },
                    preset: { type: 'string', enum: presetEnum, default: 'original' },
                    adjustments: {
                      type: 'object',
                      description: `Partial map of tone/FX adjustments (defaults: ${Object.keys(DEFAULT_ADJUSTMENTS).join(', ')})`,
                    },
                    crop: {
                      type: 'object',
                      properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        width: { type: 'number' },
                        height: { type: 'number' },
                        xRatio: { type: 'number', minimum: 0, maximum: 1 },
                        yRatio: { type: 'number', minimum: 0, maximum: 1 },
                        widthRatio: { type: 'number', minimum: 0.01, maximum: 1 },
                        heightRatio: { type: 'number', minimum: 0.01, maximum: 1 },
                      },
                    },
                    resize: {
                      type: 'object',
                      properties: {
                        mode: { type: 'string', enum: ['original', 'exact', 'maxEdge', 'percent'] },
                        width: { type: 'integer', minimum: 1, maximum: 8192 },
                        height: { type: 'integer', minimum: 1, maximum: 8192 },
                        maxEdge: { type: 'integer', minimum: 1, maximum: 8192 },
                        percent: { type: 'number', minimum: 1, maximum: 400 },
                        fit: { type: 'string', enum: ['cover', 'contain', 'fill'] },
                        lockAspect: { type: 'boolean' },
                      },
                    },
                    format: { type: 'string', enum: ['keep', 'jpeg', 'png', 'webp', 'avif'], default: 'keep' },
                    quality: { type: 'integer', minimum: 40, maximum: 100, default: 90 },
                    detectFaces: { type: 'boolean', default: false, description: 'Optionally run Gemini AI face detection on the output.' },
                    responseType: { type: 'string', enum: ['binary', 'json'], default: 'binary' },
                  },
                },
              },
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    options: { type: 'string', description: 'Optional JSON string matching the application/json options.' },
                    preset: { type: 'string', enum: presetEnum },
                    format: { type: 'string', enum: ['keep', 'jpeg', 'png', 'webp', 'avif'] },
                    quality: { type: 'integer' },
                    responseType: { type: 'string', enum: ['binary', 'json'] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Processed binary image (default) or JSON envelope containing base64 dataUri, metadata, and optional faceDetection.',
            },
            '400': { description: 'Missing image source or invalid parameters.' },
            '422': { description: 'Unsupported or corrupted image payload.' },
          },
        },
      },
      '/api/scrape': {
        post: {
          tags: ['Capture'],
          summary: 'Extract full-resolution images from a webpage, Instagram profile, HTML snippet, or manifest',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string' },
                    customHtml: { type: 'string' },
                    followLinkedPages: { type: 'boolean', default: true },
                    relayUrl: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Extracted image list, stats, and metadata.' },
          },
        },
      },
      '/api/scrape/discover-galleries': {
        post: {
          tags: ['Capture'],
          summary: 'Discover and score child gallery links on a parent hub/category webpage',
          responses: {
            '200': { description: 'Ranked list of child gallery URLs and thumbnails.' },
          },
        },
      },
      '/api/scrape/nested': {
        post: {
          tags: ['Capture'],
          summary: 'Crawl multiple child galleries concurrently and merge unique masters',
          responses: {
            '200': { description: 'Merged gallery results with per-gallery summaries.' },
          },
        },
      },
      '/api/instagram/profile': {
        post: {
          tags: ['Capture'],
          summary: 'Extract paginated posts, carousels, and HD avatars from an Instagram profile',
          responses: {
            '200': { description: 'Instagram profile feed images and pagination cursors.' },
          },
        },
      },
      '/api/ai/human-face-filter': {
        post: {
          tags: ['AI Vision'],
          summary: 'Evaluate up to 12 images via Gemini multimodal vision for visible human faces',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['images'],
                  properties: {
                    images: {
                      type: 'array',
                      maxItems: 12,
                      items: {
                        type: 'object',
                        required: ['id', 'url'],
                        properties: {
                          id: { type: 'string' },
                          url: { type: 'string' },
                          thumbnailUrl: { type: 'string' },
                          previewDataUrl: { type: 'string' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Per-image face detection verdicts with confidence and subject summaries.' },
          },
        },
      },
      '/api/links': {
        get: {
          tags: ['Delivery'],
          summary: 'Export extracted master links as JSON, CSV, or TXT',
          responses: {
            '200': { description: 'Link dataset in json, csv, or txt format.' },
          },
        },
        post: {
          tags: ['Delivery'],
          summary: 'Export supplied or scraped image links as JSON, CSV, or TXT',
          responses: {
            '200': { description: 'Link dataset in json, csv, or txt format.' },
          },
        },
      },
      '/api/download-zip': {
        post: {
          tags: ['Delivery'],
          summary: 'Package selected image URLs into an LZMA2 .7z or .zip archive (direct or NDJSON progress)',
          responses: {
            '200': { description: 'Binary archive or NDJSON progress stream ending with staged Range download token.' },
          },
        },
        get: {
          tags: ['Delivery'],
          summary: 'Download a staged archive token with HTTP Range (206 Partial Content) resume support',
          parameters: [
            { name: 'token', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'resumable', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Complete staged archive binary.' },
            '206': { description: 'Partial byte range slice of the staged archive.' },
          },
        },
      },
    },
  };
}
