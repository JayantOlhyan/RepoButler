import prisma from '../db/prisma';
import { Clock } from '../utils/clock';
import { EventFactory, SimulatedRepositoryMeta } from './event-factory';
import { handleWebhookEvent } from '../webhooks/processor';
import { seedSimulatedData } from './seed';

export interface ScenarioResult {
  name: string;
  repository: string;
  eventsGenerated: number;
  attentionItemsCreated: number;
  initialHealth: number;
  finalHealth: number;
  ciStatus: string;
}

/**
 * Executes a simulated scenario on a targeted repository.
 */
export async function runScenario(scenarioName: string): Promise<ScenarioResult> {
  // Ensure simulated user and repositories exist
  await seedSimulatedData();

  const now = new Date();
  Clock.reset(); // Start clean

  // Find simulated repository by name
  let targetRepoName = 'repobutler-healthy';
  if (scenarioName === 'ci-failure' || scenarioName === 'repeated-ci-failure' || scenarioName === 'ci-recovery') {
    targetRepoName = 'repobutler-ci-failing';
  } else if (scenarioName === 'stale-repository' || scenarioName === 'active-project') {
    targetRepoName = 'repobutler-stale';
  } else if (scenarioName === 'stale-pr' || scenarioName === 'bad-repository') {
    targetRepoName = 'repobutler-needs-attention';
  } else if (scenarioName === 'busy-day') {
    targetRepoName = 'repobutler-busy';
  }

  const repo = await prisma.repository.findFirst({
    where: { name: targetRepoName, isSimulated: true },
    include: {
      healthSnapshots: { orderBy: { calculatedAt: 'desc' }, take: 1 },
      attentionItems: { where: { status: 'OPEN' } },
    },
  });

  if (!repo) {
    throw new Error(`Simulated repository ${targetRepoName} not found. Ensure seed was run.`);
  }

  const initialHealth = repo.healthSnapshots[0]?.score ?? 100;
  const meta: SimulatedRepositoryMeta = {
    githubRepositoryId: repo.githubRepositoryId,
    name: repo.name,
    fullName: repo.fullName,
    owner: repo.owner,
  };

  let eventsCount = 0;

  // Execute scenario specific events
  switch (scenarioName) {
    
    case 'healthy-repository': {
      // Clear repo activity first
      await clearRepositoryActivity(repo.id);

      // 1. Push commits 1 day ago
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      Clock.setSimulatedTime(oneDayAgo);
      const pushPayload = EventFactory.push(meta, 'sim-developer', [
        { sha: 'sha_healthy_1', message: 'feat: implement landing page layout', timestamp: oneDayAgo },
        { sha: 'sha_healthy_2', message: 'fix: align navbar elements', timestamp: oneDayAgo },
      ]);
      await handleWebhookEvent('push', `sim_push_${Date.now()}`, pushPayload);
      eventsCount++;

      // 2. Successful workflow run 1 day ago
      const runPayload = EventFactory.workflowRun(meta, 'sim-developer', {
        id: 70001,
        name: 'Continuous Integration',
        conclusion: 'success',
        createdAt: oneDayAgo,
      });
      await handleWebhookEvent('workflow_run', 'sim_run_70001', runPayload);
      eventsCount++;

      // 3. Merged PR 2 days ago
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      Clock.setSimulatedTime(twoDaysAgo);
      const prOpened = EventFactory.pullRequest(meta, 'sim-developer', 'opened', {
        id: 7701,
        number: 1,
        title: 'feat: add dark mode toggles',
        createdAt: twoDaysAgo,
      });
      await handleWebhookEvent('pull_request', 'sim_pr_open_7701', prOpened);
      eventsCount++;

      const prClosed = EventFactory.pullRequest(meta, 'sim-developer', 'closed', {
        id: 7701,
        number: 1,
        title: 'feat: add dark mode toggles',
        isMerged: true,
        createdAt: twoDaysAgo,
        updatedAt: twoDaysAgo,
      });
      await handleWebhookEvent('pull_request', 'sim_pr_close_7701', prClosed);
      eventsCount++;

      // 4. Release published 3 days ago
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      Clock.setSimulatedTime(threeDaysAgo);
      const relPayload = EventFactory.release(meta, 'sim-developer', {
        id: 7001,
        tagName: 'v0.1.0-alpha',
        name: 'Initial Preview Release',
        publishedAt: threeDaysAgo,
      });
      await handleWebhookEvent('release', 'sim_release_7001', relPayload);
      eventsCount++;
      break;
    }

    case 'ci-failure': {
      // Workflow run failure now
      Clock.setSimulatedTime(now);
      const runPayload = EventFactory.workflowRun(meta, 'sim-developer', {
        id: Date.now(),
        name: 'Production Deploy',
        conclusion: 'failure',
      });
      await handleWebhookEvent('workflow_run', `sim_run_fail_${Date.now()}`, runPayload);
      eventsCount++;
      break;
    }

    case 'repeated-ci-failure': {
      // 5 workflow run failures sequentially
      for (let i = 0; i < 5; i++) {
        const offsetTime = new Date(now.getTime() - (5 - i) * 10 * 60 * 1000); // 10 min intervals
        Clock.setSimulatedTime(offsetTime);
        const runPayload = EventFactory.workflowRun(meta, 'sim-developer', {
          id: 80000 + i,
          name: 'Main CI Build',
          conclusion: 'failure',
          createdAt: offsetTime,
        });
        await handleWebhookEvent('workflow_run', `sim_run_fail_rep_${80000 + i}`, runPayload);
        eventsCount++;
      }
      break;
    }

    case 'ci-recovery': {
      // Successful workflow run now (recovers from failing)
      Clock.setSimulatedTime(now);
      const runPayload = EventFactory.workflowRun(meta, 'sim-developer', {
        id: 80009,
        name: 'Main CI Build',
        conclusion: 'success',
      });
      await handleWebhookEvent('workflow_run', 'sim_run_recovery_80009', runPayload);
      eventsCount++;
      break;
    }

    case 'stale-pr': {
      // Shift clock 48 hours ago to create a PR
      const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      Clock.setSimulatedTime(fortyEightHoursAgo);

      const prPayload = EventFactory.pullRequest(meta, 'external-contributor', 'opened', {
        id: 9901,
        number: 84,
        title: 'docs: update API setup guidelines',
        createdAt: fortyEightHoursAgo,
      });
      await handleWebhookEvent('pull_request', 'sim_pr_9901', prPayload);
      eventsCount++;

      // Reset to now so it registers as stale when calculated relative to now
      Clock.reset();
      // Trigger a dummy update to force evaluation at now time
      const triggerPush = EventFactory.push(meta, 'sim-developer', [
        { sha: `sha_dummy_${Date.now()}`, message: 'chore: dummy commit' }
      ]);
      await handleWebhookEvent('push', `sim_push_dummy_${Date.now()}`, triggerPush);
      break;
    }

    case 'stale-repository': {
      // Clear repo activity first
      await clearRepositoryActivity(repo.id);

      // Create a commit 21 days ago
      const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
      Clock.setSimulatedTime(twentyOneDaysAgo);
      const pushPayload = EventFactory.push(meta, 'sim-developer', [
        { sha: 'sha_stale_1', message: 'feat: prototype stale state', timestamp: twentyOneDaysAgo },
      ]);
      await handleWebhookEvent('push', 'sim_push_stale_1', pushPayload);
      eventsCount++;

      // Reset clock to now so it marks as stale repo
      Clock.reset();
      // Dummy push to trigger evaluation
      const triggerPush = EventFactory.push(meta, 'sim-developer', [
        { sha: `sha_dummy_stale_${Date.now()}`, message: 'chore: dummy commit' }
      ]);
      await handleWebhookEvent('push', `sim_push_stale_dummy_${Date.now()}`, triggerPush);
      break;
    }

    case 'active-project': {
      // Push a meaningful commit now to clear stale state
      Clock.reset();
      const pushPayload = EventFactory.push(meta, 'sim-developer', [
        { sha: `sha_active_${Date.now()}`, message: 'feat: add mock dashboard UI panels' },
      ]);
      await handleWebhookEvent('push', `sim_push_active_${Date.now()}`, pushPayload);
      eventsCount++;
      break;
    }

    case 'busy-day': {
      // Clear repository activity first
      await clearRepositoryActivity(repo.id);

      Clock.reset();
      
      // 1. Push 15 commits (done in blocks)
      const pushCommits = [];
      for (let i = 0; i < 15; i++) {
        pushCommits.push({ sha: `sha_busy_${i}`, message: `feat: busy work commit #${i}` });
      }
      const pushPayload = EventFactory.push(meta, 'sim-developer', pushCommits);
      await handleWebhookEvent('push', `sim_push_busy_${Date.now()}`, pushPayload);
      eventsCount++;

      // 2. Open 3 PRs
      for (let i = 0; i < 3; i++) {
        const prPayload = EventFactory.pullRequest(meta, 'sim-developer', 'opened', {
          id: 9910 + i,
          number: 10 + i,
          title: `feat: busy PR component #${i}`,
        });
        await handleWebhookEvent('pull_request', `sim_pr_busy_${9910 + i}`, prPayload);
        eventsCount++;
      }

      // 3. Open 7 Issues
      for (let i = 0; i < 7; i++) {
        const issuePayload = EventFactory.issues(meta, 'sim-developer', 'opened', {
          id: 9950 + i,
          number: 50 + i,
          title: `bug: busy issue item #${i}`,
        });
        await handleWebhookEvent('issues', `sim_issue_busy_${9950 + i}`, issuePayload);
        eventsCount++;
      }

      // 4. Publish 2 releases
      for (let i = 0; i < 2; i++) {
        const relPayload = EventFactory.release(meta, 'sim-developer', {
          id: 9980 + i,
          tagName: `v1.0.${i}`,
          name: `Busy Release v1.0.${i}`,
        });
        await handleWebhookEvent('release', `sim_release_busy_${9980 + i}`, relPayload);
        eventsCount++;
      }

      // 5. Successful CI workflow
      const runPayload = EventFactory.workflowRun(meta, 'sim-developer', {
        id: 99991,
        name: 'Deployment Pipeline',
        conclusion: 'success',
      });
      await handleWebhookEvent('workflow_run', 'sim_run_busy_99991', runPayload);
      eventsCount++;
      break;
    }

    case 'bad-repository': {
      // Clear repo activity first
      await clearRepositoryActivity(repo.id);

      // Workflow run failed
      Clock.setSimulatedTime(now);
      const runPayload = EventFactory.workflowRun(meta, 'sim-developer', {
        id: 95501,
        name: 'Deploy',
        conclusion: 'failure',
      });
      await handleWebhookEvent('workflow_run', 'sim_run_bad_95501', runPayload);
      eventsCount++;

      // Stale PR (created 10 days ago)
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      Clock.setSimulatedTime(tenDaysAgo);
      const prPayload = EventFactory.pullRequest(meta, 'external-contributor', 'opened', {
        id: 95502,
        number: 14,
        title: 'docs: minor grammatical fixes',
        createdAt: tenDaysAgo,
      });
      await handleWebhookEvent('pull_request', 'sim_pr_bad_95502', prPayload);
      eventsCount++;

      // Stale Issue (created 20 days ago)
      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      Clock.setSimulatedTime(twentyDaysAgo);
      const issuePayload = EventFactory.issues(meta, 'external-contributor', 'opened', {
        id: 95503,
        number: 404,
        title: 'bug: app crashes on init',
        createdAt: twentyDaysAgo,
      });
      await handleWebhookEvent('issues', 'sim_issue_bad_95503', issuePayload);
      eventsCount++;

      Clock.reset();
      // Dummy push to trigger evaluation
      const triggerPush = EventFactory.push(meta, 'sim-developer', [
        { sha: `sha_dummy_bad_${Date.now()}`, message: 'chore: dummy commit' }
      ]);
      await handleWebhookEvent('push', `sim_push_bad_dummy_${Date.now()}`, triggerPush);
      break;
    }

    default:
      throw new Error(`Unknown scenario name: ${scenarioName}`);
  }

  // Restore real clock settings
  Clock.reset();

  // Re-fetch updated repository details to build response summary
  const updatedRepo = await prisma.repository.findUnique({
    where: { id: repo.id },
    include: {
      healthSnapshots: { orderBy: { calculatedAt: 'desc' }, take: 1 },
      attentionItems: { where: { status: 'OPEN' } },
      workflowRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const finalHealth = updatedRepo?.healthSnapshots[0]?.score ?? 100;
  const attentionItemsCreated = updatedRepo?.attentionItems.length ?? 0;
  const ciStatus = updatedRepo?.workflowRuns[0]?.conclusion === 'failure' ? 'Failing' : 'Passing';

  return {
    name: scenarioName,
    repository: targetRepoName,
    eventsGenerated: eventsCount,
    attentionItemsCreated,
    initialHealth,
    finalHealth,
    ciStatus,
  };
}

/**
 * Removes all activities and rules on a simulated repo to isolate scenario testing.
 */
async function clearRepositoryActivity(repoId: string) {
  await prisma.activityEvent.deleteMany({ where: { repositoryId: repoId } });
  await prisma.commit.deleteMany({ where: { repositoryId: repoId } });
  await prisma.pullRequest.deleteMany({ where: { repositoryId: repoId } });
  await prisma.issue.deleteMany({ where: { repositoryId: repoId } });
  await prisma.workflowRun.deleteMany({ where: { repositoryId: repoId } });
  await prisma.release.deleteMany({ where: { repositoryId: repoId } });
  await prisma.healthSnapshot.deleteMany({ where: { repositoryId: repoId } });
  await prisma.attentionItem.deleteMany({ where: { repositoryId: repoId } });
}
