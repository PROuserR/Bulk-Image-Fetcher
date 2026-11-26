import type { NextConfig } from 'next';

function collectEnvHosts(): string[] {
  const hosts = new Set<string>();
  const urlCandidates = [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL];
  for (const rawUrl of urlCandidates) {
    if (!rawUrl) continue;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname) hosts.add(parsed.hostname.toLowerCase());
    } catch {
      // ignore invalid URL env values
    }
  }
  const rawAllowed = process.env.NG_ALLOWED_HOSTS;
  if (rawAllowed) {
    for (const entry of rawAllowed.split(',')) {
      const trimmed = entry.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  return Array.from(hosts);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'localhost',
    '**.localhost',
    '127.0.0.1',
    '0.0.0.0',
    '**.run.app',
    '**.googleusercontent.com',
    '**.google.com',
    '**.corp.google.com',
    '**.web.app',
    '**.firebaseapp.com',
    ...collectEnvHosts(),
  ],
  images: {
    unoptimized: true,
  },
  compress: true,
  poweredByHeader: false,
  httpAgentOptions: {
    keepAlive: true,
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'motion'],
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
  serverExternalPackages: ['sharp', 'playwright-core', 'got-scraping', '7zip-bin'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;


