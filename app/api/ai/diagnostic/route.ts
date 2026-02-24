import { NextResponse } from 'next/server';
import {
  getDiagnosticAdvice,
  type DiagnosticContext,
} from '../../../../geminiService';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const context = (await request.json()) as DiagnosticContext;
    const text = await getDiagnosticAdvice(context);

    const { searchParams } = new URL(request.url);
    const wantsStream =
      searchParams.get('stream') === '1' ||
      request.headers.get('accept')?.includes('text/event-stream');

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error('diagnostic route failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate diagnostic advice' },
      { status: 500 }
    );
  }
}
