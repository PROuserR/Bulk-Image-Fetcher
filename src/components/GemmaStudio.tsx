'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageSquare,
  Sparkles,
  ImagePlus,
  FolderOpen,
  Send,
  Trash2,
  Copy,
  Check,
  Download,
  FileArchive,
  Loader2,
  AlertCircle,
  Square,
  Cpu,
  X,
  FolderInput,
  Wand2,
} from 'lucide-react';
import {
  CAPTION_STYLES,
  CaptionedImageResult,
  CaptionStyle,
  GemmaChatTurn,
  GemmaImageAttachment,
  buildCaptionsCsv,
  buildCaptionsJson,
  buildCaptionsMarkdown,
} from '../utils/gemmaCaptionLogic';
import { triggerBlobDownload, triggerTextDownload } from '../utils/downloader';
import { ScrapedImage } from '../utils/scraperLogic';
import { resolveSeededPreviewUrl } from '../utils/folderGalleryLogic';
import {
  CUSTOM_LLM_SETTINGS_EVENT,
  CustomLlmSettings,
  DEFAULT_CUSTOM_LLM_SETTINGS,
  getActiveEngineDisplayName,
  loadCustomLlmSettings,
  saveCustomLlmSettings,
} from '../utils/customLlmConfig';
import {
  captionSingleImageWithCustomLlm,
  ensureImageDataUrlInBrowser,
  runCustomLlmChatTurn,
} from '../utils/customLlmClient';
import { LlmProviderPanel } from './LlmProviderPanel';

interface GemmaStudioProps {
  seededScrapedImages?: ScrapedImage[];
  seededSourceUrl?: string;
  onClearSeeded?: () => void;
  onNotify?: (message: string) => void;
}

type StudioSubMode = 'chat' | 'caption';
type CaptionSourceMode = 'select' | 'directory';

interface LocalCaptionInputItem {
  id: string;
  filename: string;
  relativePath: string;
  previewUrl: string;
  objectUrlToRevoke?: string;
  dataUrl?: string;
  remoteUrl?: string;
  referer?: string;
  sizeBytes: number;
}

interface GemmaStatusSnapshot {
  status: 'ready' | 'starting' | 'stopped' | 'missing_assets';
  modelName: string;
  lastError?: string;
}

const SAMPLE_HUMAN_FILES = [
  'random_001.jpg',
  'random_002.jpg',
  'random_003.jpg',
  'random_004.jpg',
  'random_005.jpg',
  'random_006.jpg',
];

async function encodeUrlOrFileToCompactJpeg(
  src: string | File,
  maxEdge = 640
): Promise<string> {
  let objectUrl: string | null = null;
  const srcUrl =
    typeof src === 'string' ? src : ((objectUrl = URL.createObjectURL(src)), objectUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Image decoding timed out'));
    }, 12000);

    img.onload = () => {
      clearTimeout(timer);
      const natW = Math.max(1, img.naturalWidth || img.width || 1);
      const natH = Math.max(1, img.naturalHeight || img.height || 1);
      const scale = Math.min(1, maxEdge / Math.max(natW, natH));
      const targetW = Math.max(1, Math.round(natW * scale));
      const targetH = Math.max(1, Math.round(natH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(dataUrl);
    };

    img.onerror = () => {
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(new Error('Unable to decode image'));
    };

    img.src = srcUrl;
  });
}

async function consumeNdjsonStream(
  response: Response,
  onEvent: (event: any) => void
) {
  if (!response.body) {
    throw new Error('Streaming response body missing');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed));
      } catch {
        // ignore partial line
      }
    }
  }
  const trailing = buffer.trim();
  if (trailing) {
    try {
      onEvent(JSON.parse(trailing));
    } catch {
      // ignore invalid trailing JSON
    }
  }
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(
        <strong key={`b_${key++}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(
        <code
          key={`c_${key++}`}
          className="font-mono text-[0.9em] px-1 py-0.5 rounded bg-black/10 dark:bg-white/10"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(token);
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

const FormattedChatText: React.FC<{ text: string; streaming?: boolean }> = ({
  text,
  streaming = false,
}) => {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={`ul_${blocks.length}`} className="list-disc pl-5 space-y-1 my-1.5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={`ol_${blocks.length}`} className="list-decimal pl-5 space-y-1 my-1.5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,3}\s+/, '');
      blocks.push(
        <div key={`h_${blocks.length}`} className="font-semibold mt-2 first:mt-0">
          {renderInlineMarkdown(heading)}
        </div>
      );
      i++;
      continue;
    }

    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^[-*•]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !/^#{1,3}\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    const isLastBlock = i >= lines.length;
    blocks.push(
      <p key={`p_${blocks.length}`} className="my-1.5 first:mt-0 last:mb-0">
        {renderInlineMarkdown(paraLines.join(' '))}
        {streaming && isLastBlock && (
          <span className="inline-block w-1.5 h-3.5 ml-1 align-middle bg-blue-600 animate-pulse" />
        )}
      </p>
    );
  }

  return (
    <div data-chat-message-body="true" className="break-words space-y-1">
      {blocks.length > 0 ? (
        blocks
      ) : (
        <span className="whitespace-pre-wrap">{text}</span>
      )}
    </div>
  );
};

export const GemmaStudio: React.FC<GemmaStudioProps> = ({
  seededScrapedImages = [],
  seededSourceUrl = '',
  onClearSeeded,
  onNotify,
}) => {
  const [subMode, setSubMode] = useState<StudioSubMode>('chat');
  const [runtimeStatus, setRuntimeStatus] = useState<GemmaStatusSnapshot | null>(null);
  const [isWarming, setIsWarming] = useState<boolean>(false);
  const [llmSettings, setLlmSettings] = useState<CustomLlmSettings>(
    DEFAULT_CUSTOM_LLM_SETTINGS
  );

  // --- Multimodal Chat State ---
  const [chatMessages, setChatMessages] = useState<GemmaChatTurn[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatAttachments, setChatAttachments] = useState<GemmaImageAttachment[]>([]);
  const [isChatStreaming, setIsChatStreaming] = useState<boolean>(false);
  const [streamingAssistantText, setStreamingAssistantText] = useState<string>('');
  const [chatStatusText, setChatStatusText] = useState<string>('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatDragging, setIsChatDragging] = useState<boolean>(false);

  // --- Batch Auto-Captioner State ---
  const [captionSourceMode, setCaptionSourceMode] = useState<CaptionSourceMode>('select');
  const [selectedCaptionItems, setSelectedCaptionItems] = useState<LocalCaptionInputItem[]>([]);
  const [dirPathInput, setDirPathInput] = useState<string>('');
  const [dirRecursive, setDirRecursive] = useState<boolean>(true);
  const [writeSidecars, setWriteSidecars] = useState<boolean>(false);
  const [scannedDirRoot, setScannedDirRoot] = useState<string>('');
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>('detailed');
  const [customCaptionFocus, setCustomCaptionFocus] = useState<string>('');
  const [captionResults, setCaptionResults] = useState<CaptionedImageResult[]>([]);
  const [previewUrlById, setPreviewUrlById] = useState<Record<string, string>>({});
  const [isCaptioning, setIsCaptioning] = useState<boolean>(false);
  const [captionProgress, setCaptionProgress] = useState<{
    done: number;
    total: number;
    label: string;
  }>({ done: 0, total: 0, label: '' });
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [isCaptionDragging, setIsCaptionDragging] = useState<boolean>(false);
  const [isExportingZip, setIsExportingZip] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const captionFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const captionAbortRef = useRef<AbortController | null>(null);
  const revokableUrlsRef = useRef<string[]>([]);
  const onClearSeededRef = useRef(onClearSeeded);
  onClearSeededRef.current = onClearSeeded;

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const resp = await fetch('/api/ai/gemma/status', { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      setRuntimeStatus({
        status: data.status || 'stopped',
        modelName: data.modelName || 'Gemma 4 E2B (Open-Source Local)',
        lastError: data.lastError,
      });
    } catch {
      // ignore transient status poll failures
    }
  }, []);

  useEffect(() => {
    setLlmSettings(loadCustomLlmSettings());
    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<CustomLlmSettings>;
      if (customEvent.detail) {
        setLlmSettings(customEvent.detail);
      }
    };
    window.addEventListener(CUSTOM_LLM_SETTINGS_EVENT, handleSync);
    return () => window.removeEventListener(CUSTOM_LLM_SETTINGS_EVENT, handleSync);
  }, []);

  const handleUpdateLlmSettings = useCallback((next: CustomLlmSettings) => {
    const saved = saveCustomLlmSettings(next);
    setLlmSettings(saved);
  }, []);

  useEffect(() => {
    refreshRuntimeStatus();
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    return () => {
      for (const url of revokableUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      revokableUrlsRef.current = [];
    };
  }, []);

  // Accept scraped gallery handoff into Auto-Captioner
  useEffect(() => {
    if (!seededScrapedImages || seededScrapedImages.length === 0) return;
    const mapped: LocalCaptionInputItem[] = seededScrapedImages.slice(0, 100).map((img, idx) => ({
      id: `seed_${idx + 1}_${img.id}`,
      filename: img.filename || `scraped_${idx + 1}.jpg`,
      relativePath: img.filename || `scraped_${idx + 1}.jpg`,
      previewUrl: resolveSeededPreviewUrl(img.fullUrl, seededSourceUrl || ''),
      remoteUrl: img.fullUrl,
      referer: seededSourceUrl,
      sizeBytes: 0,
    }));
    setSelectedCaptionItems(mapped);
    setCaptionResults([]);
    setCaptionError(null);
    setCaptionSourceMode('select');
    setSubMode('caption');
    const urls: Record<string, string> = {};
    mapped.forEach((m) => {
      urls[m.id] = m.previewUrl;
    });
    setPreviewUrlById(urls);
    onNotify?.(`Loaded ${mapped.length} gallery images into Gemma 4 Auto-Captioner.`);
    onClearSeededRef.current?.();
  }, [seededScrapedImages, seededSourceUrl, onNotify]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, streamingAssistantText]);

  const handleWarmModel = async () => {
    setIsWarming(true);
    setChatError(null);
    setCaptionError(null);
    try {
      const resp = await fetch('/api/ai/gemma/status', { method: 'POST' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to warm local Gemma 4 runtime.');
      }
      setRuntimeStatus({
        status: data.status || 'ready',
        modelName: data.modelName || 'Gemma 4 E2B (Open-Source Local)',
      });
      onNotify?.('Local Gemma 4 E2B multimodal engine is loaded and ready.');
    } catch (err: any) {
      const msg = err?.message || 'Unable to warm Gemma 4 runtime.';
      setChatError(msg);
      setCaptionError(msg);
    } finally {
      setIsWarming(false);
    }
  };

  // --- Chat Attachment Helpers ---
  const addChatFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    const remainingSlots = Math.max(0, 6 - chatAttachments.length);
    const chosen = fileArray.slice(0, remainingSlots);
    const encoded: GemmaImageAttachment[] = [];

    for (let i = 0; i < chosen.length; i++) {
      const f = chosen[i];
      try {
        const dataUrl = await encodeUrlOrFileToCompactJpeg(f, 640);
        encoded.push({
          id: `att_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
          filename: f.name,
          dataUrl,
        });
      } catch {
        // skip unreadable file
      }
    }

    if (encoded.length > 0) {
      setChatAttachments((prev) => [...prev, ...encoded].slice(0, 6));
      setChatError(null);
    }
  };

  const handleAttachSamplePairToChat = async () => {
    try {
      const samples = ['random_001.jpg', 'random_002.jpg'];
      const loaded: GemmaImageAttachment[] = [];
      for (let i = 0; i < samples.length; i++) {
        const name = samples[i];
        const dataUrl = await encodeUrlOrFileToCompactJpeg(`/samples/humans/${name}`, 640);
        loaded.push({
          id: `sample_chat_${Date.now()}_${i}`,
          filename: name,
          dataUrl,
        });
      }
      setChatAttachments((prev) => [...prev, ...loaded].slice(0, 6));
      if (!chatInput.trim()) {
        setChatInput('Describe both attached photos and compare what the people are wearing.');
      }
    } catch (err: any) {
      setChatError(err?.message || 'Could not load sample images.');
    }
  };

  const handleSendChat = async (overridePrompt?: string) => {
    const promptText = (overridePrompt ?? chatInput).trim();
    if (isChatStreaming || (!promptText && chatAttachments.length === 0)) return;

    const outgoingImages = [...chatAttachments];
    const userTurn: GemmaChatTurn = {
      role: 'user',
      text:
        promptText ||
        (outgoingImages.length === 1
          ? 'Describe this image.'
          : `Describe and compare these ${outgoingImages.length} images.`),
      images: outgoingImages.length > 0 ? outgoingImages : undefined,
    };

    const nextHistory = [...chatMessages, userTurn];
    setChatMessages(nextHistory);
    if (overridePrompt === undefined) setChatInput('');
    setChatAttachments([]);
    setChatError(null);
    setStreamingAssistantText('');
    setChatStatusText(
      llmSettings.provider === 'builtin'
        ? 'Starting Gemma 4 E2B...'
        : `Connecting to ${getActiveEngineDisplayName(llmSettings)}...`
    );
    setIsChatStreaming(true);

    const controller = new AbortController();
    chatAbortRef.current = controller;

    let assembledReply = '';

    try {
      if (llmSettings.provider !== 'builtin') {
        const result = await runCustomLlmChatTurn(llmSettings, {
          history: chatMessages,
          userText: userTurn.text,
          userImages: outgoingImages,
          signal: controller.signal,
          onDelta: (delta) => {
            setChatStatusText('');
            assembledReply += delta;
            setStreamingAssistantText(assembledReply);
          },
        });
        if (result.reply.trim()) {
          assembledReply = result.reply;
        }
      } else {
        const resp = await fetch('/api/ai/gemma/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: chatMessages,
            userText: userTurn.text,
            userImages: outgoingImages,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errPayload = await resp.json().catch(() => ({}));
          throw new Error(errPayload.error || `HTTP ${resp.status}`);
        }

        await consumeNdjsonStream(resp, (ev) => {
          if (ev.type === 'status' && typeof ev.message === 'string') {
            setChatStatusText(ev.message);
          } else if (ev.type === 'delta' && typeof ev.text === 'string') {
            setChatStatusText('');
            assembledReply += ev.text;
            setStreamingAssistantText(assembledReply);
          } else if (ev.type === 'done') {
            const finalReply =
              typeof ev.reply === 'string' && ev.reply.trim() ? ev.reply : assembledReply;
            assembledReply = finalReply;
          } else if (ev.type === 'error') {
            throw new Error(ev.error || 'Chat generation failed');
          }
        });
      }

      if (assembledReply.trim()) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', text: assembledReply.trim() },
        ]);
      }
      if (llmSettings.provider === 'builtin') {
        refreshRuntimeStatus();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (assembledReply.trim()) {
          setChatMessages((prev) => [
            ...prev,
            { role: 'assistant', text: `${assembledReply.trim()} [stopped]` },
          ]);
        }
      } else {
        setChatError(err?.message || 'Failed to generate reply.');
      }
    } finally {
      chatAbortRef.current = null;
      setIsChatStreaming(false);
      setStreamingAssistantText('');
      setChatStatusText('');
    }
  };

  // --- Batch Auto-Captioner Helpers ---
  const addCaptionFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    const newItems: LocalCaptionInputItem[] = [];
    const previewPatch: Record<string, string> = {};

    for (let i = 0; i < Math.min(120, fileArray.length); i++) {
      const f = fileArray[i];
      const objectUrl = URL.createObjectURL(f);
      revokableUrlsRef.current.push(objectUrl);
      const id = `cap_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
      let dataUrl = '';
      try {
        dataUrl = await encodeUrlOrFileToCompactJpeg(f, 640);
      } catch {
        continue;
      }
      newItems.push({
        id,
        filename: f.name,
        relativePath: (f as any).webkitRelativePath || f.name,
        previewUrl: objectUrl,
        objectUrlToRevoke: objectUrl,
        dataUrl,
        sizeBytes: f.size,
      });
      previewPatch[id] = objectUrl;
    }

    if (newItems.length > 0) {
      setSelectedCaptionItems((prev) => [...prev, ...newItems].slice(0, 120));
      setPreviewUrlById((prev) => ({ ...prev, ...previewPatch }));
      setCaptionError(null);
    }
  };

  const handleLoadSampleBatchForCaption = async () => {
    setCaptionError(null);
    const items: LocalCaptionInputItem[] = [];
    const previews: Record<string, string> = {};
    for (let i = 0; i < SAMPLE_HUMAN_FILES.length; i++) {
      const filename = SAMPLE_HUMAN_FILES[i];
      const url = `/samples/humans/${filename}`;
      try {
        const dataUrl = await encodeUrlOrFileToCompactJpeg(url, 640);
        const id = `sample_cap_${i + 1}`;
        items.push({
          id,
          filename,
          relativePath: filename,
          previewUrl: url,
          dataUrl,
          sizeBytes: 0,
        });
        previews[id] = url;
      } catch {
        // skip
      }
    }
    setSelectedCaptionItems(items);
    setPreviewUrlById(previews);
    setCaptionResults([]);
    setCaptionSourceMode('select');
    onNotify?.(`Loaded ${items.length} sample portraits ready for auto-captioning.`);
  };

  const handleRunSelectedCaptions = async () => {
    if (selectedCaptionItems.length === 0 || isCaptioning) return;
    setIsCaptioning(true);
    setCaptionError(null);
    setCaptionResults([]);
    setCaptionProgress({
      done: 0,
      total: selectedCaptionItems.length,
      label:
        llmSettings.provider === 'builtin'
          ? 'Initializing local Gemma 4 E2B...'
          : `Connecting to ${getActiveEngineDisplayName(llmSettings)}...`,
    });

    const controller = new AbortController();
    captionAbortRef.current = controller;

    try {
      if (llmSettings.provider !== 'builtin') {
        const completedResults: CaptionedImageResult[] = [];
        for (let i = 0; i < selectedCaptionItems.length; i++) {
          if (controller.signal.aborted) break;
          const item = selectedCaptionItems[i];
          setCaptionProgress({
            done: i,
            total: selectedCaptionItems.length,
            label: `Captioning ${item.filename} (${i + 1}/${selectedCaptionItems.length})...`,
          });

          let dataUrl = item.dataUrl || '';
          if (!dataUrl) {
            try {
              dataUrl = await ensureImageDataUrlInBrowser(
                item.remoteUrl || item.previewUrl,
                512
              );
            } catch (imgErr: any) {
              const errRes: CaptionedImageResult = {
                id: item.id,
                filename: item.filename,
                relativePath: item.relativePath,
                style: captionStyle,
                caption: '',
                detailedDescription: '',
                subjects: [],
                tags: [],
                setting: '',
                durationMs: 0,
                error: imgErr?.message || 'Unable to decode image for vision model',
              };
              completedResults.push(errRes);
              setCaptionResults([...completedResults]);
              continue;
            }
          }

          const captioned = await captionSingleImageWithCustomLlm(llmSettings, {
            id: item.id,
            filename: item.filename,
            relativePath: item.relativePath,
            dataUrl,
            style: captionStyle,
            customPrompt: customCaptionFocus.trim() || undefined,
            signal: controller.signal,
          });
          completedResults.push(captioned);
          setCaptionResults([...completedResults]);
          setCaptionProgress({
            done: i + 1,
            total: selectedCaptionItems.length,
            label: `Captioned ${i + 1}/${selectedCaptionItems.length}`,
          });
        }
        const okCount = completedResults.filter((r) => !r.error).length;
        onNotify?.(
          `Auto-captioned ${okCount} image(s) with ${getActiveEngineDisplayName(llmSettings)}.`
        );
        return;
      }

      const resp = await fetch('/api/ai/gemma/caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: selectedCaptionItems.map((item) => ({
            id: item.id,
            filename: item.filename,
            relativePath: item.relativePath,
            dataUrl: item.dataUrl,
            remoteUrl: item.remoteUrl,
            referer: item.referer,
          })),
          style: captionStyle,
          customPrompt: customCaptionFocus.trim(),
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(errPayload.error || `HTTP ${resp.status}`);
      }

      await consumeNdjsonStream(resp, (ev) => {
        if (ev.type === 'status' && typeof ev.message === 'string') {
          setCaptionProgress((prev) => ({ ...prev, label: ev.message }));
        } else if (ev.type === 'progress') {
          setCaptionProgress({
            done: Math.max(0, (ev.current || 1) - 1),
            total: ev.total || selectedCaptionItems.length,
            label: `Captioning ${ev.filename || ''} (${ev.current}/${ev.total})...`,
          });
        } else if (ev.type === 'item' && ev.result) {
          setCaptionResults((prev) => [...prev, ev.result as CaptionedImageResult]);
          setCaptionProgress((prev) => ({
            ...prev,
            done: prev.done + 1,
          }));
        } else if (ev.type === 'done') {
          onNotify?.(
            `Auto-captioned ${(ev.results || []).filter((r: any) => !r.error).length} image(s) with Gemma 4.`
          );
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Auto-captioning failed');
        }
      });

      refreshRuntimeStatus();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setCaptionError(err?.message || 'Batch auto-captioning failed.');
      }
    } finally {
      captionAbortRef.current = null;
      setIsCaptioning(false);
    }
  };

  const handleRunDirectoryCaptions = async () => {
    const cleanDir = dirPathInput.trim();
    if (!cleanDir || isCaptioning) return;
    setIsCaptioning(true);
    setCaptionError(null);
    setCaptionResults([]);
    setScannedDirRoot('');
    setCaptionProgress({ done: 0, total: 0, label: `Scanning ${cleanDir}...` });

    const controller = new AbortController();
    captionAbortRef.current = controller;

    try {
      if (llmSettings.provider !== 'builtin') {
        const scanResp = await fetch('/api/crop-resize/scan-dir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            directoryPath: cleanDir,
            recursive: dirRecursive,
          }),
          signal: controller.signal,
        });
        const scanData = await scanResp.json().catch(() => ({}));
        if (!scanResp.ok) {
          throw new Error(scanData.error || `HTTP ${scanResp.status} scanning directory`);
        }

        const resolvedRoot = scanData.resolvedRoot || cleanDir;
        const scannedImages: Array<{ relativePath: string; filename: string }> = Array.isArray(
          scanData.images
        )
          ? scanData.images.slice(0, 120)
          : [];
        if (scannedImages.length === 0) {
          throw new Error(`No supported images found inside ${resolvedRoot}.`);
        }

        setScannedDirRoot(resolvedRoot);
        const urlMap: Record<string, string> = {};
        scannedImages.forEach((img, idx) => {
          urlMap[`disk_${idx + 1}`] =
            `/api/crop-resize/local-preview?root=${encodeURIComponent(resolvedRoot)}&file=${encodeURIComponent(img.relativePath)}`;
        });
        setPreviewUrlById(urlMap);

        const completedResults: CaptionedImageResult[] = [];
        for (let i = 0; i < scannedImages.length; i++) {
          if (controller.signal.aborted) break;
          const img = scannedImages[i];
          const id = `disk_${i + 1}`;
          setCaptionProgress({
            done: i,
            total: scannedImages.length,
            label: `Captioning ${img.relativePath} (${i + 1}/${scannedImages.length})...`,
          });

          const dataUrl = await ensureImageDataUrlInBrowser(urlMap[id], 512);
          const captioned = await captionSingleImageWithCustomLlm(llmSettings, {
            id,
            filename: img.filename,
            relativePath: img.relativePath,
            dataUrl,
            style: captionStyle,
            customPrompt: customCaptionFocus.trim() || undefined,
            signal: controller.signal,
          });
          completedResults.push(captioned);
          setCaptionResults([...completedResults]);
          setCaptionProgress({
            done: i + 1,
            total: scannedImages.length,
            label: `Captioned ${i + 1}/${scannedImages.length}`,
          });
        }

        const okCount = completedResults.filter((r) => !r.error).length;
        onNotify?.(
          `Captioned ${okCount} directory images via ${getActiveEngineDisplayName(llmSettings)}.`
        );
        return;
      }

      const resp = await fetch('/api/ai/gemma/disk-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceDir: cleanDir,
          recursive: dirRecursive,
          limit: 120,
          style: captionStyle,
          customPrompt: customCaptionFocus.trim(),
          writeSidecars,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errPayload = await resp.json().catch(() => ({}));
        throw new Error(errPayload.error || `HTTP ${resp.status}`);
      }

      let currentRoot = cleanDir;

      await consumeNdjsonStream(resp, (ev) => {
        if (ev.type === 'scanned') {
          currentRoot = ev.resolvedSourceDir || cleanDir;
          setScannedDirRoot(currentRoot);
          const urlMap: Record<string, string> = {};
          for (const item of ev.images || []) {
            urlMap[item.id] =
              `/api/crop-resize/local-preview?root=${encodeURIComponent(currentRoot)}&file=${encodeURIComponent(item.relativePath)}`;
          }
          setPreviewUrlById(urlMap);
          setCaptionProgress({
            done: 0,
            total: ev.total || 0,
            label: `Found ${ev.total} image(s) in ${currentRoot}. Warming Gemma 4...`,
          });
        } else if (ev.type === 'status' && typeof ev.message === 'string') {
          setCaptionProgress((prev) => ({ ...prev, label: ev.message }));
        } else if (ev.type === 'progress') {
          setCaptionProgress((prev) => ({
            ...prev,
            total: ev.total || prev.total,
            label: `Captioning ${ev.filename || ''} (${ev.current}/${ev.total})...`,
          }));
        } else if (ev.type === 'item' && ev.result) {
          setCaptionResults((prev) => [...prev, ev.result as CaptionedImageResult]);
          setCaptionProgress((prev) => ({
            ...prev,
            done: prev.done + 1,
          }));
        } else if (ev.type === 'done') {
          const okCount = (ev.results || []).filter((r: any) => !r.error).length;
          const sidecarNote =
            ev.sidecarsWritten > 0 ? ` · Wrote ${ev.sidecarsWritten} .txt sidecars` : '';
          onNotify?.(`Captioned ${okCount} directory images${sidecarNote}.`);
        } else if (ev.type === 'error') {
          throw new Error(ev.error || 'Directory captioning failed');
        }
      });

      refreshRuntimeStatus();
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setCaptionError(err?.message || 'Directory auto-captioning failed.');
      }
    } finally {
      captionAbortRef.current = null;
      setIsCaptioning(false);
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleUpdateResultText = (
    id: string,
    field: 'caption' | 'detailedDescription',
    value: string
  ) => {
    setCaptionResults((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleExportZip = async () => {
    if (captionResults.length === 0 || isExportingZip) return;
    setIsExportingZip(true);
    try {
      const resp = await fetch('/api/ai/gemma/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: captionResults,
          style: captionStyle,
          sourceLabel:
            captionSourceMode === 'directory'
              ? scannedDirRoot || dirPathInput
              : `${selectedCaptionItems.length} selected images`,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to package captions ZIP.');
      }
      const blob = await resp.blob();
      triggerBlobDownload(blob, `gemma4_captions_${Date.now()}.zip`);
      onNotify?.('Downloaded captions ZIP (JSON + CSV + Markdown + sidecar .txt files).');
    } catch (err: any) {
      setCaptionError(err?.message || 'ZIP export failed.');
    } finally {
      setIsExportingZip(false);
    }
  };

  const successfulCaptionCount = useMemo(
    () => captionResults.filter((r) => !r.error).length,
    [captionResults]
  );

  const isCustomProvider = llmSettings.provider !== 'builtin';
  const activeEngineLabel = getActiveEngineDisplayName(llmSettings);

  const statusTone = isCustomProvider
    ? 'bg-emerald-500'
    : runtimeStatus?.status === 'ready'
      ? 'bg-emerald-500'
      : runtimeStatus?.status === 'starting' || isWarming
        ? 'bg-amber-500 animate-pulse'
        : runtimeStatus?.status === 'missing_assets'
          ? 'bg-rose-500'
          : 'bg-zinc-400';

  const statusText = isCustomProvider
    ? `${llmSettings.baseUrl}`
    : runtimeStatus?.status === 'ready'
      ? 'Ready (Loaded in Memory)'
      : runtimeStatus?.status === 'starting' || isWarming
        ? 'Loading Gemma 4 Model...'
        : runtimeStatus?.status === 'missing_assets'
          ? 'Model Weights Missing'
          : 'Standby (Auto-starts on first prompt)';

  return (
    <div className="space-y-6">
      {/* Top Studio Header & Sub-Mode Switcher */}
      <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 sm:p-6 transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className={`inline-block w-2 h-2 rounded-full ${statusTone}`} />
              <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">
                {isCustomProvider
                  ? activeEngineLabel
                  : runtimeStatus?.modelName || 'Gemma 4 E2B (Open-Source Local)'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="truncate max-w-xs">{statusText}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-display font-bold text-zinc-950 dark:text-zinc-50 tracking-tight">
              AI Multimodal Chat &amp; Auto-Captioner
            </h1>
            <p className="text-xs sm:text-sm text-zinc-600 dark:text-zinc-400 max-w-3xl">
              Chat with built-in Gemma 4 or connect your own Ollama / OpenAI-compatible LLM URL for private offline multi-image vision, batch captioning, CSV/JSON/Markdown exports, and .txt sidecars.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div
              role="tablist"
              aria-label="Gemma 4 Studio Mode"
              className="inline-flex p-1 bg-zinc-100 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={subMode === 'chat'}
                onClick={() => setSubMode('chat')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  subMode === 'chat'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Multi-Image Chat</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={subMode === 'caption'}
                onClick={() => setSubMode('caption')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  subMode === 'caption'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-950 dark:text-white shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Batch Auto-Captioner</span>
              </button>
            </div>

            {!isCustomProvider && runtimeStatus?.status !== 'ready' && (
              <button
                type="button"
                onClick={handleWarmModel}
                disabled={isWarming}
                className="flex items-center gap-1.5 px-3 py-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isWarming ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                ) : (
                  <Cpu className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                )}
                <span>{isWarming ? 'Warming Model...' : 'Warm Model'}</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* LLM Backend / Ollama Local Offline Provider Switcher */}
      <LlmProviderPanel
        settings={llmSettings}
        onChange={handleUpdateLlmSettings}
        onNotify={onNotify}
      />

      {/* ==================== MODE 1: MULTI-IMAGE CHAT ==================== */}
      {subMode === 'chat' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Chat Conversation Column */}
          <div className="lg:col-span-8 bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Conversation Thread</span>
                <span className="font-mono tabular-nums text-zinc-400">
                  ({chatMessages.length} messages)
                </span>
              </div>
              {chatMessages.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (isChatStreaming) chatAbortRef.current?.abort();
                    setChatMessages([]);
                    setStreamingAssistantText('');
                    setChatError(null);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800/70 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Chat</span>
                </button>
              )}
            </div>

            {/* Scrollable Messages Viewport */}
            <div
              ref={chatScrollRef}
              className="h-[440px] sm:h-[480px] overflow-y-auto p-4 sm:p-5 space-y-4 bg-zinc-50/50 dark:bg-[#0B0C10]/60"
            >
              {chatMessages.length === 0 && !isChatStreaming ? (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto px-4 space-y-3">
                  <div className="w-11 h-11 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="text-base font-display font-bold text-zinc-950 dark:text-white">
                    Ask {isCustomProvider ? activeEngineLabel : 'Gemma 4'} about one or multiple images
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    Attach up to 6 images in a single turn to compare subjects, describe outfits, extract visible text, or ask follow-up questions — running on {activeEngineLabel}.
                  </p>
                  <button
                    type="button"
                    onClick={handleAttachSamplePairToChat}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>Attach 2 Sample Portraits &amp; Draft Prompt</span>
                  </button>
                </div>
              ) : (
                <>
                  {chatMessages.map((msg, idx) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[90%] sm:max-w-[82%] rounded-xl px-4 py-3 text-xs sm:text-sm leading-relaxed border ${
                            isUser
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-[#141720] text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-800'
                          }`}
                        >
                          {msg.images && msg.images.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-2.5">
                              {msg.images.map((att) => (
                                <div
                                  key={att.id}
                                  className="relative w-20 h-20 rounded-lg overflow-hidden border border-white/25 bg-black/20 shrink-0"
                                >
                                  <img
                                    src={att.dataUrl}
                                    alt={att.filename}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          <FormattedChatText text={msg.text} />
                        </div>
                      </div>
                    );
                  })}

                  {isChatStreaming && (
                    <div className="flex flex-col items-start">
                      <div className="max-w-[90%] sm:max-w-[82%] rounded-xl px-4 py-3 text-xs sm:text-sm leading-relaxed border bg-white dark:bg-[#141720] text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-800">
                        {streamingAssistantText ? (
                          <FormattedChatText text={streamingAssistantText} streaming />
                        ) : (
                          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                            <span>{chatStatusText || 'Thinking...'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {chatError && (
              <div className="mx-4 mt-3 px-3.5 py-2.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span className="flex-1">{chatError}</span>
              </div>
            )}

            {/* Composer & Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsChatDragging(true);
              }}
              onDragLeave={() => setIsChatDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsChatDragging(false);
                if (e.dataTransfer.files?.length) {
                  addChatFiles(e.dataTransfer.files);
                }
              }}
              className={`p-3.5 sm:p-4 border-t transition-colors ${
                isChatDragging
                  ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                  : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#111318]'
              }`}
            >
              {chatAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {chatAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="relative group w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900"
                    >
                      <img
                        src={att.dataUrl}
                        alt={att.filename}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setChatAttachments((prev) => prev.filter((p) => p.id !== att.id))
                        }
                        aria-label={`Remove ${att.filename}`}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-zinc-950/80 text-white flex items-center justify-center hover:bg-rose-600 transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  ref={chatFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addChatFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => chatFileInputRef.current?.click()}
                    disabled={chatAttachments.length >= 6 || isChatStreaming}
                    className="flex items-center gap-1.5 px-3 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 text-zinc-700 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors disabled:opacity-45 cursor-pointer whitespace-nowrap"
                    title="Attach up to 6 images to this message"
                  >
                    <ImagePlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>Add Images ({chatAttachments.length}/6)</span>
                  </button>
                </div>

                <input
                  type="text"
                  aria-label="Message AI vision model"
                  placeholder={`Ask ${isCustomProvider ? llmSettings.model || 'your LLM' : 'Gemma 4'} to describe, compare, or analyze attached images...`}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  disabled={isChatStreaming}
                  className="flex-1 min-w-0 px-3.5 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-950 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />

                {isChatStreaming ? (
                  <button
                    type="button"
                    onClick={() => chatAbortRef.current?.abort()}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendChat()}
                    disabled={!chatInput.trim() && chatAttachments.length === 0}
                    className="flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Prompt Presets & Multi-Image Shortcuts */}
          <aside className="lg:col-span-4 space-y-4">
            <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5 space-y-3.5">
              <h3 className="text-sm font-display font-bold text-zinc-950 dark:text-white">
                Quick Multi-Image Prompts
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Attach 1–6 images, then click any prompt template to send or customize:
              </p>
              <div className="space-y-2">
                {[
                  {
                    title: 'Describe Each Image',
                    prompt:
                      'Describe every attached image clearly with subjects, setting, colors, and mood.',
                  },
                  {
                    title: 'Compare Differences',
                    prompt:
                      'Compare all attached images side by side. What stays consistent and what differs?',
                  },
                  {
                    title: 'Extract Visible Text & Objects',
                    prompt:
                      'List all readable text, signage, logos, clothing items, and prominent objects in these images.',
                  },
                  {
                    title: 'Write Dataset Captions',
                    prompt:
                      'Provide a concise 1-sentence training caption for each attached image numbered 1..N.',
                  },
                ].map((preset) => (
                  <button
                    key={preset.title}
                    type="button"
                    onClick={() => {
                      setChatInput(preset.prompt);
                      if (chatAttachments.length > 0 && !isChatStreaming) {
                        handleSendChat(preset.prompt);
                      }
                    }}
                    className="w-full text-left p-3 rounded-lg bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {preset.title}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 line-clamp-2">
                      {preset.prompt}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5 space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Need Bulk Folder Captioning?
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Switch to <strong>Batch Auto-Captioner</strong> to process an entire directory or multi-file batch and export CSV, JSON, Markdown, or .txt sidecar caption files.
              </p>
              <button
                type="button"
                onClick={() => setSubMode('caption')}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Open Batch Auto-Captioner</span>
              </button>
            </div>
          </aside>
        </section>
      )}

      {/* ==================== MODE 2: BATCH AUTO-CAPTIONER ==================== */}
      {subMode === 'caption' && (
        <div className="space-y-5">
          <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 sm:p-6 space-y-5">
            {/* Source Tabs: Select Files vs Server Directory */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setCaptionSourceMode('select')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    captionSourceMode === 'select'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-blue-500'
                  }`}
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>Select Multiple Images</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCaptionSourceMode('directory')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    captionSourceMode === 'directory'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-blue-500'
                  }`}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Directory Path (Server Disk)</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleLoadSampleBatchForCaption}
                disabled={isCaptioning}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer self-start sm:self-auto"
              >
                <Wand2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Load 6 Sample Portraits</span>
              </button>
            </div>

            {/* Source Input Panel */}
            {captionSourceMode === 'select' ? (
              <div className="space-y-4">
                <input
                  ref={captionFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addCaptionFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsCaptionDragging(true);
                  }}
                  onDragLeave={() => setIsCaptionDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsCaptionDragging(false);
                    if (e.dataTransfer.files?.length) addCaptionFiles(e.dataTransfer.files);
                  }}
                  onClick={() => captionFileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      captionFileInputRef.current?.click();
                    }
                  }}
                  className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer ${
                    isCaptionDragging
                      ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/20'
                      : 'border-zinc-300 dark:border-zinc-700 hover:border-blue-500 bg-zinc-50/60 dark:bg-[#0B0C10]'
                  }`}
                >
                  <ImagePlus className="w-7 h-7 mx-auto text-blue-600 dark:text-blue-400 mb-2" />
                  <p className="text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Click to select multiple images or drag &amp; drop them here
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    Supports JPG, PNG, WebP, AVIF · Up to 120 images per batch
                  </p>
                </div>

                {selectedCaptionItems.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200 font-mono tabular-nums">
                        {selectedCaptionItems.length} image(s) queued
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCaptionItems([]);
                          setCaptionResults([]);
                        }}
                        className="text-rose-600 dark:text-rose-400 hover:underline font-medium cursor-pointer"
                      >
                        Clear Queue
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedCaptionItems.slice(0, 18).map((item) => (
                        <div
                          key={item.id}
                          className="relative w-14 h-14 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
                          title={item.filename}
                        >
                          <img
                            src={item.previewUrl}
                            alt={item.filename}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ))}
                      {selectedCaptionItems.length > 18 && (
                        <div className="w-14 h-14 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-xs font-mono font-semibold text-zinc-600 dark:text-zinc-300">
                          +{selectedCaptionItems.length - 18}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <FolderInput className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      aria-label="Directory path on server disk"
                      placeholder="e.g. ./public/samples/humans or /path/to/photos"
                      value={dirPathInput}
                      onChange={(e) => setDirPathInput(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm font-mono text-zinc-950 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDirPathInput('./public/samples/humans')}
                    className="px-3.5 py-2.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Fill sample folder
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-600 dark:text-zinc-400">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dirRecursive}
                      onChange={(e) => setDirRecursive(e.target.checked)}
                      className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>Scan nested subfolders recursively</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={writeSidecars}
                      onChange={(e) => setWriteSidecars(e.target.checked)}
                      className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>Write .txt sidecar caption files next to images on disk</span>
                  </label>
                </div>
              </div>
            )}

            {/* Caption Style + Custom Focus + Run Action */}
            <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3.5 items-end">
              <div className="md:col-span-1 lg:col-span-4 space-y-1.5">
                <label
                  htmlFor="gemma-caption-style"
                  className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                >
                  Caption Output Format
                </label>
                <select
                  id="gemma-caption-style"
                  value={captionStyle}
                  onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)}
                  disabled={isCaptioning}
                  className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-950 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {CAPTION_STYLES.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 lg:col-span-5 space-y-1.5">
                <label
                  htmlFor="gemma-caption-focus"
                  className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
                >
                  Optional Focus Instruction
                </label>
                <input
                  id="gemma-caption-focus"
                  type="text"
                  placeholder="e.g. Mention outfit colors, facial expression, and lighting"
                  value={customCaptionFocus}
                  onChange={(e) => setCustomCaptionFocus(e.target.value)}
                  disabled={isCaptioning}
                  className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs sm:text-sm text-zinc-950 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="md:col-span-2 lg:col-span-3 flex items-center gap-2">
                {isCaptioning ? (
                  <button
                    type="button"
                    onClick={() => captionAbortRef.current?.abort()}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Stop Batch</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={
                      captionSourceMode === 'directory'
                        ? handleRunDirectoryCaptions
                        : handleRunSelectedCaptions
                    }
                    disabled={
                      captionSourceMode === 'directory'
                        ? !dirPathInput.trim()
                        : selectedCaptionItems.length === 0
                    }
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white rounded-lg text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>
                      {captionSourceMode === 'directory'
                        ? 'Scan & Auto-Caption'
                        : `Auto-Caption (${selectedCaptionItems.length})`}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {captionError && (
              <div className="px-3.5 py-2.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs sm:text-sm rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{captionError}</span>
              </div>
            )}

            {isCaptioning && (
              <div className="p-3.5 rounded-lg bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    <span>{captionProgress.label || 'Captioning...'}</span>
                  </span>
                  <span className="font-mono tabular-nums text-zinc-500">
                    {captionProgress.done}/{captionProgress.total || '?'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{
                      width: `${
                        captionProgress.total > 0
                          ? Math.min(
                              100,
                              Math.round((captionProgress.done / captionProgress.total) * 100)
                            )
                          : 15
                      }%`,
                    }}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Caption Results & Export Bar */}
          {captionResults.length > 0 && (
            <section className="bg-white dark:bg-[#111318] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
                <div>
                  <h2 className="text-base font-display font-bold text-zinc-950 dark:text-white">
                    Generated Image Descriptions
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5">
                    {successfulCaptionCount} of {captionResults.length} images captioned · Edit any text below before exporting
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      triggerTextDownload(
                        buildCaptionsJson(captionResults, {
                          model: activeEngineLabel,
                          sourceLabel:
                            captionSourceMode === 'directory'
                              ? scannedDirRoot || dirPathInput
                              : 'Selected Images',
                          style: captionStyle,
                        }),
                        `gemma4_captions_${Date.now()}.json`,
                        'application/json'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerTextDownload(
                        buildCaptionsCsv(captionResults),
                        `gemma4_captions_${Date.now()}.csv`,
                        'text/csv'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerTextDownload(
                        buildCaptionsMarkdown(captionResults, {
                          model: activeEngineLabel,
                          sourceLabel:
                            captionSourceMode === 'directory'
                              ? scannedDirRoot || dirPathInput
                              : 'Selected Images',
                        }),
                        `gemma4_captions_${Date.now()}.md`,
                        'text/markdown'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 rounded-lg text-xs font-medium cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Markdown</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportZip}
                    disabled={isExportingZip}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <FileArchive className="w-3.5 h-3.5" />
                    <span>{isExportingZip ? 'Packaging...' : 'Export All (.ZIP)'}</span>
                  </button>
                </div>
              </div>

              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {captionResults.map((item) => {
                  const thumb = previewUrlById[item.id];
                  return (
                    <div
                      key={item.id}
                      className="py-4 first:pt-1 last:pb-1 flex flex-col sm:flex-row gap-4 items-start"
                    >
                      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 shrink-0">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={item.filename}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400">
                            No preview
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 w-full space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs sm:text-sm font-semibold text-zinc-950 dark:text-white truncate font-mono">
                              {item.relativePath || item.filename}
                            </div>
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums mt-0.5">
                              {item.style} · {(item.durationMs / 1000).toFixed(1)}s
                              {item.setting ? ` · ${item.setting}` : ''}
                            </div>
                          </div>

                          {!item.error && (
                            <button
                              type="button"
                              onClick={() =>
                                handleCopyText(
                                  item.detailedDescription || item.caption,
                                  item.id
                                )
                              }
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 rounded-md transition-colors cursor-pointer shrink-0"
                            >
                              {copiedId === item.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {item.error ? (
                          <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                            Error: {item.error}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <input
                              type="text"
                              aria-label={`Caption for ${item.filename}`}
                              value={item.caption}
                              onChange={(e) =>
                                handleUpdateResultText(item.id, 'caption', e.target.value)
                              }
                              className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md text-xs sm:text-sm font-medium text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                            />
                            {item.detailedDescription &&
                              item.detailedDescription !== item.caption && (
                                <textarea
                                  rows={2}
                                  aria-label={`Detailed description for ${item.filename}`}
                                  value={item.detailedDescription}
                                  onChange={(e) =>
                                    handleUpdateResultText(
                                      item.id,
                                      'detailedDescription',
                                      e.target.value
                                    )
                                  }
                                  className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-[#0B0C10] border border-zinc-200 dark:border-zinc-800 rounded-md text-xs text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-blue-600"
                                />
                              )}
                            {(item.subjects.length > 0 || item.tags.length > 0) && (
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                                {item.subjects.length > 0 && (
                                  <span className="mr-3">
                                    <strong className="text-zinc-700 dark:text-zinc-300">
                                      Subjects:
                                    </strong>{' '}
                                    {item.subjects.join(', ')}
                                  </span>
                                )}
                                {item.tags.length > 0 && (
                                  <span>
                                    <strong className="text-zinc-700 dark:text-zinc-300">
                                      Tags:
                                    </strong>{' '}
                                    {item.tags.join(', ')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};
