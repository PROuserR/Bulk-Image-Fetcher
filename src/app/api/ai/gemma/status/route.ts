import { NextResponse } from 'next/server';
import { getGemmaServerManager } from '@/server/gemmaServerManager';
import { GEMMA_MODEL_LABEL, mapGemmaError } from '@/server/gemmaChatService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await getGemmaServerManager().getStatus();
    return NextResponse.json({
      ...status,
      modelLabel: GEMMA_MODEL_LABEL,
    });
  } catch (err) {
    const mapped = mapGemmaError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function POST() {
  try {
    const manager = getGemmaServerManager();
    await manager.ensureReady();
    const status = await manager.getStatus();
    return NextResponse.json({
      ...status,
      modelLabel: GEMMA_MODEL_LABEL,
    });
  } catch (err) {
    const mapped = mapGemmaError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
