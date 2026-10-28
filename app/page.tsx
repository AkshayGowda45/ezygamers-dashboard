"use client";

import React, { useState, useEffect, useCallback } from "react";

interface TelemetryMetrics {
  dau: number;
  wau: number;
  mau: number;
  sessions: number;
  gameStarts: number;
  catalogViews: number;
  previewOpens: number;
  gameCompletes: number;
  catalogDropOff: number;
}

const DEFAULT_METRICS: TelemetryMetrics = {
  dau: 0,
  wau: 0,
  mau: 0,
  sessions: 0,
  gameStarts: 0,
  catalogViews: 0,
  previewOpens: 0,
  gameCompletes: 0,
  catalogDropOff: 0,
};

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<TelemetryMetrics>(DEFAULT_METRICS);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize as empty strings so Next.js static prerender does not execute new Date()
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [game, setGame] = useState<string>("all");
  const [device, setDevice] = useState<string>("all");
  const [source, setSource] = useState<string>("all");

  // Populate dates only after mounting in the browser
  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 30);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  }, []);

  const fetchTelemetry = useCallback(async () => {
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({
        startDate,
        endDate,
        game,
        device,
        source,
      });

      const res = await fetch(`/api?${queryParams.toString()}`);
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Failed to fetch metrics");
      }
      setMetrics(json.metrics || DEFAULT_METRICS);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, game, device, source]);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().split("T")[0]);
    setEndDate(end.toISOString().split("T")[0]);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-4 gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Play-Ezygamers / Telemetry Command Studio
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            EzyGamers Live BigQuery Telemetry & Funnel Diagnostics
          </p>
        </div>

        {/* Preset Controls */}
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
          <button
            onClick={() => setPreset(1)}
            className="px-2.5 py-1 rounded hover:bg-slate-800 text-slate-300"
          >
            24H
          </button>
          <button
            onClick={() => setPreset(7)}
            className="px-2.5 py-1 rounded hover:bg-slate-800 text-slate-300"
          >
            7D
          </button>
          <button
            onClick={() => setPreset(30)}
            className="px-2.5 py-1 rounded bg-slate-800 text-white font-medium"
          >
            30D
          </button>
          <button
            onClick={() => {
              setStartDate("2026-01-01");
              setEndDate(new Date().toISOString().split("T")[0]);
            }}
            className="px-2.5 py-1 rounded hover:bg-slate-800 text-slate-300"
          >
            ALL
          </button>
          <div className="h-4 w-px bg-slate-800 mx-1"></div>
          <button
            onClick={fetchTelemetry}
            className="px-2 py-1 hover:bg-slate-800 text-slate-300 rounded"
            title="Refresh Data"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Active Slicers */}
      <section className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-wrap items-center gap-4 text-xs">
        <span className="font-semibold text-slate-400 uppercase tracking-wider text-[10px]">
          Active Slicers
        </span>
        <div className="flex items-center gap-2">
          <label className="text-slate-400">Date Range:</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
          />
          <span className="text-slate-500">→</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200"
          />
        </div>

        <select
          value={game}
          onChange={(e) => setGame(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200"
        >
          <option value="all">All Games</option>
          <option value="Neon Dash">Neon Dash</option>
          <option value="Pixel Quest">Pixel Quest</option>
        </select>

        <select
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200"
        >
          <option value="all">All Devices</option>
          <option value="mobile">Mobile</option>
          <option value="desktop">Desktop</option>
          <option value="tablet">Tablet</option>
        </select>

        {loading && (
          <span className="text-emerald-400 animate-pulse ml-auto">
            Querying BigQuery...
          </span>
        )}
      </section>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/80 rounded-xl p-3 text-rose-300 text-xs">
          <strong>Pipeline Error:</strong> {error}
        </div>
      )}

      {/* KPI Overview Cards */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "DAU", value: metrics.dau, sub: "Daily Active Users" },
          { label: "WAU", value: metrics.wau, sub: "Rolling 7-Day Users" },
          { label: "MAU", value: metrics.mau, sub: "Rolling 30-Day Users" },
          { label: "Sessions", value: metrics.sessions, sub: "Unique GA Sessions" },
          { label: "Game Starts", value: metrics.gameStarts, sub: "Gameplay Activated" },
        ].map((card, idx) => (
          <div
            key={idx}
            className="bg-slate-900/40 border border-slate-800/70 rounded-xl p-4 flex flex-col justify-between"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {card.label}
            </span>
            <div className="text-2xl font-bold text-white mt-1">
              {loading ? "..." : card.value.toLocaleString()}
            </div>
            <span className="text-[10px] text-slate-500 mt-1">{card.sub}</span>
          </div>
        ))}
      </section>

      {/* Tactical Diagnostic Section */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/40 border border-slate-800/70 rounded-xl p-4 space-y-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            1. Diagnostic Findings
          </span>
          <h4 className="text-xs font-semibold text-slate-200">Catalog Drop-Off</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            {metrics.catalogDropOff.toFixed(1)}% of landing sessions abandon without opening a preview modal.
          </p>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/70 rounded-xl p-4 space-y-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            2. Immediate Tactical Plan
          </span>
          <h4 className="text-xs font-semibold text-slate-200">High-Impact Actions</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Deploy 1-click &quot;Play Now&quot; buttons on homepage game cards to bypass modal friction.
          </p>
        </div>

        <div className="bg-slate-900/40 border border-slate-800/70 rounded-xl p-4 space-y-1.5">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            3. Telemetry Roadmap
          </span>
          <h4 className="text-xs font-semibold text-slate-200">Future Instrumentation</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Instrument in-game events (<code className="text-indigo-300 font-mono text-[11px]">level_start</code>, <code className="text-indigo-300 font-mono text-[11px]">level_complete</code>).
          </p>
        </div>
      </section>
    </div>
  );
}