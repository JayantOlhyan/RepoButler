import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateRepositoryHealth } from '../src/lib/health/calculator';
import prisma from '../src/lib/db/prisma';

// Mock the Prisma Client
vi.mock('../src/lib/db/prisma', () => {
  return {
    default: {
      repository: {
        findUnique: vi.fn(),
      },
      pullRequest: {
        findMany: vi.fn(),
      },
      issue: {
        findMany: vi.fn(),
      },
      workflowRun: {
        findMany: vi.fn(),
      },
      commit: {
        count: vi.fn(),
      },
      release: {
        findMany: vi.fn(),
      },
      healthSnapshot: {
        create: vi.fn(),
      },
    },
  };
});

describe('Repository Health Calculator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('calculates the perfect score of 100 for a perfectly active, healthy repository', async () => {
    const mockRepo = {
      id: 'repo-1',
      owner: 'jayantolhyan',
      name: 'Perfect-Repo',
      fullName: 'jayantolhyan/Perfect-Repo',
      description: 'A perfect repository with full descriptions.',
      githubUpdatedAt: new Date(), // Active today
    };

    vi.mocked(prisma.repository.findUnique).mockResolvedValue(mockRepo as any);
    
    // Healthy CI: all runs successful
    vi.mocked(prisma.workflowRun.findMany).mockResolvedValue([
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'success' },
    ] as any);

    // No open PRs or issues (default score 100)
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.issue.findMany).mockResolvedValue([]);

    // Good activity: 10 commits in last 14 days
    vi.mocked(prisma.commit.count).mockResolvedValue(10);

    // Active releases: release published yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    vi.mocked(prisma.release.findMany).mockResolvedValue([
      { publishedAt: yesterday },
    ] as any);

    const breakdown = await calculateRepositoryHealth('repo-1');

    expect(breakdown.score).toBe(100);
    expect(breakdown.ciScore).toBe(100);
    expect(breakdown.activityScore).toBe(100);
    expect(breakdown.prScore).toBe(100);
    expect(breakdown.issueScore).toBe(100);
    expect(breakdown.documentationScore).toBe(100);
    expect(breakdown.releaseScore).toBe(100);
    expect(breakdown.reasons).toHaveLength(0);
  });

  it('deducts points and adds reasons/recommendations for stale components', async () => {
    const mockRepo = {
      id: 'repo-2',
      owner: 'jayantolhyan',
      name: 'Neglected-Repo',
      fullName: 'jayantolhyan/Neglected-Repo',
      description: null, // Missing description
      githubUpdatedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000), // Updated 20 days ago
    };

    vi.mocked(prisma.repository.findUnique).mockResolvedValue(mockRepo as any);

    // Failing CI: 1 success, 1 failure (50% reliability)
    vi.mocked(prisma.workflowRun.findMany).mockResolvedValue([
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'success' },
    ] as any);

    // Stale open PR (inactive for 10 days)
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([
      { number: 1, lastActivityAt: tenDaysAgo },
    ] as any);

    // Stale open issue
    const twentyDaysAgo = new Date();
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20);
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { number: 5, lastActivityAt: twentyDaysAgo },
    ] as any);

    // Inactive: 0 commits in the last 14 days
    vi.mocked(prisma.commit.count).mockResolvedValue(0);

    // No releases
    vi.mocked(prisma.release.findMany).mockResolvedValue([]);

    const breakdown = await calculateRepositoryHealth('repo-2');

    // Weight allocations:
    // ciScore: 50 * 0.20 = 10
    // prScore: (100 - 50 - 5 = 45) * 0.15 = 6.75
    // issueScore: (100 - 40 - 3 = 57) * 0.15 = 8.55
    // activityScore: 20 * 0.15 = 3
    // maintenanceScore: (100 - (20-7)*2 = 74) * 0.15 = 11.1
    // docScore: 50 * 0.10 = 5
    // releaseScore: 50 * 0.10 = 5
    // Total = ~49.4 -> 49
    expect(breakdown.score).toBeLessThan(70);
    expect(breakdown.reasons).toContain('CI failed 1 time in recent runs');
    expect(breakdown.reasons).toContain('1 pull request is stale (no activity for 7+ days)');
    expect(breakdown.reasons).toContain('No active commits pushed in the last 14 days');
    expect(breakdown.reasons).toContain('Repository is missing a description');
    
    expect(breakdown.recommendations).toContain('Fix failing builds in workflow pipelines');
    expect(breakdown.recommendations).toContain('Add a descriptive summary in GitHub repository settings');
  });
});
