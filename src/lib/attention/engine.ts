import prisma from '../db/prisma';
import { Clock } from '../utils/clock';

export interface CandidateItem {
  type: 'PR_AWAITING_REVIEW' | 'FAILED_CI' | 'STALE_REPO' | 'STALE_PR' | 'STALE_ISSUE' | 'REPEATED_CI_FAILURE';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  evidence: string;
  recommendedAction: string;
  eventDate: Date;
  // Unique key to identify this logical item (e.g. "PR_84", "WORKFLOW_production")
  uniqueKey: string;
}

// Configurable weights for attention scoring
export const SCORING_WEIGHTS = {
  urgency: 0.30,
  impact: 0.25,
  age: 0.20,
  relevance: 0.15,
  confidence: 0.10,
};

/**
 * Calculates a score between 0 and 100 for an attention item candidate.
 */
export function calculateScore(
  candidate: CandidateItem,
  baseScores: { urgency: number; impact: number; relevance: number; confidence: number },
  ageDays: number
) {
  // Age score increases with time, caps at 100 (10 points per day)
  const ageScore = Math.min(100, Math.round(ageDays * 10));
  
  const rawScore = 
    baseScores.urgency * SCORING_WEIGHTS.urgency +
    baseScores.impact * SCORING_WEIGHTS.impact +
    ageScore * SCORING_WEIGHTS.age +
    baseScores.relevance * SCORING_WEIGHTS.relevance +
    baseScores.confidence * SCORING_WEIGHTS.confidence;
    
  return Math.min(100, Math.max(0, Math.round(rawScore)));
}

/**
 * Scans the database records for a repository and generates a list of candidate attention items.
 */
export async function getCandidates(repositoryId: string): Promise<CandidateItem[]> {
  const repository = await prisma.repository.findUnique({
    where: { id: repositoryId },
    include: { settings: true },
  });

  if (!repository || !repository.settings?.monitoringEnabled) {
    return [];
  }

  const settings = repository.settings;
  const candidates: CandidateItem[] = [];
  const now = Clock.now();

  // Fetch repository relations
  const openPrs = await prisma.pullRequest.findMany({
    where: { repositoryId, state: 'OPEN' },
  });

  const openIssues = await prisma.issue.findMany({
    where: { repositoryId, state: 'OPEN' },
  });

  const runs = await prisma.workflowRun.findMany({
    where: { repositoryId },
    orderBy: { createdAt: 'desc' },
  });

  const commits = await prisma.commit.findMany({
    where: { repositoryId, isMeaningful: true },
    orderBy: { occurredAt: 'desc' },
    take: 1,
  });

  const releases = await prisma.release.findMany({
    where: { repositoryId },
    orderBy: { publishedAt: 'desc' },
    take: 1,
  });

  const mergedPrs = await prisma.pullRequest.findMany({
    where: { repositoryId, state: 'MERGED' },
    orderBy: { mergedAt: 'desc' },
    take: 1,
  });

  const closedIssues = await prisma.issue.findMany({
    where: { repositoryId, state: 'CLOSED' },
    orderBy: { closedAt: 'desc' },
    take: 1,
  });

  // --- Rule B & F: CI Build Failures (Single & Repeated) ---
  // Group runs by workflow name
  const workflowRunsByName: Record<string, typeof runs> = {};
  for (const run of runs) {
    if (!workflowRunsByName[run.name]) {
      workflowRunsByName[run.name] = [];
    }
    workflowRunsByName[run.name].push(run);
  }

  for (const name of Object.keys(workflowRunsByName)) {
    const nameRuns = workflowRunsByName[name];
    if (nameRuns.length === 0) continue;

    // Check the latest completed run
    const latestCompletedRun = nameRuns.find(r => r.status === 'completed');
    if (!latestCompletedRun || !latestCompletedRun.conclusion) continue;

    if (latestCompletedRun.conclusion !== 'success') {
      // Find how many consecutive failures occurred recently before a success
      let consecutiveFailures = 0;
      let failureTimes: Date[] = [];
      
      for (const r of nameRuns) {
        if (r.status === 'completed') {
          if (r.conclusion !== 'success') {
            consecutiveFailures++;
            if (r.createdAt) {
              failureTimes.push(new Date(r.createdAt));
            }
          } else {
            break; // Stop at first success
          }
        }
      }

      // Check if it failed multiple times in the last 24 hours
      const oneDayAgo = Clock.now();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const failuresLast24h = failureTimes.filter(t => t > oneDayAgo).length;

      if (consecutiveFailures >= 3 || failuresLast24h >= 2) {
        // Rule F: Repeated CI failure
        candidates.push({
          type: 'REPEATED_CI_FAILURE',
          severity: 'CRITICAL',
          title: `CI failing repeatedly on ${repository.name}`,
          description: `Workflow "${name}" has failed ${consecutiveFailures} times consecutively (${failuresLast24h} times today) on ${repository.name}.`,
          evidence: `${consecutiveFailures} failures logged. Latest failure at ${latestCompletedRun.createdAt.toLocaleTimeString()}`,
          recommendedAction: 'Investigate deployment failure.',
          eventDate: latestCompletedRun.createdAt,
          uniqueKey: `WORKFLOW_${name}`,
        });
      } else {
        // Rule B: Single Failed CI
        candidates.push({
          type: 'FAILED_CI',
          severity: 'HIGH',
          title: `${repository.name} CI failed`,
          description: `The latest completed run of workflow "${name}" failed on ${repository.name}.`,
          evidence: `Workflow run completed with conclusion "${latestCompletedRun.conclusion}" at ${latestCompletedRun.createdAt.toLocaleTimeString()}`,
          recommendedAction: 'Investigate deployment failure.',
          eventDate: latestCompletedRun.createdAt,
          uniqueKey: `WORKFLOW_${name}`,
        });
      }
    }
  }

  // --- Rule A & D: Stale PRs and Awaiting Review ---
  for (const pr of openPrs) {
    const ageDays = (now.getTime() - pr.lastActivityAt.getTime()) / (24 * 60 * 60 * 1000);
    
    // PR Awaiting Review (Rule A): PR is from another author, waiting on owner (our user)
    // If user's account name is owner of the repo, and someone else is the author of the PR
    if (pr.authorLogin !== repository.owner && !pr.draft) {
      const reviewThreshold = 2; // Days
      if (ageDays >= reviewThreshold) {
        candidates.push({
          type: 'PR_AWAITING_REVIEW',
          severity: 'HIGH',
          title: `PR #${pr.number} awaiting review`,
          description: `PR #${pr.number} "${pr.title}" opened by @${pr.authorLogin} has been waiting for review for ${Math.round(ageDays)} days.`,
          evidence: `Opened at ${pr.createdAt.toLocaleDateString()}. Last activity was ${pr.lastActivityAt.toLocaleDateString()}`,
          recommendedAction: `Review PR #${pr.number}.`,
          eventDate: pr.lastActivityAt,
          uniqueKey: `PR_${pr.number}`,
        });
      }
    } 
    // Stale PR (Rule D): Owner opened the PR but it has been inactive
    else if (pr.authorLogin === repository.owner) {
      const staleThreshold = 7; // Days
      if (ageDays >= staleThreshold) {
        candidates.push({
          type: 'STALE_PR',
          severity: 'MEDIUM',
          title: `Stale PR #${pr.number}`,
          description: `Your PR #${pr.number} "${pr.title}" has been inactive for ${Math.round(ageDays)} days.`,
          evidence: `Last activity recorded on ${pr.lastActivityAt.toLocaleDateString()}`,
          recommendedAction: `Check open PR #${pr.number} or merge it.`,
          eventDate: pr.lastActivityAt,
          uniqueKey: `PR_${pr.number}`,
        });
      }
    }
  }

  // --- Rule E: Stale Issues ---
  for (const issue of openIssues) {
    const ageDays = (now.getTime() - issue.lastActivityAt.getTime()) / (24 * 60 * 60 * 1000);
    const staleThreshold = 10; // Days
    
    if (ageDays >= staleThreshold) {
      candidates.push({
        type: 'STALE_ISSUE',
        severity: 'LOW',
        title: `Stale Issue #${issue.number}`,
        description: `Issue #${issue.number} "${issue.title}" has had no updates for ${Math.round(ageDays)} days.`,
        evidence: `Last activity recorded on ${issue.lastActivityAt.toLocaleDateString()}`,
        recommendedAction: `Review issue #${issue.number} and reply or close it.`,
        eventDate: issue.lastActivityAt,
        uniqueKey: `ISSUE_${issue.number}`,
      });
    }
  }

  // --- Rule C: Stale Repository ---
  // Find the most recent date of any meaningful activity
  const dates = [
    commits[0]?.occurredAt,
    mergedPrs[0]?.mergedAt,
    closedIssues[0]?.closedAt,
    releases[0]?.publishedAt,
  ].filter((d): d is Date => !!d);

  if (dates.length > 0) {
    const latestActivity = new Date(Math.max(...dates.map(d => d.getTime())));
    const daysSinceActivity = (now.getTime() - latestActivity.getTime()) / (24 * 60 * 60 * 1000);
    const staleThreshold = settings.staleThresholdDays; // Default 14 days

    if (daysSinceActivity >= staleThreshold && !repository.isArchived) {
      candidates.push({
        type: 'STALE_REPO',
        severity: 'MEDIUM',
        title: `Repository inactive for ${Math.round(daysSinceActivity)} days`,
        description: `No meaningful activity (commits, releases, or merges) has occurred in ${repository.name} for ${Math.round(daysSinceActivity)} days.`,
        evidence: `Last activity detected on ${latestActivity.toLocaleDateString()}`,
        recommendedAction: 'Review whether the project requires updates.',
        eventDate: latestActivity,
        uniqueKey: 'STALE_REPO',
      });
    }
  }

  return candidates;
}

/**
 * Updates, resolves, and score-allocates the database attention items for a repository.
 */
export async function updateAttentionItems(repositoryId: string) {
  const candidates = await getCandidates(repositoryId);
  const now = Clock.now();

  // Get current active attention items for this repository
  const existingItems = await prisma.attentionItem.findMany({
    where: { repositoryId },
  });

  const existingKeys = new Set(existingItems.map(item => `${item.type}_${item.description.includes('PR #') ? item.title : item.id}`));
  
  // Custom helper to generate matching keys for comparison
  const getMatchKey = (item: { type: string; uniqueKey: string }) => `${item.type}_${item.uniqueKey}`;
  const existingMap = new Map(existingItems.map(item => {
    // Extract unique ID key from existing items descriptions/titles
    let matchKey = item.uniqueKey;
    if (!matchKey) {
      // Fallback matching logic for legacy data
      if (item.type.startsWith('PR_')) {
        const prMatch = item.title.match(/#(\d+)/);
        matchKey = prMatch ? `PR_${prMatch[1]}` : 'PR_unknown';
      } else if (item.type.startsWith('ISSUE_')) {
        const issueMatch = item.title.match(/#(\d+)/);
        matchKey = issueMatch ? `ISSUE_${issueMatch[1]}` : 'ISSUE_unknown';
      } else if (item.type.includes('CI_')) {
        const wfMatch = item.description.match(/"([^"]+)"/);
        matchKey = wfMatch ? `WORKFLOW_${wfMatch[1]}` : 'WORKFLOW_default';
      } else {
        matchKey = 'STALE_REPO';
      }
    }
    return [`${item.type}_${matchKey}`, item];
  }));

  const candidateKeys = new Set(candidates.map(getMatchKey));

  // 1. Resolve or Delete items that are no longer candidates
  for (const [key, item] of existingMap.entries()) {
    if (!candidateKeys.has(key)) {
      if (item.status === 'OPEN') {
        // If CI succeeded or PR was closed/merged, mark as resolved
        await prisma.attentionItem.update({
          where: { id: item.id },
          data: { status: 'RESOLVED', resolvedAt: now },
        });
      }
    }
  }

  // 2. Add or Update candidate items
  for (const candidate of candidates) {
    const matchKey = getMatchKey(candidate);
    const existing = existingMap.get(matchKey);
    
    // Define base scores for engine formula
    let baseScores = { urgency: 50, impact: 50, relevance: 50, confidence: 100 };
    if (candidate.type === 'REPEATED_CI_FAILURE') baseScores = { urgency: 95, impact: 90, relevance: 90, confidence: 100 };
    else if (candidate.type === 'FAILED_CI') baseScores = { urgency: 85, impact: 80, relevance: 85, confidence: 100 };
    else if (candidate.type === 'PR_AWAITING_REVIEW') baseScores = { urgency: 80, impact: 75, relevance: 80, confidence: 100 };
    else if (candidate.type === 'STALE_PR') baseScores = { urgency: 50, impact: 50, relevance: 60, confidence: 100 };
    else if (candidate.type === 'STALE_ISSUE') baseScores = { urgency: 30, impact: 30, relevance: 50, confidence: 100 };
    else if (candidate.type === 'STALE_REPO') baseScores = { urgency: 40, impact: 45, relevance: 50, confidence: 100 };

    const ageDays = (now.getTime() - candidate.eventDate.getTime()) / (24 * 60 * 60 * 1000);
    const attentionScore = calculateScore(candidate, baseScores, ageDays);

    if (existing) {
      // If it exists but is resolved, reopen it (e.g. CI failed again)
      if (existing.status === 'RESOLVED') {
        await prisma.attentionItem.update({
          where: { id: existing.id },
          data: {
            status: 'OPEN',
            description: candidate.description,
            evidence: candidate.evidence,
            severity: candidate.severity,
            resolvedAt: null,
          },
        });
      }
      // If it is OPEN, we keep its status but update descriptions
      else {
        await prisma.attentionItem.update({
          where: { id: existing.id },
          data: {
            description: candidate.description,
            evidence: candidate.evidence,
            severity: candidate.severity,
          },
        });
      }
    } else {
      // Create new attention item
      await prisma.attentionItem.create({
        data: {
          repositoryId,
          type: candidate.type,
          severity: candidate.severity,
          title: candidate.title,
          description: candidate.description,
          evidence: candidate.evidence,
          recommendedAction: candidate.recommendedAction,
          status: 'OPEN',
          createdAt: now,
          // Store unique key for easy updates next sync
          uniqueKey: candidate.uniqueKey,
        },
      });
    }
  }
}
