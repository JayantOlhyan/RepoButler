'use client';

import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Settings, LogOut, ShieldAlert, GitBranch, LayoutDashboard } from 'lucide-react';

export default function Header() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get('demo') === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  const demoQuery = isDemo ? '?demo=true' : '';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      {isDemo && (
        <div className="flex items-center justify-center gap-2 bg-amber-500 py-1.5 px-4 text-xs font-semibold text-zinc-950">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>Showing simulated Demo data. Connect your own GitHub account to watch active repositories.</span>
        </div>
      )}
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href={session || isDemo ? `/dashboard${demoQuery}` : '/'} className="flex items-center gap-2">
            <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
              Repo<span className="text-zinc-500">Butler</span>
            </span>
          </Link>
          {(session || isDemo) && (
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              <Link href={`/dashboard${demoQuery}`} className="hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
              <Link href={`/repositories${demoQuery}`} className="hover:text-zinc-900 dark:hover:text-white flex items-center gap-1.5">
                <GitBranch className="h-4 w-4" />
                Repositories
              </Link>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-4">
          {(session || isDemo) ? (
            <>
              <Link href={`/settings${demoQuery}`} aria-label="Settings" className="text-zinc-500 hover:text-zinc-950 dark:hover:text-white">
                <Settings className="h-5 w-5" />
              </Link>
              <div className="flex items-center gap-3">
                {isDemo ? (
                  <span className="hidden sm:block text-xs bg-zinc-100 text-zinc-800 py-1 px-2.5 rounded-full dark:bg-zinc-800 dark:text-zinc-200">
                    Demo Mode
                  </span>
                ) : (
                  <span className="hidden sm:block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {session?.user?.name}
                  </span>
                )}
                <img
                  src={isDemo ? 'https://avatars.githubusercontent.com/u/999999?v=4' : session?.user?.image || 'https://avatars.githubusercontent.com/u/999999?v=4'}
                  alt="Avatar"
                  className="h-8 w-8 rounded-full border border-zinc-200 dark:border-zinc-800"
                />
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  aria-label="Sign Out"
                  className="text-zinc-500 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </>
          ) : (
            <Link
              href="/api/auth/signin"
              className="inline-flex h-9 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow hover:bg-zinc-800 focus-visible:outline-none dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
