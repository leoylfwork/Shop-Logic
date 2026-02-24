/**
 * AI service abstraction for CK-Flow.
 * - Calls same-origin Next.js API routes (/api/ai/diagnostic, /api/ai/decode-vin).
 * API keys stay on the server; never use API keys in the frontend.
 */

import type { DiagnosticContext } from '../geminiService';
export type { DiagnosticContext } from '../geminiService';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ? process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, '')
  : '';
const api = (path: string) => `${API_BASE}${path}`;

export async function getDiagnosticAdvice(context: DiagnosticContext): Promise<string> {
  const res = await fetch(api('/api/ai/diagnostic'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context),
  });
  if (!res.ok) {
    throw new Error(`AI diagnostic API failed with status ${res.status}`);
  }
  const data = await res.json();
  return data.text ?? data.result ?? String(data);
}

export async function decodeVIN(vin: string): Promise<{
  year?: string;
  make?: string;
  model?: string;
  engine?: string;
  trim?: string;
  transmission?: string;
  drivetrain?: string;
  bodyStyle?: string;
  plant?: string;
} | null> {
  const res = await fetch(api('/api/ai/decode-vin'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vin }),
  });
  if (!res.ok) {
    throw new Error(`VIN decode API failed with status ${res.status}`);
  }
  const data = await res.json();
  return data.decoded ?? data ?? null;
}
