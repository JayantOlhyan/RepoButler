import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import prisma from '@/lib/db/prisma';
import { Clock as ClockUtil } from '@/lib/utils/clock';
import {
  Search,
  Star,
  GitFork,
  CheckCircle,
  AlertTriangle,
  Clock,
  Layers,
  ChevronRight,
} from 'lucide-react';

interface PageProps {
  searchParams: Promise<{ demo?: string; status?: string; search?: string }>;
}

export default async function RepositoriesList(props: PageProps) {
  const searchParams = await props.searchParams;
  const session = await getServerSession(authOptions);
  
  const isDemo = searchParams.demo === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  if (!session && !isDemo) {
    redirect('/');
  }

  let dbUser: any = null;
  let repos: any[] = [];
  let dbFailed = false;

  try {
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

    if (dbUser) {
      const installations = await prisma.gitHubInstallation.findMany({
        where: { userId: dbUser.id },
      });

      const installationIds = installations.map(i => i.id);

      repos = await prisma.repository.findMany({
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
        orderBy: { name: 'asc' },
      });
    }
  } catch (err) {
    console.warn('Database is offline or not configured. Falling back to in-memory mock dataset.', err);
    dbFailed = true;
  }

  if (dbFailed || (!dbUser && isDemo)) {
    dbUser = {
      id: 'demo-user-id',
      username: 'jayantolhyan',
      email: 'jayant@repobutler.dev',
      avatarUrl: 'https://avatars.githubusercontent.com/u/999999?v=4',
    };
    repos = [
      {
        id: 'repo-1',
        githubRepositoryId: 990001,
        owner: 'repobutler-sim-developer',
        name: 'Healthkinator',
        fullName: 'repobutler-sim-developer/Healthkinator',
        description: 'Actionable health calculator for remote server node processes.',
        htmlUrl: 'https://github.com/repobutler-sim-developer/Healthkinator',
        githubUpdatedAt: ClockUtil.now().toISOString(),
        settings: { monitoringEnabled: true, staleThresholdDays: 14 },
        attentionItems: [
          {
            id: 'att-1',
            type: 'FAILED_CI',
            severity: 'CRITICAL',
            title: 'Deploy pipeline has failed consecutively (3 times)',
            description: 'The production deploy workflow has failed on main branch multiple times.',
            status: 'OPEN',
          }
        ],
        healthSnapshots: [{ score: 32 }],
      },
      {
        id: 'repo-2',
        githubRepositoryId: 990002,
        owner: 'repobutler-sim-developer',
        name: 'Acme-Web',
        fullName: 'repobutler-sim-developer/Acme-Web',
        description: 'Landing page and pricing panels for Acme SaaS products.',
        htmlUrl: 'https://github.com/repobutler-sim-developer/Acme-Web',
        githubUpdatedAt: ClockUtil.now().toISOString(),
        settings: { monitoringEnabled: true, staleThresholdDays: 14 },
        attentionItems: [
          {
            id: 'att-2',
            type: 'STALE_PR',
            severity: 'HIGH',
            title: 'Pull Request #84 has been open and inactive for 9 days',
            description: 'No review or commits have occurred on "docs: update API setup guidelines".',
            status: 'OPEN',
          }
        ],
        healthSnapshots: [{ score: 68 }],
      },
      {
        id: 'repo-3',
        githubRepositoryId: 990003,
        owner: 'repobutler-sim-developer',
        name: 'OpenCampus',
        fullName: 'repobutler-sim-developer/OpenCampus',
        description: 'Open source learning hub software and modules.',
        htmlUrl: 'https://github.com/repobutler-sim-developer/OpenCampus',
        githubUpdatedAt: new Date(ClockUtil.now().getTime() - 25 * 24 * 60 * 60 * 1000).toISOString(),
        settings: { monitoringEnabled: true, staleThresholdDays: 14 },
        attentionItems: [
          {
            id: 'att-3',
            type: 'STALE_REPO',
            severity: 'MEDIUM',
            title: 'Repository has had no activity for 25 days',
            description: 'No commits, pull requests, or releases have been recorded.',
            status: 'OPEN',
          }
        ],
        healthSnapshots: [{ score: 45 }],
      }
    ];
  }

  if (!dbUser) {
    redirect('/');
  }

  // Calculate statuses and apply filters
  const fourteenDaysAgo = ClockUtil.now();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const enrichedRepos = repos.map(repo => {
    let status: 'Active' | 'Stable' | 'Attention' | 'Inactive' = 'Stable';
    
    const hasAttention = repo.attentionItems.some((i: any) => i.severity === 'CRITICAL' || i.severity === 'HIGH');
    const isStale = repo.attentionItems.some((i: any) => i.type === 'STALE_REPO');

    if (hasAttention) {
      status = 'Attention';
    } else if (isStale) {
      status = 'Inactive';
    } else {
      const isRecentlyUpdated = new Date(repo.githubUpdatedAt) > fourteenDaysAgo;
      if (isRecentlyUpdated) {
        status = 'Active';
      }
    }

    const latestSnapshot = repo.healthSnapshots[0];

    return {
      ...repo,
      status,
      healthScore: latestSnapshot ? latestSnapshot.score : null,
    };
  });

  // Apply filters from query params
  const statusFilter = searchParams.status || '';
  const searchFilter = (searchParams.search || '').toLowerCase();

  const filteredRepos = enrichedRepos.filter(repo => {
    const matchesStatus = !statusFilter || repo.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesSearch = !searchFilter || 
      repo.name.toLowerCase().includes(searchFilter) || 
      (repo.description || '').toLowerCase().includes(searchFilter);
    return matchesStatus && matchesSearch;
  });

  const demoQuery = isDemo ? 'demo=true' : '';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
          Monitored Repositories
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Viewing {filteredRepos.length} of {enrichedRepos.length} repository connections.
        </p>
      </div>

      {/* Filter Options */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white border border-zinc-200/80 rounded-xl p-4 dark:bg-zinc-900 dark:border-zinc-800">
        
        {/* Status Filters */}
        <div className="flex flex-wrap gap-2">
          {['', 'Active', 'Stable', 'Attention', 'Inactive'].map((status) => {
            const label = status || 'All';
            const isActive = (searchParams.status || '') === status.toLowerCase() || (status === '' && !searchParams.status);
            
            // Build filter URL
            const urlParams = new URLSearchParams();
            if (isDemo) urlParams.set('demo', 'true');
            if (status) urlParams.set('status', status.toLowerCase());
            if (searchParams.search) urlParams.set('search', searchParams.search);
            const queryStr = urlParams.toString();
            
            return (
              <Link
                key={status}
                href={`/repositories?${queryStr}`}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors border ${
                  isActive 
                    ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-zinc-50 dark:border-zinc-50 dark:text-zinc-900' 
                    : 'bg-zinc-50 border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Search Input Mock / Link Form */}
        <form method="GET" action="/repositories" className="relative flex items-center max-w-xs w-full">
          {isDemo && <input type="hidden" name="demo" value="true" />}
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <Search className="absolute left-3 h-4 w-4 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            name="search"
            defaultValue={searchParams.search || ''}
            placeholder="Search repositories..."
            className="w-full h-9 pl-9 pr-4 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:bg-zinc-950 dark:border-zinc-800 dark:focus:ring-zinc-50"
          />
        </form>
      </div>

      {/* Repositories Grid */}
      {filteredRepos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 p-12 text-center bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
          <Layers className="mx-auto h-10 w-10 text-zinc-400" />
          <p className="mt-4 text-base font-bold text-zinc-900 dark:text-white">No repositories found</p>
          <p className="text-sm text-zinc-500 mt-1">Try resetting your status filters or adjusting your search term.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredRepos.map((repo) => {
            let statusIcon = <CheckCircle className="h-4 w-4 text-zinc-400" />;
            let statusClass = 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200';
            
            if (repo.status === 'Active') {
              statusIcon = <CheckCircle className="h-4 w-4 text-emerald-500" />;
              statusClass = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400';
            } else if (repo.status === 'Attention') {
              statusIcon = <AlertTriangle className="h-4 w-4 text-amber-500" />;
              statusClass = 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400';
            } else if (repo.status === 'Inactive') {
              statusIcon = <Clock className="h-4 w-4 text-zinc-500" />;
              statusClass = 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
            }

            const itemQuery = demoQuery ? `?${demoQuery}` : '';

            return (
              <div 
                key={repo.id}
                className="bg-white border border-zinc-200/80 rounded-xl p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between dark:bg-zinc-900 dark:border-zinc-800/80"
              >
                <div className="space-y-4">
                  {/* Title & Status */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <h3 className="font-extrabold text-lg text-zinc-950 dark:text-white hover:underline">
                        <Link href={`/repositories/${repo.id}${itemQuery}`}>
                          {repo.name}
                        </Link>
                      </h3>
                      <p className="text-xs text-zinc-500 font-medium">
                        {repo.fullName}
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${statusClass}`}>
                      {statusIcon}
                      {repo.status}
                    </span>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2 h-10 leading-relaxed font-normal">
                    {repo.description || "No description provided."}
                  </p>

                  {/* Basic Stats */}
                  <div className="flex items-center gap-4 text-xs font-semibold text-zinc-500">
                    {repo.language && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-500" />
                        {repo.language}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5">
                      <Star className="h-3.5 w-3.5" />
                      {repo.stars}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <GitFork className="h-3.5 w-3.5" />
                      {repo.forks}
                    </span>
                  </div>
                </div>

                {/* Footer Metrics & Actions */}
                <div className="border-t border-zinc-100 mt-6 pt-4 flex items-center justify-between dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500">Health Score</span>
                    {repo.healthScore !== null ? (
                      <span className={`text-sm font-extrabold rounded-md py-0.5 px-2 ${
                        repo.healthScore >= 80 
                          ? 'bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400' 
                          : repo.healthScore >= 50 
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' 
                            : 'bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400'
                      }`}>
                        {repo.healthScore}/100
                      </span>
                    ) : (
                      <span className="text-xs bg-zinc-100 text-zinc-500 py-0.5 px-2 rounded-md dark:bg-zinc-800 dark:text-zinc-400">
                        No score
                      </span>
                    )}
                  </div>

                  <Link
                    href={`/repositories/${repo.id}${itemQuery}`}
                    className="text-xs font-bold text-zinc-900 hover:underline flex items-center gap-0.5 dark:text-white"
                  >
                    View Details
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
