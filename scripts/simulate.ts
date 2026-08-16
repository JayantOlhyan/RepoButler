import { seedSimulatedData } from '../src/lib/simulator/seed';
import { resetSimulationData } from '../src/lib/simulator/reset';
import { runScenario } from '../src/lib/simulator/scenario-runner';
import prisma from '../src/lib/db/prisma';
import { generateDailyBriefSummary } from '../src/lib/ai/provider';
import { Clock } from '../src/lib/utils/clock';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(`
RepoButler Simulator CLI
Usage:
  npx ts-node scripts/simulate.ts seed               Seed simulated repositories
  npx ts-node scripts/simulate.ts reset              Wipe simulated database records
  npx ts-node scripts/simulate.ts simulate <name>    Run scenario (e.g. healthy-repository, ci-failure, repeated-ci-failure, stale-pr, stale-repository, busy-day, bad-repository)
  npx ts-node scripts/simulate.ts brief              Trigger simulated daily brief generation
    `);
    process.exit(0);
  }

  try {
    if (command === 'seed') {
      await seedSimulatedData();
      console.log('Seed completed successfully!');
    } else if (command === 'reset') {
      const res = await resetSimulationData();
      console.log(`Reset completed. Deleted ${res.deletedCount} items.`);
    } else if (command === 'simulate') {
      const scenarioName = args[1];
      if (!scenarioName) {
        console.error('Please specify a scenario name.');
        process.exit(1);
      }
      const res = await runScenario(scenarioName);
      console.log('Scenario executed successfully!');
      console.log(JSON.stringify(res, null, 2));
    } else if (command === 'brief') {
      // Find simulated user
      const user = await prisma.user.findFirst({
        where: { githubUserId: 888888, isSimulated: true },
      });

      if (!user) {
        console.error('Simulated user not found. Run seed first.');
        process.exit(1);
      }

      const today = Clock.now();
      today.setHours(0, 0, 0, 0);

      // Fetch simulated user repos
      const repositories = await prisma.repository.findMany({
        where: {
          owner: 'repobutler-sim-developer',
          isArchived: false,
          isSimulated: true,
          settings: { monitoringEnabled: true },
        },
        include: {
          attentionItems: { where: { status: 'OPEN' } },
          commits: { where: { occurredAt: { gte: today } } },
          pullRequests: { where: { updatedAt: { gte: today } } },
          issues: { where: { updatedAt: { gte: today } } },
        },
      });

      if (repositories.length === 0) {
        console.error('No monitored simulated repositories. Seed first.');
        process.exit(1);
      }

      // Collect attention items
      const attentionItems = repositories.flatMap(r => 
        r.attentionItems.map(item => ({
          ...item,
          repoName: r.name,
        }))
      ).sort((a, b) => {
        const severityMap: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return (severityMap[b.severity] || 0) - (severityMap[a.severity] || 0);
      });

      const reposChangedCount = repositories.filter(r => 
        r.commits.length > 0 || r.pullRequests.length > 0 || r.issues.length > 0
      ).length;

      // Generate summary
      const summary = await generateDailyBriefSummary({
        userName: user.username,
        repositoriesChanged: reposChangedCount,
        attentionItems: attentionItems.map(item => ({
          repoName: item.repoName,
          type: item.type,
          severity: item.severity,
          title: item.title,
          description: item.description,
        })),
      });

      // Create Daily Brief in Database
      const brief = await prisma.dailyBrief.upsert({
        where: {
          userId_date: {
            userId: user.id,
            date: today,
          },
        },
        update: {
          summary,
          attentionCount: attentionItems.length,
          repositoriesChanged: reposChangedCount,
          generatedAt: Clock.now(),
          isSimulated: true,
        },
        create: {
          userId: user.id,
          date: today,
          summary,
          attentionCount: attentionItems.length,
          repositoriesChanged: reposChangedCount,
          generatedAt: Clock.now(),
          isSimulated: true,
        },
      });

      console.log('Daily Brief generated successfully!');
      console.log(`Summary: ${summary}`);
      console.log(`Items count: ${brief.attentionCount}`);
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Execution failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
