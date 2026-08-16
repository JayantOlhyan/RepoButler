import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../src/lib/db/prisma';
import { EventFactory } from '../src/lib/simulator/event-factory';
import { resetSimulationData } from '../src/lib/simulator/reset';
import { seedSimulatedData } from '../src/lib/simulator/seed';
import { Clock } from '../src/lib/utils/clock';

// Mock Prisma
vi.mock('../src/lib/db/prisma', () => {
  return {
    default: {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: 'sim_user_id' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'sim_user_id', isSimulated: true }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gitHubInstallation: {
        upsert: vi.fn().mockResolvedValue({ id: 'sim_install_id' }),
      },
      repository: {
        upsert: vi.fn().mockResolvedValue({ id: 'sim_repo_id', githubRepositoryId: 880001 }),
        findFirst: vi.fn().mockResolvedValue({ id: 'sim_repo_id', githubRepositoryId: 880001, name: 'repobutler-healthy', isSimulated: true, healthSnapshots: [], attentionItems: [] }),
        findMany: vi.fn().mockResolvedValue([{ id: 'sim_repo_id', isSimulated: true }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 6 }),
      },
      repositorySettings: {
        upsert: vi.fn().mockResolvedValue({ id: 'sim_settings_id' }),
      },
      dailyBrief: {
        findMany: vi.fn().mockResolvedValue([{ id: 'sim_brief_id', isSimulated: true }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };
});

describe('Developer Simulator Environment tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Clock.reset();
  });

  describe('Injectable Mock Clock', () => {
    it('returns system date by default', () => {
      const now = Clock.now();
      const real = new Date();
      expect(Math.abs(now.getTime() - real.getTime())).toBeLessThan(1000);
    });

    it('returns mock date when lock time is set in development', () => {
      // Simulate dev mode setting env
      vi.stubEnv('NODE_ENV', 'development');
      const targetDate = new Date('2026-08-16T12:00:00.000Z');
      Clock.setSimulatedTime(targetDate);
      
      const mocked = Clock.now();
      expect(mocked.getTime()).toBe(targetDate.getTime());
    });

    it('clones mock dates to avoid mutation conflicts', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const targetDate = new Date('2026-08-16T12:00:00.000Z');
      Clock.setSimulatedTime(targetDate);
      
      const first = Clock.now();
      first.setDate(first.getDate() - 1); // Mutate first local date copy
      
      const second = Clock.now();
      expect(second.getTime()).toBe(targetDate.getTime()); // Shared global remains intact
    });
  });

  describe('Event Factory Payload generator', () => {
    const meta = {
      githubRepositoryId: 880001,
      name: 'repobutler-healthy',
      fullName: 'repobutler-sim-developer/repobutler-healthy',
      owner: 'repobutler-sim-developer',
    };

    it('generates a push event payload structure with custom commits', () => {
      const payload = EventFactory.push(meta, 'sim-tester', [
        { sha: 'sha_test_123', message: 'test: simulated push message' }
      ]);

      expect(payload.repository.id).toBe(880001);
      expect(payload.sender.login).toBe('sim-tester');
      expect(payload.commits[0].id).toBe('sha_test_123');
      expect(payload.commits[0].message).toBe('test: simulated push message');
    });

    it('generates a PR event payload structure', () => {
      const prOpened = EventFactory.pullRequest(meta, 'sim-tester', 'opened', {
        id: 9555,
        number: 4,
        title: 'feat: prototype simulator page UI',
      });

      expect(prOpened.action).toBe('opened');
      expect(prOpened.pull_request.id).toBe(9555);
      expect(prOpened.pull_request.number).toBe(4);
      expect(prOpened.pull_request.user.login).toBe('sim-tester');
    });
  });

  describe('Simulated Data Seeding and Resets', () => {
    it('seeds mock entities properly', async () => {
      const repos = await seedSimulatedData();
      expect(repos.length).toBe(6);
      expect(prisma.user.upsert).toHaveBeenCalled();
      expect(prisma.gitHubInstallation.upsert).toHaveBeenCalled();
      expect(prisma.repository.upsert).toHaveBeenCalledTimes(6);
    });

    it('wipes simulator entities safely without targeting real profiles', async () => {
      const res = await resetSimulationData();
      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(3); // 1 User + 1 Repo + 1 Brief (from mock queries)
      
      // Verify deletion criteria matches isSimulated
      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { isSimulated: true },
      });
      expect(prisma.repository.deleteMany).toHaveBeenCalledWith({
        where: { isSimulated: true },
      });
      expect(prisma.dailyBrief.deleteMany).toHaveBeenCalledWith({
        where: { isSimulated: true },
      });
    });
  });
});
