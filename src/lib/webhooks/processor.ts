import prisma from '../db/prisma';
import { calculateRepositoryHealth } from '../health/calculator';
import { updateAttentionItems } from '../attention/engine';
import { Clock } from '../utils/clock';

/**
 * Reusable core event pipeline shared between real webhooks and simulator triggers.
 */
export async function handleWebhookEvent(
  eventType: string,
  deliveryId: string,
  payload: any
): Promise<{ success: boolean; reason?: string; repoId?: string }> {
  const repoGithubId = payload.repository?.id;
  const installationId = payload.installation?.id;

  // Handle installation events (uninstalls, repo changes)
  if (eventType === 'installation') {
    const action = payload.action;
    if (action === 'deleted' && installationId) {
      try {
        const dbInstallation = await prisma.gitHubInstallation.findUnique({
          where: { githubInstallationId: installationId },
        });
        if (dbInstallation) {
          await prisma.repository.updateMany({
            where: { installationId: dbInstallation.id },
            data: { isArchived: true },
          });
          console.log(`Uninstalled GitHub App installation ID: ${installationId}`);
        }
      } catch (err) {
        console.error('Failed to handle installation deletion:', err);
      }
    }
    return { success: true, reason: 'installation_processed' };
  }

  if (eventType === 'installation_repositories') {
    const action = payload.action;
    const reposAdded = payload.repositories_added || [];
    const reposRemoved = payload.repositories_removed || [];

    try {
      const dbInstallation = await prisma.gitHubInstallation.findUnique({
        where: { githubInstallationId: installationId },
      });

      if (dbInstallation) {
        for (const repo of reposRemoved) {
          await prisma.repository.updateMany({
            where: { githubRepositoryId: repo.id },
            data: { isArchived: true },
          });
        }

        for (const repo of reposAdded) {
          await prisma.repository.upsert({
            where: { githubRepositoryId: repo.id },
            update: { isArchived: false },
            create: {
              installationId: dbInstallation.id,
              githubRepositoryId: repo.id,
              owner: payload.repository?.owner?.login || '',
              name: repo.name,
              fullName: repo.full_name,
              defaultBranch: 'main',
              isPrivate: repo.private || false,
              isArchived: false,
              htmlUrl: `https://github.com/${repo.full_name}`,
              githubUpdatedAt: Clock.now(),
              settings: {
                create: {
                  monitoringEnabled: true,
                  staleThresholdDays: 14,
                  dailyBriefEnabled: true,
                  healthEnabled: true,
                },
              },
            },
          });
        }
      }
    } catch (err) {
      console.error('Failed to handle installation repositories change:', err);
    }
    return { success: true, reason: 'repositories_processed' };
  }

  if (!repoGithubId) {
    return { success: false, reason: 'Missing repository context' };
  }

  // Find repository in DB (can check either standard or simulated)
  const dbRepo = await prisma.repository.findUnique({
    where: { githubRepositoryId: repoGithubId },
  });

  if (!dbRepo) {
    return { success: false, reason: 'untracked_repository' };
  }

  // Save Activity Event in DB
  await prisma.activityEvent.create({
    data: {
      repositoryId: dbRepo.id,
      githubEventId: deliveryId,
      eventType: eventType.toUpperCase(),
      actorLogin: payload.sender?.login || 'unknown',
      occurredAt: Clock.now(),
      payloadReference: {
        action: payload.action || null,
        ref: payload.ref || null,
      },
    },
  });

  try {
    if (eventType === 'push') {
      const commits = payload.commits || [];
      for (const item of commits) {
        const authorLogin = item.author?.username || item.author?.name || 'unknown';
        const message = item.message || '';
        const sha = item.id;
        const occurredAt = new Date(item.timestamp);

        const isMerge = message.startsWith('Merge ') || message.includes('Merge pull request');
        const isChore = message.startsWith('chore:') || message.startsWith('docs:') || message.startsWith('style:');
        const isBot = authorLogin.includes('dependabot') || authorLogin.includes('[bot]');
        const isMeaningful = !isMerge && !isChore && !isBot && message.trim().length > 0;

        await prisma.commit.upsert({
          where: { sha },
          update: {
            authorLogin,
            message,
            occurredAt,
            isMeaningful,
          },
          create: {
            repositoryId: dbRepo.id,
            sha,
            authorLogin,
            message,
            occurredAt,
            isMeaningful,
          },
        });
      }

      await prisma.repository.update({
        where: { id: dbRepo.id },
        data: { githubUpdatedAt: Clock.now() },
      });
    }

    else if (eventType === 'pull_request') {
      const pr = payload.pull_request;
      const state = pr.state.toUpperCase() as 'OPEN' | 'CLOSED';
      const isMerged = !!pr.merged_at;
      const finalState = isMerged ? 'MERGED' : state;

      await prisma.pullRequest.upsert({
        where: { githubPrId: pr.id },
        update: {
          number: pr.number,
          title: pr.title,
          authorLogin: pr.user?.login || 'unknown',
          state: finalState,
          draft: pr.draft || false,
          createdAt: new Date(pr.createdAt || pr.created_at),
          updatedAt: new Date(pr.updatedAt || pr.updated_at),
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          lastActivityAt: new Date(pr.updatedAt || pr.updated_at),
        },
        create: {
          repositoryId: dbRepo.id,
          githubPrId: pr.id,
          number: pr.number,
          title: pr.title,
          authorLogin: pr.user?.login || 'unknown',
          state: finalState,
          draft: pr.draft || false,
          createdAt: new Date(pr.createdAt || pr.created_at),
          updatedAt: new Date(pr.updatedAt || pr.updated_at),
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          lastActivityAt: new Date(pr.updatedAt || pr.updated_at),
        },
      });

      await prisma.repository.update({
        where: { id: dbRepo.id },
        data: { githubUpdatedAt: Clock.now() },
      });
    }

    else if (eventType === 'issues') {
      const issue = payload.issue;

      await prisma.issue.upsert({
        where: { githubIssueId: issue.id },
        update: {
          number: issue.number,
          title: issue.title,
          state: issue.state.toUpperCase() as 'OPEN' | 'CLOSED',
          authorLogin: issue.user?.login || 'unknown',
          createdAt: new Date(issue.createdAt || issue.created_at),
          updatedAt: new Date(issue.updatedAt || issue.updated_at),
          closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
          lastActivityAt: new Date(issue.updatedAt || issue.updated_at),
        },
        create: {
          repositoryId: dbRepo.id,
          githubIssueId: issue.id,
          number: issue.number,
          title: issue.title,
          state: issue.state.toUpperCase() as 'OPEN' | 'CLOSED',
          authorLogin: issue.user?.login || 'unknown',
          createdAt: new Date(issue.createdAt || issue.created_at),
          updatedAt: new Date(issue.updatedAt || issue.updated_at),
          closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
          lastActivityAt: new Date(issue.updatedAt || issue.updated_at),
        },
      });

      await prisma.repository.update({
        where: { id: dbRepo.id },
        data: { githubUpdatedAt: Clock.now() },
      });
    }

    else if (eventType === 'issue_comment') {
      const issue = payload.issue;
      const comment = payload.comment;

      if (issue.pull_request) {
        await prisma.pullRequest.updateMany({
          where: { repositoryId: dbRepo.id, number: issue.number },
          data: { lastActivityAt: new Date(comment.updated_at || comment.created_at) },
        });
      } else {
        await prisma.issue.updateMany({
          where: { repositoryId: dbRepo.id, number: issue.number },
          data: { lastActivityAt: new Date(comment.updated_at || comment.created_at) },
        });
      }

      await prisma.repository.update({
        where: { id: dbRepo.id },
        data: { githubUpdatedAt: Clock.now() },
      });
    }

    else if (eventType === 'workflow_run') {
      const run = payload.workflow_run;

      await prisma.workflowRun.upsert({
        where: { githubWorkflowRunId: run.id },
        update: {
          name: run.name || 'default',
          status: run.status || 'unknown',
          conclusion: run.conclusion || null,
          branch: run.head_branch || 'main',
          createdAt: new Date(run.createdAt || run.created_at),
          updatedAt: new Date(run.updatedAt || run.updated_at),
          completedAt: run.run_started_at ? new Date(run.run_started_at) : null,
        },
        create: {
          repositoryId: dbRepo.id,
          githubWorkflowRunId: run.id,
          name: run.name || 'default',
          status: run.status || 'unknown',
          conclusion: run.conclusion || null,
          branch: run.head_branch || 'main',
          createdAt: new Date(run.createdAt || run.created_at),
          updatedAt: new Date(run.updatedAt || run.updated_at),
          completedAt: run.run_started_at ? new Date(run.run_started_at) : null,
        },
      });
    }

    else if (eventType === 'release') {
      const rel = payload.release;

      await prisma.release.upsert({
        where: { githubReleaseId: rel.id },
        update: {
          tagName: rel.tag_name,
          name: rel.name || null,
          publishedAt: new Date(rel.published_at || Clock.now().getTime()),
        },
        create: {
          repositoryId: dbRepo.id,
          githubReleaseId: rel.id,
          tagName: rel.tag_name,
          name: rel.name || null,
          publishedAt: new Date(rel.published_at || Clock.now().getTime()),
        },
      });
    }
  } catch (err) {
    console.error(`Error processing webhook contents for ${dbRepo.fullName}:`, err);
    return { success: false, reason: 'database_error', repoId: dbRepo.id };
  }

  // Recalculate health and attention items synchronously for simulator immediate output
  try {
    await calculateRepositoryHealth(dbRepo.id);
    await updateAttentionItems(dbRepo.id);
  } catch (err) {
    console.error(`Failed to run health/attention updates for ${dbRepo.fullName}:`, err);
  }

  return { success: true, repoId: dbRepo.id };
}
