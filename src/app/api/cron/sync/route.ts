import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { syncRepository } from '@/lib/github/sync';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    // Find all repositories with monitoring enabled that are not archived
    const monitoredRepos = await prisma.repository.findMany({
      where: {
        isArchived: false,
        settings: {
          monitoringEnabled: true,
        },
      },
    });

    console.log(`Cron sync started for ${monitoredRepos.length} repositories`);

    // Synchronize each repository in the background
    const syncPromises = monitoredRepos.map(repo => 
      syncRepository(repo.id).catch(err => {
        console.error(`Cron sync failed for repo ${repo.fullName}:`, err);
      })
    );

    await Promise.all(syncPromises);

    return NextResponse.json({ success: true, syncedCount: monitoredRepos.length });
  } catch (error) {
    console.error('Error during cron sync:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
