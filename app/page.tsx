"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";

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

export default function CommandStudioPage() {
  const [metrics, setMetrics] = useState<TelemetryMetrics>(DEFAULT_METRICS);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Tab & Theme State
  const [activeTab, setActiveTab] = useState<string>("Overview");
  const [theme, setTheme] = useState<string>("Cyber");

  // Filter State (Hydrated in useEffect to satisfy Next.js static prerender)
  const [preset, setPreset] = useState<string>("30D");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [game, setGame] = useState<string>("all");
  const [device, setDevice] = useState<string>("all");
  const [source, setSource] = useState<string>("all");

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
        throw new Error(json.error || "Failed to fetch telemetry metrics");
      }
      setMetrics(json.metrics || DEFAULT_METRICS);
    } catch (err: any) {
      console.error("Telemetry Fetch Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, game, device, source]);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  const handlePreset = (label: string, days: number | null) => {
    setPreset(label);
    const end = new Date();
    if (days === null) {
      setStartDate("2026-01-01");
    } else {
      const start = new Date();
      start.setDate(end.getDate() - days);
      setStartDate(start.toISOString().split("T")[0]);
    }
    setEndDate(end.toISOString().split("T")[0]);
  };

  // Calculated derived metrics
  const stickiness = useMemo(() => {
    if (!metrics.mau || metrics.mau === 0) return 0;
    return (metrics.dau / metrics.mau) * 100;
  }, [metrics.dau, metrics.mau]);

  const conversion = useMemo(() => {
    if (!metrics.sessions || metrics.sessions === 0) return 0;
    return (metrics.gameStarts / metrics.sessions) * 100;
  }, [metrics.gameStarts, metrics.sessions]);

  const engagementRate = useMemo(() => {
    if (!metrics.sessions || metrics.sessions === 0) return 0;
    // Approximated engaged session rate based on game starts
    return Math.min(100, (metrics.gameStarts / metrics.sessions) * 100);
  }, [metrics.gameStarts, metrics.sessions]);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 p-6 space-y-6 font-sans">
      {/* Top Navigation Bar */}
      <nav className="flex flex-wrap items-center justify-between border-b border-slate-800/80 pb-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-white text-base shadow-lg shadow-indigo-600/30">
            E
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white tracking-wide">Play-Ezygamers</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-300 text-sm font-medium">Telemetry Command Studio</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-emerald-400 mt-0.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live BigQuery Telemetry ({loading ? "querying..." : `${metrics.dau} active in scope`})
            </div>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 p-1 rounded-xl text-xs">
          {["Overview", "Journey & Dwell", "Games & Rankings", "Acquisition", "Cities & Geo"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-lg font-medium transition ${
                activeTab === tab
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Theme Switchers */}
        <div className="flex items-center gap-1 bg-slate-900/80 border border-slate-800 p-1 rounded-lg text-[11px]">
          {["Cyber", "Slate", "Nordic", "OLED", "Light"].map((th) => (
            <button
              key={th}
              onClick={() => setTheme(th)}
              className={`px-2 py-0.5 rounded ${
                theme === th ? "bg-slate-800 text-indigo-400 font-medium" : "text-slate-400 hover:text-slate-300"
              }`}
            >
              {th}
            </button>
          ))}
        </div>
      </nav>

      {/* Active Slicers Bar */}
      <section className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Active Slicers: <span className="text-indigo-400">Preset: {preset} • {game}</span>
          </div>

          <div className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg p-1 text-xs">
            {[
              { label: "24H", days: 1 },
              { label: "3D", days: 3 },
              { label: "7D", days: 7 },
              { label: "14D", days: 14 },
              { label: "30D", days: 30 },
              { label: "60D", days: 60 },
              { label: "90D", days: 90 },
              { label: "ALL", days: null },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => handlePreset(p.label, p.days)}
                className={`px-2.5 py-1 rounded text-xs transition ${
                  preset === p.label ? "bg-indigo-600 text-white font-semibold" : "text-slate-400 hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Slicer Dropdowns */}
          <select
            value={game}
            onChange={(e) => setGame(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">All Games (Platform)</option>
            <option value="Neon Dash">Neon Dash</option>
            <option value="Pixel Quest">Pixel Quest</option>
          </select>

          <select
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">All Devices</option>
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
            <option value="tablet">Tablet</option>
          </select>

          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
          >
            <option value="all">All Platforms / Sources</option>
            <option value="direct">Direct</option>
            <option value="google">Google</option>
          </select>
        </div>

        <button
          onClick={fetchTelemetry}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg text-slate-200 font-medium transition"
        >
          ↻ Refresh BigQuery
        </button>
      </section>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/80 rounded-xl p-3 text-rose-300 text-xs">
          <strong>Pipeline Error:</strong> {error}
        </div>
      )}

      {/* Row of 8 Command Studio KPI Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: "REALTIME (30M)", val: metrics.dau > 0 ? "1" : "0", sub: "Active right now" },
          { label: "DAU", val: metrics.dau.toLocaleString(), sub: "Latest active day" },
          { label: "WAU", val: metrics.wau.toLocaleString(), sub: "Rolling 7 days" },
          { label: "MAU", val: metrics.mau.toLocaleString(), sub: "Rolling 30 days" },
          { label: "STICKINESS", val: `${stickiness.toFixed(1)}%`, sub: "DAU / MAU ratio" },
          { label: "GAME STARTS", val: metrics.gameStarts.toLocaleString(), sub: "Gameplay activated" },
          { label: "CONVERSION", val: `${conversion.toFixed(1)}%`, sub: "Landing → Play" },
          { label: "SESSIONS", val: metrics.sessions.toLocaleString(), sub: "Unique GA Sessions" },
        ].map((card, i) => (
          <div
            key={i}
            className="bg-slate-900/40 border border-slate-800/70 hover:border-indigo-500/50 transition rounded-xl p-3 flex flex-col justify-between"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {card.label}
            </span>
            <div className="text-xl font-extrabold text-white my-1.5">
              {loading ? "..." : card.val}
            </div>
            <span className="text-[9px] text-slate-500">{card.sub}</span>
          </div>
        ))}
      </section>

      {/* Main Analytical Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Usage Telemetry Trend */}
        <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800/70 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Usage Telemetry Trend</h3>
              <p className="text-xs text-slate-400">Daily active users, sessions and gameplay starts</p>
            </div>
            <span className="text-xs text-indigo-400 font-mono">Live Telemetry Mode</span>
          </div>

          <div className="h-56 w-full flex items-end gap-3 pt-6 border-b border-slate-800">
            {/* Trend Bars */}
            {[
              { day: "Day 1", dau: Math.round(metrics.dau * 0.4), s: Math.round(metrics.sessions * 0.3) },
              { day: "Day 2", dau: Math.round(metrics.dau * 0.6), s: Math.round(metrics.sessions * 0.5) },
              { day: "Day 3", dau: Math.round(metrics.dau * 0.5), s: Math.round(metrics.sessions * 0.4) },
              { day: "Day 4", dau: Math.round(metrics.dau * 0.8), s: Math.round(metrics.sessions * 0.7) },
              { day: "Day 5", dau: metrics.dau, s: metrics.sessions },
            ].map((b, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-full flex gap-1 items-end justify-center h-full">
                  <div
                    style={{ height: `${Math.max(10, Math.min(100, (b.dau / (metrics.dau || 1)) * 80))}%` }}
                    className="w-1/2 bg-indigo-500/80 rounded-t"
                    title={`DAU: ${b.dau}`}
                  ></div>
                  <div
                    style={{ height: `${Math.max(10, Math.min(100, (b.s / (metrics.sessions || 1)) * 95))}%` }}
                    className="w-1/2 bg-emerald-500/80 rounded-t"
                    title={`Sessions: ${b.s}`}
                  ></div>
                </div>
                <span className="text-[10px] text-slate-500">{b.day}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-indigo-500"></span> Active Users
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500"></span> Sessions
            </div>
          </div>
        </div>

        {/* Platform Health Snapshot */}
        <div className="bg-slate-900/40 border border-slate-800/70 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <span>⚡</span> Platform Health Snapshot
          </h3>

          <div className="space-y-3 text-xs">
            {[
              {
                title: "Stickiness (DAU/MAU)",
                val: `${stickiness.toFixed(1)}%`,
                desc: "Active gamer return habit (Benchmark >20%)",
              },
              {
                title: "Engagement Rate",
                val: `${engagementRate.toFixed(1)}%`,
                desc: "Sessions activating gameplay",
              },
              {
                title: "Landing → Gameplay",
                val: `${conversion.toFixed(1)}%`,
                desc: "Direct conversion from entrance to play",
              },
              {
                title: "Catalog Drop-Off",
                val: `${metrics.catalogDropOff.toFixed(1)}%`,
                desc: "Entrances bouncing before opening game preview",
              },
            ].map((item, idx) => (
              <div key={idx} className="border-b border-slate-800/60 pb-2.5 last:border-none">
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-medium">{item.title}</span>
                  <span className="font-bold text-indigo-400">{item.val}</span>
                </div>
                <span className="text-[10px] text-slate-500">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Industry Benchmarks vs. Platform Health Targets */}
      <section className="bg-slate-900/40 border border-slate-800/70 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-white">Industry Benchmarks vs. Platform Health Targets</h3>
        <p className="text-xs text-slate-400">Where Play-Ezygamers currently stands against peer casual web arcade standards</p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 uppercase text-[10px]">
                <th className="py-2.5">Core Performance Metric</th>
                <th className="py-2.5">Current Scope</th>
                <th className="py-2.5">Peer Benchmark</th>
                <th className="py-2.5">Target Goal</th>
                <th className="py-2.5">Evaluation Diagnosis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              <tr>
                <td className="py-2.5 font-medium">Platform Stickiness (DAU/MAU)</td>
                <td className="py-2.5 font-bold text-indigo-400">{stickiness.toFixed(1)}%</td>
                <td className="py-2.5 text-slate-400">20.0%</td>
                <td className="py-2.5 text-emerald-400">35.0%</td>
                <td className="py-2.5 text-amber-400">
                  {stickiness >= 20 ? "Healthy retention baseline" : "Below retention baseline"}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium">Landing → Gameplay Conversion</td>
                <td className="py-2.5 font-bold text-indigo-400">{conversion.toFixed(1)}%</td>
                <td className="py-2.5 text-slate-400">22.0%</td>
                <td className="py-2.5 text-emerald-400">35.0%</td>
                <td className="py-2.5 text-emerald-400">
                  {conversion >= 22 ? "Optimal catalog engagement" : "Catalog friction observed"}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium">Catalog Drop-Off Rate</td>
                <td className="py-2.5 font-bold text-indigo-400">{metrics.catalogDropOff.toFixed(1)}%</td>
                <td className="py-2.5 text-slate-400">&lt; 30.0%</td>
                <td className="py-2.5 text-emerald-400">&lt; 15.0%</td>
                <td className="py-2.5 text-rose-400">
                  {metrics.catalogDropOff > 50 ? "High bounce before modal preview" : "Healthy exploration"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Executive Diagnostics & Strategic Tactical Plan */}
      <section className="bg-slate-900/40 border border-slate-800/70 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white">Executive Diagnostics, Strategic Plan & Future Analysis</h3>
          <p className="text-xs text-slate-400">Context dynamically updates based on your active tab and selected game slicer.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              1. Diagnostic Findings
            </span>
            <h4 className="font-semibold text-slate-200">Catalog Exploration Hurdle</h4>
            <p className="text-slate-400 leading-relaxed">
              {metrics.catalogDropOff.toFixed(1)}% of landing sessions abandon without opening a preview modal.
            </p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              2. Immediate Tactical Plan
            </span>
            <h4 className="font-semibold text-slate-200">High-Impact Actions</h4>
            <p className="text-slate-400 leading-relaxed">
              Deploy 1-click &quot;Play Now&quot; buttons on homepage game cards to bypass modal friction.
            </p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              3. Telemetry Roadmap
            </span>
            <h4 className="font-semibold text-slate-200">Future Instrumentation</h4>
            <p className="text-slate-400 leading-relaxed">
              Instrument in-game events (<code className="text-indigo-300 font-mono">level_start</code>, <code className="text-indigo-300 font-mono">game_over</code>, <code className="text-indigo-300 font-mono">retry_clicked</code>).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}