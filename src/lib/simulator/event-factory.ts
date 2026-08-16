import { Clock } from '../utils/clock';

export interface SimulatedRepositoryMeta {
  githubRepositoryId: number;
  name: string;
  fullName: string;
  owner: string;
}

/**
 * Helper to build standard webhook payload metadata.
 */
function buildBasePayload(repo: SimulatedRepositoryMeta, actor: string) {
  return {
    repository: {
      id: repo.githubRepositoryId,
      name: repo.name,
      full_name: repo.fullName,
      owner: { login: repo.owner },
    },
    sender: {
      login: actor,
    },
  };
}

export const EventFactory = {
  push(repo: SimulatedRepositoryMeta, actor: string, commits: { sha: string; message: string; timestamp?: Date }[]) {
    const base = buildBasePayload(repo, actor);
    return {
      ...base,
      commits: commits.map(c => ({
        id: c.sha,
        message: c.message,
        author: { username: actor, name: actor },
        timestamp: (c.timestamp || Clock.now()).toISOString(),
      })),
    };
  },

  pullRequest(
    repo: SimulatedRepositoryMeta,
    actor: string,
    action: 'opened' | 'closed' | 'reopened' | 'synchronize',
    pr: {
      id: number;
      number: number;
      title: string;
      draft?: boolean;
      isMerged?: boolean;
      createdAt?: Date;
      updatedAt?: Date;
    }
  ) {
    const base = buildBasePayload(repo, actor);
    const now = Clock.now();
    const created = pr.createdAt || now;
    const updated = pr.updatedAt || now;
    
    let state = 'open';
    let mergedAt = null;
    let closedAt = null;

    if (action === 'closed') {
      state = 'closed';
      closedAt = updated.toISOString();
      if (pr.isMerged) {
        mergedAt = updated.toISOString();
      }
    }

    return {
      ...base,
      action,
      pull_request: {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state,
        draft: pr.draft || false,
        user: { login: actor },
        created_at: created.toISOString(),
        updated_at: updated.toISOString(),
        merged_at: mergedAt,
        closed_at: closedAt,
      },
    };
  },

  issues(
    repo: SimulatedRepositoryMeta,
    actor: string,
    action: 'opened' | 'closed' | 'edited',
    issue: {
      id: number;
      number: number;
      title: string;
      createdAt?: Date;
      updatedAt?: Date;
    }
  ) {
    const base = buildBasePayload(repo, actor);
    const now = Clock.now();
    const created = issue.createdAt || now;
    const updated = issue.updatedAt || now;
    
    let state = 'open';
    let closedAt = null;

    if (action === 'closed') {
      state = 'closed';
      closedAt = updated.toISOString();
    }

    return {
      ...base,
      action,
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state,
        user: { login: actor },
        created_at: created.toISOString(),
        updated_at: updated.toISOString(),
        closed_at: closedAt,
      },
    };
  },

  issueComment(repo: SimulatedRepositoryMeta, actor: string, issueNumber: number, isPr: boolean, timestamp?: Date) {
    const base = buildBasePayload(repo, actor);
    const timeStr = (timestamp || Clock.now()).toISOString();
    return {
      ...base,
      issue: {
        number: issueNumber,
        pull_request: isPr ? {} : null,
      },
      comment: {
        created_at: timeStr,
        updated_at: timeStr,
      },
    };
  },

  workflowRun(
    repo: SimulatedRepositoryMeta,
    actor: string,
    run: {
      id: number;
      name: string;
      conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
      branch?: string;
      createdAt?: Date;
    }
  ) {
    const base = buildBasePayload(repo, actor);
    const timeStr = (run.createdAt || Clock.now()).toISOString();
    return {
      ...base,
      workflow_run: {
        id: run.id,
        name: run.name,
        status: 'completed',
        conclusion: run.conclusion,
        head_branch: run.branch || 'main',
        created_at: timeStr,
        updated_at: timeStr,
        run_started_at: timeStr,
      },
    };
  },

  release(
    repo: SimulatedRepositoryMeta,
    actor: string,
    rel: {
      id: number;
      tagName: string;
      name: string;
      publishedAt?: Date;
    }
  ) {
    const base = buildBasePayload(repo, actor);
    const timeStr = (rel.publishedAt || Clock.now()).toISOString();
    return {
      ...base,
      release: {
        id: rel.id,
        tag_name: rel.tagName,
        name: rel.name,
        published_at: timeStr,
      },
    };
  },
};
