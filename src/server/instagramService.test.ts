import test from 'node:test';
import assert from 'node:assert/strict';
import { scrapeInstagramProfile, createSafeCookieJar } from './instagramService';
import type { InstagramHttpClient } from './instagramService';

test('scrapeInstagramProfile falls back cleanly to profile embed SSR and expands GraphSidecar carousel slides', async () => {
  const profileEmbedObj = {
    context: {
      username: 'nasa',
      full_name: 'NASA',
      owner_id: '528817151',
      posts_count: 5010,
      graphql_media: [
        {
          shortcode_media: {
            __typename: 'GraphSidecar',
            id: '2001',
            shortcode: 'SIDECAR_X',
            dimensions: { width: 1080, height: 1350 },
            display_url: 'https://scontent.cdninstagram.com/v/t51.82787-15/slide_1.jpg?stp=dst-jpg_e35_tt6',
            edge_media_to_caption: { edges: [{ node: { text: 'Carousel mission' } }] },
          },
        },
        {
          shortcode_media: {
            __typename: 'GraphImage',
            id: '2002',
            shortcode: 'SINGLE_Y',
            dimensions: { width: 1080, height: 1080 },
            display_url: 'https://scontent.cdninstagram.com/v/t51.82787-15/single_y.jpg?stp=dst-jpg_e35_tt6',
            edge_media_to_caption: { edges: [{ node: { text: 'Solar flare' } }] },
          },
        },
      ],
    },
  };

  const postEmbedObj = {
    context: { type: 'GraphSidecar', shortcode: 'SIDECAR_X' },
    gql_data: {
      shortcode_media: {
        __typename: 'GraphSidecar',
        shortcode: 'SIDECAR_X',
        edge_sidecar_to_children: {
          edges: [
            {
              node: {
                id: 's1',
                display_url: 'https://scontent.cdninstagram.com/v/t51.82787-15/slide_1.jpg?oh=refreshed',
                dimensions: { width: 1080, height: 1350 },
              },
            },
            {
              node: {
                id: 's2',
                display_url: 'https://scontent.cdninstagram.com/v/t51.82787-15/slide_2.jpg?oh=refreshed',
                dimensions: { width: 1080, height: 1350 },
              },
            },
          ],
        },
      },
    },
  };

  const requestedUrls: string[] = [];
  const mockClient: InstagramHttpClient = {
    getCsrfToken: async () => 'csrf_bootstrapped',
    get: async (url) => {
      requestedUrls.push(url);
      if (url.includes('/api/v1/users/web_profile_info')) {
        return { status: 404, ok: false, headers: {}, text: '<html>not found</html>' };
      }
      if (url === 'https://www.instagram.com/nasa/') {
        return {
          status: 302,
          ok: false,
          headers: { location: 'https://www.instagram.com/accounts/login/' },
          text: '',
        };
      }
      if (url === 'https://www.instagram.com/nasa/embed/') {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: `<script>s.handle({"contextJSON":${JSON.stringify(JSON.stringify(profileEmbedObj))}});</script>`,
        };
      }
      if (url === 'https://www.instagram.com/p/SIDECAR_X/embed/') {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: `<script>s.handle({"contextJSON":${JSON.stringify(JSON.stringify(postEmbedObj))}});</script>`,
        };
      }
      return { status: 404, ok: false, headers: {}, text: '' };
    },
  };

  const result = await scrapeInstagramProfile(
    {
      profileUrl: 'https://www.instagram.com/nasa/',
      username: 'nasa',
      maxPosts: 100,
    },
    {
      createClient: async () => mockClient,
      headlessFallback: async () => null,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data?.images.length, 3);
  assert.ok(result.data?.strategyUsed?.includes('profile_embed_ssr'));
  assert.ok(result.data?.strategyUsed?.includes('sidecar_carousel_enrichment'));
  assert.ok(requestedUrls.includes('https://www.instagram.com/p/SIDECAR_X/embed/'));
});

test('scrapeInstagramProfile injects CSRF header across authenticated REST v1 pagination pages', async () => {
  const capturedHeaders: Array<Record<string, string>> = [];
  const mockClient: InstagramHttpClient = {
    getCsrfToken: async () => 'tok_csrf_abc',
    get: async (url, headers = {}) => {
      capturedHeaders.push(headers);
      if (url.includes('/api/v1/users/web_profile_info')) {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({
            data: {
              user: {
                id: '42',
                username: 'natgeo',
                full_name: 'NatGeo',
                edge_owner_to_timeline_media: {
                  page_info: { has_next_page: false },
                  edges: [
                    {
                      node: {
                        id: '1',
                        shortcode: 'PAGE1',
                        display_url: 'https://scontent.cdninstagram.com/v/p1.jpg',
                        dimensions: { width: 1080, height: 1080 },
                      },
                    },
                  ],
                },
              },
            },
          }),
        };
      }
      if (url.includes('/api/v1/feed/user/42/') && !url.includes('max_id=')) {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({
            more_available: true,
            next_max_id: 'NEXT_99',
            items: [
              {
                pk: '2',
                code: 'PAGE2',
                original_width: 1200,
                original_height: 1500,
                image_versions2: {
                  candidates: [{ url: 'https://scontent.cdninstagram.com/v/p2.jpg', width: 1200, height: 1500 }],
                },
              },
            ],
          }),
        };
      }
      if (url.includes('max_id=NEXT_99')) {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({
            more_available: false,
            items: [
              {
                pk: '3',
                code: 'PAGE3',
                original_width: 1080,
                original_height: 1080,
                image_versions2: {
                  candidates: [{ url: 'https://scontent.cdninstagram.com/v/p3.jpg', width: 1080, height: 1080 }],
                },
              },
            ],
          }),
        };
      }
      return { status: 404, ok: false, headers: {}, text: '' };
    },
  };

  const result = await scrapeInstagramProfile(
    {
      profileUrl: 'https://www.instagram.com/natgeo/',
      username: 'natgeo',
      sessionCookie: 'csrftoken=tok_csrf_abc; sessionid=sess_xyz',
      maxPosts: 100,
    },
    {
      createClient: async () => mockClient,
      headlessFallback: async () => null,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.images.length, 3);
  assert.equal(capturedHeaders[0]['x-csrftoken'], 'tok_csrf_abc');
  assert.equal(capturedHeaders[0]['Sec-Fetch-Site'], 'same-origin');
  assert.equal(capturedHeaders[0]['Sec-Fetch-Mode'], 'cors');
  assert.equal(capturedHeaders[1]['x-csrftoken'], 'tok_csrf_abc');
  assert.ok(result.data?.strategyUsed?.includes('rest_v1_pagination'));
});

test('scrapeInstagramProfile invokes headless Chromium fallback when all HTTP strategies yield no media', async () => {
  const mockClient: InstagramHttpClient = {
    getCsrfToken: async () => undefined,
    get: async () => ({ status: 403, ok: false, headers: {}, text: 'blocked' }),
  };

  const result = await scrapeInstagramProfile(
    {
      profileUrl: 'https://www.instagram.com/example_user/',
      username: 'example_user',
      maxPosts: 50,
    },
    {
      createClient: async () => mockClient,
      headlessFallback: async () => ({
        userId: '999',
        fullName: 'Example User',
        images: [
          {
            id: 'ig_1',
            thumbnailUrl: 'https://scontent.cdninstagram.com/v/browser_shot.jpg',
            fullUrl: 'https://scontent.cdninstagram.com/v/browser_shot.jpg',
            isUnshrunk: true,
            unshrinkMethod: 'Instagram Browser Fallback',
            altText: 'Shot 1',
            format: 'jpg',
            resolutionTier: 'hd',
            filename: 'example_user_shot1.jpg',
          },
        ],
      }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.images.length, 1);
  assert.ok(result.data?.strategyUsed?.includes('headless_chromium_pagination'));
});

test('createSafeCookieJar ignores cross-subdomain Domain=i.instagram.com Set-Cookie errors', async () => {
  const safeJar = createSafeCookieJar();
  await assert.doesNotReject(async () => {
    await safeJar.setCookie(
      'rur=RVA; Domain=i.instagram.com; Path=/; HttpOnly',
      'https://www.instagram.com/api/v1/users/web_profile_info/?username=nasa'
    );
  });
});

test('scrapeInstagramProfile bootstraps CSRF for raw sessionid and falls back across username REST v1 pagination', async () => {
  let csrfFromJar: string | undefined;
  const visited: string[] = [];

  const mockClient: InstagramHttpClient = {
    getCsrfToken: async () => csrfFromJar,
    get: async (url, headers = {}) => {
      visited.push(url);
      if (url === 'https://www.instagram.com/') {
        csrfFromJar = 'bootstrapped_csrf_1';
        return {
          status: 200,
          ok: true,
          headers: {},
          text: '<script>"LSD",[],{"token":"lsd_tok_99"}</script>',
        };
      }
      if (url.includes('/api/v1/users/web_profile_info')) {
        assert.equal(headers['x-csrftoken'], 'bootstrapped_csrf_1');
        return {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({
            data: {
              user: {
                id: '555001',
                username: 'photolab',
                edge_owner_to_timeline_media: {
                  page_info: { has_next_page: true, end_cursor: 'CUR_1' },
                  edges: [
                    {
                      node: {
                        id: '10',
                        shortcode: 'FIRST_1',
                        display_url: 'https://scontent.cdninstagram.com/v/first_1.jpg',
                        dimensions: { width: 1080, height: 1080 },
                      },
                    },
                  ],
                },
              },
            },
          }),
        };
      }
      if (url.includes('/api/v1/feed/user/555001/')) {
        return { status: 404, ok: false, headers: {}, text: '{}' };
      }
      if (url.includes('/api/v1/feed/user/photolab/username/')) {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({
            more_available: false,
            items: [
              {
                pk: '11',
                code: 'SECOND_2',
                original_width: 1440,
                original_height: 1800,
                image_versions2: {
                  candidates: [{ url: 'https://scontent.cdninstagram.com/v/second_2.jpg', width: 1440, height: 1800 }],
                },
              },
            ],
          }),
        };
      }
      return { status: 404, ok: false, headers: {}, text: '' };
    },
  };

  const result = await scrapeInstagramProfile(
    {
      profileUrl: 'https://www.instagram.com/photolab/',
      username: 'photolab',
      sessionCookie: '555001%3AsecretToken%3A1',
      maxPosts: 100,
    },
    {
      createClient: async () => mockClient,
      headlessFallback: async () => null,
    }
  );

  assert.equal(result.ok, true);
  assert.ok(visited.includes('https://www.instagram.com/'));
  assert.equal(result.data?.images.length, 2);
  assert.ok(result.data?.strategyUsed?.includes('rest_v1_username_pagination'));
});

test('scrapeInstagramProfile invokes Tier 6 headless Chromium when sessionid is supplied and HTTP only got embed preview', async () => {
  const profileEmbedObj = {
    context: {
      username: 'nasa',
      owner_id: '528817151',
      posts_count: 5000,
      graphql_media: [
        {
          shortcode_media: {
            __typename: 'GraphImage',
            id: '1',
            shortcode: 'EMBED_1',
            dimensions: { width: 1080, height: 1080 },
            display_url: 'https://scontent.cdninstagram.com/v/embed_preview_1.jpg',
          },
        },
      ],
    },
  };

  let headlessCalled = false;
  const mockClient: InstagramHttpClient = {
    getCsrfToken: async () => 'csrf_1',
    get: async (url) => {
      if (url === 'https://www.instagram.com/nasa/embed/') {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: `<script>s.handle({"contextJSON":${JSON.stringify(JSON.stringify(profileEmbedObj))}});</script>`,
        };
      }
      return { status: 403, ok: false, headers: {}, text: '{"message":"Please wait"}' };
    },
  };

  const result = await scrapeInstagramProfile(
    {
      profileUrl: 'https://www.instagram.com/nasa/',
      username: 'nasa',
      sessionCookie: 'csrftoken=csrf_1; sessionid=528817151%3Avalid%3A1',
      maxPosts: 100,
    },
    {
      createClient: async () => mockClient,
      headlessFallback: async () => {
        headlessCalled = true;
        return {
          userId: '528817151',
          images: [
            {
              id: 'ig_2',
              thumbnailUrl: 'https://scontent.cdninstagram.com/v/scrolled_deep_1.jpg',
              fullUrl: 'https://scontent.cdninstagram.com/v/scrolled_deep_1.jpg',
              isUnshrunk: true,
              unshrinkMethod: 'Instagram Profile Scroll Master',
              altText: 'Deep Post 1',
              format: 'jpg',
              resolutionTier: 'hd',
              filename: 'nasa_DEEP_1.jpg',
            },
          ],
          hasNextPage: true,
          endCursor: 'NEXT_PAGE_CUR',
        };
      },
    }
  );

  assert.equal(headlessCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.data?.images.length, 2);
  assert.equal(result.data?.hasMore, true);
  assert.equal(result.data?.nextCursor, 'NEXT_PAGE_CUR');
});

test('scrapeInstagramProfile supports cursor continuation (resumeUserId + resumeMaxId)', async () => {
  const visited: string[] = [];
  const mockClient: InstagramHttpClient = {
    getCsrfToken: async () => 'csrf_resume',
    get: async (url) => {
      visited.push(url);
      if (url.includes('/api/v1/feed/user/42/') && url.includes('max_id=CURSOR_RESUME_2')) {
        return {
          status: 200,
          ok: true,
          headers: {},
          text: JSON.stringify({
            more_available: true,
            next_max_id: 'CURSOR_RESUME_3',
            items: [
              {
                pk: '999',
                code: 'RESUMED_POST',
                original_width: 1080,
                original_height: 1350,
                image_versions2: {
                  candidates: [{ url: 'https://scontent.cdninstagram.com/v/resumed_post.jpg', width: 1080, height: 1350 }],
                },
              },
            ],
          }),
        };
      }
      return { status: 404, ok: false, headers: {}, text: '' };
    },
  };

  const result = await scrapeInstagramProfile(
    {
      profileUrl: 'https://www.instagram.com/natgeo/',
      username: 'natgeo',
      sessionCookie: 'csrftoken=csrf_resume; sessionid=42%3Aok%3A1',
      maxPosts: 1,
      resumeUserId: '42',
      resumeMaxId: 'CURSOR_RESUME_2',
    },
    {
      createClient: async () => mockClient,
      headlessFallback: async () => null,
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.data?.images.length, 1);
  assert.equal(result.data?.hasMore, true);
  assert.equal(result.data?.nextMaxId, 'CURSOR_RESUME_3');
  // Skips web_profile_info when resuming directly from cursor
  assert.ok(!visited.some((u) => u.includes('web_profile_info')));
});

