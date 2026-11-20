export type FaceShapeCategory =
  | 'oval'
  | 'round'
  | 'square'
  | 'heart'
  | 'diamond'
  | 'oblong'
  | 'triangle'
  | 'obscured';

export type SomatotypeCategory =
  | 'ectomorph'
  | 'mesomorph'
  | 'endomorph'
  | 'athletic_balanced'
  | 'obscured';

export type VisibilityCategory =
  | 'full_body'
  | 'upper_body'
  | 'close_up_portrait'
  | 'occluded'
  | 'no_human';

export type FolderNamingMode = 'indexed' | 'descriptive';

export interface FacialStructureProfile {
  faceShape: FaceShapeCategory | string;
  jawline: string;
  cheekbones: string;
  foreheadHeight: string;
  browAndEyes: string;
  noseStructure: string;
  facialHairOrMarks: string;
}

export interface BodyProportionsProfile {
  somatotype: SomatotypeCategory | string;
  shoulderToHipRatio: string;
  statureAndLimbRatio: string;
  buildSummary: string;
}

export interface HumanImageBiometricProfile {
  imageId: string;
  filename: string;
  hasHuman: boolean;
  faceCount: number;
  visibility: VisibilityCategory | string;
  apparentPresentation: string;
  estimatedAgeRange: string;
  facialStructure: FacialStructureProfile;
  bodyProportions: BodyProportionsProfile;
  biometricSignature: string;
  batchLocalGroupHint?: string;
  confidence: number;
  faceEmbedding?: number[];
  faceGeometryVector?: number[];
  bodyVector?: number[];
}

export interface RawClusterAssignment {
  clusterLabel?: string;
  displayName?: string;
  summary?: string;
  dominantFaceShape?: string;
  dominantSomatotype?: string;
  matchRationale?: string;
  confidence?: number;
  imageIds: string[];
}

export interface IdentityCluster {
  clusterId: string;
  folderName: string;
  displayName: string;
  isNonHuman: boolean;
  summary: string;
  dominantFaceShape: string;
  dominantSomatotype: string;
  matchRationale: string;
  confidence: number;
  imageIds: string[];
}

export interface ClassificationManifestFolder {
  clusterId: string;
  folderName: string;
  displayName: string;
  isNonHuman: boolean;
  imageCount: number;
  dominantFaceShape: string;
  dominantSomatotype: string;
  summary: string;
  matchRationale: string;
  confidence: number;
  files: {
    imageId: string;
    originalFilename: string;
    archivedPath: string;
    facialStructure: FacialStructureProfile;
    bodyProportions: BodyProportionsProfile;
    confidence: number;
  }[];
}

export interface ClassificationManifest {
  generatedAt: string;
  totalImages: number;
  humanImagesCount: number;
  nonHumanImagesCount: number;
  uniqueHumansCount: number;
  folders: ClassificationManifestFolder[];
}

export function chunkItemsForAnalysis<T>(items: T[], batchSize = 5): T[][] {
  const safeSize = Math.max(1, Math.min(12, Math.floor(batchSize)));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

export function sanitizeFolderName(raw: string, fallback = 'person_01'): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return fallback;
  }
  return cleaned.slice(0, 64);
}

export function sanitizeImageFilename(raw: string, fallback = 'image.jpg'): string {
  const base = (raw || '').split(/[\\/]/).pop() || fallback;
  const cleaned = base
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\.\.+/g, '_');
  return cleaned || fallback;
}

export function resolveUniqueFilenames<T extends { filename: string }>(
  items: T[]
): Array<T & { safeFilename: string }> {
  const used = new Set<string>();
  return items.map((item, idx) => {
    const clean = sanitizeImageFilename(item.filename, `image_${idx + 1}.jpg`);
    const dotIdx = clean.lastIndexOf('.');
    const base = dotIdx > 0 ? clean.slice(0, dotIdx) : clean;
    const ext = dotIdx > 0 ? clean.slice(dotIdx) : '.jpg';

    let candidate = `${base}${ext}`;
    let counter = 1;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}_${counter}${ext}`;
      counter++;
    }
    used.add(candidate.toLowerCase());
    return { ...item, safeFilename: candidate };
  });
}

function pickMostFrequent(values: string[], fallback = 'obscured'): string {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const v = (raw || '').trim().toLowerCase();
    if (!v || v === 'obscured' || v === 'unknown' || v === 'n/a') continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = fallback;
  let bestCount = 0;
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function formatPersonSlug(index: number): string {
  return `person_${String(index).padStart(2, '0')}`;
}

function ensureUniqueFolderName(candidate: string, usedNames: Set<string>): string {
  let finalName = sanitizeFolderName(candidate, 'person_folder');
  let suffix = 2;
  while (usedNames.has(finalName.toLowerCase())) {
    finalName = `${sanitizeFolderName(candidate, 'person_folder')}_${suffix}`;
    suffix++;
  }
  usedNames.add(finalName.toLowerCase());
  return finalName;
}

export function normalizeClusterAssignments(
  profiles: HumanImageBiometricProfile[],
  rawClusters: RawClusterAssignment[],
  folderNamingMode: FolderNamingMode = 'indexed'
): IdentityCluster[] {
  const profileById = new Map<string, HumanImageBiometricProfile>();
  for (const p of profiles) {
    profileById.set(p.imageId, p);
  }

  const assignedHumanIds = new Set<string>();
  const nonHumanIds: string[] = [];

  for (const p of profiles) {
    if (!p.hasHuman) {
      nonHumanIds.push(p.imageId);
    }
  }

  interface DraftCluster {
    imageIds: string[];
    raw: RawClusterAssignment;
  }

  const drafts: DraftCluster[] = [];

  for (const raw of rawClusters) {
    if (!Array.isArray(raw?.imageIds)) continue;
    const validIds: string[] = [];
    for (const id of raw.imageIds) {
      const profile = profileById.get(id);
      if (!profile || !profile.hasHuman || assignedHumanIds.has(id)) {
        continue;
      }
      assignedHumanIds.add(id);
      validIds.push(id);
    }
    if (validIds.length > 0) {
      drafts.push({ imageIds: validIds, raw });
    }
  }

  // Fallback for any human image omitted by the clustering model: group by identical biometric hint or create singleton
  for (const p of profiles) {
    if (!p.hasHuman || assignedHumanIds.has(p.imageId)) continue;
    assignedHumanIds.add(p.imageId);
    drafts.push({
      imageIds: [p.imageId],
      raw: {
        displayName: '',
        summary: p.biometricSignature,
        dominantFaceShape: p.facialStructure.faceShape,
        dominantSomatotype: p.bodyProportions.somatotype,
        matchRationale: 'Assigned as distinct individual based on facial and body landmarks.',
        confidence: p.confidence,
        imageIds: [p.imageId],
      },
    });
  }

  // Sort human clusters deterministically: multi-photo matches first (by size desc), then original appearance order
  const originalIndex = new Map<string, number>();
  profiles.forEach((p, idx) => originalIndex.set(p.imageId, idx));

  drafts.sort((a, b) => {
    if (b.imageIds.length !== a.imageIds.length) {
      return b.imageIds.length - a.imageIds.length;
    }
    const aFirst = originalIndex.get(a.imageIds[0]) ?? 0;
    const bFirst = originalIndex.get(b.imageIds[0]) ?? 0;
    return aFirst - bFirst;
  });

  const usedFolderNames = new Set<string>();
  const clusters: IdentityCluster[] = [];

  drafts.forEach((draft, idx) => {
    const seq = idx + 1;
    const clusterId = formatPersonSlug(seq);
    const memberProfiles = draft.imageIds
      .map((id) => profileById.get(id))
      .filter((p): p is HumanImageBiometricProfile => Boolean(p));

    const dominantFaceShape =
      (draft.raw.dominantFaceShape && draft.raw.dominantFaceShape !== 'obscured'
        ? draft.raw.dominantFaceShape
        : '') ||
      pickMostFrequent(memberProfiles.map((m) => m.facialStructure.faceShape), 'balanced');

    const dominantSomatotype =
      (draft.raw.dominantSomatotype && draft.raw.dominantSomatotype !== 'obscured'
        ? draft.raw.dominantSomatotype
        : '') ||
      pickMostFrequent(memberProfiles.map((m) => m.bodyProportions.somatotype), 'balanced');

    const avgConfidence =
      draft.raw.confidence !== undefined && Number.isFinite(draft.raw.confidence)
        ? Math.max(0, Math.min(1, draft.raw.confidence))
        : memberProfiles.reduce((acc, m) => acc + (m.confidence || 0.7), 0) /
          Math.max(1, memberProfiles.length);

    const descriptiveBase = `${clusterId}_${sanitizeFolderName(dominantFaceShape, 'face')}_${sanitizeFolderName(dominantSomatotype, 'frame')}`;
    const folderCandidate = folderNamingMode === 'descriptive' ? descriptiveBase : clusterId;
    const folderName = ensureUniqueFolderName(folderCandidate, usedFolderNames);

    const displayName =
      draft.raw.displayName && draft.raw.displayName.trim()
        ? draft.raw.displayName.trim()
        : `Person ${String(seq).padStart(2, '0')}`;

    const summary =
      draft.raw.summary?.trim() ||
      memberProfiles[0]?.biometricSignature ||
      `${dominantFaceShape} facial structure · ${dominantSomatotype} frame`;

    const matchRationale =
      draft.raw.matchRationale?.trim() ||
      (draft.imageIds.length > 1
        ? `Matched across ${draft.imageIds.length} images by consistent facial geometry and somatic proportions.`
        : 'Unique individual profile with distinct cranial and body structure.');

    clusters.push({
      clusterId,
      folderName,
      displayName,
      isNonHuman: false,
      summary,
      dominantFaceShape,
      dominantSomatotype,
      matchRationale,
      confidence: Number(avgConfidence.toFixed(2)),
      imageIds: draft.imageIds,
    });
  });

  if (nonHumanIds.length > 0) {
    const folderName = ensureUniqueFolderName('non_human_or_unidentified', usedFolderNames);
    clusters.push({
      clusterId: 'non_human',
      folderName,
      displayName: 'No Human Detected',
      isNonHuman: true,
      summary: 'Images where no identifiable human face or body structure was detected.',
      dominantFaceShape: 'none',
      dominantSomatotype: 'none',
      matchRationale: 'Filtered out from human identity folders.',
      confidence: 1,
      imageIds: nonHumanIds,
    });
  }

  return clusters;
}

export function renameClusterFolder(
  clusters: IdentityCluster[],
  clusterId: string,
  newName: string
): IdentityCluster[] {
  const existingOtherNames = new Set(
    clusters
      .filter((c) => c.clusterId !== clusterId)
      .map((c) => c.folderName.toLowerCase())
  );

  return clusters.map((c) => {
    if (c.clusterId !== clusterId) return c;
    const sanitized = sanitizeFolderName(newName, c.clusterId);
    let unique = sanitized;
    let suffix = 2;
    while (existingOtherNames.has(unique.toLowerCase())) {
      unique = `${sanitized}_${suffix}`;
      suffix++;
    }
    return {
      ...c,
      folderName: unique,
      displayName: newName.trim() || c.displayName,
    };
  });
}

export function mergeClusters(
  clusters: IdentityCluster[],
  sourceClusterId: string,
  targetClusterId: string
): IdentityCluster[] {
  if (sourceClusterId === targetClusterId) return clusters;
  const source = clusters.find((c) => c.clusterId === sourceClusterId);
  const target = clusters.find((c) => c.clusterId === targetClusterId);
  if (!source || !target) return clusters;

  const mergedIds = Array.from(new Set([...target.imageIds, ...source.imageIds]));
  return clusters
    .filter((c) => c.clusterId !== sourceClusterId)
    .map((c) =>
      c.clusterId === targetClusterId
        ? {
            ...c,
            imageIds: mergedIds,
            matchRationale: `Merged ${source.displayName} into ${target.displayName} (${mergedIds.length} images).`,
          }
        : c
    );
}

export function moveImageBetweenClusters(
  clusters: IdentityCluster[],
  imageId: string,
  targetClusterId: string,
  profile?: HumanImageBiometricProfile
): IdentityCluster[] {
  let nextClusters = clusters
    .map((c) => ({
      ...c,
      imageIds: c.imageIds.filter((id) => id !== imageId),
    }))
    .filter((c) => c.imageIds.length > 0 || c.clusterId === targetClusterId);

  if (targetClusterId === '__new__') {
    const usedNames = new Set(nextClusters.map((c) => c.folderName.toLowerCase()));
    let idx = nextClusters.filter((c) => !c.isNonHuman).length + 1;
    let newId = formatPersonSlug(idx);
    while (
      nextClusters.some((c) => c.clusterId === newId) ||
      usedNames.has(newId.toLowerCase())
    ) {
      idx++;
      newId = formatPersonSlug(idx);
    }
    nextClusters.push({
      clusterId: newId,
      folderName: newId,
      displayName: `Person ${String(idx).padStart(2, '0')}`,
      isNonHuman: false,
      summary:
        profile?.biometricSignature || 'Split into dedicated identity folder for manual curation.',
      dominantFaceShape: profile?.facialStructure.faceShape || 'obscured',
      dominantSomatotype: profile?.bodyProportions.somatotype || 'obscured',
      matchRationale: 'Manually separated into its own unique human folder.',
      confidence: profile?.confidence ?? 0.9,
      imageIds: [imageId],
    });
    return nextClusters;
  }

  return nextClusters.map((c) =>
    c.clusterId === targetClusterId
      ? { ...c, imageIds: Array.from(new Set([...c.imageIds, imageId])) }
      : c
  );
}

export function buildClassificationManifest(
  clusters: IdentityCluster[],
  profilesById: Map<string, HumanImageBiometricProfile>
): ClassificationManifest {
  let totalImages = 0;
  let humanImagesCount = 0;
  let nonHumanImagesCount = 0;
  let uniqueHumansCount = 0;

  const folders: ClassificationManifestFolder[] = clusters.map((cluster) => {
    const sourceItems = cluster.imageIds.map((id) => {
      const p = profilesById.get(id);
      return {
        imageId: id,
        filename: p?.filename || `${id}.jpg`,
        profile: p,
      };
    });

    const deduped = resolveUniqueFilenames(sourceItems);
    totalImages += deduped.length;
    if (cluster.isNonHuman) {
      nonHumanImagesCount += deduped.length;
    } else {
      humanImagesCount += deduped.length;
      uniqueHumansCount += 1;
    }

    return {
      clusterId: cluster.clusterId,
      folderName: cluster.folderName,
      displayName: cluster.displayName,
      isNonHuman: cluster.isNonHuman,
      imageCount: deduped.length,
      dominantFaceShape: cluster.dominantFaceShape,
      dominantSomatotype: cluster.dominantSomatotype,
      summary: cluster.summary,
      matchRationale: cluster.matchRationale,
      confidence: cluster.confidence,
      files: deduped.map((d) => ({
        imageId: d.imageId,
        originalFilename: d.filename,
        archivedPath: `${cluster.folderName}/${d.safeFilename}`,
        facialStructure: d.profile?.facialStructure || {
          faceShape: 'obscured',
          jawline: 'obscured',
          cheekbones: 'obscured',
          foreheadHeight: 'obscured',
          browAndEyes: 'obscured',
          noseStructure: 'obscured',
          facialHairOrMarks: 'none',
        },
        bodyProportions: d.profile?.bodyProportions || {
          somatotype: 'obscured',
          shoulderToHipRatio: 'obscured',
          statureAndLimbRatio: 'obscured',
          buildSummary: 'obscured',
        },
        confidence: d.profile?.confidence ?? cluster.confidence,
      })),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    totalImages,
    humanImagesCount,
    nonHumanImagesCount,
    uniqueHumansCount,
    folders,
  };
}
