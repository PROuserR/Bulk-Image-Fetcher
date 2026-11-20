import {
  DEFAULT_FACE_ANCHOR,
  FaceAnchor,
  FilterRecipe,
  SnapLensState,
  applyComicPopEffectToRgba,
  applyPixelAdjustmentsToRgba,
  applyRadialBulgeWarpToRgba,
  applyUnsharpSharpenToRgba,
  applyVhsEffectToRgba,
  clampNum,
  estimateSkinPortraitAnchor,
} from './imageFilterLogic';
import { OutputConfig, resolveOutputExtension } from './imageTransformLogic';

export function loadHtmlImageForFilter(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image for filter studio.'));
    img.src = src;
  });
}

/**
 * Estimates a face anchor using browser FaceDetector when available, falling back
 * smoothly to our offline YCbCr portrait centroid detector so AR lenses auto-snap
 * cleanly onto portraits in any browser.
 */
export async function detectFaceAnchorFromImage(img: HTMLImageElement): Promise<FaceAnchor> {
  const natW = Math.max(1, img.naturalWidth || img.width);
  const natH = Math.max(1, img.naturalHeight || img.height);

  // 1. Optional native FaceDetector (Chrome experimental/OS-enabled)
  const FaceDetectorCtor =
    typeof window !== 'undefined' ? (window as unknown as { FaceDetector?: unknown }).FaceDetector : undefined;
  if (typeof FaceDetectorCtor === 'function') {
    try {
      const detector = new (FaceDetectorCtor as new (opts?: {
        fastMode?: boolean;
        maxDetectedFaces?: number;
      }) => {
        detect: (input: HTMLImageElement) => Promise<
          { boundingBox: { x: number; y: number; width: number; height: number } }[]
        >;
      })({ fastMode: true, maxDetectedFaces: 3 });

      const faces = await detector.detect(img);
      if (faces && faces.length > 0) {
        // Pick largest detected face box
        const primary = [...faces].sort(
          (a, b) =>
            b.boundingBox.width * b.boundingBox.height -
            a.boundingBox.width * a.boundingBox.height
        )[0];
        const box = primary.boundingBox;
        return {
          centerX: clampNum((box.x + box.width * 0.5) / natW, 0.1, 0.9),
          centerY: clampNum((box.y + box.height * 0.48) / natH, 0.1, 0.85),
          widthRatio: clampNum(box.width / natW, 0.16, 0.78),
          tiltDeg: 0,
          source: 'auto',
        };
      }
    } catch {
      // Fall through cleanly to offline portrait estimator
    }
  }

  // 2. Offline downsampled YCbCr portrait centroid detection
  try {
    const sampleSize = 96;
    const scale = Math.min(sampleSize / natW, sampleSize / natH, 1);
    const sw = Math.max(16, Math.round(natW * scale));
    const sh = Math.max(16, Math.round(natH * scale));
    const offscreen = document.createElement('canvas');
    offscreen.width = sw;
    offscreen.height = sh;
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ...DEFAULT_FACE_ANCHOR };
    ctx.drawImage(img, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    return estimateSkinPortraitAnchor(data, sw, sh);
  } catch {
    return { ...DEFAULT_FACE_ANCHOR };
  }
}

/**
 * Renders original source image + full adjustment pipeline + Snapchat AR lens overlays
 * cleanly onto `targetCanvas`.
 */
export function renderFilteredToCanvas(
  sourceImg: HTMLImageElement,
  targetCanvas: HTMLCanvasElement,
  recipe: FilterRecipe,
  options?: { maxEdge?: number; fillBackdrop?: string }
): { width: number; height: number } {
  const natW = Math.max(1, sourceImg.naturalWidth || sourceImg.width);
  const natH = Math.max(1, sourceImg.naturalHeight || sourceImg.height);

  let outW = natW;
  let outH = natH;
  const maxEdge = options?.maxEdge;
  if (maxEdge && maxEdge > 0 && Math.max(natW, natH) > maxEdge) {
    const scale = maxEdge / Math.max(natW, natH);
    outW = Math.max(1, Math.round(natW * scale));
    outH = Math.max(1, Math.round(natH * scale));
  }

  targetCanvas.width = outW;
  targetCanvas.height = outH;

  const ctx = targetCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { width: outW, height: outH };
  }

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (options?.fillBackdrop) {
    ctx.fillStyle = options.fillBackdrop;
    ctx.fillRect(0, 0, outW, outH);
  } else {
    ctx.clearRect(0, 0, outW, outH);
  }

  const adj = recipe.adjustments;
  const scaleFactor = outW / natW;

  // Apply Gaussian blur smoothly via native GPU canvas filter pre-pass
  if (adj.blur > 0) {
    const scaledBlur = Math.max(0.4, adj.blur * Math.max(0.45, scaleFactor));
    ctx.filter = `blur(${scaledBlur.toFixed(2)}px)`;
  } else {
    ctx.filter = 'none';
  }

  ctx.drawImage(sourceImg, 0, 0, outW, outH);
  ctx.filter = 'none';
  ctx.restore();

  // Per-pixel color, tone, clarity & optical shader pipeline
  const needsPixelShader =
    adj.brightness !== 0 ||
    adj.contrast !== 0 ||
    adj.saturation !== 0 ||
    adj.exposure !== 0 ||
    adj.warmth !== 0 ||
    adj.tint !== 0 ||
    adj.grayscale !== 0 ||
    adj.sepia !== 0 ||
    adj.hueRotate !== 0 ||
    adj.invert !== 0 ||
    adj.grain > 0 ||
    adj.sharpen > 0 ||
    (recipe.lens.intensity > 0 &&
      (recipe.lens.lensId === 'big_head' ||
        recipe.lens.lensId === 'vhs_cam' ||
        recipe.lens.lensId === 'comic_pop'));

  if (needsPixelShader) {
    const imgData = ctx.getImageData(0, 0, outW, outH);
    const rgba = imgData.data;

    applyPixelAdjustmentsToRgba(rgba, outW, outH, adj);

    if (adj.sharpen > 0) {
      applyUnsharpSharpenToRgba(rgba, outW, outH, adj.sharpen);
    }

    if (recipe.lens.intensity > 0) {
      if (recipe.lens.lensId === 'big_head') {
        applyRadialBulgeWarpToRgba(
          rgba,
          outW,
          outH,
          recipe.lens.faceAnchor,
          recipe.lens.intensity
        );
      } else if (recipe.lens.lensId === 'vhs_cam') {
        applyVhsEffectToRgba(rgba, outW, outH, recipe.lens.intensity);
      } else if (recipe.lens.lensId === 'comic_pop') {
        applyComicPopEffectToRgba(rgba, outW, outH, recipe.lens.intensity);
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  // Radial vignette lighting falloff
  if (adj.vignette > 0) {
    const strength = clampNum(adj.vignette / 100, 0, 1) * 0.82;
    const cx = outW * 0.5;
    const cy = outH * 0.5;
    const innerR = Math.min(outW, outH) * 0.34;
    const outerR = Math.hypot(cx, cy) * 1.05;
    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, `rgba(0,0,0,${(strength * 0.25).toFixed(3)})`);
    grad.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, outW, outH);
    ctx.restore();
  }

  // Procedural Snapchat-inspired AR / HUD overlays
  if (recipe.lens.lensId !== 'none' && recipe.lens.intensity > 0) {
    drawSnapLensOverlay(ctx, outW, outH, recipe.lens);
  }

  return { width: outW, height: outH };
}

function drawSnapLensOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lens: SnapLensState
): void {
  const alpha = clampNum(lens.intensity / 100, 0, 1);
  if (alpha <= 0.01) return;

  const anchor = lens.faceAnchor;
  const cx = anchor.centerX * w;
  const cy = anchor.centerY * h;
  const fw = Math.max(40, anchor.widthRatio * w);
  const tiltRad = (anchor.tiltDeg * Math.PI) / 180;

  ctx.save();
  ctx.globalAlpha = alpha;

  switch (lens.lensId) {
    case 'puppy': {
      ctx.translate(cx, cy);
      ctx.rotate(tiltRad);

      // Left & Right floppy puppy ears
      for (const dir of [-1, 1]) {
        ctx.save();
        ctx.translate(dir * fw * 0.44, -fw * 0.46);
        ctx.rotate(dir * 0.32);

        const earGrad = ctx.createLinearGradient(0, -fw * 0.26, 0, fw * 0.32);
        earGrad.addColorStop(0, '#92400e');
        earGrad.addColorStop(1, '#d97706');
        ctx.fillStyle = earGrad;
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = Math.max(1.5, fw * 0.018);

        ctx.beginPath();
        ctx.ellipse(0, 0, fw * 0.22, fw * 0.34, dir * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Inner soft peach ear lobe
        ctx.fillStyle = '#fda4af';
        ctx.globalAlpha = alpha * 0.55;
        ctx.beginPath();
        ctx.ellipse(0, fw * 0.03, fw * 0.11, fw * 0.2, dir * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Warm puppy nose at center-lower bridge
      ctx.globalAlpha = alpha;
      const noseY = fw * 0.06;
      const noseGrad = ctx.createRadialGradient(
        -fw * 0.03,
        noseY - fw * 0.03,
        fw * 0.02,
        0,
        noseY,
        fw * 0.16
      );
      noseGrad.addColorStop(0, '#52525b');
      noseGrad.addColorStop(0.45, '#18181b');
      noseGrad.addColorStop(1, '#09090b');

      ctx.fillStyle = noseGrad;
      ctx.beginPath();
      ctx.moveTo(0, noseY + fw * 0.1);
      ctx.bezierCurveTo(
        -fw * 0.18,
        noseY + fw * 0.04,
        -fw * 0.16,
        noseY - fw * 0.1,
        0,
        noseY - fw * 0.08
      );
      ctx.bezierCurveTo(
        fw * 0.16,
        noseY - fw * 0.1,
        fw * 0.18,
        noseY + fw * 0.04,
        0,
        noseY + fw * 0.1
      );
      ctx.fill();

      // Glossy highlight dot on nose
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(-fw * 0.04, noseY - fw * 0.035, fw * 0.032, fw * 0.018, -0.35, 0, Math.PI * 2);
      ctx.fill();

      // Playful pink tongue peeking beneath mouth region
      const tongueY = fw * 0.34;
      const tongueGrad = ctx.createLinearGradient(0, tongueY - fw * 0.05, 0, tongueY + fw * 0.22);
      tongueGrad.addColorStop(0, '#fb7185');
      tongueGrad.addColorStop(1, '#f43f5e');
      ctx.fillStyle = tongueGrad;
      ctx.beginPath();
      ctx.roundRect(-fw * 0.1, tongueY, fw * 0.2, fw * 0.22, [
        fw * 0.04,
        fw * 0.04,
        fw * 0.1,
        fw * 0.1,
      ]);
      ctx.fill();
      ctx.strokeStyle = 'rgba(136,19,55,0.45)';
      ctx.lineWidth = Math.max(1.2, fw * 0.012);
      ctx.beginPath();
      ctx.moveTo(0, tongueY + fw * 0.03);
      ctx.lineTo(0, tongueY + fw * 0.17);
      ctx.stroke();
      break;
    }

    case 'flower_crown': {
      // Soft golden sunlit atmospheric glow
      ctx.save();
      const haloGrad = ctx.createRadialGradient(
        cx,
        cy - fw * 0.25,
        fw * 0.1,
        cx,
        cy - fw * 0.25,
        fw * 1.1
      );
      haloGrad.addColorStop(0, 'rgba(253, 224, 71, 0.22)');
      haloGrad.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = haloGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      ctx.translate(cx, cy);
      ctx.rotate(tiltRad);

      const crownColors = [
        ['#f472b6', '#fbcfe8', '#fef08a'],
        ['#fb7185', '#fecdd3', '#fde047'],
        ['#c084fc', '#e9d5ff', '#fef08a'],
        ['#ffffff', '#fce7f3', '#f59e0b'],
        ['#f43f5e', '#fda4af', '#fef08a'],
        ['#a78bfa', '#ddd6fe', '#fde047'],
        ['#f472b6', '#fbcfe8', '#fef08a'],
      ];

      // Curved botanical stem arc
      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = Math.max(2, fw * 0.025);
      ctx.beginPath();
      ctx.arc(0, -fw * 0.18, fw * 0.56, Math.PI * 1.16, Math.PI * 1.84);
      ctx.stroke();

      // Leaves + 7 layered blossoms along the crown arc
      const count = 7;
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const angle = Math.PI * (1.16 + t * 0.68);
        const fx = Math.cos(angle) * fw * 0.56;
        const fy = -fw * 0.18 + Math.sin(angle) * fw * 0.56;
        const radius = fw * (i === 3 ? 0.115 : i === 2 || i === 4 ? 0.1 : 0.085);
        const [outerC, innerC, centerC] = crownColors[i % crownColors.length];

        // Flanking sage leaves
        for (const leafSide of [-1, 1]) {
          ctx.save();
          ctx.translate(fx + leafSide * radius * 0.9, fy + radius * 0.25);
          ctx.rotate(angle + leafSide * 0.5);
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.ellipse(0, 0, radius * 0.65, radius * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // 5 petals
        for (let p = 0; p < 5; p++) {
          const pAngle = (p * Math.PI * 2) / 5 + i * 0.3;
          ctx.fillStyle = p % 2 === 0 ? outerC : innerC;
          ctx.beginPath();
          ctx.ellipse(
            fx + Math.cos(pAngle) * radius * 0.55,
            fy + Math.sin(pAngle) * radius * 0.55,
            radius * 0.52,
            radius * 0.36,
            pAngle,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
        // Flower stamen center
        ctx.fillStyle = centerC;
        ctx.beginPath();
        ctx.arc(fx, fy, radius * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'heart_blush': {
      ctx.translate(cx, cy);
      ctx.rotate(tiltRad);

      // Rosy soft radial cheek blush + floating heart decals
      for (const dir of [-1, 1]) {
        const bx = dir * fw * 0.28;
        const by = fw * 0.08;
        const blushGrad = ctx.createRadialGradient(bx, by, fw * 0.02, bx, by, fw * 0.19);
        blushGrad.addColorStop(0, 'rgba(244, 63, 94, 0.55)');
        blushGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');
        ctx.fillStyle = blushGrad;
        ctx.beginPath();
        ctx.arc(bx, by, fw * 0.19, 0, Math.PI * 2);
        ctx.fill();

        // Crisp cheek heart
        drawHeartShape(ctx, bx, by - fw * 0.01, fw * 0.11, '#fb7185', '#ffffff');
        // Smaller accent heart near temple
        drawHeartShape(
          ctx,
          dir * fw * 0.42,
          -fw * 0.24,
          fw * 0.085,
          '#f43f5e',
          'rgba(255,255,255,0.85)'
        );
      }

      // Sparkle stars above brow & temples
      const sparkles = [
        { x: -fw * 0.36, y: -fw * 0.44, r: fw * 0.065 },
        { x: 0, y: -fw * 0.58, r: fw * 0.08 },
        { x: fw * 0.38, y: -fw * 0.42, r: fw * 0.065 },
      ];
      for (const sp of sparkles) {
        drawFourPointSparkle(ctx, sp.x, sp.y, sp.r, '#fde047');
      }
      break;
    }

    case 'rainbow_mouth': {
      ctx.translate(cx, cy);
      ctx.rotate(tiltRad);

      // Sparkling star flares over left & right eyes
      drawFourPointSparkle(ctx, -fw * 0.2, -fw * 0.13, fw * 0.11, '#fef08a');
      drawFourPointSparkle(ctx, fw * 0.2, -fw * 0.13, fw * 0.11, '#fef08a');

      // Iconic cascading Snapchat prism rainbow from mouth downward
      const rainbowCols = [
        '#ef4444',
        '#f97316',
        '#facc15',
        '#22c55e',
        '#0ea5e9',
        '#6366f1',
        '#a855f7',
      ];
      const streamTop = fw * 0.22;
      const streamLen = Math.max(h * 0.48, fw * 0.85);
      const topHalfW = fw * 0.14;
      const bottomHalfW = fw * 0.3;

      ctx.save();
      ctx.globalAlpha = alpha * 0.84;
      for (let i = 0; i < rainbowCols.length; i++) {
        const t0 = i / rainbowCols.length;
        const t1 = (i + 1) / rainbowCols.length;
        ctx.fillStyle = rainbowCols[i];
        ctx.beginPath();
        ctx.moveTo(-topHalfW + topHalfW * 2 * t0, streamTop);
        ctx.lineTo(-topHalfW + topHalfW * 2 * t1, streamTop);
        ctx.lineTo(-bottomHalfW + bottomHalfW * 2 * t1, streamTop + streamLen);
        ctx.lineTo(-bottomHalfW + bottomHalfW * 2 * t0, streamTop + streamLen);
        ctx.closePath();
        ctx.fill();
      }

      // Soft puffy cloud curl at mouth origin
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      const cloudPuffs = [-0.1, -0.04, 0.04, 0.1];
      for (const px of cloudPuffs) {
        ctx.beginPath();
        ctx.arc(px * fw, streamTop + fw * 0.02, fw * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }

    case 'cool_shades': {
      ctx.translate(cx, cy - fw * 0.12);
      ctx.rotate(tiltRad);

      const bridgeW = fw * 0.09;
      const lensW = fw * 0.31;
      const lensH = fw * 0.19;
      const framePad = fw * 0.018;

      // Metallic gold bridge + temple arms
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = Math.max(2, fw * 0.022);
      ctx.beginPath();
      ctx.moveTo(-bridgeW * 0.55, -lensH * 0.25);
      ctx.quadraticCurveTo(0, -lensH * 0.45, bridgeW * 0.55, -lensH * 0.25);
      ctx.stroke();

      // Left & Right aviator-style dark polarized lenses with crisp sky reflections
      for (const dir of [-1, 1]) {
        const lx = dir * (bridgeW * 0.5 + lensW * 0.5);
        ctx.save();
        ctx.translate(lx, 0);

        // Outer metallic rim
        ctx.fillStyle = '#18181b';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = Math.max(1.5, fw * 0.016);
        ctx.beginPath();
        ctx.roundRect(
          -lensW * 0.5 - framePad,
          -lensH * 0.5 - framePad,
          lensW + framePad * 2,
          lensH + framePad * 2,
          [fw * 0.03, fw * 0.03, fw * 0.11, fw * 0.11]
        );
        ctx.fill();
        ctx.stroke();

        // Gradient tint glass
        const glassGrad = ctx.createLinearGradient(0, -lensH * 0.5, 0, lensH * 0.5);
        glassGrad.addColorStop(0, '#0f172a');
        glassGrad.addColorStop(0.55, '#1e293b');
        glassGrad.addColorStop(1, '#0284c7');
        ctx.fillStyle = glassGrad;
        ctx.beginPath();
        ctx.roundRect(-lensW * 0.5, -lensH * 0.5, lensW, lensH, [
          fw * 0.024,
          fw * 0.024,
          fw * 0.095,
          fw * 0.095,
        ]);
        ctx.fill();

        // Crisp diagonal specular reflection bars
        ctx.fillStyle = 'rgba(255,255,255,0.38)';
        ctx.beginPath();
        ctx.moveTo(-lensW * 0.34, -lensH * 0.42);
        ctx.lineTo(-lensW * 0.14, -lensH * 0.42);
        ctx.lineTo(-lensW * 0.38, lensH * 0.36);
        ctx.lineTo(-lensW * 0.46, lensH * 0.36);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.moveTo(-lensW * 0.06, -lensH * 0.42);
        ctx.lineTo(lensW * 0.04, -lensH * 0.42);
        ctx.lineTo(-lensW * 0.22, lensH * 0.36);
        ctx.lineTo(-lensW * 0.3, lensH * 0.36);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }
      break;
    }

    case 'butterfly_crown': {
      ctx.translate(cx, cy);
      ctx.rotate(tiltRad);

      const butterflies = [
        { x: -fw * 0.48, y: -fw * 0.38, scale: 0.78, rot: -0.35 },
        { x: -fw * 0.28, y: -fw * 0.56, scale: 0.92, rot: -0.18 },
        { x: 0, y: -fw * 0.64, scale: 1.08, rot: 0 },
        { x: fw * 0.28, y: -fw * 0.56, scale: 0.92, rot: 0.18 },
        { x: fw * 0.48, y: -fw * 0.38, scale: 0.78, rot: 0.35 },
      ];

      for (const bf of butterflies) {
        drawGoldButterfly(ctx, bf.x, bf.y, fw * 0.13 * bf.scale, bf.rot);
      }

      // Floating gold stardust motes
      const motes = [
        [-0.58, -0.15, 0.025],
        [-0.4, -0.74, 0.03],
        [0.42, -0.72, 0.028],
        [0.58, -0.18, 0.024],
        [-0.16, -0.82, 0.022],
        [0.18, -0.8, 0.022],
      ];
      ctx.fillStyle = '#fde047';
      for (const [mx, my, mr] of motes) {
        ctx.beginPath();
        ctx.arc(mx * fw, my * fw, mr * fw, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    case 'vhs_cam': {
      // Camcorder viewfinder HUD overlay (PLAY ▶ + ● REC + timestamp)
      const pad = Math.max(14, Math.min(w, h) * 0.045);
      const fontSize = Math.max(12, Math.round(Math.min(w, h) * 0.042));

      ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = 'top';

      // Top-left PLAY
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText('PLAY ▶', pad + 1.5, pad + 1.5);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText('PLAY ▶', pad, pad);

      // Top-right ● REC
      const recText = '● REC';
      const recW = ctx.measureText(recText).width;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(recText, w - pad - recW + 1.5, pad + 1.5);
      ctx.fillStyle = '#ef4444';
      ctx.fillText(recText, w - pad - recW, pad);

      // Bottom-left retro timestamp
      ctx.textBaseline = 'bottom';
      ctx.font = `600 ${Math.max(11, Math.round(fontSize * 0.88))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      const stamp = '1996-11-18  09:42 PM';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(stamp, pad + 1.5, h - pad + 1.5);
      ctx.fillStyle = '#fde68a';
      ctx.fillText(stamp, pad, h - pad);

      // Subtle camcorder framing corners
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.55)';
      ctx.lineWidth = Math.max(1.5, w * 0.003);
      const arm = pad * 0.7;
      // Bottom-right corner bracket
      ctx.beginPath();
      ctx.moveTo(w - pad - arm, h - pad);
      ctx.lineTo(w - pad, h - pad);
      ctx.lineTo(w - pad, h - pad - arm);
      ctx.stroke();
      break;
    }

    case 'big_head': {
      // Subtle radial comic action speedlines near outer perimeter
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.lineWidth = Math.max(1.2, Math.min(w, h) * 0.003);
      const center = { x: cx, y: cy };
      const rInner = Math.max(w, h) * 0.42;
      const rOuter = Math.max(w, h) * 0.75;
      for (let i = 0; i < 24; i++) {
        const ang = (i * Math.PI * 2) / 24;
        ctx.beginPath();
        ctx.moveTo(center.x + Math.cos(ang) * rInner, center.y + Math.sin(ang) * rInner);
        ctx.lineTo(center.x + Math.cos(ang) * rOuter, center.y + Math.sin(ang) * rOuter);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }

    case 'comic_pop': {
      // Crisp comic-book ink inner panel border
      const inset = Math.max(6, Math.round(Math.min(w, h) * 0.018));
      ctx.strokeStyle = '#09090b';
      ctx.lineWidth = Math.max(3, Math.round(Math.min(w, h) * 0.012));
      ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
      break;
    }

    default:
      break;
  }

  ctx.restore();
}

function drawHeartShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fill: string,
  stroke?: string
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, size * 0.35);
  ctx.bezierCurveTo(-size * 0.65, -size * 0.15, -size * 0.45, -size * 0.75, 0, -size * 0.32);
  ctx.bezierCurveTo(size * 0.45, -size * 0.75, size * 0.65, -size * 0.15, 0, size * 0.35);
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, size * 0.09);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFourPointSparkle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.quadraticCurveTo(0, 0, 0, r);
  ctx.quadraticCurveTo(0, 0, -r, 0);
  ctx.quadraticCurveTo(0, 0, 0, -r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGoldButterfly(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rot: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);

  const grad = ctx.createLinearGradient(-size, -size, size, size);
  grad.addColorStop(0, '#fef08a');
  grad.addColorStop(0.5, '#f59e0b');
  grad.addColorStop(1, '#b45309');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = Math.max(1, size * 0.06);

  for (const dir of [-1, 1]) {
    // Upper wing
    ctx.beginPath();
    ctx.ellipse(dir * size * 0.48, -size * 0.25, size * 0.48, size * 0.32, dir * -0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Lower wing
    ctx.beginPath();
    ctx.ellipse(dir * size * 0.36, size * 0.22, size * 0.34, size * 0.24, dir * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Thorax body
  ctx.fillStyle = '#451a03';
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.09, size * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export async function exportFilteredImageBlob(
  srcUrl: string,
  originalFilename: string,
  recipe: FilterRecipe,
  output: OutputConfig
): Promise<{ blob: Blob; width: number; height: number; mime: string }> {
  const img = await loadHtmlImageForFilter(srcUrl);
  const { mime } = resolveOutputExtension(originalFilename, output.format);
  const canvas = document.createElement('canvas');

  const dims = renderFilteredToCanvas(img, canvas, recipe, {
    fillBackdrop: mime === 'image/jpeg' ? '#FFFFFF' : undefined,
  });

  const quality = Math.max(0.4, Math.min(1, (output.quality || 90) / 100));
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error('Failed to encode filtered image.'));
      },
      mime,
      mime === 'image/png' ? undefined : quality
    );
  });

  return {
    blob,
    width: dims.width,
    height: dims.height,
    mime,
  };
}
