import prisma from '../db/prisma';
import { Clock } from '../utils/clock';

export interface HealthBreakdown {
  score: number;
  ciScore: number;
  activityScore: number;
  issueScore: number;
  prScore: number;
  maintenanceScore: number;
  documentationScore: number;
  releaseScore: number;
  reasons: string[];
  recommendations: string[];
}

/**
 * Calculates and persists the health score and snapshot for a repository.
 * 
 * @param repositoryId Internal database repository ID
 * @returns HealthBreakdown containing scores, reasons, and recommendations
 */
export async function calculateRepositoryHealth(repositoryId: string): Promise<HealthBreakdown> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  if (!repository) {
    throw new Error(`Repository with ID ${repositoryId} not found.`);
  }

  const now = Clock.now();
  const reasons: string[] = [];
  const recommendations: string[] = [];

  // 1. CI Reliability (20%)
  const runs = await prisma.workflowRun.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
    take: 15,
  });
  
  let ciScore = 100;
  const completedRuns = runs.filter(r => r.status === 'completed');
  if (completedRuns.length > 0) {
    const successfulRuns = completedRuns.filter(r => r.conclusion === 'success');
    ciScore = Math.round((successfulRuns.length / completedRuns.length) * 100);
    
    if (ciScore < 90) {
      const failureCount = completedRuns.length - successfulRuns.length;
      reasons.push(`CI failed ${failureCount} time${failureCount > 1 ? 's' : ''} in recent runs`);
      recommendations.push('Fix failing builds in workflow pipelines');
    }
  }

  // 2. PR Health (15%)
  const openPrs = await prisma.pullRequest.findMany({
    where: { repositoryId, state: 'OPEN' },
  });

  let prScore = 100;
  if (openPrs.length > 0) {
    const oneWeekAgo = Clock.now();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const stalePrs = openPrs.filter(pr => pr.lastActivityAt < oneWeekAgo);
    prScore = Math.max(0, 100 - Math.round((stalePrs.length / openPrs.length) * 50) - (stalePrs.length * 5));
    
    if (stalePrs.length > 0) {
      reasons.push(`${stalePrs.length} pull request${stalePrs.length > 1 ? 's are' : ' is'} stale (no activity for 7+ days)`);
      recommendations.push(`Review and merge or close stale PRs (e.g. PR #${stalePrs[0].number})`);
    }
  }

  // 3. Issue Health (15%)
  const openIssues = await prisma.issue.findMany({
    where: { repositoryId, state: 'OPEN' },
  });

  let issueScore = 100;
  if (openIssues.length > 0) {
    const fourteenDaysAgo = Clock.now();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const staleIssues = openIssues.filter(issue => issue.lastActivityAt < fourteenDaysAgo);
    issueScore = Math.max(0, 100 - Math.round((staleIssues.length / openIssues.length) * 40) - (staleIssues.length * 3));
    
    if (staleIssues.length > 0) {
      reasons.push(`${staleIssues.length} issue${staleIssues.length > 1 ? 's are' : ' is'} stale (inactive for 14+ days)`);
      recommendations.push(`Respond to or resolve open stale issues (e.g. Issue #${staleIssues[0].number})`);
    }
  }

  // 4. Activity (15%)
  const fourteenDaysAgo = Clock.now();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const recentCommits = await prisma.commit.count({
    where: {
      repositoryId,
      occurredAt: { gte: fourteenDaysAgo },
    },
  });

  let activityScore = 100;
  if (recentCommits === 0) {
    activityScore = 20;
    reasons.push('No active commits pushed in the last 14 days');
    recommendations.push('Push updates or refactor code to resume activity momentum');
  } else if (recentCommits < 5) {
    activityScore = 70;
  }

  // 5. Maintenance (15%)
  const daysSinceUpdate = (now.getTime() - repository.githubUpdatedAt.getTime()) / (24 * 60 * 60 * 1000);
  let maintenanceScore = 100;
  if (daysSinceUpdate > 7) {
    maintenanceScore = Math.max(0, Math.round(100 - (daysSinceUpdate - 7) * 2));
    if (daysSinceUpdate > 14) {
      reasons.push(`Repository has not been updated in ${Math.round(daysSinceUpdate)} days`);
    }
  }

  // 6. Documentation (10%)
  // Score is based on presence of a description in the repository metadata
  let documentationScore = repository.description ? 100 : 50;
  if (!repository.description) {
    reasons.push('Repository is missing a description');
    recommendations.push('Add a descriptive summary in GitHub repository settings');
  }

  // 7. Release Health (10%)
  const latestReleases = await prisma.release.findMany({
    where: { repositoryId },
    orderBy: { publishedAt: 'desc' },
    take: 1,
  });

  let releaseScore = 100;
  if (latestReleases.length === 0) {
    releaseScore = 50;
    // Don't flag this as a critical problem for side projects, but offer a tip
    recommendations.push('Create a release version tag to establish stable milestones');
  } else {
    const daysSinceRelease = (now.getTime() - latestReleases[0].publishedAt.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceRelease > 90) {
      releaseScore = Math.max(0, Math.round(80 - (daysSinceRelease - 90) * 0.2));
      reasons.push(`No new release version published in ${Math.round(daysSinceRelease)} days`);
      recommendations.push('Publish a new release tag for recent code improvements');
    }
  }

  // Calculate overall weighted score
  const score = Math.round(
    ciScore * 0.20 +
    prScore * 0.15 +
    issueScore * 0.15 +
    activityScore * 0.15 +
    maintenanceScore * 0.15 +
    documentationScore * 0.10 +
    releaseScore * 0.10
  );

  // 8. Persist health snapshot in DB
  await prisma.healthSnapshot.create({
    data: {
      repositoryId,
      score,
      ciScore,
      activityScore,
      issueScore,
      prScore,
      maintenanceScore,
      documentationScore,
      calculatedAt: now,
    },
  });

  return {
    score,
    ciScore,
    activityScore,
    issueScore,
    prScore,
    maintenanceScore,
    documentationScore,
    releaseScore,
    reasons,
    recommendations,
  };
}

/**
 * Returns the latest health breakdown for a repository.
 */
export async function getLatestHealthSnapshot(repositoryId: string): Promise<HealthBreakdown | null> {
  const snapshot = await prisma.healthSnapshot.findFirst({
    where: { repositoryId },
    orderBy: { calculatedAt: 'desc' },
  });

  if (!snapshot) {
    return null;
  }

  // Re-generate reasons/recommendations dynamically based on snapshot numbers for display
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
  });

  const reasons: string[] = [];
  const recommendations: string[] = [];

  if (snapshot.ciScore < 90) {
    reasons.push('Recent CI workflow builds have failed');
    recommendations.push('Fix failing builds in workflow pipelines');
  }
  if (snapshot.prScore < 80) {
    reasons.push('Stale pull requests are pending your response');
    recommendations.push('Review open pull requests');
  }
  if (snapshot.issueScore < 80) {
    reasons.push('Stale issues are waiting to be resolved');
    recommendations.push('Respond to or close open stale issues');
  }
  if (snapshot.activityScore < 50) {
    reasons.push('Low recent code commit frequency');
    recommendations.push('Push new updates to resume activity momentum');
  }
  if (repository && !repository.description) {
    reasons.push('Repository lacks description metadata');
    recommendations.push('Add description in GitHub settings');
  }

  return {
    score: snapshot.score,
    ciScore: snapshot.ciScore,
    activityScore: snapshot.activityScore,
    issueScore: snapshot.issueScore,
    prScore: snapshot.prScore,
    maintenanceScore: snapshot.maintenanceScore,
    documentationScore: snapshot.documentationScore,
    releaseScore: 90, // Fallback placeholder in snap read
    reasons,
    recommendations,
  };
}
