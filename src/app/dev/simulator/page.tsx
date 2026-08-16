'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Settings,
  Database,
  Activity,
  Play,
  Trash2,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Calendar,
  Layers,
  Heart,
  Eye,
} from 'lucide-react';

interface SimulatedRepo {
  id: string;
  name: string;
  fullName: string;
  health: number;
  attentionCount: number;
  prsCount: number;
  issuesCount: number;
  ciStatus: string;
  lastUpdatedAt: string;
}

interface SimulatedEvent {
  id: string;
  githubEventId: string;
  eventType: string;
  actorLogin: string;
  occurredAt: string;
  repoName: string;
}

export default function DevSimulatorPage() {
  const [repos, setRepos] = useState<SimulatedRepo[]>([]);
  const [events, setEvents] = useState<SimulatedEvent[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [logOutput, setLogOutput] = useState<string[]>([]);
  const [scenarioResult, setScenarioResult] = useState<any>(null);

  // Custom Event Form State
  const [customEventType, setCustomEventType] = useState('PUSH');
  const [customActor, setCustomActor] = useState('sim-developer');
  const [customOffset, setCustomOffset] = useState('0'); // in minutes
  const [metadataTitle, setMetadataTitle] = useState('');
  const [metadataNumber, setMetadataNumber] = useState('');

  // Fetch initial simulator dashboard state
  async function fetchState() {
    try {
      const res = await fetch('/api/dev/simulator');
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repositories || []);
        setEvents(data.events || []);
        if (data.repositories.length > 0 && !selectedRepoId) {
          setSelectedRepoId(data.repositories[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load simulator data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchState();
  }, []);

  const appendLog = (msg: string) => {
    setLogOutput(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 19)]);
  };

  const handleAction = async (action: string, payload?: any) => {
    setProcessing(true);
    setScenarioResult(null);
    try {
      const res = await fetch('/api/dev/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (res.ok) {
        const data = await res.json();
        appendLog(data.message || `Action "${action}" completed.`);
        if (data.result) {
          setScenarioResult(data.result);
        }
        await fetchState();
      } else {
        const errText = await res.text();
        appendLog(`Error: ${errText}`);
      }
    } catch (err: any) {
      appendLog(`Exception: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleReset = async () => {
    const confirmed = confirm(
      'WARNING: This will permanently wipe all simulated repositories, commits, PRs, issues, runs, releases, and briefs.\nThis has no impact on real user accounts. Proceed?'
    );
    if (!confirmed) return;
    await handleAction('reset');
  };

  const handleCustomEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRepoId) {
      alert('Please seed and select a repository first.');
      return;
    }

    appendLog(`Simulating custom event ${customEventType}...`);
    await handleAction('simulate_event', {
      repositoryId: selectedRepoId,
      eventType: customEventType,
      actor: customActor,
      timestampOffset: customOffset,
      metadata: {
        title: metadataTitle,
        number: metadataNumber,
        tagName: metadataTitle,
        name: metadataTitle,
      },
    });

    // Reset simple metadata inputs
    setMetadataTitle('');
    setMetadataNumber('');
  };

  const selectedRepo = repos.find(r => r.id === selectedRepoId);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
        <span className="text-sm font-semibold text-zinc-500">Loading simulator controls...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      
      {/* Title & Security Warn Banner */}
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 dark:bg-amber-950/20 dark:border-amber-900/50 space-y-2">
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-extrabold text-sm uppercase tracking-wider">
          <AlertTriangle className="h-5 w-5" />
          Development Simulator Center
        </div>
        <p className="text-xs text-amber-700/90 dark:text-amber-400/90 leading-relaxed font-semibold">
          These events are synthetic and exist only for local development/testing. Simulated database records are strictly isolated (flagged with `isSimulated = true`) and will never communicate with GitHub APIs or modify real project records.
        </p>
      </div>

      {/* Simulator Details Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-zinc-50 border border-zinc-200 rounded-xl p-5 dark:bg-zinc-900/50 dark:border-zinc-800">
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-extrabold tracking-wider text-zinc-400">Environment</span>
          <p className="text-sm font-extrabold text-zinc-900 dark:text-white flex items-center gap-1">
            <Layers className="h-4 w-4 text-zinc-500" />
            DEVELOPMENT
          </p>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-extrabold tracking-wider text-zinc-400">Database</span>
          <p className="text-sm font-extrabold text-zinc-900 dark:text-white flex items-center gap-1">
            <Database className="h-4 w-4 text-zinc-500" />
            Connected
          </p>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-extrabold tracking-wider text-zinc-400">Simulator Status</span>
          <p className="text-sm font-bold text-green-600 dark:text-green-400 flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" />
            ACTIVE
          </p>
        </div>
        <div className="space-y-1 flex items-end">
          <button
            onClick={() => handleAction('seed')}
            disabled={processing}
            className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-xs font-bold text-white shadow hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${processing ? 'animate-spin' : ''}`} />
            Seed Simulated Repos
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left column: Preset scenarios & Custom event trigger */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Quick Presets Scenarios */}
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 p-6 space-y-6">
            <h2 className="text-base font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Play className="h-5 w-5 text-zinc-400" />
              Predefined Scenarios
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'healthy-repository' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Healthy Repository</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Commits, CI successes, and a release setup. Expect high health score.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'ci-failure' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">CI Failure</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Fires a failed workflow event. Health drops and registers an alert.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'repeated-ci-failure' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Repeated CI Failure</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Fires 5 failed runs. Deduplicates to 1 critical attention card.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'ci-recovery' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">CI Recovery</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Generates a passing workflow run. Resolves outstanding CI alert.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'stale-pr' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Stale Pull Request</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Sets clock 48h ago, opens a PR, shifts back. Expect review alert.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'stale-repository' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Stale Repository</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Schedules push 21 days ago, shifts back. Expect repo inactive alert.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'active-project' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Active Project</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Fires a push event now. Rescues repo from stale inactive status.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'busy-day' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Busy Development Day</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">15 commits, 3 PRs, 7 issues, releases. Ideal for brief testing.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('run_scenario', { scenarioName: 'bad-repository' })}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors disabled:opacity-50 dark:border-zinc-850 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-900 dark:text-white">Bad Repository</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Failing CI, stale PRs, stale issues, zero commits. Expect low health.</p>
                </div>
              </button>

              <button
                onClick={() => handleAction('generate_brief')}
                disabled={processing}
                className="flex items-start text-left p-3.5 border border-amber-200 bg-amber-50/10 rounded-lg hover:bg-amber-50/30 transition-colors disabled:opacity-50 dark:border-amber-900/30 dark:hover:bg-amber-950/20 cursor-pointer"
              >
                <div>
                  <h3 className="text-xs font-extrabold text-amber-800 dark:text-amber-400">Generate Daily Brief</h3>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Collects simulated logs, builds brief, calls AI or fallback template.</p>
                </div>
              </button>
            </div>
          </section>

          {/* Custom Event Simulator Form */}
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 p-6 space-y-6">
            <h2 className="text-base font-bold text-zinc-950 dark:text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-zinc-400" />
              Custom Event Simulator
            </h2>

            <form onSubmit={handleCustomEvent} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-extrabold text-zinc-400 block">Target Repository</label>
                <select
                  value={selectedRepoId}
                  onChange={(e) => setSelectedRepoId(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none dark:bg-zinc-950 dark:border-zinc-800"
                >
                  <option value="">-- Select Repo --</option>
                  {repos.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-extrabold text-zinc-400 block">Event Type</label>
                <select
                  value={customEventType}
                  onChange={(e) => setCustomEventType(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none dark:bg-zinc-950 dark:border-zinc-800"
                >
                  <option value="PUSH">PUSH</option>
                  <option value="PR_OPENED">PR OPENED</option>
                  <option value="PR_CLOSED">PR CLOSED</option>
                  <option value="PR_MERGED">PR MERGED</option>
                  <option value="ISSUE_OPENED">ISSUE OPENED</option>
                  <option value="ISSUE_CLOSED">ISSUE CLOSED</option>
                  <option value="WORKFLOW_FAILED">WORKFLOW FAILED</option>
                  <option value="WORKFLOW_PASSED">WORKFLOW PASSED</option>
                  <option value="RELEASE_PUBLISHED">RELEASE PUBLISHED</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-extrabold text-zinc-400 block">Actor Login</label>
                <input
                  type="text"
                  value={customActor}
                  onChange={(e) => setCustomActor(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none dark:bg-zinc-950 dark:border-zinc-800"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-extrabold text-zinc-400 block">Time Offset (Relative)</label>
                <select
                  value={customOffset}
                  onChange={(e) => setCustomOffset(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none dark:bg-zinc-950 dark:border-zinc-800"
                >
                  <option value="0">Now</option>
                  <option value="60">1 Hour Ago</option>
                  <option value="360">6 Hours Ago</option>
                  <option value="1440">1 Day Ago</option>
                  <option value="4320">3 Days Ago</option>
                  <option value="10080">7 Days Ago</option>
                  <option value="20160">14 Days Ago</option>
                  <option value="43200">30 Days Ago</option>
                </select>
              </div>

              {/* Event specific inputs */}
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-extrabold text-zinc-400 block">Metadata Title / Tag / Name</label>
                  <input
                    type="text"
                    value={metadataTitle}
                    placeholder="e.g. fix: crash fix, v1.0.2, CI Build"
                    onChange={(e) => setMetadataTitle(e.target.value)}
                    className="w-full h-9 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none dark:bg-zinc-950 dark:border-zinc-800"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-extrabold text-zinc-400 block">PR / Issue Number</label>
                  <input
                    type="number"
                    value={metadataNumber}
                    placeholder="e.g. 84, 102"
                    onChange={(e) => setMetadataNumber(e.target.value)}
                    className="w-full h-9 px-3 text-xs bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none dark:bg-zinc-950 dark:border-zinc-800"
                  />
                </div>
              </div>

              <div className="md:col-span-2 pt-2">
                <button
                  type="submit"
                  disabled={processing}
                  className="w-full inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-xs font-bold text-white shadow hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200 cursor-pointer"
                >
                  <Activity className="h-4 w-4" />
                  Simulate Webhook Event
                </button>
              </div>

            </form>
          </section>

        </div>

        {/* Right column: Target repo state & logs */}
        <div className="space-y-8">
          
          {/* Target Repo Current State */}
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 p-6 space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">Active Test Repository State</h2>
              <p className="text-[10px] text-zinc-400">Select a simulated repo in Custom Event dropdown to inspect.</p>
            </div>

            {selectedRepo ? (
              <div className="space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Repository Name</span>
                  <span className="font-extrabold text-zinc-900 dark:text-white">{selectedRepo.name}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Actionable Health</span>
                  <span className="font-extrabold text-zinc-900 dark:text-white">{selectedRepo.health}/100</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Open PRs</span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-200">{selectedRepo.prsCount}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Open Issues</span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-200">{selectedRepo.issuesCount}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">CI Status</span>
                  <span className={`font-bold ${selectedRepo.ciStatus === 'Failing' ? 'text-red-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
                    {selectedRepo.ciStatus}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Open Alerts</span>
                  <span className="font-extrabold text-zinc-900 dark:text-white">{selectedRepo.attentionCount}</span>
                </div>
                <div className="pt-2">
                  <Link
                    href={`/repositories/${selectedRepo.id}?demo=true`}
                    target="_blank"
                    className="w-full inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    View Repo Dashboard
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-4 border-t border-zinc-100 dark:border-zinc-800">No test repository selected.</p>
            )}
          </section>

          {/* Webhook Activity Log Console */}
          <section className="bg-zinc-950 text-zinc-300 border border-zinc-800 rounded-xl p-5 space-y-4 font-mono text-[10px]">
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <span className="text-zinc-500 font-bold uppercase tracking-wider">Simulator Event Log</span>
              <Link href="/dev/webhooks" className="text-zinc-400 hover:text-white flex items-center gap-0.5 font-sans font-semibold">
                Inspect Webhooks
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {logOutput.length === 0 ? (
                <p className="text-zinc-600">Console idle. Ready for events...</p>
              ) : (
                logOutput.map((log, idx) => (
                  <p key={idx} className="leading-normal break-words">{log}</p>
                ))
              )}
            </div>
          </section>

          {/* Scenario Result Summary Debugging Box */}
          {scenarioResult && (
            <section className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 dark:bg-zinc-900 dark:border-zinc-850 space-y-4">
              <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white">Scenario Result Summary</h3>
              <div className="space-y-2 text-xs">
                <p><span className="font-semibold text-zinc-500">Scenario Run:</span> <span className="font-bold">{scenarioResult.name}</span></p>
                <p><span className="font-semibold text-zinc-500">Events Generated:</span> <span className="font-bold">{scenarioResult.eventsGenerated}</span></p>
                <p><span className="font-semibold text-zinc-500">Health shift:</span> <span className="font-bold">{scenarioResult.initialHealth} &rarr; {scenarioResult.finalHealth}</span></p>
                <p><span className="font-semibold text-zinc-500">Open attention alerts:</span> <span className="font-bold">{scenarioResult.attentionItemsCreated}</span></p>
              </div>
            </section>
          )}

          {/* Admin Wiping Tools */}
          <section className="bg-red-50/20 border border-red-200/50 rounded-xl p-5 dark:bg-red-950/10 dark:border-red-900/30 space-y-3">
            <h3 className="font-extrabold text-xs text-red-600 dark:text-red-400 uppercase tracking-wider">Simulator Admin Tools</h3>
            <p className="text-[10px] text-zinc-500 leading-normal">
              Reset simulator variables and wipe synthetic records from local database schemas safely.
            </p>
            <button
              onClick={handleReset}
              disabled={processing}
              className="w-full inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-50 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Reset Simulation Data
            </button>
          </section>

        </div>

      </div>

    </div>
  );
}
