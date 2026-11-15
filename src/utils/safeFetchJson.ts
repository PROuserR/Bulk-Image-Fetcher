export interface ParsedApiResponse<T = any> {
  ok: boolean;
  data: T | null;
  error?: string;
}

/**
 * Safely parses an API response body without throwing raw SyntaxError when a proxy,
 * gateway timeout (502/504), or fallback server returns an HTML page instead of JSON.
 */
export function parseSafeApiResponse<T = any>(
  rawText: string,
  httpStatus: number,
  httpOk: boolean,
  statusText = ''
): ParsedApiResponse<T> {
  const trimmed = (rawText || '').trim();

  if (!trimmed) {
    return {
      ok: httpOk,
      data: null,
      error: httpOk
        ? undefined
        : `Server returned an empty response (HTTP ${httpStatus}${statusText ? ` ${statusText}` : ''}).`,
    };
  }

  // Strip optional XSSI prefix like "for (;;);" if present
  const jsonCandidate = trimmed.startsWith('for (;;);') ? trimmed.slice(9).trim() : trimmed;

  if (jsonCandidate.startsWith('{') || jsonCandidate.startsWith('[')) {
    try {
      const parsed = JSON.parse(jsonCandidate) as T;
      return { ok: httpOk, data: parsed };
    } catch {
      // Fall through to HTML/plain-text error extraction
    }
  }

  // Non-JSON body (typically HTML error/timeout page from gateway or reverse proxy)
  if (trimmed.startsWith('<') || /<html/i.test(trimmed)) {
    const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    if (httpStatus === 504 || /504|gateway time-?out/i.test(title)) {
      return {
        ok: false,
        data: null,
        error:
          'Server request timed out (HTTP 504). For Instagram profiles, try lowering Max Photos or use the 1-Click IG Profile Harvester inside a logged-in Instagram browser tab.',
      };
    }

    if (httpStatus === 502 || /502|bad gateway/i.test(title)) {
      return {
        ok: false,
        data: null,
        error:
          'Upstream proxy returned HTTP 502 (Bad Gateway). The remote host or Instagram endpoint closed the connection.',
      };
    }

    return {
      ok: false,
      data: null,
      error: `Server returned an HTML response instead of JSON (HTTP ${httpStatus}${
        title ? ` — ${title}` : ''
      }). Try using the 1-Click Harvester or Paste Box.`,
    };
  }

  return {
    ok: false,
    data: null,
    error: `Unexpected non-JSON response (HTTP ${httpStatus}): ${trimmed.slice(0, 140)}`,
  };
}

/**
 * Fetches an API endpoint and safely parses JSON, converting HTML/proxy errors into readable messages.
 */
export async function fetchApiJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; data: T | null; error?: string }> {
  const response = await fetch(input, init);
  const rawText = await response.text();
  const parsed = parseSafeApiResponse<T>(rawText, response.status, response.ok, response.statusText);
  return {
    status: response.status,
    ok: parsed.ok,
    data: parsed.data,
    error: parsed.error,
  };
}
