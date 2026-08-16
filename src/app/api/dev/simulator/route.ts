import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { isSimulatorAllowed } from '@/lib/simulator/guard';
import { seedSimulatedData } from '@/lib/simulator/seed';
import { resetSimulationData } from '@/lib/simulator/reset';
import { runScenario } from '@/lib/simulator/scenario-runner';
import { EventFactory } from '@/lib/simulator/event-factory';
import { handleWebhookEvent } from '@/lib/webhooks/processor';
import { generateDailyBriefSummary } from '@/lib/ai/provider';
import { Clock } from '@/lib/utils/clock';

// GET: Return simulator status, test repos list, and recent events
export async function GET(req: NextRequest) {
  if (!isSimulatorAllowed()) {
    return new NextResponse('Simulator Forbidden in Production', { status: 403 });
  }

  try {
    // 1. Get simulated repos
    const repos = await prisma.repository.findMany({
      where: { isSimulated: true },
      include: {
        healthSnapshots: { orderBy: { calculatedAt: 'desc' }, take: 1 },
        attentionItems: { where: { status: 'OPEN' } },
        pullRequests: { where: { state: 'OPEN' } },
        issues: { where: { state: 'OPEN' } },
        workflowRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { name: 'asc' },
    });

    const mappedRepos = repos.map(r => ({
      id: r.id,
      name: r.name,
      fullName: r.fullName,
      health: r.healthSnapshots[0]?.score ?? 100,
      attentionCount: r.attentionItems.length,
      prsCount: r.pullRequests.length,
      issuesCount: r.issues.length,
      ciStatus: r.workflowRuns[0]?.conclusion === 'failure' ? 'Failing' : 'Passing',
      lastUpdatedAt: r.githubUpdatedAt,
    }));

    // 2. Get recent simulated events (the last 15 activity events on simulated repos)
    const recentEvents = await prisma.activityEvent.findMany({
      where: {
        repository: { isSimulated: true },
      },
      include: { repository: true },
      orderBy: { occurredAt: 'desc' },
      take: 15,
    });

    const mappedEvents = recentEvents.map(e => ({
      id: e.id,
      githubEventId: e.githubEventId,
      eventType: e.eventType,
      actorLogin: e.actorLogin,
      occurredAt: e.occurredAt,
      repoName: e.repository.name,
    }));

    return NextResponse.json({
      enabled: true,
      databaseConnected: true,
      repositories: mappedRepos,
      events: mappedEvents,
    });
  } catch (error) {
    console.error('Simulator GET Error:', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}

// POST: Execute simulator commands
export async function POST(req: NextRequest) {
  if (!isSimulatorAllowed()) {
    return new NextResponse('Simulator Forbidden in Production', { status: 403 });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'seed') {
      const repos = await seedSimulatedData();
      return NextResponse.json({ success: true, message: `Seeded ${repos.length} test repositories.` });
    }

    if (action === 'reset') {
      const result = await resetSimulationData();
      return NextResponse.json({ success: true, message: `Reset complete. Deleted ${result.deletedCount} items.` });
    }

    if (action === 'run_scenario') {
      const { scenarioName } = body;
      const result = await runScenario(scenarioName);
      return NextResponse.json({ success: true, result });
    }

    if (action === 'simulate_event') {
      const { repositoryId, eventType, actor, timestampOffset, metadata } = body;

      const repo = await prisma.repository.findUnique({
        where: { id: repositoryId },
      });

      if (!repo || !repo.isSimulated) {
        return new NextResponse('Simulated repository not found', { status: 404 });
      }

      // Configure simulated time offset
      const now = new Date();
      let eventTime = now;
      if (timestampOffset) {
        const offsetMin = parseInt(timestampOffset, 10);
        if (!isNaN(offsetMin)) {
          eventTime = new Date(now.getTime() - offsetMin * 60 * 1000);
        }
      }

      Clock.setSimulatedTime(eventTime);

      const meta = {
        githubRepositoryId: repo.githubRepositoryId,
        name: repo.name,
        fullName: repo.fullName,
        owner: repo.owner,
      };

      let payload: any;
      const deliveryId = `sim_custom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const type = eventType.toUpperCase();

      if (type === 'PUSH') {
        payload = EventFactory.push(meta, actor, [
          { sha: `sha_custom_${Date.now()}`, message: metadata?.message || 'commit: simulated push update', timestamp: eventTime }
        ]);
      } else if (type === 'PR_OPENED') {
        payload = EventFactory.pullRequest(meta, actor, 'opened', {
          id: 90000 + Math.floor(Math.random() * 1000),
          number: parseInt(metadata?.number || '1', 10),
          title: metadata?.title || 'feat: simulated pull request',
          createdAt: eventTime,
        });
      } else if (type === 'PR_CLOSED' || type === 'PR_MERGED') {
        payload = EventFactory.pullRequest(meta, actor, 'closed', {
          id: parseInt(metadata?.id || '90001', 10),
          number: parseInt(metadata?.number || '1', 10),
          title: metadata?.title || 'feat: simulated pull request',
          isMerged: type === 'PR_MERGED',
          createdAt: eventTime,
          updatedAt: eventTime,
        });
      } else if (type === 'ISSUE_OPENED') {
        payload = EventFactory.issues(meta, actor, 'opened', {
          id: 91000 + Math.floor(Math.random() * 1000),
          number: parseInt(metadata?.number || '1', 10),
          title: metadata?.title || 'bug: simulated issue reports',
          createdAt: eventTime,
        });
      } else if (type === 'ISSUE_CLOSED') {
        payload = EventFactory.issues(meta, actor, 'closed', {
          id: parseInt(metadata?.id || '91001', 10),
          number: parseInt(metadata?.number || '1', 10),
          title: metadata?.title || 'bug: simulated issue reports',
          createdAt: eventTime,
          updatedAt: eventTime,
        });
      } else if (type === 'WORKFLOW_FAILED' || type === 'WORKFLOW_PASSED') {
        payload = EventFactory.workflowRun(meta, actor, {
          id: 92000 + Math.floor(Math.random() * 1000),
          name: metadata?.name || 'CI Build',
          conclusion: type === 'WORKFLOW_FAILED' ? 'failure' : 'success',
          createdAt: eventTime,
        });
      } else if (type === 'RELEASE_PUBLISHED') {
        payload = EventFactory.release(meta, actor, {
          id: 93000 + Math.floor(Math.random() * 1000),
          tagName: metadata?.tagName || 'v1.0.0-mock',
          name: metadata?.name || 'Mock Release',
          publishedAt: eventTime,
        });
      } else {
        Clock.reset();
        return new NextResponse(`Unsupported event type: ${type}`, { status: 400 });
      }

      // Process event through the standard pipeline
      const processType = type.startsWith('PR_') ? 'pull_request' : (type.startsWith('ISSUE_') ? 'issues' : type.toLowerCase());
      const result = await handleWebhookEvent(processType, deliveryId, payload);
      
      Clock.reset(); // Restore clock

      if (result.success) {
        return NextResponse.json({ success: true, message: `Simulated ${type} event processed.` });
      } else {
        return NextResponse.json({ success: false, error: result.reason || 'Event pipeline failed.' });
      }
    }

    if (action === 'generate_brief') {
      // Find simulated user
      const user = await prisma.user.findFirst({
        where: { githubUserId: 888888, isSimulated: true },
      });

      if (!user) {
        return new NextResponse('Simulated user not found. Seed first.', { status: 404 });
      }

      const today = Clock.now();
      today.setHours(0, 0, 0, 0);

      // Fetch simulated user repos
      const repositories = await prisma.repository.findMany({
        where: {
          owner: 'repobutler-sim-developer',
          isArchived: false,
          isSimulated: true,
          settings: { monitoringEnabled: true },
        },
        include: {
          attentionItems: { where: { status: 'OPEN' } },
          commits: { where: { occurredAt: { gte: today } } },
          pullRequests: { where: { updatedAt: { gte: today } } },
          issues: { where: { updatedAt: { gte: today } } },
        },
      });

      if (repositories.length === 0) {
        return NextResponse.json({ success: false, error: 'No monitored simulated repositories.' });
      }

      // Collect attention items
      const attentionItems = repositories.flatMap(r => 
        r.attentionItems.map(item => ({
          ...item,
          repoName: r.name,
        }))
      ).sort((a, b) => {
        const severityMap: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return (severityMap[b.severity] || 0) - (severityMap[a.severity] || 0);
      });

      const reposChangedCount = repositories.filter(r => 
        r.commits.length > 0 || r.pullRequests.length > 0 || r.issues.length > 0
      ).length;

      // Generate summary
      const summary = await generateDailyBriefSummary({
        userName: user.username,
        repositoriesChanged: reposChangedCount,
        attentionItems: attentionItems.map(item => ({
          repoName: item.repoName,
          type: item.type,
          severity: item.severity,
          title: item.title,
          description: item.description,
        })),
      });

      // Upsert Simulated Brief
      const brief = await prisma.dailyBrief.upsert({
        where: {
          userId_date: {
            userId: user.id,
            date: today,
          },
        },
        update: {
          summary,
          attentionCount: attentionItems.length,
          repositoriesChanged: reposChangedCount,
          generatedAt: Clock.now(),
          isSimulated: true,
        },
        create: {
          userId: user.id,
          date: today,
          summary,
          attentionCount: attentionItems.length,
          repositoriesChanged: reposChangedCount,
          generatedAt: Clock.now(),
          isSimulated: true,
        },
      });

      await prisma.dailyBriefItem.deleteMany({
        where: { dailyBriefId: brief.id },
      });

      const briefItemsData = attentionItems.slice(0, 5).map((item, idx) => {
        const repo = repositories.find(r => r.name === item.repoName);
        return {
          dailyBriefId: brief.id,
          repositoryId: repo?.id || '',
          attentionItemId: item.id,
          rank: idx + 1,
          reason: `${item.severity}: ${item.title}. ${item.description}`,
        };
      });

      if (briefItemsData.length > 0) {
        await prisma.dailyBriefItem.createMany({
          data: briefItemsData.filter(d => d.repositoryId !== ''),
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Daily Brief generated successfully.',
        brief: {
          id: brief.id,
          summary,
          attentionCount: brief.attentionCount,
          repositoriesChanged: brief.repositoriesChanged,
          generatedAt: brief.generatedAt,
        },
      });
    }

    return new NextResponse('Unsupported Action', { status: 400 });
  } catch (error) {
    console.error('Simulator POST Error:', error);
    return new NextResponse('Internal Error', { status: 500 });
  }
}
