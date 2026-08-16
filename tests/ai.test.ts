import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateDailyBriefSummary,
  explainHealthScore,
  getDeterministicDailyBriefSummary,
  getDeterministicHealthExplanation,
} from '../src/lib/ai/provider';

describe('AI Provider Integrations and Fallbacks', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER', 'none');
    vi.stubEnv('AI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  const mockSummaryReq = {
    userName: 'Jayant',
    repositoriesChanged: 4,
    attentionItems: [
      { repoName: 'Healthkinator', type: 'FAILED_CI', severity: 'CRITICAL', title: 'Production CI failing', description: 'Failed twice' },
      { repoName: 'Acme-Web', type: 'PR_AWAITING_REVIEW', severity: 'HIGH', title: 'PR #84 awaiting review', description: 'Pending review' }
    ]
  };

  const mockExplanationReq = {
    repoName: 'Healthkinator',
    healthScore: 45,
    ciScore: 10,
    prScore: 80,
    issueScore: 90,
    activityScore: 50,
    reasons: ['CI failed 3 times', 'Activity is low']
  };

  describe('Deterministic Templates', () => {
    it('generates a daily brief overview correctly', () => {
      const summary = getDeterministicDailyBriefSummary(mockSummaryReq);
      expect(summary).toContain('Good morning, Jayant');
      expect(summary).toContain('4 repositories changed');
      expect(summary).toContain('2 items requiring attention');
      expect(summary).toContain('Production CI failing on Healthkinator');
    });

    it('generates a health explanation correctly', () => {
      const explanation = getDeterministicHealthExplanation(mockExplanationReq);
      expect(explanation).toContain('Healthkinator has a health score of 45/100');
      expect(explanation).toContain('CI failed 3 times');
      expect(explanation).toContain('Activity is low');
    });
  });

  describe('API Fallback Handling', () => {
    it('falls back to templates if provider is set to none or keys are missing', async () => {
      const summary = await generateDailyBriefSummary(mockSummaryReq);
      expect(summary).toBe(getDeterministicDailyBriefSummary(mockSummaryReq));

      const explanation = await explainHealthScore(mockExplanationReq);
      expect(explanation).toBe(getDeterministicHealthExplanation(mockExplanationReq));
    });

    it('falls back to templates if fetch throws an error', async () => {
      // Configure AI provider as gemini but leave api key setup (which will trigger failure in fetch call)
      vi.stubEnv('AI_PROVIDER', 'gemini');
      vi.stubEnv('AI_API_KEY', 'dummy-key');

      // Mock global fetch to throw network error
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disconnected'));

      const summary = await generateDailyBriefSummary(mockSummaryReq);
      expect(summary).toBe(getDeterministicDailyBriefSummary(mockSummaryReq));
      expect(fetchMock).toHaveBeenCalled();

      fetchMock.mockRestore();
    });
  });
});
