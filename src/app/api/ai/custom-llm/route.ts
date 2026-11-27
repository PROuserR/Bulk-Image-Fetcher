import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildOllamaChatPayload,
  buildOpenAiCompatChatPayload,
  isPrivateOrLinkLocalHostname,
  LlmProviderMode,
  validateLlmEndpointUrl,
} from '@/utils/customLlmConfig';
import type { OpenAiChatMessage } from '@/utils/gemmaCaptionLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPrivateIpAddress(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '');
  if (net.isIPv4(clean)) {
    return isPrivateOrLinkLocalHostname(clean);
  }
  if (net.isIPv6(clean)) {
    const lower = clean.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80:')
    );
  }
  return false;
}

async function assertServerProxyAllowed(parsed: URL): Promise<void> {
  const allowLocal = process.env.ALLOW_LOCAL_LLM_PROXY === 'true';
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // Always block cloud instance metadata endpoints
  if (
    hostname === '169.254.169.254' ||
    hostname === 'metadata.google.internal' ||
    hostname === 'metadata.goog' ||
    hostname === '100.100.100.200'
  ) {
    throw new Error('Metadata service endpoints are blocked.');
  }

  if (allowLocal) {
    return;
  }

  if (isPrivateOrLinkLocalHostname(hostname)) {
    throw new Error(
      'Localhost and private LAN LLM URLs cannot be reached from a remote server proxy. Switch Connection Routing to "Browser Direct (Offline)" to connect straight to your local Ollama or LM Studio instance.'
    );
  }

  try {
    const resolved = await dns.lookup(hostname, { all: true });
    for (const addr of resolved) {
      if (isPrivateIpAddress(addr.address)) {
        throw new Error(
          'Resolved host points to a private or loopback IP. Switch Connection Routing to "Browser Direct (Offline)" for local networks.'
        );
      }
    }
  } catch (err: any) {
    if (err?.message?.includes('private') || err?.message?.includes('loopback')) {
      throw err;
    }
    // If DNS lookup fails temporarily, let fetch surface the concrete network error
  }
}

function buildOptionalServerAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const serverApiKey = (process.env.CUSTOM_LLM_API_KEY || '').trim();
  if (serverApiKey) {
    headers.Authorization = `Bearer ${serverApiKey}`;
  }
  return headers;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'models' ? 'models' : 'chat';
    const provider: Exclude<LlmProviderMode, 'builtin'> =
      body?.provider === 'openai-compat' ? 'openai-compat' : 'ollama';

    const validation = validateLlmEndpointUrl(String(body?.baseUrl || ''), provider);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    try {
      await assertServerProxyAllowed(validation.parsed);
    } catch (policyErr: any) {
      return NextResponse.json(
        { error: policyErr?.message || 'Endpoint blocked by server proxy policy.' },
        { status: 403 }
      );
    }

    const baseUrl = validation.normalizedUrl;
    const optionalAuth = buildOptionalServerAuthHeaders();

    if (action === 'models') {
      const targetUrl =
        provider === 'ollama' ? `${baseUrl}/api/tags` : `${baseUrl}/models`;
      const upstream = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...optionalAuth,
        },
        signal: req.signal ?? AbortSignal.timeout(12_000),
      });

      const rawText = await upstream.text();
      if (!upstream.ok) {
        return NextResponse.json(
          {
            error: `Upstream LLM returned HTTP ${upstream.status}: ${rawText.slice(0, 240) || upstream.statusText}`,
          },
          { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
        );
      }

      try {
        const parsedJson = JSON.parse(rawText);
        return NextResponse.json(parsedJson);
      } catch {
        return NextResponse.json(
          { error: 'Upstream LLM endpoint did not return valid JSON model metadata.' },
          { status: 502 }
        );
      }
    }

    // Chat / completion proxy
    const model = String(body?.model || '').trim();
    if (!model) {
      return NextResponse.json({ error: 'Model ID is required.' }, { status: 400 });
    }

    const messages = Array.isArray(body?.messages)
      ? (body.messages as OpenAiChatMessage[])
      : [];
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'At least one message is required.' },
        { status: 400 }
      );
    }

    const stream = Boolean(body?.stream);
    const temperature =
      typeof body?.temperature === 'number' ? body.temperature : 0.3;
    const maxTokens =
      typeof body?.maxTokens === 'number' ? body.maxTokens : 700;

    const targetUrl =
      provider === 'ollama' ? `${baseUrl}/api/chat` : `${baseUrl}/chat/completions`;
    const payload =
      provider === 'ollama'
        ? buildOllamaChatPayload({ model, messages, temperature, maxTokens, stream })
        : buildOpenAiCompatChatPayload({
            model,
            messages,
            temperature,
            maxTokens,
            stream,
          });

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...optionalAuth,
      },
      body: JSON.stringify(payload),
      signal: req.signal ?? AbortSignal.timeout(180_000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          error: `Upstream LLM error (HTTP ${upstream.status}): ${errText.slice(0, 320) || upstream.statusText}`,
        },
        { status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502 }
      );
    }

    const contentType =
      upstream.headers.get('content-type') ||
      (stream
        ? provider === 'ollama'
          ? 'application/x-ndjson; charset=utf-8'
          : 'text/event-stream; charset=utf-8'
        : 'application/json; charset=utf-8');

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to connect to custom LLM endpoint.' },
      { status: 502 }
    );
  }
}
