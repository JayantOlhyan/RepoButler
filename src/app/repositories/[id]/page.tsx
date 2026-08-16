import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import prisma from '@/lib/db/prisma';
import { getLatestHealthSnapshot, HealthBreakdown } from '@/lib/health/calculator';
import { Clock as ClockUtil } from '@/lib/utils/clock';
import {
  ArrowLeft,
  Star,
  GitFork,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Clock,
  Sparkles,
  GitPullRequest,
  AlertCircle,
  Play,
  RotateCw,
} from 'lucide-react';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ demo?: string }>;
}

export default async function RepositoryDetail(props: PageProps) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const repoId = params.id;
  const session = await getServerSession(authOptions);
  
  const isDemo = searchParams.demo === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  if (!session && !isDemo) {
    redirect('/');
  }

  // Determine user to query
  let dbUser = null;
  if (isDemo) {
    dbUser = await prisma.user.findUnique({
      where: { githubUserId: 999999 },
    });
  } else if (session?.user) {
    const githubUserId = parseInt((session.user as any).id || '', 10);
    dbUser = await prisma.user.findUnique({
      where: { githubUserId: isNaN(githubUserId) ? -1 : githubUserId },
    });
    if (!dbUser) {
      dbUser = await prisma.user.findFirst({
        where: { username: (session.user as any).username || session.user.name || '' },
      });
    }
  }

  if (!dbUser) {
    redirect('/');
  }

  // Fetch repository with installation details to check authorization
  const repository = await prisma.repository.findUnique({
    where: { id: repoId },
    include: {
      installation: true,
      settings: true,
      projectMemory: true,
      attentionItems: {
        where: { status: 'OPEN' },
      },
    },
  });

  // SECURITY: Repository-level authorization check
  if (!repository) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Repository Not Found</h2>
        <p className="mt-2 text-sm text-zinc-500">The requested repository connection does not exist.</p>
        <Link href="/repositories" className="mt-4 text-sm font-semibold text-zinc-900 underline dark:text-white">Back to Repositories</Link>
      </div>
    );
  }

  if (repository.installation.userId !== dbUser.id) {
    // Return 403 Forbidden equivalent
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4 text-center space-y-4">
        <AlertTriangle className="h-12 w-12 text-red-500" />
        <h2 className="text-xl font-extrabold text-zinc-900 dark:text-white">Access Denied</h2>
        <p className="text-sm text-zinc-500 max-w-sm">
          Security policy blocks access to this repository. You are not authorized to view repositories belonging to this installation.
        </p>
        <Link href="/dashboard" className="text-sm font-semibold text-zinc-900 underline dark:text-white">Return to Dashboard</Link>
      </div>
    );
  }

  // Fetch latest health snapshot breakdown
  const latestSnapshot = await getLatestHealthSnapshot(repository.id);

  // --- Aggregate Recent Timeline Activity ---
  const commits = await prisma.commit.findMany({
    where: { repositoryId: repository.id },
    orderBy: { occurredAt: 'desc' },
    take: 10,
  });

  const prs = await prisma.pullRequest.findMany({
    where: { repositoryId: repository.id },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  const issues = await prisma.issue.findMany({
    where: { repositoryId: repository.id },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  const runs = await prisma.workflowRun.findMany({
    where: { repositoryId: repository.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const releases = await prisma.release.findMany({
    where: { repositoryId: repository.id },
    orderBy: { publishedAt: 'desc' },
    take: 5,
  });

  // Combine items into a chronological list
  interface TimelineEvent {
    id: string;
    type: 'COMMIT' | 'PR' | 'ISSUE' | 'WORKFLOW' | 'RELEASE';
    title: string;
    subtitle: string;
    timestamp: Date;
    actor: string;
    badgeText?: string;
    badgeStyle?: string;
  }

  const timeline: TimelineEvent[] = [];

  commits.forEach(c => {
    timeline.push({
      id: `c-${c.id}`,
      type: 'COMMIT',
      title: `Commit pushed: "${c.message.split('\n')[0]}"`,
      subtitle: c.sha.substring(0, 7),
      timestamp: c.occurredAt,
      actor: c.authorLogin,
    });
  });

  prs.forEach(p => {
    let badgeStyle = 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
    if (p.state === 'OPEN') badgeStyle = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400';
    if (p.state === 'MERGED') badgeStyle = 'bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400';

    timeline.push({
      id: `p-${p.id}`,
      type: 'PR',
      title: `Pull Request #${p.number}: "${p.title}"`,
      subtitle: p.state,
      timestamp: p.updatedAt,
      actor: p.authorLogin,
      badgeText: p.state,
      badgeStyle,
    });
  });

  issues.forEach(i => {
    let badgeStyle = 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
    if (i.state === 'OPEN') badgeStyle = 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400';

    timeline.push({
      id: `i-${i.id}`,
      type: 'ISSUE',
      title: `Issue #${i.number}: "${i.title}"`,
      subtitle: i.state,
      timestamp: i.updatedAt,
      actor: i.authorLogin,
      badgeText: i.state,
      badgeStyle,
    });
  });

  runs.forEach(r => {
    let badgeStyle = 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
    if (r.conclusion === 'success') badgeStyle = 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400';
    if (r.conclusion === 'failure') badgeStyle = 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400';

    timeline.push({
      id: `r-${r.id}`,
      type: 'WORKFLOW',
      title: `Workflow "${r.name}" run complete`,
      subtitle: r.conclusion || 'unknown',
      timestamp: r.createdAt,
      actor: 'GitHub Actions',
      badgeText: r.conclusion || undefined,
      badgeStyle,
    });
  });

  releases.forEach(rel => {
    timeline.push({
      id: `rel-${rel.id}`,
      type: 'RELEASE',
      title: `Release published: ${rel.tagName}`,
      subtitle: rel.name || '',
      timestamp: rel.publishedAt,
      actor: repository.owner,
      badgeText: 'RELEASE',
      badgeStyle: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400',
    });
  });

  // Sort timeline descending
  timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  // Determine repository overall status
  const fourteenDaysAgo = ClockUtil.now();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  
  let repoStatus = 'Stable';
  const hasCriticalAttention = repository.attentionItems.some(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
  const hasStaleAttention = repository.attentionItems.some(i => i.type === 'STALE_REPO');

  if (hasCriticalAttention) {
    repoStatus = 'Needs Attention';
  } else if (hasStaleAttention) {
    repoStatus = 'Inactive';
  } else {
    const isRecentlyUpdated = new Date(repository.githubUpdatedAt) > fourteenDaysAgo;
    if (isRecentlyUpdated) {
      repoStatus = 'Active';
    }
  }

  const demoQuery = isDemo ? '?demo=true' : '';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      
      {/* Back navigation & Metadata */}
      <div className="space-y-4">
        <Link
          href={`/repositories${demoQuery}`}
          className="text-xs font-bold text-zinc-500 hover:text-zinc-900 inline-flex items-center gap-1 dark:hover:text-white"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
          Back to list
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
                {repository.name}
              </h1>
              <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                repoStatus === 'Active' 
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400' 
                  : repoStatus === 'Needs Attention' 
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' 
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
              }`}>
                {repoStatus}
              </span>
            </div>
            <p className="text-sm text-zinc-500 font-medium">
              {repository.fullName}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="flex items-center gap-1 text-xs font-semibold text-zinc-500">
              <Star className="h-4 w-4" />
              {repository.stars} stars
            </span>
            <span className="flex items-center gap-1 text-xs font-semibold text-zinc-500">
              <GitFork className="h-4 w-4" />
              {repository.forks} forks
            </span>
            <a
              href={repository.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              GitHub
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        {repository.description && (
          <p className="text-sm sm:text-base text-zinc-700 dark:text-zinc-300 font-normal leading-relaxed max-w-3xl">
            {repository.description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left 2 Columns: Attention, Health, Timeline */}
        <div className="lg:col-span-2 space-y-10">
          
          {/* Active Attention Items */}
          {repository.attentionItems.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-zinc-500" />
                What needs attention
              </h2>
              
              <div className="space-y-3">
                {repository.attentionItems.map((item) => {
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
                  
                  let actionUrl = repository.htmlUrl;
                  if (prNumber) actionUrl = `${repository.htmlUrl}/pull/${prNumber}`;
                  else if (issueNumber) actionUrl = `${repository.htmlUrl}/issues/${issueNumber}`;
                  else if (item.uniqueKey?.startsWith('WORKFLOW_')) actionUrl = `${repository.htmlUrl}/actions`;

                  return (
                    <div 
                      key={item.id}
                      className={`flex flex-col sm:flex-row sm:items-start justify-between gap-4 p-5 bg-white border border-zinc-200/80 rounded-xl shadow-sm ${borderHighlight} dark:bg-zinc-900 dark:border-zinc-800/80`}
                    >
                      <div className="space-y-2">
                        <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded ${severityColor}`}>
                          {item.severity}
                        </span>
                        <h3 className="font-bold text-zinc-950 dark:text-white text-base">
                          {item.title}
                        </h3>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          {item.description}
                        </p>
                        <p className="text-xs text-zinc-500 font-mono">
                          Evidence: {item.evidence}
                        </p>
                      </div>

                      <a
                        href={actionUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white shrink-0 mt-2 sm:mt-0"
                      >
                        {prNumber ? 'Review PR' : issueNumber ? 'View Issue' : item.type.includes('CI') ? 'Investigate' : 'View GitHub'}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Actionable Health Breakdown */}
          {latestSnapshot && (
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-zinc-500" />
                Actionable Health
              </h2>

              <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm space-y-6 dark:bg-zinc-900 dark:border-zinc-800">
                <div className="flex items-center gap-4 border-b border-zinc-100 pb-4 dark:border-zinc-800">
                  <div className={`h-16 w-16 rounded-xl flex items-center justify-center text-xl font-black shrink-0 ${
                    latestSnapshot.score >= 80 
                      ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
                      : latestSnapshot.score >= 50 
                        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' 
                        : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                  }`}>
                    {latestSnapshot.score}
                  </div>
                  <div>
                    <h3 className="font-extrabold text-zinc-950 dark:text-white text-base">Health Index Score</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">Calculated based on actual repository activity and builds</p>
                  </div>
                </div>

                {/* Reasons & Recommendations */}
                {latestSnapshot.reasons.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-50/50 p-4 rounded-lg border border-zinc-100 dark:bg-zinc-950/30 dark:border-zinc-800/40">
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Deduction Reasons</h4>
                      <ul className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1.5 list-disc list-inside">
                        {latestSnapshot.reasons.map((r, idx) => (
                          <li key={idx} className="leading-relaxed">{r}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Improve by</h4>
                      <ul className="text-xs text-zinc-800 dark:text-zinc-200 space-y-1.5 list-decimal list-inside font-medium">
                        {latestSnapshot.recommendations.map((rec, idx) => (
                          <li key={idx} className="leading-relaxed">{rec}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Score Grid Breakdown */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 pb-1.5 dark:border-zinc-800">Dimensions</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-1">
                    <div className="space-y-1">
                      <span className="text-xs text-zinc-500 font-semibold">CI Reliability</span>
                      <span className="block text-sm font-extrabold text-zinc-900 dark:text-white">{latestSnapshot.ciScore}%</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-zinc-500 font-semibold">PR Health</span>
                      <span className="block text-sm font-extrabold text-zinc-900 dark:text-white">{latestSnapshot.prScore}%</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-zinc-500 font-semibold">Issue Health</span>
                      <span className="block text-sm font-extrabold text-zinc-900 dark:text-white">{latestSnapshot.issueScore}%</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-zinc-500 font-semibold">Recent Activity</span>
                      <span className="block text-sm font-extrabold text-zinc-900 dark:text-white">{latestSnapshot.activityScore}%</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Chronological Timeline */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Clock className="h-5 w-5 text-zinc-500" />
              Recent Activity
            </h2>

            {timeline.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
                <p className="text-sm font-semibold text-zinc-900 dark:text-white">No recent activity</p>
                <p className="text-xs text-zinc-500 mt-1">No commits, workflow runs, or releases recorded in the last 30 days.</p>
              </div>
            ) : (
              <div className="bg-white border border-zinc-200 rounded-xl p-6 shadow-sm space-y-6 dark:bg-zinc-900 dark:border-zinc-800">
                <div className="flow-root">
                  <ul className="-mb-8">
                    {timeline.map((event, eventIdx) => (
                      <li key={event.id}>
                        <div className="relative pb-8">
                          {eventIdx !== timeline.length - 1 ? (
                            <span className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />
                          ) : null}
                          <div className="relative flex space-x-3">
                            <div>
                              <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white dark:ring-zinc-900 ${
                                event.type === 'COMMIT' 
                                  ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' 
                                  : event.type === 'RELEASE'
                                    ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400'
                                    : event.type === 'PR'
                                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
                                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800'
                              }`}>
                                <span className="text-[10px] font-extrabold">{event.type.charAt(0)}</span>
                              </span>
                            </div>
                            <div className="flex-1 min-w-0 pt-1.5 flex justify-between space-x-4">
                              <div>
                                <p className="text-sm text-zinc-900 font-semibold dark:text-white">
                                  {event.title}{' '}
                                  {event.badgeText && (
                                    <span className={`inline-flex items-center text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded-md ${event.badgeStyle}`}>
                                      {event.badgeText}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-zinc-500 mt-0.5">
                                  by @{event.actor} {event.subtitle && <span className="font-mono bg-zinc-50 dark:bg-zinc-950 px-1 rounded">({event.subtitle})</span>}
                                </p>
                              </div>
                              <div className="text-right text-xs whitespace-nowrap text-zinc-500">
                                <time dateTime={event.timestamp.toISOString()}>
                                  {event.timestamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </time>
                              </div>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

        </div>

        {/* Right Column: Project Memory & Actions */}
        <div className="space-y-10">
          
          {/* Project Memory Card */}
          {repository.projectMemory && (
            <section className="space-y-4">
              <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-zinc-500" />
                Project Memory
              </h2>

              <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4 dark:bg-zinc-900 dark:border-zinc-800">
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Context Summary</span>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed font-normal">
                    {repository.projectMemory.summary || "No historical memory stored."}
                  </p>
                </div>

                <div className="space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Current Focus</span>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed font-semibold">
                    {repository.projectMemory.currentFocus || "None declared."}
                  </p>
                </div>

                {repository.projectMemory.lastMeaningfulActivity && (
                  <div className="space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Last Meaningful Activity</span>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {repository.projectMemory.lastMeaningfulActivity}
                    </p>
                  </div>
                )}

                {repository.projectMemory.unfinishedWork && (
                  <div className="space-y-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Unfinished Tasks</span>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {repository.projectMemory.unfinishedWork}
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Quick Actions (Manual Sync / Settings) */}
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <RotateCw className="h-5 w-5 text-zinc-500" />
              Repository Settings
            </h2>

            <div className="bg-white border border-zinc-200 rounded-xl p-5 shadow-sm space-y-4 dark:bg-zinc-900 dark:border-zinc-800">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Monitoring status</span>
                  <span className="font-bold text-zinc-900 dark:text-white">
                    {repository.settings?.monitoringEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">Stale Threshold</span>
                  <span className="font-bold text-zinc-900 dark:text-white">
                    {repository.settings?.staleThresholdDays} days
                  </span>
                </div>
              </div>

              <div className="border-t border-zinc-100 pt-4 flex gap-2 dark:border-zinc-800">
                <Link
                  href={`/settings${demoQuery}`}
                  className="flex-1 inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                >
                  Configure
                </Link>
              </div>
            </div>
          </section>

        </div>

      </div>

    </div>
  );
}
