import { NextResponse } from 'next/server';
import { decodeVIN } from '../../../../geminiService';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { vin?: string };
    const vin = body.vin?.trim();
    if (!vin) {
      return NextResponse.json({ error: 'vin is required' }, { status: 400 });
    }

    const decoded = await decodeVIN(vin);
    return NextResponse.json({ decoded });
  } catch (error) {
    console.error('decode-vin route failed:', error);
    return NextResponse.json({ error: 'Failed to decode VIN' }, { status: 500 });
  }
}
