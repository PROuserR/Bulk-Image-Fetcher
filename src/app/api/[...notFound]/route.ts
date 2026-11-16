import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function notFoundJson() {
  return NextResponse.json({ error: 'API endpoint not found.' }, { status: 404 });
}

export const GET = notFoundJson;
export const POST = notFoundJson;
export const PUT = notFoundJson;
export const PATCH = notFoundJson;
export const DELETE = notFoundJson;
