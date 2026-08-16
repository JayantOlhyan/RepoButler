const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing database...');
  await prisma.dailyBriefItem.deleteMany();
  await prisma.dailyBrief.deleteMany();
  await prisma.attentionItem.deleteMany();
  await prisma.healthSnapshot.deleteMany();
  await prisma.projectMemory.deleteMany();
  await prisma.commit.deleteMany();
  await prisma.pullRequest.deleteMany();
  await prisma.issue.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.release.deleteMany();
  await prisma.activityEvent.deleteMany();
  await prisma.repositorySettings.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.gitHubInstallation.deleteMany();
  await prisma.user.deleteMany();

  console.log('Seeding user...');
  const user = await prisma.user.create({
    data: {
      githubUserId: 999999, // Specific ID for demo/mock mode
      username: 'jayantolhyan',
      email: 'jayant@repobutler.dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/999999?v=4',
    },
  });

  console.log('Seeding GitHub installation...');
  const installation = await prisma.gitHubInstallation.create({
    data: {
      userId: user.id,
      githubInstallationId: 123456,
      accountLogin: 'jayantolhyan',
      accountType: 'User',
    },
  });

  const now = new Date('2026-08-16T14:55:00+05:30');
  const getPastDate = (daysAgo, hoursAgo = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(d.getHours() - hoursAgo);
    return d;
  };

  console.log('Seeding repositories...');

  // 1. Acme-Web (Healthy, but has a stale PR #84)
  const acmeWeb = await prisma.repository.create({
    data: {
      installationId: installation.id,
      githubRepositoryId: 101,
      owner: 'jayantolhyan',
      name: 'Acme-Web',
      fullName: 'jayantolhyan/Acme-Web',
      description: 'The core web interface for Acme services.',
      defaultBranch: 'main',
      isPrivate: false,
      isArchived: false,
      htmlUrl: 'https://github.com/jayantolhyan/Acme-Web',
      language: 'TypeScript',
      stars: 42,
      forks: 7,
      openIssuesCount: 3,
      githubUpdatedAt: getPastDate(1),
      lastSyncedAt: now,
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
          summary: 'A React and Next.js portal. Stable, undergoing minor feature enhancements.',
          currentFocus: 'Improving settings page and layout styling.',
          lastMeaningfulActivity: 'Merged PR #82 (OAuth configuration)',
          unfinishedWork: 'PR #84 awaiting review; 2 minor issues outstanding.',
        },
      },
    },
  });

  // 2. Healthkinator (Failing CI repeatedly, needs attention)
  const healthkinator = await prisma.repository.create({
    data: {
      installationId: installation.id,
      githubRepositoryId: 102,
      owner: 'jayantolhyan',
      name: 'Healthkinator',
      fullName: 'jayantolhyan/Healthkinator',
      description: 'System metrics and service health monitoring tool.',
      defaultBranch: 'main',
      isPrivate: false,
      isArchived: false,
      htmlUrl: 'https://github.com/jayantolhyan/Healthkinator',
      language: 'Go',
      stars: 12,
      forks: 2,
      openIssuesCount: 5,
      githubUpdatedAt: getPastDate(0, 2), // 2 hours ago
      lastSyncedAt: now,
      settings: {
        create: {
          monitoringEnabled: true,
          staleThresholdDays: 7,
          dailyBriefEnabled: true,
          healthEnabled: true,
        },
      },
      projectMemory: {
        create: {
          summary: 'Backend daemon written in Go to poll server health. Frequent deployments.',
          currentFocus: 'Fixing Docker build config and CI environment variables.',
          lastMeaningfulActivity: 'Release v1.2.0 published.',
          unfinishedWork: 'Broken production CI pipeline. 4 open issues.',
        },
      },
    },
  });

  // 3. OpenCampus (Stale, no activity for 18 days)
  const openCampus = await prisma.repository.create({
    data: {
      installationId: installation.id,
      githubRepositoryId: 103,
      owner: 'jayantolhyan',
      name: 'OpenCampus',
      fullName: 'jayantolhyan/OpenCampus',
      description: 'Open source university administration system.',
      defaultBranch: 'develop',
      isPrivate: true,
      isArchived: false,
      htmlUrl: 'https://github.com/jayantolhyan/OpenCampus',
      language: 'Python',
      stars: 108,
      forks: 34,
      openIssuesCount: 15,
      githubUpdatedAt: getPastDate(18), // 18 days ago
      lastSyncedAt: now,
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
          summary: 'Large Python/Django application for student scheduling and registry.',
          currentFocus: 'None. Project is currently stale/stable.',
          lastMeaningfulActivity: 'Institution configuration setup 18 days ago.',
          unfinishedWork: '15 open issues, 1 stale draft PR.',
        },
      },
    },
  });

  // 4. Example-API (Active, healthy)
  const exampleApi = await prisma.repository.create({
    data: {
      installationId: installation.id,
      githubRepositoryId: 104,
      owner: 'jayantolhyan',
      name: 'Example-API',
      fullName: 'jayantolhyan/Example-API',
      description: 'Public mock API server for developers.',
      defaultBranch: 'main',
      isPrivate: false,
      isArchived: false,
      htmlUrl: 'https://github.com/jayantolhyan/Example-API',
      language: 'JavaScript',
      stars: 5,
      forks: 0,
      openIssuesCount: 0,
      githubUpdatedAt: getPastDate(0, 1), // 1 hour ago
      lastSyncedAt: now,
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
          summary: 'Fastify-based JSON server for developer sandboxing.',
          currentFocus: 'Adding support for dynamic query pagination.',
          lastMeaningfulActivity: 'Added new routes for auth mock simulations.',
          unfinishedWork: 'All caught up.',
        },
      },
    },
  });

  console.log('Seeding commits...');
  // Commits for Acme-Web (Active)
  await prisma.commit.createMany({
    data: [
      { repositoryId: acmeWeb.id, sha: 'sha1a', authorLogin: 'jayantolhyan', message: 'Update navigation panel and settings styling', occurredAt: getPastDate(1) },
      { repositoryId: acmeWeb.id, sha: 'sha1b', authorLogin: 'developer-b', message: 'Merge pull request #82 from branch-oauth', occurredAt: getPastDate(2) },
      { repositoryId: acmeWeb.id, sha: 'sha1c', authorLogin: 'jayantolhyan', message: 'Fix OAuth credential mapping key issues', occurredAt: getPastDate(2, 4) },
    ],
  });

  // Commits for Healthkinator (Failing CI)
  await prisma.commit.createMany({
    data: [
      { repositoryId: healthkinator.id, sha: 'sha2a', authorLogin: 'jayantolhyan', message: 'Attempt to fix alpine package dependencies in Dockerfile', occurredAt: getPastDate(0, 2) },
      { repositoryId: healthkinator.id, sha: 'sha2b', authorLogin: 'jayantolhyan', message: 'Fix database connection pooling config', occurredAt: getPastDate(0, 3) },
      { repositoryId: healthkinator.id, sha: 'sha2c', authorLogin: 'developer-c', message: 'Update metrics export schema', occurredAt: getPastDate(1) },
    ],
  });

  // Commits for OpenCampus (Inactive)
  await prisma.commit.createMany({
    data: [
      { repositoryId: openCampus.id, sha: 'sha3a', authorLogin: 'jayantolhyan', message: 'Configure institution schedules database tables', occurredAt: getPastDate(18) },
      { repositoryId: openCampus.id, sha: 'sha3b', authorLogin: 'developer-d', message: 'Fix registration validation rules', occurredAt: getPastDate(20) },
    ],
  });

  // Commits for Example-API (Healthy)
  await prisma.commit.createMany({
    data: [
      { repositoryId: exampleApi.id, sha: 'sha4a', authorLogin: 'jayantolhyan', message: 'Implement mock route pagination rules', occurredAt: getPastDate(0, 1) },
      { repositoryId: exampleApi.id, sha: 'sha4b', authorLogin: 'jayantolhyan', message: 'Update README endpoint documentation', occurredAt: getPastDate(0, 4) },
    ],
  });

  console.log('Seeding Pull Requests...');
  // Acme-Web PRs
  const pr84 = await prisma.pullRequest.create({
    data: {
      repositoryId: acmeWeb.id,
      githubPrId: 201,
      number: 84,
      title: 'Implement dynamic layout container queries',
      authorLogin: 'developer-b',
      state: 'OPEN',
      draft: false,
      createdAt: getPastDate(4),
      updatedAt: getPastDate(4),
      lastActivityAt: getPastDate(4),
    },
  });

  await prisma.pullRequest.create({
    data: {
      repositoryId: acmeWeb.id,
      githubPrId: 202,
      number: 82,
      title: 'OAuth authorization setup for client portals',
      authorLogin: 'jayantolhyan',
      state: 'MERGED',
      draft: false,
      createdAt: getPastDate(5),
      updatedAt: getPastDate(2),
      mergedAt: getPastDate(2),
      closedAt: getPastDate(2),
      lastActivityAt: getPastDate(2),
    },
  });

  // Healthkinator PRs
  await prisma.pullRequest.create({
    data: {
      repositoryId: healthkinator.id,
      githubPrId: 203,
      number: 14,
      title: 'Optimize Go garbage collection thresholds',
      authorLogin: 'developer-c',
      state: 'OPEN',
      draft: false,
      createdAt: getPastDate(1),
      updatedAt: getPastDate(0, 2),
      lastActivityAt: getPastDate(0, 2),
    },
  });

  // OpenCampus PRs
  await prisma.pullRequest.create({
    data: {
      repositoryId: openCampus.id,
      githubPrId: 204,
      number: 91,
      title: 'Refactor registry controller templates',
      authorLogin: 'developer-d',
      state: 'OPEN',
      draft: true,
      createdAt: getPastDate(25),
      updatedAt: getPastDate(20),
      lastActivityAt: getPastDate(20),
    },
  });

  console.log('Seeding Issues...');
  // Healthkinator Issues
  await prisma.issue.create({
    data: {
      repositoryId: healthkinator.id,
      githubIssueId: 301,
      number: 45,
      title: 'Production database connections leaking under load',
      state: 'OPEN',
      authorLogin: 'jayantolhyan',
      createdAt: getPastDate(3),
      updatedAt: getPastDate(1),
      lastActivityAt: getPastDate(1),
    },
  });

  // OpenCampus Issues
  await prisma.issue.create({
    data: {
      repositoryId: openCampus.id,
      githubIssueId: 302,
      number: 112,
      title: 'Student portal timetable crash on mobile Safari',
      state: 'OPEN',
      authorLogin: 'student-tester',
      createdAt: getPastDate(19),
      updatedAt: getPastDate(18),
      lastActivityAt: getPastDate(18),
    },
  });

  console.log('Seeding Workflow Runs...');
  // Healthkinator failing CI
  await prisma.workflowRun.createMany({
    data: [
      {
        repositoryId: healthkinator.id,
        githubWorkflowRunId: 401,
        name: 'production',
        status: 'completed',
        conclusion: 'failure',
        branch: 'main',
        createdAt: getPastDate(0, 2),
        updatedAt: getPastDate(0, 2),
        completedAt: getPastDate(0, 2),
      },
      {
        repositoryId: healthkinator.id,
        githubWorkflowRunId: 402,
        name: 'production',
        status: 'completed',
        conclusion: 'failure',
        branch: 'main',
        createdAt: getPastDate(0, 3),
        updatedAt: getPastDate(0, 3),
        completedAt: getPastDate(0, 3),
      },
      {
        repositoryId: healthkinator.id,
        githubWorkflowRunId: 403,
        name: 'production',
        status: 'completed',
        conclusion: 'failure',
        branch: 'main',
        createdAt: getPastDate(0, 5),
        updatedAt: getPastDate(0, 5),
        completedAt: getPastDate(0, 5),
      },
      {
        repositoryId: healthkinator.id,
        githubWorkflowRunId: 404,
        name: 'production',
        status: 'completed',
        conclusion: 'success',
        branch: 'main',
        createdAt: getPastDate(1),
        updatedAt: getPastDate(1),
        completedAt: getPastDate(1),
      },
    ],
  });

  // Acme-Web passing CI
  await prisma.workflowRun.createMany({
    data: [
      {
        repositoryId: acmeWeb.id,
        githubWorkflowRunId: 405,
        name: 'lint-and-test',
        status: 'completed',
        conclusion: 'success',
        branch: 'main',
        createdAt: getPastDate(1),
        updatedAt: getPastDate(1),
        completedAt: getPastDate(1),
      },
    ],
  });

  console.log('Seeding Releases...');
  await prisma.release.create({
    data: {
      repositoryId: healthkinator.id,
      githubReleaseId: 501,
      tagName: 'v1.2.0',
      name: 'Release v1.2.0 - Core updates',
      publishedAt: getPastDate(1),
    },
  });

  console.log('Seeding Health Snapshots...');
  await prisma.healthSnapshot.create({
    data: {
      repositoryId: acmeWeb.id,
      score: 85,
      ciScore: 100,
      activityScore: 90,
      issueScore: 80,
      prScore: 70,
      maintenanceScore: 85,
      documentationScore: 90,
      calculatedAt: now,
    },
  });

  await prisma.healthSnapshot.create({
    data: {
      repositoryId: healthkinator.id,
      score: 45,
      ciScore: 10,
      activityScore: 80,
      issueScore: 60,
      prScore: 65,
      maintenanceScore: 50,
      documentationScore: 70,
      calculatedAt: now,
    },
  });

  await prisma.healthSnapshot.create({
    data: {
      repositoryId: openCampus.id,
      score: 58,
      ciScore: 80,
      activityScore: 10,
      issueScore: 50,
      prScore: 60,
      maintenanceScore: 65,
      documentationScore: 85,
      calculatedAt: now,
    },
  });

  await prisma.healthSnapshot.create({
    data: {
      repositoryId: exampleApi.id,
      score: 95,
      ciScore: 100,
      activityScore: 95,
      issueScore: 100,
      prScore: 100,
      maintenanceScore: 90,
      documentationScore: 85,
      calculatedAt: now,
    },
  });

  console.log('Seeding Attention Items...');
  // Stale PR awaiting review (Acme-Web)
  const att1 = await prisma.attentionItem.create({
    data: {
      repositoryId: acmeWeb.id,
      type: 'PR_AWAITING_REVIEW',
      severity: 'HIGH',
      title: 'PR #84 awaiting review',
      description: 'PR #84 dynamic layout container queries has been waiting for your review for 4 days.',
      evidence: 'PR opened on 2026-08-12 with requested reviewer.',
      recommendedAction: 'Review PR #84.',
      status: 'OPEN',
      createdAt: getPastDate(4),
    },
  });

  // Repeated CI failure (Healthkinator)
  const att2 = await prisma.attentionItem.create({
    data: {
      repositoryId: healthkinator.id,
      type: 'REPEATED_CI_FAILURE',
      severity: 'CRITICAL',
      title: 'Production CI failing repeatedly',
      description: 'Workflow "production" has failed 3 times within the last few hours on Healthkinator.',
      evidence: '3 failures logged between 10:00 and 13:00 today.',
      recommendedAction: 'Investigate deployment failure.',
      status: 'OPEN',
      createdAt: getPastDate(0, 2),
    },
  });

  // Stale Repository (OpenCampus)
  const att3 = await prisma.attentionItem.create({
    data: {
      repositoryId: openCampus.id,
      type: 'STALE_REPO',
      severity: 'MEDIUM',
      title: 'Project losing momentum',
      description: 'No meaningful activity detected on OpenCampus for 18 days.',
      evidence: 'Last commit was on 2026-07-29 ("Configure institution schedules database tables").',
      recommendedAction: 'Review the remaining configuration issues.',
      status: 'OPEN',
      createdAt: getPastDate(18),
    },
  });

  console.log('Seeding Daily Briefs...');
  const brief = await prisma.dailyBrief.create({
    data: {
      userId: user.id,
      date: new Date('2026-08-16T00:00:00.000Z'),
      summary: 'Today, 9 repositories changed. 3 repositories need your attention. Healthkinator CI failed twice, Acme-Web has a PR waiting for review, and OpenCampus has been inactive for 18 days.',
      attentionCount: 3,
      repositoriesChanged: 4,
      generatedAt: now,
    },
  });

  await prisma.dailyBriefItem.createMany({
    data: [
      {
        dailyBriefId: brief.id,
        repositoryId: healthkinator.id,
        attentionItemId: att2.id,
        rank: 1,
        reason: 'Critical: Continuous integration build failure blocks production deployment.',
      },
      {
        dailyBriefId: brief.id,
        repositoryId: acmeWeb.id,
        attentionItemId: att1.id,
        rank: 2,
        reason: 'High: Stale pull request #84 is pending your response.',
      },
      {
        dailyBriefId: brief.id,
        repositoryId: openCampus.id,
        attentionItemId: att3.id,
        rank: 3,
        reason: 'Medium: Development has stalled for 18 days.',
      },
    ],
  });

  console.log('Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
