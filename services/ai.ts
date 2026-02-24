/**
 * AI service abstraction for CK-Flow.
 * - When VITE_API_BASE_URL is set, calls Vercel Serverless (/api/ai/diagnostic, /api/ai/decode-vin).
 * - Otherwise falls back to local geminiService (prototype only).
 * API keys stay on the server; never use API keys in the frontend.
 */

export type { DiagnosticContext } from '../geminiService';

import {
  getDiagnosticAdvice as geminiDiagnostic,
  decodeVIN as geminiDecodeVIN,
  type DiagnosticContext,
} from '../geminiService';

const API_BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL
  ? (import.meta.env.VITE_API_BASE_URL as string).replace(/\/$/, '')
  : '';

export async function getDiagnosticAdvice(context: DiagnosticContext): Promise<string> {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/api/ai/diagnostic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      return data.text ?? data.result ?? String(data);
    } catch (e) {
      console.warn('AI diagnostic API failed, falling back to local:', e);
    }
  }
  return geminiDiagnostic(context);
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
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/api/ai/decode-vin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      return data.decoded ?? data ?? null;
    } catch (e) {
      console.warn('VIN decode API failed, falling back to local:', e);
    }
  }
  return geminiDecodeVIN(vin);
}
