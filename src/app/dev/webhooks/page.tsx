'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Activity,
  AlertTriangle,
  RefreshCw,
  Clock,
  Eye,
  CheckCircle,
} from 'lucide-react';

interface EventInspectorItem {
  id: string;
  githubEventId: string;
  eventType: string;
  actorLogin: string;
  occurredAt: string;
  repoName: string;
  repoFullName: string;
  isSimulated: boolean;
  payload: any;
}

export default function DevWebhooksPage() {
  const [events, setEvents] = useState<EventInspectorItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchEvents() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/dev/webhooks');
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load webhook events:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchEvents();
  }, []);

  const selectedEvent = events.find(e => e.id === selectedEventId);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3.5rem)] px-4">
        <span className="text-sm font-semibold text-zinc-500">Loading webhook events...</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/dev/simulator"
            className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Simulator
          </Link>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white flex items-center gap-2">
            <Activity className="h-7 w-7 text-zinc-400" />
            Webhook Event Inspector
          </h1>
        </div>

        <button
          onClick={fetchEvents}
          disabled={refreshing}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-4 text-xs font-bold text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh Log
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Events List Table */}
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 overflow-hidden">
          <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
            <h2 className="text-base font-bold text-zinc-950 dark:text-white">Activity Log Cache</h2>
            <p className="text-xs text-zinc-500 mt-0.5">Displays both real-time GitHub hooks and simulated events sequentially.</p>
          </div>

          {events.length === 0 ? (
            <div className="p-12 text-center text-sm text-zinc-500">
              No webhook events captured in database.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 border-b border-zinc-200 dark:bg-zinc-950/20 dark:border-zinc-850">
                    <th className="p-4 font-bold text-zinc-500">Event ID</th>
                    <th className="p-4 font-bold text-zinc-500">Type</th>
                    <th className="p-4 font-bold text-zinc-500">Repository</th>
                    <th className="p-4 font-bold text-zinc-500">Actor</th>
                    <th className="p-4 font-bold text-zinc-500">Source</th>
                    <th className="p-4 font-bold text-zinc-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {events.map((item) => (
                    <tr
                      key={item.id}
                      className={`hover:bg-zinc-50/50 dark:hover:bg-zinc-800/10 cursor-pointer ${
                        selectedEventId === item.id ? 'bg-zinc-50 dark:bg-zinc-800/20' : ''
                      }`}
                      onClick={() => setSelectedEventId(item.id)}
                    >
                      <td className="p-4 font-mono text-[10px] text-zinc-500 max-w-[120px] truncate">
                        {item.githubEventId}
                      </td>
                      <td className="p-4 font-extrabold text-zinc-900 dark:text-white">
                        {item.eventType}
                      </td>
                      <td className="p-4 font-bold text-zinc-700 dark:text-zinc-300">
                        {item.repoName}
                      </td>
                      <td className="p-4 text-zinc-500">{item.actorLogin}</td>
                      <td className="p-4">
                        {item.isSimulated ? (
                          <span className="inline-flex px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100 text-[10px] font-bold dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900/30">
                            Simulated
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px] font-bold dark:bg-zinc-800 dark:text-zinc-300">
                            Real Hook
                          </span>
                        )}
                      </td>
                      <td className="p-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEventId(item.id);
                          }}
                          className="p-1 text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Side: Event Payload Details */}
        <div className="space-y-8">
          
          <section className="bg-white border border-zinc-200 rounded-xl shadow-sm dark:bg-zinc-900 dark:border-zinc-800 p-6 space-y-6">
            <h2 className="text-base font-bold text-zinc-950 dark:text-white">Webhook Inspector Details</h2>
            
            {selectedEvent ? (
              <div className="space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                <div className="space-y-1 text-xs">
                  <span className="font-semibold text-zinc-500 block">Unique ID</span>
                  <p className="font-mono text-[10px] bg-zinc-50 p-2 rounded border border-zinc-200 dark:bg-zinc-950 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 select-all break-all">
                    {selectedEvent.githubEventId}
                  </p>
                </div>
                
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Webhook Type</span>
                  <span className="font-extrabold text-zinc-900 dark:text-white">{selectedEvent.eventType}</span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Repository Scope</span>
                  <span className="font-bold text-zinc-900 dark:text-zinc-200">{selectedEvent.repoFullName}</span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Triggered At</span>
                  <span className="text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(selectedEvent.occurredAt).toLocaleTimeString()} ({new Date(selectedEvent.occurredAt).toLocaleDateString()})
                  </span>
                </div>

                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-500">Webhook Status</span>
                  <span className="text-green-600 dark:text-green-400 font-bold flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" />
                    SUCCESS
                  </span>
                </div>

                <div className="space-y-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                  <span className="text-[10px] uppercase font-extrabold text-zinc-400 block">Webhook Activity Details</span>
                  <pre className="text-[10px] bg-zinc-950 text-zinc-400 p-3 rounded-lg overflow-x-auto max-h-56 leading-normal font-mono">
                    {JSON.stringify(selectedEvent.payload || { action: null, ref: null }, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 text-center py-8 border-t border-zinc-100 dark:border-zinc-800">
                Select an event from the activity log to inspect its webhook properties and processed metadata.
              </p>
            )}
          </section>

        </div>

      </div>

    </div>
  );
}
