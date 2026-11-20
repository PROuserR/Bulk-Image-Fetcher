export type CaptionStyle = 'concise' | 'detailed' | 'structured' | 'alt_text';

export interface CaptionStyleMeta {
  id: CaptionStyle;
  label: string;
  shortDescription: string;
}

export const CAPTION_STYLES: CaptionStyleMeta[] = [
  {
    id: 'detailed',
    label: 'Detailed Description',
    shortDescription: 'Rich visual breakdown of subjects, setting, colors & lighting',
  },
  {
    id: 'concise',
    label: 'Dataset Caption (1-Sentence)',
    shortDescription: 'Crisp single-sentence caption ideal for LoRA & image datasets',
  },
  {
    id: 'structured',
    label: 'Structured JSON + Tags',
    shortDescription: 'Caption, full description, subject list, setting & searchable tags',
  },
  {
    id: 'alt_text',
    label: 'Accessibility Alt-Text',
    shortDescription: 'Screen-reader friendly description with concise keywords',
  },
];

export interface GemmaImageAttachment {
  id: string;
  filename: string;
  dataUrl: string; // data:image/jpeg;base64,...
}

export interface GemmaChatTurn {
  role: 'user' | 'assistant';
  text: string;
  images?: GemmaImageAttachment[];
}

export interface ParsedCaptionOutput {
  caption: string;
  detailedDescription: string;
  subjects: string[];
  tags: string[];
  setting: string;
  rawText: string;
}

export interface CaptionedImageResult {
  id: string;
  filename: string;
  relativePath: string;
  style: CaptionStyle;
  caption: string;
  detailedDescription: string;
  subjects: string[];
  tags: string[];
  setting: string;
  durationMs: number;
  error?: string;
}

export function stripModelThoughtBlocks(raw: string): string {
  if (!raw) return '';
  let cleaned = raw
    // Gemma 4 channel/thought markers if model emits reasoning tokens
    .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<\|thought\|>[\s\S]*?<\|\/thought\|>/gi, '')
    .replace(/<\|channel>\w*/gi, '')
    .replace(/<channel\|>/gi, '')
    .trim();
  return cleaned;
}

export function buildCaptionPrompt(style: CaptionStyle, customPrompt?: string): string {
  const custom = (customPrompt || '').trim();
  const focusClause = custom ? ` Additional focus instruction: ${custom}` : '';

  switch (style) {
    case 'concise':
      return `Write a single clear, accurate sentence captioning what is visible in this image. Describe the main subject, pose or action, clothing/objects, and setting without speculation.${focusClause}`;
    case 'alt_text':
      return `Write concise, objective accessibility alt-text (1-2 sentences) describing this image for a screen reader. Do not begin with "Image of" or "Photo of".${focusClause}`;
    case 'structured':
      return (
        `Analyze this image and return ONLY a valid JSON object with keys:\n` +
        `- "caption": concise 1-sentence summary\n` +
        `- "detailedDescription": 2-4 sentence visual description covering subjects, composition, objects, lighting, and background\n` +
        `- "subjects": array of short noun phrases for main subjects\n` +
        `- "tags": array of 5 to 10 lowercase descriptive keywords\n` +
        `- "setting": short phrase describing environment or background\n` +
        `Respond with raw JSON only.${focusClause}`
      );
    case 'detailed':
    default:
      return `Provide a vivid, accurate description of this image in 2-4 sentences. Cover the primary subjects, facial expression or posture if people are present, clothing/objects, composition, lighting, color palette, and background environment.${focusClause}`;
  }
}

export function buildBatchComparePrompt(
  filenames: string[],
  customPrompt?: string
): string {
  const custom = (customPrompt || '').trim();
  const nameList = filenames.map((name, idx) => `Image ${idx + 1}: ${name}`).join(', ');
  if (custom) {
    return `${custom}\n\nAttached images (${filenames.length}): ${nameList}`;
  }
  return `Compare and describe all ${filenames.length} attached images (${nameList}). For each image, summarize what it shows, then note visual similarities or differences across the set.`;
}

function normalizeStringList(value: unknown, maxItems = 12): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string') {
      return value
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, maxItems);
    }
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = String(item ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractFirstSentence(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const match = clean.match(/^[^.!?]+[.!?]/);
  if (match && match[0].length <= 240) {
    return match[0].trim();
  }
  return clean.length > 180 ? `${clean.slice(0, 177).trimEnd()}...` : clean;
}

export function parseCaptionModelOutput(
  rawResponse: string,
  style: CaptionStyle
): ParsedCaptionOutput {
  const cleaned = stripModelThoughtBlocks(rawResponse);

  if (style === 'structured') {
    const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonCandidate = fencedMatch ? fencedMatch[1].trim() : cleaned;
    const braceStart = jsonCandidate.indexOf('{');
    const braceEnd = jsonCandidate.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        const parsed = JSON.parse(jsonCandidate.slice(braceStart, braceEnd + 1));
        const detailed = String(
          parsed.detailedDescription || parsed.description || parsed.caption || ''
        ).trim();
        const caption =
          String(parsed.caption || '').trim() || extractFirstSentence(detailed) || cleaned;
        return {
          caption,
          detailedDescription: detailed || caption,
          subjects: normalizeStringList(parsed.subjects, 8),
          tags: normalizeStringList(parsed.tags || parsed.keywords, 12),
          setting: String(parsed.setting || parsed.environment || '').trim(),
          rawText: cleaned,
        };
      } catch {
        // Fall through cleanly to prose fallback
      }
    }
  }

  const normalized = cleaned.replace(/^caption:\s*/i, '').trim();
  const firstSentence = extractFirstSentence(normalized);
  return {
    caption: firstSentence || normalized,
    detailedDescription: normalized,
    subjects: [],
    tags: [],
    setting: '',
    rawText: cleaned,
  };
}

export interface OpenAiContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAiContentPart[];
}

export function buildOpenAiChatMessages(params: {
  systemPrompt?: string;
  history: GemmaChatTurn[];
  userText: string;
  userImages?: GemmaImageAttachment[];
  maxHistoryTurns?: number;
}): OpenAiChatMessage[] {
  const messages: OpenAiChatMessage[] = [];
  const systemText = (params.systemPrompt || '').trim();
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  const maxHistory = Math.max(0, Math.min(20, params.maxHistoryTurns ?? 8));
  const slicedHistory = params.history.slice(-maxHistory);

  // Keep images only on the last 1 prior user turn so CPU context window remains nimble
  const lastImageTurnIndex = (() => {
    for (let i = slicedHistory.length - 1; i >= 0; i--) {
      if (slicedHistory[i].role === 'user' && (slicedHistory[i].images?.length || 0) > 0) {
        return i;
      }
    }
    return -1;
  })();

  slicedHistory.forEach((turn, idx) => {
    if (turn.role === 'assistant') {
      if (turn.text.trim()) {
        messages.push({ role: 'assistant', content: turn.text.trim() });
      }
      return;
    }

    const includeImages = idx === lastImageTurnIndex && (turn.images?.length || 0) > 0;
    if (includeImages && turn.images) {
      const parts: OpenAiContentPart[] = turn.images.map((img) => ({
        type: 'image_url',
        image_url: { url: img.dataUrl },
      }));
      parts.push({
        type: 'text',
        text: turn.text.trim() || 'Describe these attached images.',
      });
      messages.push({ role: 'user', content: parts });
    } else {
      const imageHint =
        turn.images && turn.images.length > 0
          ? `[Previously attached ${turn.images.length} image(s): ${turn.images.map((i) => i.filename).join(', ')}]\n`
          : '';
      messages.push({
        role: 'user',
        content: `${imageHint}${turn.text.trim() || 'Continue.'}`,
      });
    }
  });

  const currentImages = params.userImages || [];
  const cleanUserText = params.userText.trim();
  if (currentImages.length > 0) {
    const parts: OpenAiContentPart[] = currentImages.map((img) => ({
      type: 'image_url',
      image_url: { url: img.dataUrl },
    }));
    parts.push({
      type: 'text',
      text:
        cleanUserText ||
        (currentImages.length === 1
          ? 'Describe this image in detail.'
          : `Analyze and describe all ${currentImages.length} attached images.`),
    });
    messages.push({ role: 'user', content: parts });
  } else if (cleanUserText) {
    messages.push({ role: 'user', content: cleanUserText });
  }

  return messages;
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(',');
  if (dataUrl.startsWith('data:') && commaIdx !== -1) {
    return dataUrl.slice(commaIdx + 1);
  }
  return dataUrl;
}

export function buildSidecarCaptionFilename(relativePath: string): string {
  const clean = (relativePath || 'image').replace(/\\/g, '/');
  const lastSlash = clean.lastIndexOf('/');
  const dir = lastSlash !== -1 ? clean.slice(0, lastSlash + 1) : '';
  const base = lastSlash !== -1 ? clean.slice(lastSlash + 1) : clean;
  const lastDot = base.lastIndexOf('.');
  const stem = lastDot > 0 ? base.slice(0, lastDot) : base;
  return `${dir}${stem}.txt`;
}

function escapeCsvCell(value: string): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCaptionsCsv(results: CaptionedImageResult[]): string {
  const headers = [
    'filename',
    'relative_path',
    'style',
    'caption',
    'detailed_description',
    'subjects',
    'tags',
    'setting',
    'duration_ms',
    'error',
  ];
  const rows = [headers.join(',')];
  for (const r of results) {
    rows.push(
      [
        escapeCsvCell(r.filename),
        escapeCsvCell(r.relativePath),
        escapeCsvCell(r.style),
        escapeCsvCell(r.caption),
        escapeCsvCell(r.detailedDescription),
        escapeCsvCell(r.subjects.join('; ')),
        escapeCsvCell(r.tags.join(', ')),
        escapeCsvCell(r.setting),
        String(Math.max(0, Math.round(r.durationMs || 0))),
        escapeCsvCell(r.error || ''),
      ].join(',')
    );
  }
  return rows.join('\n');
}

export function buildCaptionsJson(
  results: CaptionedImageResult[],
  meta: { model: string; sourceLabel: string; style: CaptionStyle }
): string {
  return JSON.stringify(
    {
      model: meta.model,
      source: meta.sourceLabel,
      style: meta.style,
      generatedAt: new Date().toISOString(),
      totalImages: results.length,
      captionedCount: results.filter((r) => !r.error).length,
      items: results,
    },
    null,
    2
  );
}

export function buildCaptionsMarkdown(
  results: CaptionedImageResult[],
  meta: { model: string; sourceLabel: string }
): string {
  const lines: string[] = [
    `# Auto-Generated Image Captions (${meta.model})`,
    ``,
    `- **Source**: ${meta.sourceLabel || 'Selected Images'}`,
    `- **Total Images**: ${results.length}`,
    `- **Successful**: ${results.filter((r) => !r.error).length}`,
    ``,
  ];

  results.forEach((item, idx) => {
    lines.push(`## ${idx + 1}. ${item.relativePath || item.filename}`);
    if (item.error) {
      lines.push(`- **Error**: ${item.error}`);
    } else {
      lines.push(`- **Caption**: ${item.caption}`);
      if (item.detailedDescription && item.detailedDescription !== item.caption) {
        lines.push(`- **Description**: ${item.detailedDescription}`);
      }
      if (item.subjects.length > 0) {
        lines.push(`- **Subjects**: ${item.subjects.join(', ')}`);
      }
      if (item.setting) {
        lines.push(`- **Setting**: ${item.setting}`);
      }
      if (item.tags.length > 0) {
        lines.push(`- **Tags**: \`${item.tags.join('`, `')}\``);
      }
    }
    lines.push('');
  });

  return lines.join('\n');
}

export function buildSidecarTextContent(item: CaptionedImageResult): string {
  if (item.detailedDescription && item.detailedDescription !== item.caption) {
    const tagsLine = item.tags.length > 0 ? `\nTags: ${item.tags.join(', ')}` : '';
    return `${item.caption}\n\n${item.detailedDescription}${tagsLine}\n`;
  }
  const tagsLine = item.tags.length > 0 ? `\nTags: ${item.tags.join(', ')}` : '';
  return `${item.caption}${tagsLine}\n`;
}

export function chunkCaptionItems<T>(items: T[], chunkSize = 4): T[][] {
  const size = Math.max(1, Math.round(chunkSize));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
