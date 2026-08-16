import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { verifyWebhookSignature } from '@/lib/security/webhooks';
import { calculateRepositoryHealth } from '@/lib/health/calculator';
import { updateAttentionItems } from '@/lib/attention/engine';

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

  const repoGithubId = payload.repository?.id;
  const installationId = payload.installation?.id;

  // Handle installation events (uninstalls, repo changes)
  if (eventType === 'installation') {
    const action = payload.action;
    if (action === 'deleted' && installationId) {
      // Mark repositories as inactive / uninstall
      try {
        const dbInstallation = await prisma.gitHubInstallation.findUnique({
          where: { githubInstallationId: installationId },
        });
        if (dbInstallation) {
          await prisma.repository.updateMany({
            where: { installationId: dbInstallation.id },
            data: { isArchived: true }, // Or mark inactive
          });
          console.log(`Uninstalled GitHub App installation ID: ${installationId}`);
        }
      } catch (err) {
        console.error('Failed to handle installation deletion:', err);
      }
    }
    return new NextResponse('Ok', { status: 200 });
  }

  if (eventType === 'installation_repositories') {
    // Repositories added or removed from the App
    const action = payload.action;
    const reposAdded = payload.repositories_added || [];
    const reposRemoved = payload.repositories_removed || [];

    try {
      const dbInstallation = await prisma.gitHubInstallation.findUnique({
        where: { githubInstallationId: installationId },
      });

      if (dbInstallation) {
        // Disable monitoring or remove repositories that were removed
        for (const repo of reposRemoved) {
          await prisma.repository.updateMany({
            where: { githubRepositoryId: repo.id },
            data: { isArchived: true },
          });
        }

        // Add metadata for repositories that were added
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
              defaultBranch: 'main', // Temporary fallback
              isPrivate: repo.private || false,
              isArchived: false,
              htmlUrl: `https://github.com/${repo.full_name}`,
              githubUpdatedAt: new Date(),
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
    return new NextResponse('Ok', { status: 200 });
  }

  // 3. Find repository in DB
  if (!repoGithubId) {
    return new NextResponse('Missing repository context', { status: 200 });
  }

  const dbRepo = await prisma.repository.findUnique({
    where: { githubRepositoryId: repoGithubId },
  });

  if (!dbRepo) {
    // If we don't monitor this repo, we acknowledge and skip
    return new NextResponse('Ok (untracked repository)', { status: 200 });
  }

  // 4. Save Activity Event in DB
  await prisma.activityEvent.create({
    data: {
      repositoryId: dbRepo.id,
      githubEventId: deliveryId,
      eventType: eventType.toUpperCase(),
      actorLogin: payload.sender?.login || 'unknown',
      occurredAt: new Date(),
      payloadReference: {
        action: payload.action || null,
        ref: payload.ref || null,
      },
    },
  });

  // 5. Update state asynchronously or synchronously based on complexity
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
        data: { githubUpdatedAt: new Date() },
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
          createdAt: new Date(pr.created_at),
          updatedAt: new Date(pr.updated_at),
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          lastActivityAt: new Date(pr.updated_at),
        },
        create: {
          repositoryId: dbRepo.id,
          githubPrId: pr.id,
          number: pr.number,
          title: pr.title,
          authorLogin: pr.user?.login || 'unknown',
          state: finalState,
          draft: pr.draft || false,
          createdAt: new Date(pr.created_at),
          updatedAt: new Date(pr.updated_at),
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          lastActivityAt: new Date(pr.updated_at),
        },
      });

      await prisma.repository.update({
        where: { id: dbRepo.id },
        data: { githubUpdatedAt: new Date() },
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
          createdAt: new Date(issue.created_at),
          updatedAt: new Date(issue.updated_at),
          closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
          lastActivityAt: new Date(issue.updated_at),
        },
        create: {
          repositoryId: dbRepo.id,
          githubIssueId: issue.id,
          number: issue.number,
          title: issue.title,
          state: issue.state.toUpperCase() as 'OPEN' | 'CLOSED',
          authorLogin: issue.user?.login || 'unknown',
          createdAt: new Date(issue.created_at),
          updatedAt: new Date(issue.updated_at),
          closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
          lastActivityAt: new Date(issue.updated_at),
        },
      });

      await prisma.repository.update({
        where: { id: dbRepo.id },
        data: { githubUpdatedAt: new Date() },
      });
    }

    else if (eventType === 'issue_comment') {
      const issue = payload.issue;
      const comment = payload.comment;

      // Update last activity on corresponding PR or Issue
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
        data: { githubUpdatedAt: new Date() },
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
          createdAt: new Date(run.created_at),
          updatedAt: new Date(run.updated_at),
          completedAt: run.run_started_at ? new Date(run.run_started_at) : null,
        },
        create: {
          repositoryId: dbRepo.id,
          githubWorkflowRunId: run.id,
          name: run.name || 'default',
          status: run.status || 'unknown',
          conclusion: run.conclusion || null,
          branch: run.head_branch || 'main',
          createdAt: new Date(run.created_at),
          updatedAt: new Date(run.updated_at),
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
          publishedAt: new Date(rel.published_at || Date.now()),
        },
        create: {
          repositoryId: dbRepo.id,
          githubReleaseId: rel.id,
          tagName: rel.tag_name,
          name: rel.name || null,
          publishedAt: new Date(rel.published_at || Date.now()),
        },
      });
    }
  } catch (err) {
    console.error(`Error processing webhook contents for ${dbRepo.fullName}:`, err);
  }

  // 6. Recalculate health and attention items in the background
  // This satisfies the target of returning in <5 seconds.
  calculateRepositoryHealth(dbRepo.id)
    .then(() => updateAttentionItems(dbRepo.id))
    .catch((err) => console.error(`Failed to run background updates for ${dbRepo.fullName}:`, err));

  return new NextResponse('Ok', { status: 200 });
}
