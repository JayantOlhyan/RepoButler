import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import prisma from '@/lib/db/prisma';
import { getAppOctokit, getInstallationOctokit } from '@/lib/github/client';
import { syncRepository } from '@/lib/github/sync';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const installationIdStr = searchParams.get('installation_id');
  const setupAction = searchParams.get('setup_action');

  if (!installationIdStr) {
    return NextResponse.redirect(new URL('/?error=missing_installation_id', req.url));
  }

  const installationId = parseInt(installationIdStr, 10);
  if (isNaN(installationId)) {
    return NextResponse.redirect(new URL('/?error=invalid_installation_id', req.url));
  }

  // Get current logged-in user
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    // Redirect to home page where they can sign in, appending the installation ID so we can reconnect it later if needed
    return NextResponse.redirect(new URL(`/?error=signin_required&installation_id=${installationId}`, req.url));
  }

  const userId = (session.user as any).id;
  if (!userId) {
    return NextResponse.redirect(new URL('/?error=user_not_found', req.url));
  }

  try {
    // 1. Fetch installation details from GitHub to get account login and type
    const appOctokit = getAppOctokit();
    const { data: installationData } = await appOctokit.request('GET /app/installations/{installation_id}', {
      installation_id: installationId,
    });

    const accountLogin = (installationData.account as any)?.login || '';
    const accountType = (installationData.account as any)?.type || 'User';

    // 2. Upsert GitHubInstallation in DB
    const dbInstallation = await prisma.gitHubInstallation.upsert({
      where: { githubInstallationId: installationId },
      update: {
        userId,
        accountLogin,
        accountType,
      },
      create: {
        githubInstallationId: installationId,
        userId,
        accountLogin,
        accountType,
      },
    });

    // 3. Fetch list of repositories authorized for this installation
    const installationOctokit = await getInstallationOctokit(installationId);
    const { data: reposData } = await installationOctokit.request('GET /installation/repositories');

    // 4. Save repository metadata in DB
    const savedRepos = [];
    for (const repo of reposData.repositories) {
      const dbRepo = await prisma.repository.upsert({
        where: { githubRepositoryId: Number(repo.id) },
        update: {
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description || null,
          defaultBranch: repo.default_branch,
          isPrivate: repo.private,
          isArchived: repo.archived || false,
          htmlUrl: repo.html_url,
          language: repo.language || null,
          stars: repo.stargazers_count || 0,
          forks: repo.forks_count || 0,
          openIssuesCount: repo.open_issues_count || 0,
          githubUpdatedAt: new Date(repo.updated_at || Date.now()),
        },
        create: {
          installationId: dbInstallation.id,
          githubRepositoryId: Number(repo.id),
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description || null,
          defaultBranch: repo.default_branch,
          isPrivate: repo.private,
          isArchived: repo.archived || false,
          htmlUrl: repo.html_url,
          language: repo.language || null,
          stars: repo.stargazers_count || 0,
          forks: repo.forks_count || 0,
          openIssuesCount: repo.open_issues_count || 0,
          githubUpdatedAt: new Date(repo.updated_at || Date.now()),
          settings: {
            create: {
              monitoringEnabled: true,
              staleThresholdDays: 14,
              dailyBriefEnabled: true,
              healthEnabled: true,
            },
          },
          projectMemory: {
            create: {
              summary: 'Initializing memory...',
              currentFocus: 'Initial synchronization',
            },
          },
        },
      });
      savedRepos.push(dbRepo);
    }

    // 5. Trigger asynchronous sync for each repository to import historical activity (PRs, commits, issues, runs, releases)
    // We run this in the background so the user callback returns immediately and the dashboard loads fast.
    for (const repo of savedRepos) {
      syncRepository(repo.id, installationOctokit).catch((err) => {
        console.error(`Failed background sync for repo ${repo.fullName}:`, err);
      });
    }

    // Redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', req.url));
  } catch (error) {
    console.error('Error handling installation callback:', error);
    return NextResponse.redirect(new URL('/?error=installation_failed', req.url));
  }
}
