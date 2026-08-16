import { Octokit } from '@octokit/rest';
import prisma from '../db/prisma';
import { getInstallationOctokit } from './client';
import { calculateRepositoryHealth } from '../health/calculator';
import { updateAttentionItems } from '../attention/engine';

/**
 * Synchronizes a single repository's data from GitHub.
 * Imports commits, pull requests, issues, releases, and actions runs from the last 30 days.
 * 
 * @param repositoryId Internal database ID of the repository
 * @param octokit Optional authenticated Octokit instance (avoids requesting a token if already available)
 */
export async function syncRepository(repositoryId: string, octokit?: Octokit) {
  console.log(`Starting sync for repository: ${repositoryId}`);
  
  try {
    // 1. Fetch repository from DB
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: { installation: true },
    });

    if (!repository) {
      throw new Error(`Repository with ID ${repositoryId} not found.`);
    }

    // 2. Instantiate Octokit client if not provided
    const client = octokit || await getInstallationOctokit(repository.installation.githubInstallationId);

    const owner = repository.owner;
    const repo = repository.name;
    
    // Look back window: 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sinceIso = thirtyDaysAgo.toISOString();

    // -- A. SYNC COMMITS --
    try {
      const { data: commits } = await client.request('GET /repos/{owner}/{repo}/commits', {
        owner,
        repo,
        since: sinceIso,
        per_page: 100,
      });

      for (const item of commits) {
        const authorLogin = item.author?.login || item.commit.author?.name || 'unknown';
        const message = item.commit.message || '';
        const sha = item.sha;
        const occurredAt = new Date(item.commit.author?.date || Date.now());

        // Simple heuristic for meaningful commit:
        // Ignore merge commits, chore, empty messages, or dependabot updates
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
            repositoryId,
            sha,
            authorLogin,
            message,
            occurredAt,
            isMeaningful,
          },
        });
      }
    } catch (err) {
      console.error(`Error syncing commits for ${repository.fullName}:`, err);
    }

    // -- B. SYNC PULL REQUESTS --
    try {
      const { data: pulls } = await client.request('GET /repos/{owner}/{repo}/pulls', {
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      });

      for (const item of pulls) {
        const state = item.state.toUpperCase() as 'OPEN' | 'CLOSED';
        const isMerged = !!item.merged_at;
        const finalState = isMerged ? 'MERGED' : state;

        await prisma.pullRequest.upsert({
          where: { githubPrId: Number(item.id) },
          update: {
            number: item.number,
            title: item.title,
            authorLogin: item.user?.login || 'unknown',
            state: finalState,
            draft: item.draft || false,
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            mergedAt: item.merged_at ? new Date(item.merged_at) : null,
            closedAt: item.closed_at ? new Date(item.closed_at) : null,
            lastActivityAt: new Date(item.updated_at),
          },
          create: {
            repositoryId,
            githubPrId: Number(item.id),
            number: item.number,
            title: item.title,
            authorLogin: item.user?.login || 'unknown',
            state: finalState,
            draft: item.draft || false,
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            mergedAt: item.merged_at ? new Date(item.merged_at) : null,
            closedAt: item.closed_at ? new Date(item.closed_at) : null,
            lastActivityAt: new Date(item.updated_at),
          },
        });
      }
    } catch (err) {
      console.error(`Error syncing PRs for ${repository.fullName}:`, err);
    }

    // -- C. SYNC ISSUES --
    try {
      const { data: issues } = await client.request('GET /repos/{owner}/{repo}/issues', {
        owner,
        repo,
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
      });

      for (const item of issues) {
        // GitHub Issues API returns pull requests too; filter them out
        if (item.pull_request) continue;

        await prisma.issue.upsert({
          where: { githubIssueId: Number(item.id) },
          update: {
            number: item.number,
            title: item.title,
            state: item.state.toUpperCase() as 'OPEN' | 'CLOSED',
            authorLogin: item.user?.login || 'unknown',
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            closedAt: item.closed_at ? new Date(item.closed_at) : null,
            lastActivityAt: new Date(item.updated_at),
          },
          create: {
            repositoryId,
            githubIssueId: Number(item.id),
            number: item.number,
            title: item.title,
            state: item.state.toUpperCase() as 'OPEN' | 'CLOSED',
            authorLogin: item.user?.login || 'unknown',
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            closedAt: item.closed_at ? new Date(item.closed_at) : null,
            lastActivityAt: new Date(item.updated_at),
          },
        });
      }
    } catch (err) {
      console.error(`Error syncing issues for ${repository.fullName}:`, err);
    }

    // -- D. SYNC RELEASES --
    try {
      const { data: releases } = await client.request('GET /repos/{owner}/{repo}/releases', {
        owner,
        repo,
        per_page: 20,
      });

      for (const item of releases) {
        await prisma.release.upsert({
          where: { githubReleaseId: item.id },
          update: {
            tagName: item.tag_name,
            name: item.name || null,
            publishedAt: new Date(item.published_at || Date.now()),
          },
          create: {
            repositoryId,
            githubReleaseId: item.id,
            tagName: item.tag_name,
            name: item.name || null,
            publishedAt: new Date(item.published_at || Date.now()),
          },
        });
      }
    } catch (err) {
      console.error(`Error syncing releases for ${repository.fullName}:`, err);
    }

    // -- E. SYNC WORKFLOW RUNS --
    try {
      const { data: runsData } = await client.request('GET /repos/{owner}/{repo}/actions/runs', {
        owner,
        repo,
        branch: repository.defaultBranch,
        per_page: 30,
      });

      for (const item of runsData.workflow_runs) {
        await prisma.workflowRun.upsert({
          where: { githubWorkflowRunId: item.id },
          update: {
            name: item.name || 'default',
            status: item.status || 'unknown',
            conclusion: item.conclusion || null,
            branch: item.head_branch || 'main',
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            completedAt: item.run_started_at ? new Date(item.run_started_at) : null,
          },
          create: {
            repositoryId,
            githubWorkflowRunId: item.id,
            name: item.name || 'default',
            status: item.status || 'unknown',
            conclusion: item.conclusion || null,
            branch: item.head_branch || 'main',
            createdAt: new Date(item.created_at),
            updatedAt: new Date(item.updated_at),
            completedAt: item.run_started_at ? new Date(item.run_started_at) : null,
          },
        });
      }
    } catch (err) {
      console.error(`Error syncing workflow runs for ${repository.fullName}:`, err);
    }

    // 3. Mark last synced time
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { lastSyncedAt: new Date() },
    });

    console.log(`Sync completed successfully for repository: ${repository.fullName}`);

    // 4. Recalculate health and update attention items
    try {
      await calculateRepositoryHealth(repositoryId);
      await updateAttentionItems(repositoryId);
    } catch (err) {
      console.error(`Error in post-sync health/attention calculations for ${repository.fullName}:`, err);
    }

  } catch (error) {
    console.error(`Error syncing repository ID ${repositoryId}:`, error);
    throw error;
  }
}
