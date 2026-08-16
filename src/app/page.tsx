import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { Play, ArrowRight, ShieldCheck, Star } from 'lucide-react';
import { redirect } from 'next/navigation';

export default async function Home() {
  const session = await getServerSession(authOptions);

  // If signed in, redirect straight to dashboard
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] py-16 px-4 bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-950 dark:to-zinc-900">
      <div className="max-w-4xl w-full text-center space-y-8">
        
        {/* Main Hero Section */}
        <div className="space-y-4">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-zinc-900 dark:text-white max-w-3xl mx-auto leading-tight">
            Your GitHub repositories have a <span className="text-zinc-500 font-medium">butler</span> now.
          </h1>
          <p className="text-lg sm:text-xl text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto font-normal">
            RepoButler watches your repositories, understands what changed, and tells you what deserves your attention.
          </p>
        </div>

        {/* CTA Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <Link
            href="/api/auth/signin"
            className="w-full sm:w-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-zinc-800 transition-colors focus-visible:outline-none dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" /></svg>
            Connect GitHub
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/dashboard?demo=true"
            className="w-full sm:w-auto inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-900 transition-all dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <Play className="h-4 w-4 text-zinc-500 fill-zinc-500" />
            View Demo
          </Link>
        </div>

        {/* Secondary Supporting Message */}
        <div className="pt-8 border-t border-zinc-100 dark:border-zinc-800/50 max-w-xl mx-auto">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-500">
            Stop checking 20 repositories one by one.
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-8 text-left max-w-4xl mx-auto">
          <div className="bg-white/60 p-6 rounded-xl border border-zinc-200/60 dark:bg-zinc-900/40 dark:border-zinc-800/40">
            <h3 className="font-semibold text-zinc-900 dark:text-white text-base flex items-center gap-2">
              <span className="text-zinc-400">1.</span> Attention Queue
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Heuristic rules scan open PRs, stale issues, and consecutive workflow build failures to surface priorities.
            </p>
          </div>
          <div className="bg-white/60 p-6 rounded-xl border border-zinc-200/60 dark:bg-zinc-900/40 dark:border-zinc-800/40">
            <h3 className="font-semibold text-zinc-900 dark:text-white text-base flex items-center gap-2">
              <span className="text-zinc-400">2.</span> Actionable Health
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Deterministic health scores from 0–100 built on actual repository activity, releases, docs, and build reliability.
            </p>
          </div>
          <div className="bg-white/60 p-6 rounded-xl border border-zinc-200/60 dark:bg-zinc-900/40 dark:border-zinc-800/40">
            <h3 className="font-semibold text-zinc-900 dark:text-white text-base flex items-center gap-2">
              <span className="text-zinc-400">3.</span> Daily Brief
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              A clean chronological review of what happened across all active repositories, listing what needs your response.
            </p>
          </div>
        </div>

        {/* Footer/Trust */}
        <div className="flex items-center justify-center gap-6 pt-12 text-xs text-zinc-400 dark:text-zinc-600">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            Least Privilege Permissions
          </span>
          <span className="flex items-center gap-1.5">
            <Star className="h-4 w-4" />
            Designed for Side Projects
          </span>
        </div>

      </div>
    </div>
  );
}
