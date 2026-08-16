import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import prisma from '@/lib/db/prisma';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  GitPullRequest,
  AlertCircle,
  FileText,
  Activity,
  Archive,
  BarChart3,
  Calendar,
  Layers,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface PageProps {
  searchParams: Promise<{ demo?: string }>;
}

export default async function Dashboard(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await getServerSession(authOptions);
  
  const isDemo = searchParams.demo === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  if (!session && !isDemo) {
    redirect('/');
  }

  // Determine user to query
  let dbUser = null;
  if (isDemo) {
    // Seed user is jayantolhyan
    dbUser = await prisma.user.findUnique({
      where: { githubUserId: 999999 },
    });
  } else if (session?.user) {
    const githubUserId = parseInt((session.user as any).id || '', 10);
    dbUser = await prisma.user.findUnique({
      where: { githubUserId: isNaN(githubUserId) ? -1 : githubUserId },
    });
    // Fallback search by username/email
    if (!dbUser) {
      dbUser = await prisma.user.findFirst({
        where: { username: (session.user as any).username || session.user.name || '' },
      });
    }
  }

  if (!dbUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 text-center">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-white">User Session Syncing</h2>
        <p className="mt-2 text-sm text-zinc-500">We are completing your profile sync. Please reload in a few moments.</p>
        <Link href="/" className="mt-4 text-sm font-semibold text-zinc-900 underline dark:text-white">Return Home</Link>
      </div>
    );
  }

  // Fetch installations and repositories
  const installations = await prisma.gitHubInstallation.findMany({
    where: { userId: dbUser.id },
  });

  const installationIds = installations.map(i => i.id);

  const repositories = await prisma.repository.findMany({
    where: { installationId: { in: installationIds } },
    include: {
      settings: true,
      attentionItems: {
        where: { status: 'OPEN' },
      },
      healthSnapshots: {
        orderBy: { calculatedAt: 'desc' },
        take: 1,
      },
    },
  });

  // Calculate greetings based on time
  const hour = new Date().getHours();
  let greeting = 'Good morning';
  if (hour >= 12 && hour < 17) {
    greeting = 'Good afternoon';
  } else if (hour >= 17) {
    greeting = 'Good evening';
  }

  const name = dbUser.username || session?.user?.name || 'Developer';

  // --- Aggregate Attention Queue ---
  // Merge all open attention items from monitored, non-archived repos
  const attentionItems = repositories
    .filter(r => r.settings?.monitoringEnabled && !r.isArchived)
    .flatMap(r => r.attentionItems.map(item => ({
      ...item,
      repoName: r.name,
      repoFullName: r.fullName,
      repoId: r.id,
      htmlUrl: r.htmlUrl,
    })))
    .sort((a, b) => {
      // Sort priority: CRITICAL > HIGH > MEDIUM > LOW
      const severityMap: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      return (severityMap[b.severity] || 0) - (severityMap[a.severity] || 0);
    });

  // --- Aggregate Repositories Statuses ---
  let activeCount = 0;
  let stableCount = 0;
  let attentionCount = 0;
  let inactiveCount = 0;

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  for (const repo of repositories) {
    if (repo.isArchived || !repo.settings?.monitoringEnabled) continue;

    const hasAttention = repo.attentionItems.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
    const isStale = repo.attentionItems.some(i => i.type === 'STALE_REPO');

    if (hasAttention) {
      attentionCount++;
    } else if (isStale) {
      inactiveCount++;
    } else {
      // Check if it has recent updates to distinguish active vs stable
      const isRecentlyUpdated = new Date(repo.githubUpdatedAt) > fourteenDaysAgo;
      if (isRecentlyUpdated) {
        activeCount++;
      } else {
        stableCount++;
      }
    }
  }

  // --- Fetch Daily Brief ---
  // Fetch latest generated daily brief
  const latestBrief = await prisma.dailyBrief.findFirst({
    where: { userId: dbUser.id },
    orderBy: { date: 'desc' },
    include: {
      items: {
        include: {
          repository: true,
          attentionItem: true,
        },
      },
    },
  });

  // --- Weekly Momentum Stats ---
  // In a full implementation, we run database aggregates. For MVP, we calculate or mock:
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const commitsCount = await prisma.commit.count({
    where: { repositoryId: { in: repositories.map(r => r.id) }, occurredAt: { gte: oneWeekAgo } },
  });
  
  const prsMergedCount = await prisma.pullRequest.count({
    where: { repositoryId: { in: repositories.map(r => r.id) }, state: 'MERGED', mergedAt: { gte: oneWeekAgo } },
  });

  const issuesResolvedCount = await prisma.issue.count({
    where: { repositoryId: { in: repositories.map(r => r.id) }, state: 'CLOSED', closedAt: { gte: oneWeekAgo } },
  });

  const releasesCount = await prisma.release.count({
    where: { repositoryId: { in: repositories.map(r => r.id) }, publishedAt: { gte: oneWeekAgo } },
  });

  const demoQuery = isDemo ? '?demo=true' : '';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-10">
      
      {/* Welcome Banner */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
          {greeting}, {name}.
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {attentionItems.length === 0 
            ? "You're all clear. Nothing currently requires your attention."
            : `You have ${attentionItems.length} thing${attentionItems.length > 1 ? 's' : ''} worth your attention.`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left 2 Columns: Attention Queue & Today's Brief */}
        <div className="lg:col-span-2 space-y-10">
          
          {/* Section 1: Attention Queue */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-zinc-500" />
              You should look at these
            </h2>
            
            {attentionItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
                <CheckCircle className="mx-auto h-8 w-8 text-green-500" />
                <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-white">No attention items</p>
                <p className="text-xs text-zinc-500">Your monitored repositories are in stable health.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {attentionItems.map((item) => {
                  let severityColor = 'bg-zinc-400 text-zinc-950';
                  let borderHighlight = 'border-l-4 border-l-zinc-300';
                  
                  if (item.severity === 'CRITICAL') {
                    severityColor = 'bg-red-500 text-white';
                    borderHighlight = 'border-l-4 border-l-red-500';
                  } else if (item.severity === 'HIGH') {
                    severityColor = 'bg-amber-500 text-zinc-950';
                    borderHighlight = 'border-l-4 border-l-amber-500';
                  } else if (item.severity === 'MEDIUM') {
                    severityColor = 'bg-yellow-500 text-zinc-950';
                    borderHighlight = 'border-l-4 border-l-yellow-400';
                  }

                  const prNumber = item.uniqueKey?.startsWith('PR_') ? item.uniqueKey.split('_')[1] : null;
                  const issueNumber = item.uniqueKey?.startsWith('ISSUE_') ? item.uniqueKey.split('_')[1] : null;
                  
                  // Construct direct github links
                  let actionUrl = item.htmlUrl;
                  if (prNumber) actionUrl = `${item.htmlUrl}/pull/${prNumber}`;
                  else if (issueNumber) actionUrl = `${item.htmlUrl}/issues/${issueNumber}`;
                  else if (item.uniqueKey?.startsWith('WORKFLOW_')) actionUrl = `${item.htmlUrl}/actions`;

                  return (
                    <div
                      key={item.id}
                      className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-5 bg-white border border-zinc-200/80 rounded-xl shadow-sm ${borderHighlight} dark:bg-zinc-900 dark:border-zinc-800/80`}
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${severityColor}`}>
                            {item.severity}
                          </span>
                          <Link 
                            href={`/repositories/${item.repoId}${demoQuery}`}
                            className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-white"
                          >
                            {item.repoName}
                          </Link>
                        </div>
                        <h3 className="font-bold text-zinc-950 dark:text-white text-base">
                          {item.title}
                        </h3>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xl leading-relaxed">
                          {item.description}
                        </p>
                        <p className="text-xs text-zinc-500 font-mono">
                          Evidence: {item.evidence}
                        </p>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 pt-2 sm:pt-0 shrink-0">
                        <a
                          href={actionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                        >
                          {prNumber ? 'Review PR' : issueNumber ? 'View Issue' : item.type.includes('CI') ? 'Investigate' : 'View Repo'}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Section 2: Today's Brief */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Calendar className="h-5 w-5 text-zinc-500" />
              Daily Briefing
            </h2>
            
            {latestBrief ? (
              <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm space-y-4 dark:bg-zinc-900 dark:border-zinc-800">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    {new Date(latestBrief.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-md dark:bg-zinc-800 dark:text-zinc-400">
                    {latestBrief.repositoriesChanged} repositories changed
                  </span>
                </div>
                
                {latestBrief.summary ? (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed font-normal">
                    {latestBrief.summary}
                  </p>
                ) : (
                  <p className="text-sm text-zinc-500 italic">No summary generated.</p>
                )}

                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Ranked Priorities</h4>
                  <div className="space-y-3">
                    {latestBrief.items.sort((a, b) => a.rank - b.rank).map((briefItem) => (
                      <div key={briefItem.id} className="flex items-start gap-3 text-sm">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {briefItem.rank}
                        </span>
                        <div className="space-y-0.5">
                          <Link 
                            href={`/repositories/${briefItem.repositoryId}${demoQuery}`}
                            className="font-semibold text-zinc-900 hover:underline dark:text-white"
                          >
                            {briefItem.repository.name}
                          </Link>
                          <p className="text-xs text-zinc-500">{briefItem.reason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
                <FileText className="mx-auto h-8 w-8 text-zinc-400" />
                <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-white">No briefs generated yet</p>
                <p className="text-xs text-zinc-500">Briefs are built automatically every morning.</p>
              </div>
            )}
          </section>

        </div>

        {/* Right Column: Repository Status Overview & Momentum */}
        <div className="space-y-10">
          
          {/* Section 3: Repositories Status */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Layers className="h-5 w-5 text-zinc-500" />
              Repositories
            </h2>
            
            <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-50 p-4 rounded-lg text-center dark:bg-zinc-950">
                  <span className="block text-2xl font-black text-zinc-900 dark:text-white">{activeCount}</span>
                  <span className="text-xs font-semibold text-zinc-500">Active</span>
                </div>
                <div className="bg-zinc-50 p-4 rounded-lg text-center dark:bg-zinc-950">
                  <span className="block text-2xl font-black text-zinc-900 dark:text-white">{stableCount}</span>
                  <span className="text-xs font-semibold text-zinc-500">Stable</span>
                </div>
                <div className="bg-zinc-50 p-4 rounded-lg text-center dark:bg-zinc-950">
                  <span className={`block text-2xl font-black ${attentionCount > 0 ? 'text-amber-500' : 'text-zinc-900 dark:text-white'}`}>{attentionCount}</span>
                  <span className="text-xs font-semibold text-zinc-500">Attention</span>
                </div>
                <div className="bg-zinc-50 p-4 rounded-lg text-center dark:bg-zinc-950">
                  <span className={`block text-2xl font-black ${inactiveCount > 0 ? 'text-zinc-500' : 'text-zinc-900 dark:text-white'}`}>{inactiveCount}</span>
                  <span className="text-xs font-semibold text-zinc-500">Inactive</span>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-3 text-center dark:border-zinc-800">
                <Link
                  href={`/repositories${demoQuery}`}
                  className="text-xs font-bold text-zinc-900 hover:underline inline-flex items-center gap-1 dark:text-white"
                >
                  Manage all repositories
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </section>

          {/* Section 4: Momentum */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-zinc-500" />
              Developer Momentum
            </h2>

            <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4 dark:bg-zinc-900 dark:border-zinc-800">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Activity in the last 7 days</span>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 font-normal">Code commits</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{isDemo ? 23 : commitsCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 font-normal">PRs merged</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{isDemo ? 7 : prsMergedCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 font-normal">Issues resolved</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{isDemo ? 9 : issuesResolvedCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 font-normal">Release iterations</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{isDemo ? 2 : releasesCount}</span>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4 flex items-center gap-2 text-xs text-zinc-500 dark:border-zinc-800">
                <Sparkles className="h-4 w-4 text-zinc-400 shrink-0" />
                <span>RepoButler rewards real updates. Streak counters are deliberately excluded.</span>
              </div>
            </div>
          </section>

        </div>

      </div>

    </div>
  );
}
