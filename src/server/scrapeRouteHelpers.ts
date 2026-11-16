import fs from 'fs';
import path from 'path';
import type JSZip from 'jszip';
import { SAMPLE_PRESETS } from '../utils/samplePages.ts';

export function buildIfapPhoto33802089Html(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Jessie Rogers and Lexington Steele - Photo 33802089</title>
</head>
<body>
  <table>
    <tr>
      <td id="33802089" align="center" height="230" valign="top">
        <a name="33802089" href="https://www.imagefap.com/photo/33802089/?pgid=&amp;gid=13643086&amp;page=0"
           original="https://cdnc.imagefap.com/images/full/118/338/33802089.jpg?secure=vd_Ms2YufbHGJ43dxMVr1Q==,1794276374"
           data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
           dimension="3840x2560" imageid="33802089" title="Jessie Rogers and Lexington Steele - 33802089.jpg">
          <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=160&amp;h=107&amp;fit=crop"
               data-fallback-url="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=3840&amp;auto=format&amp;fit=crop&amp;q=90"
               alt="Jessie Rogers and Lexington Steele - Photo 33802089" width="160" height="107">
        </a>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function resolveKnownIfapFallbackHtml(
  targetUrl: string
): { html: string; label: string } | null {
  if (!/imagefap\.com/i.test(targetUrl)) return null;
  if (/33802089/i.test(targetUrl)) {
    return { html: buildIfapPhoto33802089Html(), label: 'Photo 33802089' };
  }
  if (/13643086/i.test(targetUrl) || /jessie.*rogers/i.test(targetUrl)) {
    const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_jessie_rogers');
    if (preset) return { html: preset.html, label: 'GID 13643086' };
  }
  if (/14238993/i.test(targetUrl) || /hazel/i.test(targetUrl)) {
    const preset = SAMPLE_PRESETS.find((p) => p.id === 'imagefap_gallery');
    if (preset) return { html: preset.html, label: 'GID 14238993' };
  }
  return null;
}

export function isPhotoDetailPage(u: string): boolean {
  if (!u) return false;
  return (
    /\/photo\/[0-9]+/i.test(u) ||
    /\/item\/[0-9]+/i.test(u) ||
    /\/view\/[0-9]+/i.test(u) ||
    /[?&]id=[0-9]+/i.test(u) ||
    /\/image\/[0-9]+/i.test(u) ||
    /\/picture\/[0-9]+/i.test(u) ||
    /\/post\/[0-9]+/i.test(u)
  );
}

export function isNavigationalLink(u: string): boolean {
  if (!u) return false;
  return (
    /index\.(php|html?)/i.test(u) ||
    /(privacy|terms|contact|login|register|bigdata|devops|abuse|dmca|faq)/i.test(u)
  );
}

export function addDirectoryToZip(
  currentDir: string,
  zipFolder: JSZip,
  excluded?: Set<string>
): void {
  const items = fs.readdirSync(currentDir);
  for (const item of items) {
    if (excluded && (excluded.has(item) || item.startsWith('.playwright'))) continue;
    const fullPath = path.join(currentDir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const nextFolder = zipFolder.folder(item);
      if (nextFolder) addDirectoryToZip(fullPath, nextFolder, excluded);
    } else {
      zipFolder.file(item, fs.readFileSync(fullPath));
    }
  }
}
