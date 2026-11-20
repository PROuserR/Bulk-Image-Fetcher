import { NextRequest, NextResponse } from 'next/server';
import {
  clusterHumanProfilesOffline,
  mapClassifierError,
} from '@/server/humanClassifierService';
import { FolderNamingMode } from '@/utils/humanClassifierLogic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { profiles, folderNamingMode } = body || {};

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return NextResponse.json(
        { error: 'Biometric profiles array is required for identity clustering.' },
        { status: 400 }
      );
    }

    const mode: FolderNamingMode =
      folderNamingMode === 'descriptive' ? 'descriptive' : 'indexed';

    const result = await clusterHumanProfilesOffline(profiles, mode);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const mapped = mapClassifierError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
