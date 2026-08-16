import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import prisma from '@/lib/db/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const searchParams = req.nextUrl.searchParams;
  const isDemo = searchParams.get('demo') === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  if (!session && !isDemo) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Get user
  let dbUser = null;
  if (isDemo) {
    dbUser = await prisma.user.findUnique({ where: { githubUserId: 999999 } });
  } else if (session?.user) {
    const githubUserId = parseInt((session.user as any).id || '', 10);
    dbUser = await prisma.user.findUnique({
      where: { githubUserId: isNaN(githubUserId) ? -1 : githubUserId },
    });
  }

  if (!dbUser) {
    return new NextResponse('User not found', { status: 404 });
  }

  try {
    const installations = await prisma.gitHubInstallation.findMany({
      where: { userId: dbUser.id },
    });

    const repos = await prisma.repository.findMany({
      where: { installationId: { in: installations.map(i => i.id) } },
      include: { settings: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      repositories: repos.map(r => ({
        id: r.id,
        name: r.name,
        fullName: r.fullName,
        isArchived: r.isArchived,
        monitoringEnabled: r.settings?.monitoringEnabled ?? true,
        staleThresholdDays: r.settings?.staleThresholdDays ?? 14,
        dailyBriefEnabled: r.settings?.dailyBriefEnabled ?? true,
        healthEnabled: r.settings?.healthEnabled ?? true,
      })),
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const searchParams = req.nextUrl.searchParams;
  const isDemo = searchParams.get('demo') === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  if (!session && !isDemo) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // In demo mode, we simulate the save and return success immediately to keep the seed data clean
  if (isDemo) {
    return NextResponse.json({ success: true, message: 'Settings simulated saved successfully' });
  }

  let dbUser = null;
  if (session?.user) {
    const githubUserId = parseInt((session.user as any).id || '', 10);
    dbUser = await prisma.user.findUnique({
      where: { githubUserId: isNaN(githubUserId) ? -1 : githubUserId },
    });
  }

  if (!dbUser) {
    return new NextResponse('User not found', { status: 404 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    // Handle delete all data
    if (action === 'delete_all_data') {
      await prisma.user.delete({
        where: { id: dbUser.id },
      });
      return NextResponse.json({ success: true, message: 'All account data deleted successfully' });
    }

    // Handle disconnect GitHub
    if (action === 'disconnect_github') {
      await prisma.gitHubInstallation.deleteMany({
        where: { userId: dbUser.id },
      });
      return NextResponse.json({ success: true, message: 'GitHub installations disconnected successfully' });
    }

    // Handle updating repository settings
    const { repositoryId, monitoringEnabled, staleThresholdDays, dailyBriefEnabled } = body;
    
    if (!repositoryId) {
      return new NextResponse('Missing repositoryId', { status: 400 });
    }

    // Verify ownership of repository
    const repo = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: { installation: true },
    });

    if (!repo || repo.installation.userId !== dbUser.id) {
      return new NextResponse('Unauthorized', { status: 403 });
    }

    await prisma.repositorySettings.upsert({
      where: { repositoryId },
      update: {
        monitoringEnabled,
        staleThresholdDays: parseInt(staleThresholdDays, 10) || 14,
        dailyBriefEnabled,
      },
      create: {
        repositoryId,
        monitoringEnabled,
        staleThresholdDays: parseInt(staleThresholdDays, 10) || 14,
        dailyBriefEnabled,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
