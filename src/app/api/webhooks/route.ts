import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { verifyWebhookSignature } from '@/lib/security/webhooks';
import { handleWebhookEvent } from '@/lib/webhooks/processor';

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-hub-signature-256') || '';
  const eventType = req.headers.get('x-github-event') || '';
  const deliveryId = req.headers.get('x-github-delivery') || '';

  // 1. Verify Signature
  const rawBody = await req.text();
  const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
  
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.error('Webhook signature verification failed');
    return new NextResponse('Invalid signature', { status: 401 });
  }

  // 2. Check Idempotency
  if (deliveryId) {
    const existingEvent = await prisma.activityEvent.findUnique({
      where: { githubEventId: deliveryId },
    });
    if (existingEvent) {
      return new NextResponse('Ok (duplicate skipped)', { status: 200 });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    return new NextResponse('Invalid JSON body', { status: 400 });
  }

  const result = await handleWebhookEvent(eventType, deliveryId, payload);
  
  if (result.success) {
    return new NextResponse('Ok', { status: 200 });
  } else if (result.reason === 'untracked_repository') {
    return new NextResponse('Ok (untracked repository)', { status: 200 });
  } else {
    return new NextResponse(result.reason || 'Processing failed', { status: 200 });
  }
}
