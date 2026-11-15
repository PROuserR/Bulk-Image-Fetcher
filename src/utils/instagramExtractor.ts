import * as cheerio from 'cheerio';
import type { ScrapedImage } from './scraperLogic.ts';
import { classifyResolution, detectFormat } from './scraperLogic.ts';

export interface InstagramProfileTarget {
  username: string;
  profileUrl: string;
  tab?: 'posts' | 'reels' | 'tagged';
}

export interface InstagramExtractionPage {
  userId?: string;
  username?: string;
  fullName?: string;
  profilePicUrl?: string;
  postsCount?: number;
  images: ScrapedImage[];
  hasNextPage: boolean;
  endCursor?: string;
  nextMaxId?: string;
  shortcodesToEnrich?: string[];
}

export interface InstagramParsedCookies {
  header?: string;
  cookies: Record<string, string>;
  csrfToken?: string;
  sessionId?: string;
  dsUserId?: string;
  hasSessionId: boolean;
}

export interface InstagramHtmlTokens {
  lsd?: string;
  fbDtsg?: string;
  csrfToken?: string;
  appId?: string;
  asbdId?: string;
  userId?: string;
}

const RESERVED_IG_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'api',
  'static',
  'legal',
  'about',
  'developer',
  'challenge',
  'oauth',
  'privacy',
]);

/**
 * Parses an Instagram profile URL or @handle into a canonical username + profile URL.
 * Returns null for post/reel/explore URLs or non-Instagram URLs.
 */
export function parseInstagramProfileUrl(input: string): InstagramProfileTarget | null {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Support "@username" shorthand directly
  if (/^@[a-zA-Z0-9._]{1,30}$/.test(trimmed)) {
    const username = trimmed.slice(1);
    return {
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
    };
  }

  let candidate = trimmed;
  if (/^(?:www\.|m\.|i\.)?instagram\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const u = new URL(candidate);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) {
      return null;
    }

    const segments = u.pathname
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 0) return null;

    const first = segments[0];
    if (RESERVED_IG_PATHS.has(first.toLowerCase())) {
      return null;
    }

    if (!/^[a-zA-Z0-9._]{1,30}$/.test(first)) {
      return null;
    }

    const second = segments[1]?.toLowerCase();
    if (
      segments.length > 1 &&
      !['feed', 'tagged', 'channel', 'reels', 'embed'].includes(second || '')
    ) {
      return null;
    }

    const tab =
      second === 'reels' ? 'reels' : second === 'tagged' ? 'tagged' : undefined;

    return {
      username: first,
      profileUrl: `https://www.instagram.com/${first}/`,
      ...(tab ? { tab } : {}),
    };
  } catch {
    return null;
  }
}

function stripSurroundingQuotes(value: string): string {
  const s = value.trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function extractDsUserIdFromSessionId(sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  let decoded = sessionId;
  try {
    decoded = decodeURIComponent(sessionId);
  } catch {
    decoded = sessionId;
  }
  const firstSegment = decoded.split(':')[0]?.trim();
  if (firstSegment && /^\d{4,}$/.test(firstSegment)) {
    return firstSegment;
  }
  return undefined;
}

/**
 * Parses either a raw sessionid value or a full Cookie header string into structured fields.
 */
export function parseInstagramSessionCookies(rawCookie?: string): InstagramParsedCookies {
  const trimmed = stripSurroundingQuotes(
    (rawCookie || '')
      .trim()
      .replace(/^cookie:\s*/i, '')
      .replace(/[\r\n]+/g, '; ')
      .trim()
  );

  if (!trimmed) {
    return { cookies: {}, hasSessionId: false };
  }

  if (!trimmed.includes('=')) {
    const cleanedSession = stripSurroundingQuotes(trimmed);
    const dsUserId = extractDsUserIdFromSessionId(cleanedSession);
    return {
      header: `sessionid=${cleanedSession}`,
      cookies: { sessionid: cleanedSession },
      sessionId: cleanedSession,
      dsUserId,
      hasSessionId: true,
    };
  }

  const cookies: Record<string, string> = {};
  for (const part of trimmed.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = stripSurroundingQuotes(part.slice(eqIdx + 1).trim());
    if (key && val) {
      cookies[key] = val;
    }
  }

  const normalizedPairs = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
  const csrfToken = cookies.csrftoken || cookies.CSRFTOKEN;
  const sessionId = cookies.sessionid || cookies.SESSIONID;
  const dsUserId =
    cookies.ds_user_id || cookies.DS_USER_ID || extractDsUserIdFromSessionId(sessionId);

  return {
    header: normalizedPairs.length > 0 ? normalizedPairs.join('; ') : trimmed,
    cookies,
    csrfToken,
    sessionId,
    dsUserId,
    hasSessionId: Boolean(sessionId),
  };
}

/**
 * Parses Instagram JSON, `for (;;);`-prefixed JSON, or multi-line Polaris NDJSON streaming chunks.
 */
export function parseInstagramUpstreamJsonPayloads(bodyText: string): {
  payloads: any[];
  isHtmlLogin: boolean;
} {
  const trimmed = (bodyText || '').trim();
  if (!trimmed) {
    return { payloads: [], isHtmlLogin: false };
  }

  const normalized = trimmed.startsWith('for (;;);') ? trimmed.slice(9).trim() : trimmed;
  if (normalized.startsWith('<') || /<(?:!doctype|html|head|body)\b/i.test(normalized)) {
    return {
      payloads: [],
      isHtmlLogin:
        normalized.includes('/accounts/login') ||
        normalized.includes('challenge') ||
        normalized.includes('loginForm'),
    };
  }

  const payloads: any[] = [];
  let isHtmlLogin = false;

  const inspectAndPush = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.require_login === true) {
      isHtmlLogin = true;
    }
    payloads.push(obj);
    const bboxData = obj.__bbox?.result?.data || obj.__bbox?.data;
    if (bboxData && typeof bboxData === 'object') {
      payloads.push({ data: bboxData });
    }
  };

  try {
    const single = JSON.parse(normalized);
    inspectAndPush(single);
    return { payloads, isHtmlLogin };
  } catch {
    // Fall through to multi-line NDJSON chunk parsing
  }

  for (const rawLine of normalized.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('for (;;);')) {
      line = line.slice(9).trim();
    }
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try {
      const chunk = JSON.parse(line);
      inspectAndPush(chunk);
    } catch {
      // Ignore partial or malformed streaming line
    }
  }

  return { payloads, isHtmlLogin };
}

/**
 * Normalizes an Instagram session cookie input.
 * Accepts either a raw sessionid value or a full Cookie header string.
 */
export function formatInstagramCookieHeader(rawCookie?: string): string | undefined {
  return parseInstagramSessionCookies(rawCookie).header;
}

/**
 * Extracts runtime security & Relay tokens (LSD, FB_DTSG, CSRF token, App ID) from Instagram HTML.
 */
export function extractInstagramTokensFromHtml(html: string): InstagramHtmlTokens {
  if (!html) return {};
  const lsdMatch =
    html.match(/"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/) ||
    html.match(/name="lsd"\s+value="([^"]+)"/i) ||
    html.match(/"lsd"\s*:\s*"([^"]+)"/);

  const dtsgMatch =
    html.match(/"DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/) ||
    html.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);

  const csrfMatch =
    html.match(/"csrf_token"\s*:\s*"([^"]+)"/) ||
    html.match(/\\?"csrftoken\\?"\s*:\s*\\?"([^"\\]+)\\?"/);

  const appIdMatch =
    html.match(/"APP_ID"\s*:\s*"(\d+)"/) ||
    html.match(/"X-IG-App-ID"\s*:\s*"(\d+)"/);

  const ownerIdMatch =
    html.match(/"owner_id"\s*:\s*"?(\d+)"?/) ||
    html.match(/"profile_id"\s*:\s*"(\d+)"/) ||
    html.match(/"id"\s*:\s*"(\d{5,})"\s*,\s*"is_business_account"/);

  return {
    lsd: lsdMatch?.[1],
    fbDtsg: dtsgMatch?.[1],
    csrfToken: csrfMatch?.[1],
    appId: appIdMatch?.[1],
    userId: ownerIdMatch?.[1],
  };
}

/**
 * Decodes escaped `"contextJSON":"..."` ServerJS payloads used on Instagram profile and post embed pages.
 */
export function extractContextJsonPayloads(html: string): any[] {
  if (!html || !html.includes('contextJSON')) return [];
  const results: any[] = [];
  const pattern = /"contextJSON"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const unescapedString = JSON.parse(`"${match[1]}"`);
      if (typeof unescapedString === 'string' && unescapedString.trim().startsWith('{')) {
        const parsedObj = JSON.parse(unescapedString);
        if (parsedObj && typeof parsedObj === 'object') {
          results.push(parsedObj);
        }
      }
    } catch {
      // Ignore malformed contextJSON segments
    }
  }
  return results;
}

function normalizeCdnAssetKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('cdninstagram.com') || u.hostname.includes('fbcdn.net')) {
      return `${u.pathname}`;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function decodeHtmlEntitiesInUrl(rawUrl: string): string {
  return rawUrl.replace(/&amp;/g, '&').trim();
}

function isLowResInstagramUrl(url: string): boolean {
  return /[?&]stp=[^&]*(?:s150x150|s240x240|s320x320|s480x480|p160x160|p320x320|p480x480)/i.test(
    url
  );
}

function computeAspectRatio(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

function pickBestCandidate(
  candidates?: Array<{
    url?: string;
    src?: string;
    width?: number;
    height?: number;
    config_width?: number;
    config_height?: number;
  }>
): { url: string; width?: number; height?: number } | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const valid = candidates.filter(
    (c) =>
      (typeof c?.url === 'string' && c.url.length > 0) ||
      (typeof c?.src === 'string' && c.src.length > 0)
  );
  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => {
    const wA = a.width || a.config_width || 0;
    const hA = a.height || a.config_height || 0;
    const wB = b.width || b.config_width || 0;
    const hB = b.height || b.config_height || 0;
    const areaA = wA * hA;
    const areaB = wB * hB;
    if (areaB !== areaA) return areaB - areaA;
    return wB - wA;
  });

  const best = sorted[0];
  const url = best.url || best.src || '';
  if (!url) return null;
  const width = best.width ?? best.config_width;
  const height = best.height ?? best.config_height;
  return {
    url: decodeHtmlEntitiesInUrl(url),
    width: typeof width === 'number' ? width : undefined,
    height: typeof height === 'number' ? height : undefined,
  };
}

function pickThumbCandidate(
  candidates?: Array<{
    url?: string;
    src?: string;
    width?: number;
    config_width?: number;
  }>,
  fallback?: string
): string {
  if (!Array.isArray(candidates) || candidates.length === 0) return fallback || '';
  const valid = candidates.filter(
    (c) =>
      (typeof c?.url === 'string' && c.url.length > 0) ||
      (typeof c?.src === 'string' && c.src.length > 0)
  );
  if (valid.length === 0) return fallback || '';
  const sorted = [...valid].sort(
    (a, b) => (a.width || a.config_width || 0) - (b.width || b.config_width || 0)
  );
  const medium =
    sorted.find((c) => (c.width || c.config_width || 0) >= 320) || sorted[sorted.length - 1];
  return decodeHtmlEntitiesInUrl(medium.url || medium.src || fallback || '');
}

/**
 * Extracts all full-resolution photo assets (posts + carousels + reels covers + HD profile photo)
 * from Instagram web_profile_info, Polaris GraphQL timeline/clips, embed contextJSON, or v1 user feed JSON payloads.
 */
export function extractInstagramMediaFromJson(
  payload: any,
  fallbackUsername?: string
): InstagramExtractionPage {
  const images: ScrapedImage[] = [];
  const seenKeys = new Set<string>();
  const seenAssetPaths = new Set<string>();
  const sidecarShortcodes = new Set<string>();
  let idCounter = 1;

  if (!payload || typeof payload !== 'object') {
    return { images, hasNextPage: false };
  }

  const embedContext =
    payload?.context && typeof payload.context === 'object' ? payload.context : undefined;
  const unwrappedData =
    payload?.__bbox?.result?.data || payload?.__bbox?.data || payload?.data;

  const gqlShortcodeMedia =
    payload?.gql_data?.shortcode_media ||
    unwrappedData?.shortcode_media ||
    unwrappedData?.xdt_shortcode_media ||
    payload?.graphql?.shortcode_media ||
    payload?.shortcode_media ||
    embedContext?.media ||
    undefined;

  const user =
    unwrappedData?.user ||
    unwrappedData?.xdt_api__v1__users__web_profile_info?.data?.user ||
    payload?.graphql?.user ||
    payload?.user ||
    (embedContext?.username || embedContext?.owner_id || embedContext?.graphql_media
      ? {
          id: embedContext.owner_id,
          username: embedContext.username,
          full_name: embedContext.full_name,
          profile_pic_url: embedContext.profile_pic_url,
          profile_pic_url_hd: embedContext.profile_pic_url_hd,
          posts_count: embedContext.posts_count,
          edge_owner_to_timeline_media: embedContext.edge_owner_to_timeline_media,
        }
      : undefined);

  const timelineConnection =
    user?.edge_owner_to_timeline_media ||
    unwrappedData?.xdt_api__v1__feed__user_timeline_graphql_connection ||
    unwrappedData?.xdt_api__v1__profile_timeline__user_timeline_graphql_connection ||
    payload?.xdt_api__v1__feed__user_timeline_graphql_connection ||
    payload?.xdt_api__v1__profile_timeline__user_timeline_graphql_connection ||
    payload?.edge_owner_to_timeline_media;

  const clipsConnection =
    user?.edge_felix_video_timeline ||
    unwrappedData?.xdt_api__v1__clips__user_connection_v2 ||
    payload?.xdt_api__v1__clips__user_connection_v2;

  const username: string | undefined =
    user?.username ||
    embedContext?.username ||
    gqlShortcodeMedia?.owner?.username ||
    payload?.items?.[0]?.user?.username ||
    timelineConnection?.edges?.[0]?.node?.user?.username ||
    clipsConnection?.edges?.[0]?.node?.media?.user?.username ||
    fallbackUsername;

  const userId: string | undefined =
    (user?.id && String(user.id)) ||
    (embedContext?.owner_id && String(embedContext.owner_id)) ||
    (gqlShortcodeMedia?.owner?.id && String(gqlShortcodeMedia.owner.id)) ||
    (payload?.items?.[0]?.user?.pk && String(payload.items[0].user.pk)) ||
    (payload?.items?.[0]?.user?.id && String(payload.items[0].user.id)) ||
    (timelineConnection?.edges?.[0]?.node?.user?.pk &&
      String(timelineConnection.edges[0].node.user.pk)) ||
    (timelineConnection?.edges?.[0]?.node?.user?.id &&
      String(timelineConnection.edges[0].node.user.id)) ||
    (clipsConnection?.edges?.[0]?.node?.media?.user?.pk &&
      String(clipsConnection.edges[0].node.media.user.pk)) ||
    (clipsConnection?.edges?.[0]?.node?.media?.user?.id &&
      String(clipsConnection.edges[0].node.media.user.id)) ||
    undefined;

  const fullName: string | undefined =
    user?.full_name ||
    embedContext?.full_name ||
    gqlShortcodeMedia?.owner?.full_name ||
    payload?.items?.[0]?.user?.full_name ||
    undefined;

  const hdPicVersion = pickBestCandidate(user?.hd_profile_pic_versions);
  const profilePicUrl: string | undefined =
    user?.profile_pic_url_hd ||
    user?.hd_profile_pic_url_info?.url ||
    hdPicVersion?.url ||
    user?.profile_pic_url ||
    undefined;

  const postsCount: number | undefined =
    typeof user?.posts_count === 'number'
      ? user.posts_count
      : typeof user?.edge_owner_to_timeline_media?.count === 'number'
        ? user.edge_owner_to_timeline_media.count
        : typeof embedContext?.posts_count === 'number'
          ? embedContext.posts_count
          : undefined;

  const pushPhoto = (params: {
    key: string;
    fullUrl: string;
    thumbUrl?: string;
    shortcode?: string;
    width?: number;
    height?: number;
    caption?: string;
    method: string;
    slideIndex?: number;
    allowThumbAvatar?: boolean;
  }) => {
    const cleanFullUrl = decodeHtmlEntitiesInUrl(params.fullUrl || '');
    if (!cleanFullUrl) return;
    const assetPathKey = normalizeCdnAssetKey(cleanFullUrl);
    if (
      seenKeys.has(params.key) ||
      seenKeys.has(cleanFullUrl) ||
      seenAssetPaths.has(assetPathKey)
    ) {
      return;
    }
    seenKeys.add(params.key);
    seenKeys.add(cleanFullUrl);
    seenAssetPaths.add(assetPathKey);

    const fmt = detectFormat(cleanFullUrl) || 'jpg';
    const ext = fmt === 'other' ? 'jpg' : fmt;
    const prefix = username ? `${username}_` : 'ig_';
    const base = params.shortcode || params.key.replace(/[^a-zA-Z0-9_-]/g, '');
    const suffix = params.slideIndex ? `_slide${params.slideIndex}` : '';
    const filename = `${prefix}${base}${suffix}.${ext}`;
    const linkedPageUrl = params.shortcode
      ? `https://www.instagram.com/p/${params.shortcode}/`
      : username
        ? `https://www.instagram.com/${username}/`
        : undefined;

    images.push({
      id: `ig_${idCounter++}`,
      thumbnailUrl: decodeHtmlEntitiesInUrl(params.thumbUrl || '') || cleanFullUrl,
      fullUrl: cleanFullUrl,
      isUnshrunk: params.allowThumbAvatar ? !isLowResInstagramUrl(cleanFullUrl) : true,
      unshrinkMethod: params.method,
      altText: params.caption || `${username ? '@' + username + ' ' : ''}${base}`,
      format: fmt === 'other' ? 'jpg' : fmt,
      width: params.width,
      height: params.height,
      aspectRatio: computeAspectRatio(params.width, params.height),
      resolutionTier: classifyResolution(params.width, params.height),
      filename,
      sourceContext: 'Instagram Profile Post',
      linkedPageUrl,
      deepScraped: true,
    });
  };

  // Profile avatar (prefer HD; fallback to profile_pic_url from embed when HD not returned)
  const avatarFull =
    user?.hd_profile_pic_url_info?.url ||
    hdPicVersion?.url ||
    user?.profile_pic_url_hd ||
    user?.profile_pic_url;
  if (
    avatarFull &&
    (user?.hd_profile_pic_url_info?.url ||
      hdPicVersion?.url ||
      user?.profile_pic_url_hd ||
      embedContext?.graphql_media)
  ) {
    const isHd = Boolean(
      user?.hd_profile_pic_url_info?.url || hdPicVersion?.url || user?.profile_pic_url_hd
    );
    pushPhoto({
      key: `avatar_${username || userId || 'profile'}`,
      fullUrl: avatarFull,
      thumbUrl: user?.profile_pic_url || avatarFull,
      width: user?.hd_profile_pic_url_info?.width || hdPicVersion?.width,
      height: user?.hd_profile_pic_url_info?.height || hdPicVersion?.height,
      caption: `${fullName || username || 'Profile'} Avatar${isHd ? ' (HD)' : ''}`,
      method: isHd ? 'Instagram HD Profile Avatar' : 'Instagram Profile Avatar',
      allowThumbAvatar: !isHd,
    });
  }

  let hasNextPage = false;
  let endCursor: string | undefined;
  let nextMaxId: string | undefined;

  const extractMediaNode = (rawNode: any, defaultMethodPrefix = 'Instagram') => {
    const node = rawNode?.shortcode_media || rawNode?.media || rawNode;
    if (!node || typeof node !== 'object') return;
    const shortcode: string | undefined = node.shortcode || node.code;
    const caption =
      node?.edge_media_to_caption?.edges?.[0]?.node?.text ||
      node?.caption?.text ||
      (typeof node?.caption === 'string' ? node.caption : '') ||
      '';

    // Check modern xdt v1 node (carousel_media)
    if (Array.isArray(node.carousel_media) && node.carousel_media.length > 0) {
      node.carousel_media.forEach((slide: any, idx: number) => {
        const best = pickBestCandidate(slide?.image_versions2?.candidates);
        if (best) {
          pushPhoto({
            key: String(slide.id || slide.pk || `${shortcode}_s${idx + 1}`),
            fullUrl: best.url,
            thumbUrl: pickThumbCandidate(slide?.image_versions2?.candidates, best.url),
            shortcode,
            width: slide.original_width || best.width,
            height: slide.original_height || best.height,
            caption,
            method: `${defaultMethodPrefix} Carousel Slide ${idx + 1} Full-Res`,
            slideIndex: idx + 1,
          });
        }
      });
      return;
    }

    // Classic GraphQL / embed node with edge_sidecar_to_children
    const sidecarEdges = node?.edge_sidecar_to_children?.edges;
    if (Array.isArray(sidecarEdges) && sidecarEdges.length > 0) {
      sidecarEdges.forEach((sEdge: any, idx: number) => {
        const sNode = sEdge?.node;
        if (!sNode) return;
        const bestRes = pickBestCandidate(sNode.display_resources);
        const url = sNode.display_url || bestRes?.url;
        if (!url) return;
        const thumb =
          sNode.thumbnail_src ||
          (Array.isArray(sNode.display_resources) && sNode.display_resources[0]?.src) ||
          url;
        pushPhoto({
          key: String(sNode.id || `${shortcode}_slide_${idx + 1}`),
          fullUrl: url,
          thumbUrl: thumb,
          shortcode,
          width: sNode.dimensions?.width || bestRes?.width,
          height: sNode.dimensions?.height || bestRes?.height,
          caption,
          method: `${defaultMethodPrefix} Carousel Slide ${idx + 1} Full-Res`,
          slideIndex: idx + 1,
        });
      });
      return;
    }

    // Sidecar indicated without inline slide array (common in embed contextJSON) -> mark for enrichment AND keep cover fallback
    const isUnexpandedSidecar =
      (node.__typename === 'GraphSidecar' || node.media_type === 8) && Boolean(shortcode);
    if (isUnexpandedSidecar && shortcode) {
      sidecarShortcodes.add(shortcode);
    }

    if (node.image_versions2?.candidates) {
      const best = pickBestCandidate(node.image_versions2.candidates);
      if (best) {
        pushPhoto({
          key: String(node.id || node.pk || shortcode || best.url),
          fullUrl: best.url,
          thumbUrl: pickThumbCandidate(node.image_versions2.candidates, best.url),
          shortcode,
          width: node.original_width || best.width,
          height: node.original_height || best.height,
          caption,
          method:
            node.media_type === 2 || node.is_video
              ? `${defaultMethodPrefix} Video Cover Full-Res`
              : `${defaultMethodPrefix} Post Full-Res Master`,
        });
        return;
      }
    }

    const bestResource = pickBestCandidate(node.display_resources);
    const url = node.display_url || bestResource?.url;
    if (url) {
      const thumb =
        node.thumbnail_src ||
        (Array.isArray(node.display_resources) && node.display_resources[0]?.src) ||
        url;
      pushPhoto({
        key: String(node.id || shortcode || url),
        fullUrl: url,
        thumbUrl: thumb,
        shortcode,
        width: node.dimensions?.width || bestResource?.width,
        height: node.dimensions?.height || bestResource?.height,
        caption,
        method:
          node.is_video || node.__typename === 'GraphVideo'
            ? `${defaultMethodPrefix} Video Poster Full-Res`
            : `${defaultMethodPrefix} Post Full-Res Master`,
      });
    }
  };

  // 1. Timeline connections (legacy GraphQL + Polaris Relay connection)
  for (const conn of [timelineConnection, clipsConnection]) {
    if (conn && Array.isArray(conn.edges)) {
      if (conn.page_info?.has_next_page) {
        hasNextPage = true;
        if (!endCursor && conn.page_info.end_cursor) {
          endCursor = conn.page_info.end_cursor;
        }
      }
      for (const edge of conn.edges) {
        if (edge?.node) {
          extractMediaNode(edge.node);
        }
      }
    }
  }

  // 2. Embed profile `context.graphql_media` array
  if (Array.isArray(embedContext?.graphql_media)) {
    for (const entry of embedContext.graphql_media) {
      extractMediaNode(entry, 'Instagram Embed');
    }
  }

  // 3. Single shortcode_media payload (post JSON / post embed gql_data)
  if (gqlShortcodeMedia) {
    extractMediaNode(gqlShortcodeMedia, 'Instagram Post');
  }

  // 4. REST API v1 /api/v1/feed/user/<id>/ or /api/v1/media/<id>/info/ format (`items[]`)
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length > 0) {
    if (payload.more_available && payload.next_max_id) {
      hasNextPage = true;
      nextMaxId = String(payload.next_max_id);
    }

    for (const item of items) {
      extractMediaNode(item, 'Instagram');
    }
  }

  return {
    userId,
    username,
    fullName,
    profilePicUrl,
    postsCount,
    images,
    hasNextPage,
    endCursor,
    nextMaxId,
    ...(sidecarShortcodes.size > 0 ? { shortcodesToEnrich: [...sidecarShortcodes] } : {}),
  };
}

/**
 * Extracts full-res Instagram photos embedded in SSR profile/post HTML (`contextJSON` in ServerJS,
 * `<script type="application/json">` Relay payloads, or rendered CDN `<img>` elements).
 */
export function extractInstagramMediaFromHtml(
  html: string,
  profileUrl: string,
  fallbackUsername?: string
): InstagramExtractionPage {
  if (!html) {
    return { images: [], hasNextPage: false };
  }

  const $ = cheerio.load(html);
  const aggregated: ScrapedImage[] = [];
  const seenUrls = new Set<string>();
  const seenAssetPaths = new Set<string>();
  const shortcodesToEnrich = new Set<string>();
  let resolvedMeta: Partial<InstagramExtractionPage> = {};

  const mergePage = (page: InstagramExtractionPage) => {
    if (!resolvedMeta.userId && page.userId) resolvedMeta.userId = page.userId;
    if (!resolvedMeta.username && page.username) resolvedMeta.username = page.username;
    if (!resolvedMeta.fullName && page.fullName) resolvedMeta.fullName = page.fullName;
    if (!resolvedMeta.profilePicUrl && page.profilePicUrl) resolvedMeta.profilePicUrl = page.profilePicUrl;
    if (!resolvedMeta.postsCount && page.postsCount) resolvedMeta.postsCount = page.postsCount;
    if (page.hasNextPage) {
      resolvedMeta.hasNextPage = true;
      if (page.endCursor) resolvedMeta.endCursor = page.endCursor;
      if (page.nextMaxId) resolvedMeta.nextMaxId = page.nextMaxId;
    }
    if (page.shortcodesToEnrich) {
      for (const sc of page.shortcodesToEnrich) shortcodesToEnrich.add(sc);
    }
    for (const img of page.images) {
      const assetKey = normalizeCdnAssetKey(img.fullUrl);
      if (!seenUrls.has(img.fullUrl) && !seenAssetPaths.has(assetKey)) {
        seenUrls.add(img.fullUrl);
        seenAssetPaths.add(assetKey);
        aggregated.push({ ...img, id: `ig_${aggregated.length + 1}` });
      }
    }
  };

  // Strategy A: ServerJS `contextJSON` double-encoded JSON payloads (profile /embed/ & post /embed/)
  const contextPayloads = extractContextJsonPayloads(html);
  for (const ctxObj of contextPayloads) {
    mergePage(extractInstagramMediaFromJson(ctxObj, fallbackUsername));
  }

  // Strategy B: Traverse Relay / ScheduledServerJS `<script>` JSON payloads
  const collectNestedRelayPayloads = (parsed: unknown) => {
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (
        node.edge_owner_to_timeline_media ||
        node.xdt_api__v1__feed__user_timeline_graphql_connection ||
        node.xdt_api__v1__clips__user_connection_v2 ||
        node.shortcode_media ||
        node.graphql_media ||
        Array.isArray(node.items)
      ) {
        mergePage(
          extractInstagramMediaFromJson(
            {
              data: node,
              items: node.items,
              shortcode_media: node.shortcode_media,
              context: node.graphql_media ? node : undefined,
            },
            fallbackUsername
          )
        );
      }
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
      } else {
        for (const key of Object.keys(node)) {
          if (typeof node[key] === 'object') visit(node[key]);
        }
      }
    };
    visit(parsed);
  };

  $('script').each((_, el) => {
    const text = $(el).text()?.trim();
    if (!text) return;
    if (
      !text.includes('edge_owner_to_timeline_media') &&
      !text.includes('xdt_api__v1__feed__user_timeline_graphql_connection') &&
      !text.includes('xdt_api__v1__clips__user_connection_v2') &&
      !text.includes('image_versions2') &&
      !text.includes('shortcode_media') &&
      !text.includes('graphql_media')
    ) {
      return;
    }

    if (text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text);
        const topPage = extractInstagramMediaFromJson(parsed, fallbackUsername);
        if (topPage.images.length > 0) {
          mergePage(topPage);
          return;
        }
        collectNestedRelayPayloads(parsed);
        return;
      } catch {
        // Fall through to inline JSON slice extraction
      }
    }

    try {
      const jsonStart = text.indexOf('{');
      const jsonEnd = text.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        collectNestedRelayPayloads(JSON.parse(text.slice(jsonStart, jsonEnd + 1)));
      }
    } catch {
      // Ignore malformed inline script JSON
    }
  });

  // Strategy C: Rendered DOM <img> elements (e.g. saved page HTML or Playwright DOM snapshot)
  if (aggregated.length === 0) {
    $('img').each((_, el) => {
      const $img = $(el);
      const rawSrc = $img.attr('src') || $img.attr('data-src') || '';
      const src = decodeHtmlEntitiesInUrl(rawSrc);
      if (!src || (!src.includes('cdninstagram.com') && !src.includes('fbcdn.net'))) return;
      if (src.includes('rsrc.php')) return; // Ignore Instagram UI icons/sprites

      const srcset = $img.attr('srcset') || '';
      let bestUrl = src;
      let maxW = parseInt($img.attr('width') || '', 10) || undefined;
      if (srcset) {
        const parts = srcset.split(',').map((s) => s.trim().split(/\s+/));
        for (const [u, wStr] of parts) {
          const cleanU = u ? decodeHtmlEntitiesInUrl(u) : '';
          const w = parseInt((wStr || '').replace(/w$/i, ''), 10);
          if (cleanU && (!maxW || (w && w > maxW))) {
            bestUrl = cleanU;
            maxW = w || maxW;
          }
        }
      }
      const parentHref = $img.closest('a').attr('href') || '';
      const shortcodeMatch = parentHref.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      let linkedPageUrl = profileUrl;
      if (parentHref && !parentHref.endsWith('#')) {
        try {
          linkedPageUrl = new URL(parentHref, profileUrl || 'https://www.instagram.com/').href;
        } catch {
          linkedPageUrl = profileUrl;
        }
      }

      const assetKey = normalizeCdnAssetKey(bestUrl);
      if (!seenUrls.has(bestUrl) && !seenAssetPaths.has(assetKey)) {
        seenUrls.add(bestUrl);
        seenAssetPaths.add(assetKey);
        const fmt = detectFormat(bestUrl) || 'jpg';
        aggregated.push({
          id: `ig_${aggregated.length + 1}`,
          thumbnailUrl: src,
          fullUrl: bestUrl,
          isUnshrunk: Boolean(!isLowResInstagramUrl(bestUrl)),
          unshrinkMethod:
            srcset && bestUrl !== src ? 'Instagram Profile Srcset Max' : 'Instagram Profile Rendered Image',
          altText: $img.attr('alt') || `instagram_photo_${aggregated.length + 1}`,
          format: fmt === 'other' ? 'jpg' : fmt,
          width: maxW,
          resolutionTier: classifyResolution(maxW, undefined),
          filename: `${resolvedMeta.username || fallbackUsername || 'ig'}_${shortcodeMatch?.[1] || aggregated.length + 1}.jpg`,
          sourceContext: 'Instagram Profile HTML',
          linkedPageUrl,
        });
      }
    });
  }

  return {
    userId: resolvedMeta.userId,
    username: resolvedMeta.username || fallbackUsername,
    fullName: resolvedMeta.fullName,
    profilePicUrl: resolvedMeta.profilePicUrl,
    postsCount: resolvedMeta.postsCount,
    images: aggregated,
    hasNextPage: Boolean(resolvedMeta.hasNextPage),
    endCursor: resolvedMeta.endCursor,
    nextMaxId: resolvedMeta.nextMaxId,
    ...(shortcodesToEnrich.size > 0
      ? { shortcodesToEnrich: [...shortcodesToEnrich] }
      : {}),
  };
}
