import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { isSimulatorAllowed } from '@/lib/simulator/guard';

export async function GET(req: NextRequest) {
  if (!isSimulatorAllowed()) {
    return new NextResponse('Webhook Inspector Forbidden in Production', { status: 403 });
  }

  try {
    const events = await prisma.activityEvent.findMany({
      include: {
        repository: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 40,
    });

    const mappedEvents = events.map(e => ({
      id: e.id,
      githubEventId: e.githubEventId,
      eventType: e.eventType,
      actorLogin: e.actorLogin,
      occurredAt: e.occurredAt,
      repoName: e.repository.name,
      repoFullName: e.repository.fullName,
      isSimulated: e.repository.isSimulated,
      payload: e.payloadReference,
    }));

    return NextResponse.json({
      success: true,
      events: mappedEvents,
    });
  } catch (error) {
    console.error('Webhook Inspector GET Error:', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
