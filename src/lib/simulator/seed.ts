import prisma from '../db/prisma';

export async function seedSimulatedData() {
  console.log('[Simulator Seed] Starting simulated database seed...');

  // 1. Create simulated user
  const user = await prisma.user.upsert({
    where: { githubUserId: 888888 },
    update: {
      username: 'repobutler-sim-developer',
      email: 'sim-developer@repobutler.dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/999999?v=4',
      isSimulated: true,
    },
    create: {
      githubUserId: 888888,
      username: 'repobutler-sim-developer',
      email: 'sim-developer@repobutler.dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/999999?v=4',
      isSimulated: true,
    },
  });

  // 2. Create simulated App Installation
  const installation = await prisma.gitHubInstallation.upsert({
    where: { githubInstallationId: 888888 },
    update: {
      userId: user.id,
      accountLogin: 'repobutler-sim-developer',
      accountType: 'User',
    },
    create: {
      githubInstallationId: 888888,
      userId: user.id,
      accountLogin: 'repobutler-sim-developer',
      accountType: 'User',
    },
  });

  const reposToSeed = [
    { id: '880001', name: 'repobutler-healthy', desc: 'Mock healthy repository' },
    { id: '880002', name: 'repobutler-active', desc: 'Mock active repository' },
    { id: '880003', name: 'repobutler-stale', desc: 'Mock stale repository' },
    { id: '880004', name: 'repobutler-ci-failing', desc: 'Mock CI failing repository' },
    { id: '880005', name: 'repobutler-busy', desc: 'Mock busy development day repository' },
    { id: '880006', name: 'repobutler-needs-attention', desc: 'Mock bad repository' },
  ];

  const seededRepos = [];

  // 3. Seed simulated repositories
  for (const item of reposToSeed) {
    const repoId = parseInt(item.id, 10);
    const repo = await prisma.repository.upsert({
      where: { githubRepositoryId: repoId },
      update: {
        owner: 'repobutler-sim-developer',
        name: item.name,
        fullName: `repobutler-sim-developer/${item.name}`,
        description: `${item.desc} (Simulated)`,
        defaultBranch: 'main',
        isPrivate: false,
        isArchived: false,
        htmlUrl: `https://github.com/repobutler-sim-developer/${item.name}`,
        githubUpdatedAt: new Date(),
        isSimulated: true,
      },
      create: {
        installationId: installation.id,
        githubRepositoryId: repoId,
        owner: 'repobutler-sim-developer',
        name: item.name,
        fullName: `repobutler-sim-developer/${item.name}`,
        description: `${item.desc} (Simulated)`,
        defaultBranch: 'main',
        isPrivate: false,
        isArchived: false,
        htmlUrl: `https://github.com/repobutler-sim-developer/${item.name}`,
        githubUpdatedAt: new Date(),
        isSimulated: true,
      },
    });

    // Create repository settings if missing
    await prisma.repositorySettings.upsert({
      where: { repositoryId: repo.id },
      update: {
        monitoringEnabled: true,
        staleThresholdDays: 14,
        dailyBriefEnabled: true,
        healthEnabled: true,
      },
      create: {
        repositoryId: repo.id,
        monitoringEnabled: true,
        staleThresholdDays: 14,
        dailyBriefEnabled: true,
        healthEnabled: true,
      },
    });

    seededRepos.push(repo);
  }

  console.log(`[Simulator Seed] Successfully seeded ${seededRepos.length} simulated repositories.`);
  return seededRepos;
}
