'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  ShieldAlert,
  Trash2,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
  Save,
  CheckCircle,
  HelpCircle,
  Eye,
  LogOut,
  ArrowRight,
} from 'lucide-react';

interface RepoSettings {
  id: string;
  name: string;
  fullName: string;
  isArchived: boolean;
  monitoringEnabled: boolean;
  staleThresholdDays: number;
  dailyBriefEnabled: boolean;
  healthEnabled: boolean;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const isDemo = searchParams.get('demo') === 'true' || session?.user?.email === 'jayant@repobutler.dev';

  const [repos, setRepos] = useState<RepoSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const [generalSaveStatus, setGeneralSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Timezone and brief defaults
  const [timezone, setTimezone] = useState('GMT+5:30');
  const [deliveryTime, setDeliveryTime] = useState('08:00');

  const demoQuery = isDemo ? '?demo=true' : '';

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch(`/api/settings${demoQuery}`);
        if (res.ok) {
          const data = await res.json();
          setRepos(data.repositories || []);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, [isDemo]);

  const handleToggle = async (repoId: string, field: 'monitoringEnabled' | 'dailyBriefEnabled') => {
    const updated = repos.map((r) => {
      if (r.id === repoId) {
        const val = !r[field];
        saveRepoSettings(repoId, { ...r, [field]: val });
        return { ...r, [field]: val };
      }
      return r;
    });
    setRepos(updated);
  };

  const handleThresholdChange = (repoId: string, val: string) => {
    const parsed = parseInt(val, 10);
    setRepos(
      repos.map((r) => {
        if (r.id === repoId) {
          return { ...r, staleThresholdDays: isNaN(parsed) ? 14 : parsed };
        }
        return r;
      })
    );
  };

  const saveRepoSettings = async (repoId: string, updatedRepo: RepoSettings) => {
    setSaveStatus((prev) => ({ ...prev, [repoId]: 'saving' }));
    try {
      const res = await fetch(`/api/settings${demoQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repositoryId: repoId,
          monitoringEnabled: updatedRepo.monitoringEnabled,
          staleThresholdDays: updatedRepo.staleThresholdDays,
          dailyBriefEnabled: updatedRepo.dailyBriefEnabled,
        }),
      });

      if (res.ok) {
        setSaveStatus((prev) => ({ ...prev, [repoId]: 'saved' }));
        setTimeout(() => {
          setSaveStatus((prev) => ({ ...prev, [repoId]: 'idle' }));
        }, 1500);
      } else {
        setSaveStatus((prev) => ({ ...prev, [repoId]: 'error' }));
      }
    } catch (err) {
      setSaveStatus((prev) => ({ ...prev, [repoId]: 'error' }));
    }
  };

  const handleDisconnect = async () => {
    const confirmed = confirm(
      'Are you sure you want to disconnect RepoButler from your GitHub Account?\nWe will stop monitoring and deactivate your sync pipelines.'
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/settings${demoQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'disconnect_github' }),
      });

      if (res.ok) {
        alert(isDemo ? 'Demo Mode: Disconnect simulated successfully!' : 'GitHub integration disconnected.');
        router.push('/');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteData = async () => {
    const confirmed = confirm(
      'WARNING: This will permanently delete ALL your account data, credentials, history, and generated briefs from RepoButler.\nThis action is irreversible. Proceed?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/settings${demoQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_all_data' }),
      });

      if (res.ok) {
        alert(isDemo ? 'Demo Mode: Data wipe simulated successfully!' : 'All data removed. Goodbye!');
        router.push('/');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveGeneralSettings = () => {
    setGeneralSaveStatus('saving');
    setTimeout(() => {
      setGeneralSaveStatus('saved');
      setTimeout(() => setGeneralSaveStatus('idle'), 1500);
    }, 800);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
        <span className="text-sm font-semibold text-zinc-500">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-10">
      
      {/* Title */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Configure repository monitors, daily brief intervals, and privacy controls.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left 2 Columns: Repository Connections */}
        <div className="lg:col-span-2 space-y-8">
          
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden">
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">Repository Monitoring</h2>
              <p className="text-xs text-zinc-500 mt-0.5">Toggle active background monitoring and configure stale alarms per repository.</p>
            </div>

            {repos.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No active repositories connected.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {repos.map((repo) => (
                  <div key={repo.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="space-y-1 max-w-xs">
                      <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white">{repo.name}</h3>
                      <p className="text-xs text-zinc-500">{repo.fullName}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-6">
                      
                      {/* Toggle Monitor */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-500">Monitor</span>
                        <button
                          onClick={() => handleToggle(repo.id, 'monitoringEnabled')}
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
                        >
                          {repo.monitoringEnabled ? (
                            <ToggleRight className="h-7 w-7 text-zinc-900 dark:text-zinc-50" />
                          ) : (
                            <ToggleLeft className="h-7 w-7" />
                          )}
                        </button>
                      </div>

                      {/* Threshold Input */}
                      {repo.monitoringEnabled && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-500">Stale Threshold</span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              max="180"
                              value={repo.staleThresholdDays}
                              onChange={(e) => handleThresholdChange(repo.id, e.target.value)}
                              className="w-12 h-8 text-center text-xs font-bold bg-zinc-50 border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:bg-zinc-950 dark:border-zinc-800 dark:focus:ring-zinc-50"
                            />
                            <span className="text-[10px] font-semibold text-zinc-400">days</span>
                          </div>
                          <button
                            onClick={() => saveRepoSettings(repo.id, repo)}
                            disabled={saveStatus[repo.id] === 'saving'}
                            className="p-1.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 cursor-pointer"
                            aria-label="Save threshold"
                          >
                            <Save className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {/* Toggle Daily Brief */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-zinc-500">Briefing</span>
                        <button
                          onClick={() => handleToggle(repo.id, 'dailyBriefEnabled')}
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer"
                          disabled={!repo.monitoringEnabled}
                        >
                          {repo.dailyBriefEnabled && repo.monitoringEnabled ? (
                            <ToggleRight className="h-7 w-7 text-zinc-900 dark:text-zinc-50" />
                          ) : (
                            <ToggleLeft className="h-7 w-7" />
                          )}
                        </button>
                      </div>

                      {/* Save feedback banner */}
                      {saveStatus[repo.id] === 'saving' && <span className="text-[10px] text-zinc-400 font-medium">Saving...</span>}
                      {saveStatus[repo.id] === 'saved' && <span className="text-[10px] text-green-500 font-bold flex items-center gap-0.5"><CheckCircle className="h-3 w-3" /> Saved</span>}
                      {saveStatus[repo.id] === 'error' && <span className="text-[10px] text-red-500 font-bold">Error</span>}

                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Privacy & Account Administration */}
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 p-6 space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">Privacy & Integration Settings</h2>
              <p className="text-xs text-zinc-500">Control data retention scopes and delete repository connections.</p>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800">
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Disconnect GitHub Integration</h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-normal">
                  Revoke RepoButler's read-only permissions and disconnect all monitoring webhooks immediately.
                </p>
              </div>
              <button
                onClick={handleDisconnect}
                className="w-full sm:w-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <LogOut className="h-4 w-4" />
                Disconnect
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800">
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-bold text-red-600 dark:text-red-400">Delete Account & Data</h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-normal">
                  Wipe your user profile, repository caches, activity event history, and daily briefs permanently from PostgreSQL.
                </p>
              </div>
              <button
                onClick={handleDeleteData}
                className="w-full sm:w-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-red-50 border border-red-200 px-4 text-xs font-bold text-red-700 shadow-sm hover:bg-red-100 hover:text-red-800 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Wipe All Data
              </button>
            </div>
          </section>

        </div>

        {/* Right Column: Brief Frequency & Timezones */}
        <div className="space-y-8">
          
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 p-6 space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-bold text-zinc-950 dark:text-white">Daily Briefing Schedules</h2>
              <p className="text-xs text-zinc-500">Determine timezone offsets and target briefing deliverable hours.</p>
            </div>

            <div className="space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              {/* Delivery hour */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block">Brief Delivery Time</label>
                <input
                  type="time"
                  value={deliveryTime}
                  onChange={(e) => setDeliveryTime(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:bg-zinc-950 dark:border-zinc-800 dark:focus:ring-zinc-50"
                />
              </div>

              {/* Timezone */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block">Your Local Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-zinc-50 border border-zinc-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:bg-zinc-950 dark:border-zinc-800 dark:focus:ring-zinc-50"
                >
                  <option value="GMT-8:00">Pacific Time (GMT-8)</option>
                  <option value="GMT-5:00">Eastern Time (GMT-5)</option>
                  <option value="GMT+0:00">Greenwich Mean Time (GMT+0)</option>
                  <option value="GMT+1:00">Central European Time (GMT+1)</option>
                  <option value="GMT+5:30">Indian Standard Time (GMT+5:30)</option>
                  <option value="GMT+9:00">Japan Standard Time (GMT+9)</option>
                </select>
              </div>

              <button
                onClick={saveGeneralSettings}
                className="w-full inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-xs font-bold text-white shadow hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 cursor-pointer"
              >
                Save General Settings
              </button>

              {generalSaveStatus === 'saving' && <p className="text-center text-xs text-zinc-400">Saving schedules...</p>}
              {generalSaveStatus === 'saved' && <p className="text-center text-xs text-green-500 font-semibold">Settings saved!</p>}
            </div>
          </section>

          {/* Integration instructions card */}
          <section className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 dark:bg-zinc-950/20 dark:border-zinc-800 space-y-3">
            <h3 className="font-extrabold text-sm text-zinc-900 dark:text-white flex items-center gap-1.5">
              <HelpCircle className="h-4 w-4 text-zinc-500" />
              Need help?
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed font-normal">
              To add additional repositories, update your RepoButler App permissions in your personal GitHub account.
            </p>
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-zinc-900 hover:underline flex items-center gap-0.5 dark:text-white"
            >
              Update App settings on GitHub
              <ArrowRight className="h-3 w-3" />
            </a>
          </section>

        </div>

      </div>

    </div>
  );
}
