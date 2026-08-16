import prisma from '../db/prisma';

/**
 * Wipes all simulated accounts, repositories, activity records, snapshots, 
 * attention items, and generated daily briefings from the database.
 * 
 * Safety check: Only deletes records flagged with isSimulated = true.
 */
export async function resetSimulationData(): Promise<{ success: boolean; deletedCount: number }> {
  console.log('[Simulator Reset] Starting simulated database reset...');

  try {
    // 1. Fetch counts of what will be deleted for reporting
    const simUsers = await prisma.user.findMany({ where: { isSimulated: true } });
    const simRepos = await prisma.repository.findMany({ where: { isSimulated: true } });
    const simBriefs = await prisma.dailyBrief.findMany({ where: { isSimulated: true } });

    const totalCount = simUsers.length + simRepos.length + simBriefs.length;

    // 2. Perform deletions
    // Deleting User cascades to GitHubInstallation, which cascades to Repository, 
    // cascading further to Settings, Commits, PRs, Issues, WorkflowRuns, Releases, 
    // HealthSnapshots, ProjectMemories, and AttentionItems.
    if (simUsers.length > 0) {
      await prisma.user.deleteMany({
        where: { isSimulated: true },
      });
    }

    // Delete any repository that might not have been linked to a simulated user (backup safety)
    if (simRepos.length > 0) {
      await prisma.repository.deleteMany({
        where: { isSimulated: true },
      });
    }

    // Delete simulated daily briefs
    if (simBriefs.length > 0) {
      await prisma.dailyBrief.deleteMany({
        where: { isSimulated: true },
      });
    }

    console.log(`[Simulator Reset] Wiped ${totalCount} primary simulated entities successfully.`);
    return { success: true, deletedCount: totalCount };
  } catch (error) {
    console.error('[Simulator Reset] Error wiping simulation database records:', error);
    throw error;
  }
}
