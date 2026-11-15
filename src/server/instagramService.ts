import fs from 'fs';
import { gotScraping } from 'got-scraping';
import { CookieJar } from 'tough-cookie';
import pLimit from 'p-limit';
import type { ExtractionResult } from '../utils/htmlExtractor.ts';
import type { ScrapedImage } from '../utils/scraperLogic.ts';
import {
  parseInstagramSessionCookies,
  extractInstagramTokensFromHtml,
  extractInstagramMediaFromJson,
  extractInstagramMediaFromHtml,
  parseInstagramUpstreamJsonPayloads,
} from '../utils/instagramExtractor.ts';
import {
  DEFAULT_USER_AGENT,
  HTML_ACCEPT_HEADER,
  buildRelayTarget,
} from './fetchHelpers.ts';

export interface InstagramScrapeParams {
  profileUrl: string;
  username: string;
  sessionCookie?: string;
  maxPosts?: number;
  relayUrl?: string;
  resumeUserId?: string;
  resumeCursor?: string;
  resumeMaxId?: string;
}

export interface InstagramScrapeResponse {
  ok: boolean;
  status: number;
  loginRequired?: boolean;
  sessionExpired?: boolean;
  error?: string;
  data?: ExtractionResult & {
    loginRequired?: boolean;
    sessionExpired?: boolean;
    notice?: string;
    truncated?: boolean;
    strategyUsed?: string;
    hasMore?: boolean;
    nextCursor?: string;
    nextMaxId?: string;
    userId?: string;
    username?: string;
    totalProfilePosts?: number;
  };
}

export interface HttpTextResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  url?: string;
}

export interface InstagramHttpClient {
  get: (
    url: string,
    headers?: Record<string, string>,
    timeoutMs?: number
  ) => Promise<HttpTextResponse>;
  post?: (
    url: string,
    body: string,
    headers?: Record<string, string>,
    timeoutMs?: number
  ) => Promise<HttpTextResponse>;
  getCsrfToken: () => Promise<string | undefined>;
}

export interface HeadlessInstagramResult {
  images: ScrapedImage[];
  userId?: string;
  fullName?: string;
  postsCount?: number;
  hitLoginGate?: boolean;
  sessionExpired?: boolean;
  hasNextPage?: boolean;
  endCursor?: string;
  nextMaxId?: string;
}

export interface InstagramServiceDeps {
  createClient?: (sessionCookie?: string, relayUrl?: string) => Promise<InstagramHttpClient>;
  headlessFallback?: (params: {
    profileUrl: string;
    username: string;
    sessionCookie?: string;
    timeoutMs: number;
    maxPosts?: number;
  }) => Promise<HeadlessInstagramResult | null>;
}

const ANDROID_IG_USER_AGENT =
  'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 458229237)';

const CHROMIUM_CANDIDATE_PATHS = [
  process.env.CHROMIUM_PATH,
  '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((p): p is string => Boolean(p));

function findChromiumExecutable(): string | undefined {
  for (const candidate of CHROMIUM_CANDIDATE_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore permission errors
    }
  }
  return undefined;
}

function normalizeCdnPath(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('cdninstagram.com') || u.hostname.includes('fbcdn.net')) {
      return u.pathname;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function readSafeUpstreamPayloads(
  bodyText: string
): { payloads: any[]; isHtmlLogin: boolean } {
  return parseInstagramUpstreamJsonPayloads(bodyText);
}

/**
 * Wraps tough-cookie CookieJar with looseMode + ignoreError so cross-subdomain
 * `Set-Cookie: Domain=i.instagram.com` headers returned by `www.instagram.com`
 * never throw unhandled rejections inside got-scraping.
 */
export function createSafeCookieJar() {
  const realJar = new CookieJar(undefined, { looseMode: true });

  return {
    realJar,
    async getCookieString(url: string): Promise<string> {
      try {
        return await realJar.getCookieString(url);
      } catch {
        return '';
      }
    },
    async setCookie(rawCookie: string, url: string): Promise<void> {
      try {
        await realJar.setCookie(rawCookie, url, { ignoreError: true });
        if (url.includes('instagram.com') && !/domain=/i.test(rawCookie)) {
          const otherHost = url.includes('i.instagram.com')
            ? 'https://www.instagram.com/'
            : 'https://i.instagram.com/';
          await realJar.setCookie(rawCookie, otherHost, { ignoreError: true });
        }
      } catch {
        // Never allow cross-domain Set-Cookie quirks to abort API calls
      }
    },
    async getCookies(url: string) {
      try {
        return await realJar.getCookies(url);
      } catch {
        return [];
      }
    },
  };
}

/**
 * Creates a TLS-fingerprinted got-scraping HTTP client backed by a fault-tolerant tough-cookie jar.
 */
async function createDefaultInstagramHttpClient(
  sessionCookie?: string,
  relayUrl?: string
): Promise<InstagramHttpClient> {
  const safeJar = createSafeCookieJar();
  const parsedCookies = parseInstagramSessionCookies(sessionCookie);

  const cookiesToSeed: Record<string, string> = { ...parsedCookies.cookies };
  if (parsedCookies.dsUserId && !cookiesToSeed.ds_user_id) {
    cookiesToSeed.ds_user_id = parsedCookies.dsUserId;
  }

  for (const [key, val] of Object.entries(cookiesToSeed)) {
    const cookieLine = `${key}=${val}; Domain=.instagram.com; Path=/; Secure`;
    await safeJar.setCookie(cookieLine, 'https://www.instagram.com/');
    await safeJar.setCookie(cookieLine, 'https://i.instagram.com/');
  }

  const getCsrfToken = async (): Promise<string | undefined> => {
    const cookies = await safeJar.getCookies('https://www.instagram.com/');
    const found = cookies.find((c) => c.key.toLowerCase() === 'csrftoken');
    return found?.value || parsedCookies.csrfToken;
  };

  const executeRequest = async (
    method: 'GET' | 'POST',
    targetUrl: string,
    headers: Record<string, string> = {},
    body?: string,
    timeoutMs = 8000
  ): Promise<HttpTextResponse> => {
    const proxiedUrl = buildRelayTarget(targetUrl, relayUrl);
    const seedPairs = Object.entries(cookiesToSeed).map(([k, v]) => `${k}=${v}`).join('; ');

    const resp = await gotScraping({
      url: proxiedUrl,
      method,
      ...(body !== undefined ? { body } : {}),
      cookieJar: relayUrl ? undefined : (safeJar as any),
      headers: {
        ...(relayUrl && seedPairs ? { Cookie: seedPairs } : {}),
        ...headers,
      },
      followRedirect: false,
      throwHttpErrors: false,
      timeout: { request: timeoutMs },
      retry: { limit: 1 },
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 128 }],
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos'],
        locales: ['en-US'],
      },
    });

    return {
      status: resp.statusCode,
      ok: resp.statusCode >= 200 && resp.statusCode < 300,
      headers: resp.headers as Record<string, string | string[] | undefined>,
      text: typeof resp.body === 'string' ? resp.body : String(resp.body ?? ''),
      url: resp.url,
    };
  };

  return {
    get: (targetUrl, headers = {}, timeoutMs = 8000) =>
      executeRequest('GET', targetUrl, headers, undefined, timeoutMs),
    post: (targetUrl, body, headers = {}, timeoutMs = 8000) =>
      executeRequest('POST', targetUrl, headers, body, timeoutMs),
    getCsrfToken,
  };
}

/**
 * Headless Chromium (playwright-core) with session injection, GraphQL/REST network interception,
 * and active scroll pagination to load full profiles when HTTP API calls are blocked on server IPs.
 */
async function defaultHeadlessChromiumFallback(params: {
  profileUrl: string;
  username: string;
  sessionCookie?: string;
  timeoutMs: number;
  maxPosts?: number;
}): Promise<HeadlessInstagramResult | null> {
  const executablePath = findChromiumExecutable();
  if (!executablePath) return null;

  const { chromium } = await import('playwright-core');
  const parsedCookies = parseInstagramSessionCookies(params.sessionCookie);
  const targetLimit = Math.min(Math.max(Number(params.maxPosts) || 200, 12), 1000);
  const browserDeadline = Date.now() + Math.max(5000, params.timeoutMs - 1000);
  let browser: import('playwright-core').Browser | null = null;

  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });

    const cookiesMap: Record<string, string> = { ...parsedCookies.cookies };
    if (parsedCookies.dsUserId && !cookiesMap.ds_user_id) {
      cookiesMap.ds_user_id = parsedCookies.dsUserId;
    }

    const cookieEntries = Object.entries(cookiesMap).map(([name, value]) => ({
      name,
      value,
      domain: '.instagram.com',
      path: '/',
      secure: true,
    }));
    if (cookieEntries.length > 0) {
      await context.addCookies(cookieEntries);
    }

    const page = await context.newPage();
    const collectedImages: ScrapedImage[] = [];
    const seenPaths = new Set<string>();
    let userId: string | undefined;
    let fullName: string | undefined;
    let postsCount: number | undefined;
    let hitLoginGate = false;
    let sessionExpired = false;
    let hasNextPage = false;
    let endCursor: string | undefined;
    let nextMaxId: string | undefined;

    const mergePayloads = (payloads: any[]) => {
      for (const json of payloads) {
        const extracted = extractInstagramMediaFromJson(json, params.username);
        if (extracted.userId) userId = userId || extracted.userId;
        if (extracted.fullName) fullName = fullName || extracted.fullName;
        if (extracted.postsCount) postsCount = postsCount || extracted.postsCount;
        if (extracted.hasNextPage) {
          hasNextPage = true;
          if (extracted.endCursor) endCursor = extracted.endCursor;
          if (extracted.nextMaxId) nextMaxId = extracted.nextMaxId;
        } else if (
          json?.data?.xdt_api__v1__feed__user_timeline_graphql_connection?.page_info?.has_next_page === false ||
          json?.more_available === false
        ) {
          hasNextPage = false;
        }
        for (const img of extracted.images) {
          const key = normalizeCdnPath(img.fullUrl);
          if (!seenPaths.has(key)) {
            seenPaths.add(key);
            collectedImages.push({ ...img, id: `ig_${collectedImages.length + 1}` });
          }
        }
      }
    };

    page.on('response', async (response) => {
      const rUrl = response.url();
      if (
        !rUrl.includes('/api/v1/') &&
        !rUrl.includes('/graphql')
      ) {
        return;
      }
      try {
        const text = await response.text();
        const { payloads, isHtmlLogin } = readSafeUpstreamPayloads(text);
        if (isHtmlLogin) hitLoginGate = true;
        if (payloads.length > 0) mergePayloads(payloads);
      } catch {
        // Ignore streaming/closed response bodies
      }
    });

    const target = parsedCookies.hasSessionId
      ? params.profileUrl
      : `https://www.instagram.com/${encodeURIComponent(params.username)}/embed/`;

    await page.goto(target, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(5000, params.timeoutMs - 3000),
    });
    await page.waitForTimeout(2000);

    if (page.url().includes('/accounts/login') || page.url().includes('/challenge')) {
      hitLoginGate = true;
      if (parsedCookies.hasSessionId) {
        sessionExpired = true;
      }
    }

    // Extract initial SSR HTML payloads
    const initialHtml = await page.content();
    const initialExtracted = extractInstagramMediaFromHtml(initialHtml, target, params.username);
    if (initialExtracted.userId) userId = userId || initialExtracted.userId;
    if (initialExtracted.fullName) fullName = fullName || initialExtracted.fullName;
    if (initialExtracted.postsCount) postsCount = postsCount || initialExtracted.postsCount;
    for (const img of initialExtracted.images) {
      const key = normalizeCdnPath(img.fullUrl);
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        collectedImages.push({ ...img, id: `ig_${collectedImages.length + 1}` });
      }
    }

    // If authenticated and not redirected to login, actively scroll profile to trigger Relay GraphQL pagination
    if (parsedCookies.hasSessionId && !sessionExpired) {
      let stagnantScrolls = 0;
      let scrollCount = 0;
      const maxScrolls = 18;

      while (
        collectedImages.length < targetLimit &&
        scrollCount < maxScrolls &&
        stagnantScrolls < 3 &&
        Date.now() < browserDeadline - 1400
      ) {
        scrollCount++;
        const beforeCount = collectedImages.length;

        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          for (const btn of buttons) {
            const label = (btn.textContent || '').trim().toLowerCase();
            if (label.includes('show more') || label.includes('load more')) {
              (btn as HTMLElement).click();
            }
          }
        });

        await page.waitForTimeout(1350);

        if (page.url().includes('/accounts/login') || page.url().includes('/challenge')) {
          hitLoginGate = true;
          sessionExpired = true;
          break;
        }

        if (collectedImages.length > beforeCount) {
          stagnantScrolls = 0;
        } else {
          stagnantScrolls++;
        }
      }

      // Final DOM harvest in case any article thumbnails rendered without captured XHR payloads
      if (collectedImages.length < targetLimit) {
        const finalHtml = await page.content();
        const finalDom = extractInstagramMediaFromHtml(finalHtml, target, params.username);
        for (const img of finalDom.images) {
          if (collectedImages.length >= targetLimit) break;
          const key = normalizeCdnPath(img.fullUrl);
          if (!seenPaths.has(key)) {
            seenPaths.add(key);
            collectedImages.push({ ...img, id: `ig_${collectedImages.length + 1}` });
          }
        }
      }
    }

    return {
      images: collectedImages,
      userId,
      fullName,
      postsCount,
      hitLoginGate,
      sessionExpired,
      hasNextPage,
      endCursor,
      nextMaxId,
    };
  } catch {
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}

/**
 * Multi-tier Instagram profile scraper combining:
 * 1) TLS-fingerprinted got-scraping + fault-tolerant tough-cookie CSRF/session jar + CSRF bootstrap
 * 2) Official web_profile_info & mobile i.instagram.com APIs with strict XHR Sec-Fetch-* headers
 * 3) Public profile SSR HTML & /<username>/embed/ ServerJS contextJSON extraction
 * 4) Bounded-concurrency (p-limit) GraphSidecar carousel expansion via /p/<shortcode>/embed/
 * 5) Multi-endpoint resilient REST v1 + Polaris GraphQL + legacy GraphQL pagination (plus cursor resume)
 * 6) Stealth Headless Chromium (playwright-core) active scroll pagination fallback
 */
export async function scrapeInstagramProfile(
  params: InstagramScrapeParams,
  deps: InstagramServiceDeps = {}
): Promise<InstagramScrapeResponse> {
  const {
    profileUrl,
    username,
    sessionCookie,
    relayUrl,
    resumeUserId,
    resumeCursor,
    resumeMaxId,
  } = params;
  const maxLimit = Math.min(Math.max(Number(params.maxPosts) || 200, 12), 1000);
  const parsedCookies = parseInstagramSessionCookies(sessionCookie);
  const budgetMs = parsedCookies.hasSessionId ? 45000 : 25000;
  const deadlineAt = Date.now() + budgetMs;
  const remainingMs = (capMs: number) => Math.max(1500, Math.min(capMs, deadlineAt - Date.now()));

  const client = deps.createClient
    ? await deps.createClient(sessionCookie, relayUrl)
    : await createDefaultInstagramHttpClient(sessionCookie, relayUrl);

  const headlessFallbackFn = deps.headlessFallback ?? defaultHeadlessChromiumFallback;

  const allImages: ScrapedImage[] = [];
  const seenUrls = new Set<string>();
  const seenCdnPaths = new Set<string>();
  const shortcodesToEnrich = new Set<string>();
  const strategyTrail: string[] = [];

  let resolvedName: string | undefined;
  let userId: string | undefined = resumeUserId || undefined;
  let totalProfilePosts: number | undefined;
  let nextCursor: string | undefined = resumeCursor || undefined;
  let nextMaxId: string | undefined = resumeMaxId || undefined;
  let discoveredLsd: string | undefined;
  let discoveredFbDtsg: string | undefined;
  let discoveredCsrf: string | undefined = parsedCookies.csrfToken;
  let discoveredAppId: string | undefined;
  let hitLoginGate = false;
  let sessionExpired = false;
  let hitTimeBudget = false;
  let didHttpPaginate = Boolean(resumeUserId && (resumeCursor || resumeMaxId));

  const buildApiHeaders = async (refererOverride?: string): Promise<Record<string, string>> => {
    const csrfToken = (await client.getCsrfToken()) || discoveredCsrf;
    return {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'x-ig-app-id': discoveredAppId || '936619743392459',
      'x-asbd-id': '129477',
      'x-ig-www-claim': '0',
      'x-requested-with': 'XMLHttpRequest',
      ...(csrfToken ? { 'x-csrftoken': csrfToken } : {}),
      ...(discoveredLsd ? { 'x-fb-lsd': discoveredLsd } : {}),
      Origin: 'https://www.instagram.com',
      Referer: refererOverride || profileUrl,
    };
  };

  const appendUnique = (imgs: ScrapedImage[], replaceMatchingPath = false) => {
    for (const img of imgs) {
      if (allImages.length >= maxLimit && !replaceMatchingPath) break;
      const cdnPath = normalizeCdnPath(img.fullUrl);
      if (replaceMatchingPath && seenCdnPaths.has(cdnPath)) {
        const existingIdx = allImages.findIndex(
          (item) => normalizeCdnPath(item.fullUrl) === cdnPath
        );
        if (existingIdx !== -1) {
          allImages[existingIdx] = {
            ...allImages[existingIdx],
            ...img,
            id: allImages[existingIdx].id,
          };
        }
        continue;
      }
      if (!seenUrls.has(img.fullUrl) && !seenCdnPaths.has(cdnPath)) {
        if (allImages.length >= maxLimit) break;
        seenUrls.add(img.fullUrl);
        seenCdnPaths.add(cdnPath);
        allImages.push({ ...img, id: `ig_${allImages.length + 1}` });
      }
    }
  };

  const absorbPage = (
    page: ReturnType<typeof extractInstagramMediaFromJson>,
    replaceMatchingPath = false
  ) => {
    if (page.userId) userId = userId || page.userId;
    if (page.fullName) resolvedName = resolvedName || page.fullName;
    if (page.postsCount) totalProfilePosts = totalProfilePosts || page.postsCount;
    if (page.hasNextPage) {
      if (page.endCursor) nextCursor = page.endCursor;
      if (page.nextMaxId) nextMaxId = page.nextMaxId;
    }
    if (page.shortcodesToEnrich) {
      for (const sc of page.shortcodesToEnrich) {
        shortcodesToEnrich.add(sc);
      }
    }
    appendUnique(page.images, replaceMatchingPath);
  };

  const absorbPayloads = (
    payloads: any[]
  ): { added: number; hasNextPage: boolean; endCursor?: string; nextMaxId?: string } => {
    const before = allImages.length;
    let foundNext = false;
    let pageCursor: string | undefined;
    let pageMaxId: string | undefined;

    for (const payload of payloads) {
      const page = extractInstagramMediaFromJson(payload, username);
      absorbPage(page);
      if (page.hasNextPage) {
        foundNext = true;
        if (page.endCursor) pageCursor = page.endCursor;
        if (page.nextMaxId) pageMaxId = page.nextMaxId;
      }
    }

    return {
      added: allImages.length - before,
      hasNextPage: foundNext,
      endCursor: pageCursor,
      nextMaxId: pageMaxId,
    };
  };

  const inspectRedirectLocation = (headers: Record<string, string | string[] | undefined>) => {
    const rawLoc = headers.location;
    const loc = Array.isArray(rawLoc) ? rawLoc[0] || '' : rawLoc || '';
    if (loc.includes('/accounts/login') || loc.includes('challenge')) {
      hitLoginGate = true;
      if (parsedCookies.hasSessionId) {
        sessionExpired = true;
      }
    }
  };

  const isResumeRequest = Boolean(resumeUserId && (resumeCursor || resumeMaxId));

  // Bootstrap CSRF, mid, datr & LSD cookies when caller supplied a raw sessionid without csrftoken
  if (parsedCookies.hasSessionId && !(await client.getCsrfToken()) && Date.now() < deadlineAt - 5000) {
    try {
      const homeResp = await client.get(
        'https://www.instagram.com/',
        {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: HTML_ACCEPT_HEADER,
          'Accept-Language': 'en-US,en;q=0.9',
        },
        remainingMs(5500)
      );
      if (homeResp.status >= 300 && homeResp.status < 400) {
        inspectRedirectLocation(homeResp.headers);
      } else if (homeResp.ok && homeResp.text) {
        const tokens = extractInstagramTokensFromHtml(homeResp.text);
        if (tokens.lsd) discoveredLsd = tokens.lsd;
        if (tokens.fbDtsg) discoveredFbDtsg = tokens.fbDtsg;
        if (tokens.csrfToken) discoveredCsrf = discoveredCsrf || tokens.csrfToken;
        if (tokens.appId) discoveredAppId = tokens.appId;
      }
    } catch {
      // Non-fatal; continue to API tiers
    }
  }

  if (!isResumeRequest) {
    // Tier 1A: Official www.instagram.com web_profile_info API
    try {
      const apiUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
      const resp = await client.get(apiUrl, await buildApiHeaders(), remainingMs(7000));

      if (resp.status >= 300 && resp.status < 400) {
        inspectRedirectLocation(resp.headers);
      } else if (resp.ok) {
        const { payloads, isHtmlLogin } = readSafeUpstreamPayloads(resp.text);
        if (isHtmlLogin) {
          hitLoginGate = true;
          if (parsedCookies.hasSessionId) sessionExpired = true;
        }
        if (payloads.length > 0) {
          const absorbed = absorbPayloads(payloads);
          if (absorbed.added > 0 || userId) {
            strategyTrail.push('web_profile_info');
            if (parsedCookies.hasSessionId && absorbed.added > 0) {
              didHttpPaginate = true;
            }
          }
        }
      } else if (resp.status === 401 || resp.status === 403) {
        hitLoginGate = true;
      }
    } catch {
      // Fall through to mobile API
    }

    // Tier 1B: Mobile API i.instagram.com/api/v1/users/web_profile_info
    if (allImages.length === 0 && Date.now() < deadlineAt - 3000) {
      try {
        const mobileApiUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
        const mobileResp = await client.get(
          mobileApiUrl,
          {
            ...(await buildApiHeaders()),
            'User-Agent': ANDROID_IG_USER_AGENT,
          },
          remainingMs(6000)
        );

        if (mobileResp.ok) {
          const { payloads, isHtmlLogin } = readSafeUpstreamPayloads(mobileResp.text);
          if (isHtmlLogin) hitLoginGate = true;
          if (payloads.length > 0) {
            const absorbed = absorbPayloads(payloads);
            if (absorbed.added > 0 || userId) {
              strategyTrail.push('mobile_web_profile_info');
              if (parsedCookies.hasSessionId && absorbed.added > 0) {
                didHttpPaginate = true;
              }
            }
          }
        }
      } catch {
        // Fall through to SSR HTML
      }
    }

    // Tier 2: Profile SSR HTML (<username>/) — also harvests userId, lsd, fb_dtsg even if authenticated profile SSR works
    if ((allImages.length === 0 || (parsedCookies.hasSessionId && !userId)) && Date.now() < deadlineAt - 3000) {
      try {
        const htmlResp = await client.get(
          profileUrl,
          {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: HTML_ACCEPT_HEADER,
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://www.instagram.com/',
          },
          remainingMs(7000)
        );

        if (htmlResp.status >= 300 && htmlResp.status < 400) {
          inspectRedirectLocation(htmlResp.headers);
        } else if (htmlResp.ok) {
          const tokens = extractInstagramTokensFromHtml(htmlResp.text);
          if (tokens.lsd) discoveredLsd = tokens.lsd;
          if (tokens.fbDtsg) discoveredFbDtsg = tokens.fbDtsg;
          if (tokens.csrfToken) discoveredCsrf = discoveredCsrf || tokens.csrfToken;
          if (tokens.appId) discoveredAppId = tokens.appId;
          if (tokens.userId) userId = userId || tokens.userId;

          if (
            htmlResp.text.includes('/accounts/login') &&
            !htmlResp.text.includes('edge_owner_to_timeline_media') &&
            !htmlResp.text.includes('xdt_api__v1__feed__user_timeline_graphql_connection')
          ) {
            hitLoginGate = true;
            if (parsedCookies.hasSessionId) sessionExpired = true;
          } else {
            const page = extractInstagramMediaFromHtml(htmlResp.text, profileUrl, username);
            const before = allImages.length;
            absorbPage(page);
            if (allImages.length > before) {
              strategyTrail.push('profile_ssr');
              if (parsedCookies.hasSessionId) didHttpPaginate = true;
            }
          }
        } else if (htmlResp.status === 401 || htmlResp.status === 403) {
          hitLoginGate = true;
        }
      } catch {
        // Fall through to profile embed endpoint
      }
    }

    // Tier 3: Profile Embed Endpoint (/<username>/embed/ with Sec-Fetch-Dest: iframe)
    // Extracts signed ServerJS contextJSON media & userId even on unauthenticated cloud IPs
    if (allImages.length === 0 && Date.now() < deadlineAt - 2500) {
      try {
        const embedUrl = `https://www.instagram.com/${encodeURIComponent(username)}/embed/`;
        const embedResp = await client.get(
          embedUrl,
          {
            'User-Agent': DEFAULT_USER_AGENT,
            Accept: HTML_ACCEPT_HEADER,
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site',
            Referer: 'https://www.google.com/',
          },
          remainingMs(8500)
        );

        if (embedResp.ok && embedResp.text) {
          const tokens = extractInstagramTokensFromHtml(embedResp.text);
          if (tokens.lsd) discoveredLsd = discoveredLsd || tokens.lsd;
          if (tokens.fbDtsg) discoveredFbDtsg = discoveredFbDtsg || tokens.fbDtsg;
          if (tokens.csrfToken) discoveredCsrf = discoveredCsrf || tokens.csrfToken;
          if (tokens.appId) discoveredAppId = discoveredAppId || tokens.appId;
          if (tokens.userId) userId = userId || tokens.userId;

          const page = extractInstagramMediaFromHtml(embedResp.text, embedUrl, username);
          absorbPage(page);
          if (page.images.length > 0) {
            strategyTrail.push('profile_embed_ssr');
          }
        }
      } catch {
        // Proceed to remaining enrichment/fallbacks
      }
    }

    // Tier 4: Concurrent GraphSidecar Carousel Enrichment via /p/<shortcode>/embed/
    if (
      shortcodesToEnrich.size > 0 &&
      allImages.length < maxLimit &&
      Date.now() < deadlineAt - 2500
    ) {
      const limit = pLimit(4);
      const shortcodes = [...shortcodesToEnrich].slice(0, parsedCookies.hasSessionId ? 12 : 6);
      const enrichedResults = await Promise.all(
        shortcodes.map((shortcode) =>
          limit(async () => {
            if (Date.now() >= deadlineAt - 2000) return null;
            try {
              const postEmbedUrl = `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/`;
              const postResp = await client.get(
                postEmbedUrl,
                {
                  'User-Agent': DEFAULT_USER_AGENT,
                  Accept: HTML_ACCEPT_HEADER,
                  'Accept-Language': 'en-US,en;q=0.9',
                  'Sec-Fetch-Dest': 'iframe',
                  'Sec-Fetch-Mode': 'navigate',
                  'Sec-Fetch-Site': 'cross-site',
                  Referer: profileUrl,
                },
                remainingMs(5500)
              );
              if (postResp.ok && postResp.text) {
                return extractInstagramMediaFromHtml(postResp.text, postEmbedUrl, username);
              }
            } catch {
              // Skip failed individual carousel enrichments
            }
            return null;
          })
        )
      );

      let expandedSlides = 0;
      for (const page of enrichedResults) {
        if (page && page.images.length > 0) {
          const before = allImages.length;
          absorbPage(page, true);
          if (allImages.length > before) {
            expandedSlides += allImages.length - before;
          }
        }
      }
      if (expandedSlides > 0) {
        strategyTrail.push('sidecar_carousel_enrichment');
      }
    }
  }

  // Tier 5: Resilient Multi-Endpoint Authenticated Pagination (REST v1 + mobile v1 + GraphQL GET/POST)
  let pageIterations = 0;
  let hasMore = Boolean(nextMaxId || nextCursor || (parsedCookies.hasSessionId && userId));
  let webV1Blocked = false;
  let usernameV1Blocked = false;
  let mobileV1Blocked = false;
  let legacyGqlBlocked = false;
  let polarisPostBlocked = false;

  const tryFeedGet = async (
    feedUrl: string,
    strategyTag: string,
    overrideUa?: string
  ): Promise<{ succeeded: boolean; hasNext: boolean; newMaxId?: string; newCursor?: string }> => {
    try {
      const headers = await buildApiHeaders();
      if (overrideUa) headers['User-Agent'] = overrideUa;
      const feedResp = await client.get(feedUrl, headers, remainingMs(7000));
      if (feedResp.status >= 300 && feedResp.status < 400) {
        inspectRedirectLocation(feedResp.headers);
        return { succeeded: false, hasNext: false };
      }
      if (!feedResp.ok) {
        if (feedResp.status === 401 || feedResp.status === 403) hitLoginGate = true;
        return { succeeded: false, hasNext: false };
      }
      const { payloads, isHtmlLogin } = readSafeUpstreamPayloads(feedResp.text);
      if (isHtmlLogin) {
        hitLoginGate = true;
        if (parsedCookies.hasSessionId) sessionExpired = true;
        return { succeeded: false, hasNext: false };
      }
      if (payloads.length === 0) {
        return { succeeded: false, hasNext: false };
      }
      const absorbed = absorbPayloads(payloads);
      if (absorbed.added > 0) {
        didHttpPaginate = true;
        if (!strategyTrail.includes(strategyTag)) {
          strategyTrail.push(strategyTag);
        }
      }
      return {
        succeeded: true,
        hasNext: absorbed.hasNextPage,
        newMaxId: absorbed.nextMaxId,
        newCursor: absorbed.endCursor,
      };
    } catch {
      return { succeeded: false, hasNext: false };
    }
  };

  while (hasMore && (userId || username) && allImages.length < maxLimit && pageIterations < 35) {
    if (Date.now() >= deadlineAt - (parsedCookies.hasSessionId && !didHttpPaginate ? 6500 : 2000)) {
      hitTimeBudget = true;
      break;
    }
    pageIterations++;
    let stepSucceeded = false;

    // 5A: Official www.instagram.com REST v1 feed by userId
    if (!webV1Blocked && userId && (nextMaxId || parsedCookies.hasSessionId)) {
      const urlA = `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?count=33${
        nextMaxId ? `&max_id=${encodeURIComponent(nextMaxId)}` : ''
      }`;
      const resA = await tryFeedGet(urlA, 'rest_v1_pagination');
      if (resA.succeeded) {
        stepSucceeded = true;
        nextMaxId = resA.newMaxId;
        hasMore = Boolean(resA.hasNext && (resA.newMaxId || resA.newCursor));
      } else {
        webV1Blocked = true;
      }
    }

    // 5B: Fallback to username-based REST v1 feed (does not require numeric userId)
    if (!stepSucceeded && !usernameV1Blocked && (nextMaxId || parsedCookies.hasSessionId)) {
      const urlB = `https://www.instagram.com/api/v1/feed/user/${encodeURIComponent(username)}/username/?count=33${
        nextMaxId ? `&max_id=${encodeURIComponent(nextMaxId)}` : ''
      }`;
      const resB = await tryFeedGet(urlB, 'rest_v1_username_pagination');
      if (resB.succeeded) {
        stepSucceeded = true;
        nextMaxId = resB.newMaxId;
        hasMore = Boolean(resB.hasNext && (resB.newMaxId || resB.newCursor));
      } else {
        usernameV1Blocked = true;
      }
    }

    // 5C: Fallback to i.instagram.com Mobile REST v1 feed
    if (!stepSucceeded && !mobileV1Blocked && userId && (nextMaxId || parsedCookies.hasSessionId)) {
      const urlC = `https://i.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?count=33${
        nextMaxId ? `&max_id=${encodeURIComponent(nextMaxId)}` : ''
      }`;
      const resC = await tryFeedGet(urlC, 'mobile_rest_v1_pagination', ANDROID_IG_USER_AGENT);
      if (resC.succeeded) {
        stepSucceeded = true;
        nextMaxId = resC.newMaxId;
        hasMore = Boolean(resC.hasNext && (resC.newMaxId || resC.newCursor));
      } else {
        mobileV1Blocked = true;
      }
    }

    // 5D: Legacy GraphQL query_hash pagination when endCursor is available
    if (!stepSucceeded && !legacyGqlBlocked && userId && nextCursor) {
      const vars = JSON.stringify({ id: userId, first: 50, after: nextCursor });
      const gqlUrl = `https://www.instagram.com/graphql/query/?query_hash=69cba40317214236af40e7efa697781d&variables=${encodeURIComponent(vars)}`;
      const resD = await tryFeedGet(gqlUrl, 'graphql_pagination');
      if (resD.succeeded) {
        stepSucceeded = true;
        nextCursor = resD.newCursor;
        hasMore = Boolean(resD.hasNext && resD.newCursor);
      } else {
        legacyGqlBlocked = true;
      }
    }

    // 5E: Polaris POST /graphql/query Relay connection fallback (handles multi-line NDJSON chunks)
    if (!stepSucceeded && !polarisPostBlocked && client.post && parsedCookies.hasSessionId) {
      try {
        const variables = JSON.stringify({
          data: { count: 12, include_relationship_info: true, latest_besties_reel_media: true, latest_reel_media: true },
          username,
          ...(nextCursor ? { after: nextCursor, before: null, first: 12, last: null } : {}),
        });
        const form = new URLSearchParams({
          av: parsedCookies.dsUserId || '0',
          __d: 'www',
          __user: '0',
          __a: '1',
          __req: String(pageIterations),
          ...(discoveredFbDtsg ? { fb_dtsg: discoveredFbDtsg } : {}),
          ...(discoveredLsd ? { lsd: discoveredLsd } : {}),
          fb_api_caller_class: 'RelayModern',
          fb_api_req_friendly_name: 'PolarisProfilePostsQuery',
          variables,
          server_timestamps: 'true',
          doc_id: nextCursor ? '7950326061742207' : '7898261790222653',
        });

        const baseHeaders = await buildApiHeaders();
        const postResp = await client.post(
          'https://www.instagram.com/graphql/query',
          form.toString(),
          {
            ...baseHeaders,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-FB-Friendly-Name': 'PolarisProfilePostsQuery',
          },
          remainingMs(7000)
        );
        if (postResp.ok && postResp.text) {
          const { payloads, isHtmlLogin } = readSafeUpstreamPayloads(postResp.text);
          if (isHtmlLogin) {
            hitLoginGate = true;
            sessionExpired = true;
            polarisPostBlocked = true;
          } else if (payloads.length > 0) {
            const absorbed = absorbPayloads(payloads);
            if (absorbed.added > 0) {
              stepSucceeded = true;
              didHttpPaginate = true;
              if (!strategyTrail.includes('polaris_graphql_pagination')) {
                strategyTrail.push('polaris_graphql_pagination');
              }
            }
            if (absorbed.endCursor) nextCursor = absorbed.endCursor;
            hasMore = Boolean(absorbed.hasNextPage && absorbed.endCursor);
          } else {
            polarisPostBlocked = true;
          }
        } else {
          polarisPostBlocked = true;
        }
      } catch {
        polarisPostBlocked = true;
      }
    }

    if (!stepSucceeded || (!nextMaxId && !nextCursor)) {
      break;
    }
  }

  // Tier 6: Stealth Headless Chromium (playwright-core)
  // Run if ALL HTTP tiers yielded 0 images OR user provided sessionid but HTTP API tiers could not paginate beyond preview!
  const shouldUseHeadless =
    !isResumeRequest &&
    Date.now() < deadlineAt - 4500 &&
    (allImages.length === 0 ||
      (parsedCookies.hasSessionId && !didHttpPaginate && allImages.length < maxLimit));

  if (shouldUseHeadless) {
    const browserResult = await headlessFallbackFn({
      profileUrl,
      username,
      sessionCookie,
      timeoutMs: remainingMs(22000),
      maxPosts: maxLimit,
    });
    if (browserResult) {
      if (browserResult.hitLoginGate) hitLoginGate = true;
      if (browserResult.sessionExpired) sessionExpired = true;
      if (browserResult.userId) userId = userId || browserResult.userId;
      if (browserResult.fullName) resolvedName = resolvedName || browserResult.fullName;
      if (browserResult.postsCount) totalProfilePosts = totalProfilePosts || browserResult.postsCount;
      if (browserResult.hasNextPage) {
        hasMore = true;
        if (browserResult.endCursor) nextCursor = browserResult.endCursor;
        if (browserResult.nextMaxId) nextMaxId = browserResult.nextMaxId;
      }
      if (browserResult.images.length > 0) {
        const beforeCount = allImages.length;
        appendUnique(browserResult.images);
        if (allImages.length > beforeCount || beforeCount === 0) {
          strategyTrail.push('headless_chromium_pagination');
          if (parsedCookies.hasSessionId && allImages.length > beforeCount) {
            didHttpPaginate = true;
          }
        }
      }
    }
  }

  if (allImages.length === 0) {
    return {
      ok: false,
      status: hitLoginGate || sessionExpired ? 403 : 404,
      loginRequired: hitLoginGate || sessionExpired,
      sessionExpired,
      error: sessionExpired
        ? `Instagram rejected or expired your sessionid cookie for @${username} (redirected to login). Grab a fresh sessionid from your logged-in Instagram tab (DevTools -> Application -> Cookies -> instagram.com) or run the 1-Click IG Profile Harvester.`
        : hitLoginGate
          ? `Instagram required authentication for @${username} from this server IP (redirected to login). Add your Instagram "sessionid" (or full Cookie header) in the Instagram Profile panel, or run the 1-Click IG Profile Harvester inside your logged-in Instagram browser tab and paste the JSON.`
          : `No public photos could be fetched for @${username}. Verify the handle is public or provide your sessionid cookie / Open-Tab Harvester JSON.`,
    };
  }

  const formats: Record<string, number> = {};
  for (const img of allImages) {
    formats[img.format] = (formats[img.format] || 0) + 1;
  }

  const canResumeCursor = Boolean(hasMore && (nextCursor || nextMaxId));
  const truncated = (allImages.length >= maxLimit || hitTimeBudget || canResumeCursor) && hasMore;
  const usedEmbedOnly =
    strategyTrail.includes('profile_embed_ssr') &&
    !didHttpPaginate &&
    !strategyTrail.includes('web_profile_info');

  let notice: string | undefined;
  if (sessionExpired) {
    notice = `Your Instagram sessionid cookie appears expired or rejected from this cloud IP (Instagram redirected to login), so only ${allImages.length} public preview photos could be loaded. Refresh your sessionid from DevTools -> Application -> Cookies or use the 1-Click IG Profile Harvester in your logged-in tab.`;
  } else if (parsedCookies.hasSessionId && usedEmbedOnly && allImages.length <= 15) {
    notice = `Your sessionid was sent, but Instagram blocked or rate-limited authenticated API pagination from this server IP (showing ${allImages.length} public preview photos). For private or full multi-hundred post profiles, run the 1-Click IG Profile Harvester directly in your logged-in browser tab and paste the JSON.`;
  } else if (hitTimeBudget && canResumeCursor) {
    notice = `Fetched ${allImages.length} full-res photos within the server request window. Click "Load More Posts" below to fetch the next batch seamlessly.`;
  } else if (canResumeCursor) {
    const totalLabel =
      totalProfilePosts && totalProfilePosts > allImages.length
        ? ` (out of ~${totalProfilePosts.toLocaleString()} profile posts)`
        : '';
    notice = `Fetched ${allImages.length} full-res photos${totalLabel}. Click "Load More Posts" to continue fetching the next batch.`;
  } else if (!parsedCookies.hasSessionId && (usedEmbedOnly || allImages.length <= 14)) {
    const totalLabel =
      totalProfilePosts && totalProfilePosts > allImages.length
        ? ` out of ~${totalProfilePosts.toLocaleString()} profile posts`
        : '';
    notice = `Fetched ${allImages.length} public preview photos${totalLabel} (including full-res masters & carousel slides). Add your Instagram "sessionid" cookie or run the 1-Click IG Profile Harvester in a logged-in tab to paginate ALL posts.`;
  } else if (truncated) {
    notice = `Fetched ${allImages.length} full-res photos (capped at Max Photos = ${maxLimit}). Increase Max Photos in the Instagram Profile panel to fetch more.`;
  }

  return {
    ok: true,
    status: 200,
    sessionExpired,
    data: {
      url: profileUrl,
      pageTitle: `@${username}${resolvedName ? ` (${resolvedName})` : ''} — Instagram Full-Res Profile`,
      images: allImages,
      stats: {
        totalFound: allImages.length,
        unshrunkCount: allImages.filter((i) => i.isUnshrunk).length,
        formats,
      },
      truncated,
      strategyUsed: strategyTrail.join(' + '),
      notice,
      hasMore: canResumeCursor,
      nextCursor,
      nextMaxId,
      userId,
      username,
      totalProfilePosts,
      sessionExpired,
    },
  };
}
