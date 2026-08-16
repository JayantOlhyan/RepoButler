import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateScore, getCandidates, CandidateItem } from '../src/lib/attention/engine';
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
        findMany: vi.fn(),
      },
      release: {
        findMany: vi.fn(),
      },
    },
  };
});

describe('Attention Engine Intelligence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('Attention Score Formula', () => {
    it('calculates expected score for a given candidate and age', () => {
      const candidate: CandidateItem = {
        type: 'FAILED_CI',
        severity: 'HIGH',
        title: 'CI failure',
        description: 'Test description',
        evidence: 'Test evidence',
        recommendedAction: 'Investigate',
        eventDate: new Date(),
        uniqueKey: 'workflow_test',
      };
      
      const baseScores = { urgency: 80, impact: 80, relevance: 80, confidence: 100 };
      
      // Age is 0 days
      const scoreToday = calculateScore(candidate, baseScores, 0);
      // urgency * 0.3 + impact * 0.25 + age(0) * 0.20 + relevance * 0.15 + confidence * 0.1
      // 80*0.3 + 80*0.25 + 0 + 80*0.15 + 100*0.1 = 24 + 20 + 0 + 12 + 10 = 66
      expect(scoreToday).toBe(66);

      // Age is 4 days
      const scoreLater = calculateScore(candidate, baseScores, 4);
      // ageScore = min(100, 4 * 10) = 40
      // 24 + 20 + 40*0.20 + 12 + 10 = 66 + 8 = 74
      expect(scoreLater).toBe(74);
    });
  });

  describe('Attention Rules Processing', () => {
    const mockRepo = {
      id: 'repo-abc',
      name: 'Healthkinator',
      owner: 'jayantolhyan',
      fullName: 'jayantolhyan/Healthkinator',
      isArchived: false,
      settings: {
        monitoringEnabled: true,
        staleThresholdDays: 14,
      },
    };

    it('creates FAILED_CI candidate when the latest workflow run fails', async () => {
      vi.mocked(prisma.repository.findUnique).mockResolvedValue(mockRepo as any);
      vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([]);
      vi.mocked(prisma.issue.findMany).mockResolvedValue([]);
      vi.mocked(prisma.commit.findMany).mockResolvedValue([]);
      vi.mocked(prisma.release.findMany).mockResolvedValue([]);
      
      // Workflow run list: Latest run is failure, prior is success
      const now = new Date();
      vi.mocked(prisma.workflowRun.findMany).mockResolvedValue([
        {
          name: 'production',
          status: 'completed',
          conclusion: 'failure',
          branch: 'main',
          createdAt: now,
        },
        {
          name: 'production',
          status: 'completed',
          conclusion: 'success',
          branch: 'main',
          createdAt: new Date(now.getTime() - 3600000),
        },
      ] as any);

      const candidates = await getCandidates('repo-abc');
      
      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('FAILED_CI');
      expect(candidates[0].severity).toBe('HIGH');
      expect(candidates[0].uniqueKey).toBe('WORKFLOW_production');
    });

    it('creates REPEATED_CI_FAILURE when build fails repeatedly', async () => {
      vi.mocked(prisma.repository.findUnique).mockResolvedValue(mockRepo as any);
      vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([]);
      vi.mocked(prisma.issue.findMany).mockResolvedValue([]);
      vi.mocked(prisma.commit.findMany).mockResolvedValue([]);
      vi.mocked(prisma.release.findMany).mockResolvedValue([]);

      const now = new Date();
      // 3 consecutive failures
      vi.mocked(prisma.workflowRun.findMany).mockResolvedValue([
        { name: 'production', status: 'completed', conclusion: 'failure', branch: 'main', createdAt: now },
        { name: 'production', status: 'completed', conclusion: 'failure', branch: 'main', createdAt: new Date(now.getTime() - 3600000) },
        { name: 'production', status: 'completed', conclusion: 'failure', branch: 'main', createdAt: new Date(now.getTime() - 7200000) },
      ] as any);

      const candidates = await getCandidates('repo-abc');

      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('REPEATED_CI_FAILURE');
      expect(candidates[0].severity).toBe('CRITICAL');
    });

    it('creates PR_AWAITING_REVIEW when a PR from another contributor is open longer than 2 days', async () => {
      vi.mocked(prisma.repository.findUnique).mockResolvedValue(mockRepo as any);
      vi.mocked(prisma.workflowRun.findMany).mockResolvedValue([]);
      vi.mocked(prisma.issue.findMany).mockResolvedValue([]);
      vi.mocked(prisma.commit.findMany).mockResolvedValue([]);
      vi.mocked(prisma.release.findMany).mockResolvedValue([]);

      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([
        {
          number: 84,
          title: 'Add dashboard UI layout',
          authorLogin: 'developer-b', // NOT owner (jayantolhyan)
          state: 'OPEN',
          draft: false,
          createdAt: fourDaysAgo,
          lastActivityAt: fourDaysAgo,
        },
      ] as any);

      const candidates = await getCandidates('repo-abc');

      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('PR_AWAITING_REVIEW');
      expect(candidates[0].severity).toBe('HIGH');
      expect(candidates[0].uniqueKey).toBe('PR_84');
    });

    it('creates STALE_PR when the owner themselves left a PR open longer than 7 days', async () => {
      vi.mocked(prisma.repository.findUnique).mockResolvedValue(mockRepo as any);
      vi.mocked(prisma.workflowRun.findMany).mockResolvedValue([]);
      vi.mocked(prisma.issue.findMany).mockResolvedValue([]);
      vi.mocked(prisma.commit.findMany).mockResolvedValue([]);
      vi.mocked(prisma.release.findMany).mockResolvedValue([]);

      const eightDaysAgo = new Date();
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

      vi.mocked(prisma.pullRequest.findMany).mockResolvedValue([
        {
          number: 91,
          title: 'Settings refactoring WIP',
          authorLogin: 'jayantolhyan', // IS owner
          state: 'OPEN',
          draft: false,
          createdAt: eightDaysAgo,
          lastActivityAt: eightDaysAgo,
        },
      ] as any);

      const candidates = await getCandidates('repo-abc');

      expect(candidates).toHaveLength(1);
      expect(candidates[0].type).toBe('STALE_PR');
      expect(candidates[0].severity).toBe('MEDIUM');
      expect(candidates[0].uniqueKey).toBe('PR_91');
    });
  });
});
