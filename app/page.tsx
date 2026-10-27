'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  Crown,
  Gamepad2,
  HelpCircle,
  Info,
  Lightbulb,
  MapPin,
  Monitor,
  Moon,
  Radio,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Sun,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type View = 'overview' | 'journey' | 'games' | 'acquisition' | 'geo';
type ThemeMode = 'cyber' | 'slate' | 'nordic' | 'light' | 'oled';

type KPIKey =
  | 'realtime'
  | 'dau'
  | 'wau'
  | 'mau'
  | 'stickiness'
  | 'sessions'
  | 'gameStarts'
  | 'conversion'
  | 'engagement'
  | 'playtime';

const KPI_INFO: Record<
  KPIKey,
  {
    title: string;
    short: string;
    definition: string;
    formula: string;
    why: string;
    insight: string;
  }
> = {
  realtime: {
    title: 'Realtime Active Players',
    short: 'Players active in the last 30 minutes of telemetry.',
    definition: 'Count of unique pseudonymous IDs active within the trailing 30-minute window.',
    formula: 'COUNT(DISTINCT user_pseudo_id WHERE event_timestamp >= NOW() - 30m)',
    why: 'Immediate health indicator of concurrent platform presence.',
    insight: 'Spikes in realtime indicate effective marketing pushes or viral game links.',
  },
  dau: {
    title: 'Daily Active Users (DAU)',
    short: 'Unique users active on the latest recorded day in scope.',
    definition: 'Count of distinct players who engaged on the final day of the filter range.',
    formula: 'COUNT(DISTINCT user_pseudo_id WHERE event_date = latestDate)',
    why: 'Demonstrates day-over-day reach and audience retention.',
    insight: 'Higher DAU on weekends signals recreational casual gamer affinity.',
  },
  wau: {
    title: 'Weekly Active Users (WAU)',
    short: 'Unique users across the rolling 7-day period.',
    definition: 'Count of distinct active users over the last 7 calendar days.',
    formula: 'COUNT(DISTINCT user_pseudo_id WHERE event_date >= latestDate - 6d)',
    why: 'Measures short-term player recurring habits and churn velocity.',
    insight: 'A steady WAU with fluctuating DAU indicates inconsistent daily engagement.',
  },
  mau: {
    title: 'Monthly Active Users (MAU)',
    short: 'Unique users active over the trailing 30-day window.',
    definition: 'Total addressable active player base across the month.',
    formula: 'COUNT(DISTINCT user_pseudo_id WHERE event_date >= latestDate - 29d)',
    why: 'Primary benchmark for total platform scale and growth.',
    insight: 'Growth in MAU without growth in DAU suggests low repeat visitation.',
  },
  stickiness: {
    title: 'Audience Stickiness',
    short: 'Ratio of daily to monthly active players.',
    definition: 'Calculates what percentage of your monthly audience returns on any given day.',
    formula: '(DAU / MAU) × 100',
    why: 'Industry gold standard for casual games (benchmark: >20%).',
    insight: 'Scores above 40% reflect a dedicated core group of repeat gamers.',
  },
  sessions: {
    title: 'Total Platform Sessions',
    short: 'Distinct user visits recorded in BigQuery.',
    definition: 'Count of unique ga_session_id occurrences in the selected date span.',
    formula: 'COUNT(DISTINCT session_id)',
    why: 'Quantifies raw web traffic volume arriving at the arcade portal.',
    insight: 'Compare sessions to users to determine average player visit frequency.',
  },
  gameStarts: {
    title: 'Game Starts (Plays)',
    short: 'Sessions in which a game actually executed.',
    definition: 'Count of sessions recording at least one game_start event.',
    formula: 'COUNT(DISTINCT session_id WHERE has_play = 1)',
    why: 'Core conversion milestone distinguishing explorers from players.',
    insight: 'If starts lag behind sessions, users are getting stuck in the catalog.',
  },
  conversion: {
    title: 'Landing → Gameplay Conversion',
    short: 'Percentage of visitors that successfully launch a game.',
    definition: 'Landing sessions that triggered game_start divided by total landing sessions.',
    formula: '(Sessions with game_start / Landing sessions) × 100',
    why: 'Measures catalog UI effectiveness and discoverability.',
    insight: 'A 25% conversion indicates 75% drop-off at the discovery layer.',
  },
  engagement: {
    title: 'Engaged Session Rate',
    short: 'Sessions lasting >10s or viewing 2+ pages (GA4 standard).',
    definition: 'Share of visits deemed engaged by Google Analytics 4 telemetry.',
    formula: '(Engaged sessions / Total sessions) × 100',
    why: 'Filters out accidental clicks, spiders, and immediate bounce visits.',
    insight: 'High engagement (>60%) confirms that retained visitors are genuinely interested.',
  },
  playtime: {
    title: 'Average Session Dwell',
    short: 'Mean engagement seconds spent per session.',
    definition: 'Total active engagement milliseconds divided by total sessions.',
    formula: 'SUM(engagement_msec) / Total sessions / 1000',
    why: 'Direct proxy for player immersion and gameplay enjoyment.',
    insight: 'Sessions exceeding 45 seconds indicate healthy in-game flow.',
  },
};

const PRESETS = [
  ['24h', '24H'],
  ['3', '3D'],
  ['7', '7D'],
  ['14', '14D'],
  ['30', '30D'],
  ['60', '60D'],
  ['90', '90D'],
  ['all', 'ALL'],
] as const;

function formatNumber(value: any) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('en-IN').format(n);
}

function formatPercent(value: any) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function delta(current: any, previous: any) {
  const c = Number(current || 0);
  const p = Number(previous || 0);
  if (!p) return null;
  return ((c - p) / Math.abs(p)) * 100;
}

function DeltaBadge({ current, previous }: { current: any; previous: any }) {
  const d = delta(current, previous);
  if (d === null || !Number.isFinite(d)) {
    return <span className="text-[10px] text-slate-400 font-medium">No prior baseline</span>;
  }
  const positive = d >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
      {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(d).toFixed(1)}% vs prior
    </span>
  );
}

export default function AnalyticsLeadDashboard() {
  const [view, setView] = useState<View>('overview');
  const [theme, setTheme] = useState<ThemeMode>('cyber');
  const [brightness, setBrightness] = useState<number>(100);

  const [days, setDays] = useState('30');
  const [dateMode, setDateMode] = useState<'preset' | 'custom'>('preset');
  const [startDate, setStartDate] = useState('2026-10-01');
  const [endDate, setEndDate] = useState('2026-10-26');

  const [device, setDevice] = useState('all');
  const [game, setGame] = useState('all');
  const [source, setSource] = useState('all');

  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedKPI, setSelectedKPI] = useState<KPIKey | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (dateMode === 'custom') {
        params.set('startDate', startDate);
        params.set('endDate', endDate);
      } else {
        params.set('days', days);
      }

      params.set('device', device);
      params.set('game', game);
      params.set('source', source);

      const response = await fetch(`/api/funnel?${params.toString()}`, { cache: 'no-store' });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || 'Failed to load telemetry from BigQuery');
      }

      setPayload(json.data || {});
    } catch (err: any) {
      setError(err?.message || 'Failed to query BigQuery telemetry');
    } finally {
      setLoading(false);
    }
  }, [dateMode, days, startDate, endDate, device, game, source]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const s = payload?.summary || {};
  const previous = payload?.previous_summary || {};
  const windows = payload?.user_windows || {};

  const games = payload?.games || [];
  const dropoffs = payload?.dropoffs || [];
  const locations = payload?.locations || [];
  const acquisition = payload?.acquisition || [];
  const trend = payload?.trend || [];

  const realtimeUsers = Number(windows.realtime_active_30m || 0);
  const dau = Number(windows.dau || 0);
  const wau = Number(windows.wau || 0);
  const mau = Number(windows.mau || 0);
  const stickiness = mau ? (dau / mau) * 100 : 0;

  const totalSessions = Number(s.total_sessions || 0);
  const totalUsers = Number(s.total_users || 0);
  const gameStarts = Number(s.game_start_sessions || 0);
  const conversion = Number(s.conversion_rate_pct || 0);
  const engagement = Number(s.engagement_rate_pct || 0);
  const avgDuration = Number(s.avg_session_duration_sec || 0);

  const landing = Number(s.landing_sessions || 0);
  const preview = Number(s.preview_sessions || 0);
  const previewDrop = landing ? ((landing - preview) / landing) * 100 : 0;

  // Rankings derived from current filtered dataset
  const topByAvgDwell = useMemo(() => {
    return [...games].sort((a: any, b: any) => Number(b.avg_dwell_sec || 0) - Number(a.avg_dwell_sec || 0)).slice(0, 5);
  }, [games]);

  const topByTotalPlaytime = useMemo(() => {
    return [...games].sort((a: any, b: any) => Number(b.total_playtime_sec || 0) - Number(a.total_playtime_sec || 0)).slice(0, 5);
  }, [games]);

  const lowestByAvgDwell = useMemo(() => {
    return [...games].sort((a: any, b: any) => Number(a.avg_dwell_sec || 0) - Number(b.avg_dwell_sec || 0)).slice(0, 3);
  }, [games]);

  // Industry Benchmarks vs Current vs Targets
  const benchmarkMatrix = [
    {
      metric: 'Platform Stickiness (DAU/MAU)',
      current: `${stickiness.toFixed(1)}%`,
      benchmark: '20.0%',
      target: '35.0%',
      status: stickiness >= 35 ? 'success' : stickiness >= 20 ? 'warning' : 'danger',
      evaluation: stickiness >= 20 ? 'Above casual industry average' : 'Below retention baseline',
    },
    {
      metric: 'GA4 Engaged Session Rate',
      current: `${engagement.toFixed(1)}%`,
      benchmark: '55.0%',
      target: '70.0%',
      status: engagement >= 70 ? 'success' : engagement >= 55 ? 'warning' : 'danger',
      evaluation: engagement >= 55 ? 'Healthy visitor interest' : 'High immediate bounce rate',
    },
    {
      metric: 'Landing → Gameplay Conversion',
      current: `${conversion.toFixed(1)}%`,
      benchmark: '22.0%',
      target: '35.0%',
      status: conversion >= 35 ? 'success' : conversion >= 22 ? 'warning' : 'danger',
      evaluation: conversion >= 22 ? 'Solid modal-to-play conversion' : 'Severe catalog friction',
    },
    {
      metric: 'Immediate Game Bounce (<5s)',
      current: `${(games[0]?.bounce_rate_pct || 0)}%`,
      benchmark: '< 25.0%',
      target: '< 15.0%',
      status: (games[0]?.bounce_rate_pct || 0) <= 15 ? 'success' : (games[0]?.bounce_rate_pct || 0) <= 25 ? 'warning' : 'danger',
      evaluation: (games[0]?.bounce_rate_pct || 0) <= 25 ? 'Acceptable load drop' : 'Iframe latency/confusion',
    },
    {
      metric: 'Average Gameplay Dwell',
      current: `${(s?.avg_gameplay_dwell_sec || 0)}s`,
      benchmark: '45.0s',
      target: '90.0s',
      status: (s?.avg_gameplay_dwell_sec || 0) >= 90 ? 'success' : (s?.avg_gameplay_dwell_sec || 0) >= 45 ? 'warning' : 'danger',
      evaluation: (s?.avg_gameplay_dwell_sec || 0) >= 45 ? 'Players complete first run' : 'Early gameplay abandonment',
    },
  ];

  // 5 Distinct High-Contrast Theme Palettes
  const themeClasses = useMemo(() => {
    switch (theme) {
      case 'light':
        return {
          bg: 'bg-slate-100 text-slate-900',
          card: 'bg-white border-slate-300 shadow-md text-slate-900',
          sub: 'bg-slate-50 border-slate-300 text-slate-800',
          text: 'text-slate-600',
          border: 'border-slate-300',
          table: 'bg-slate-200 text-slate-800',
        };
      case 'slate':
        return {
          bg: 'bg-[#0f172a] text-slate-50',
          card: 'bg-[#1e293b] border-slate-600 shadow-lg text-slate-50',
          sub: 'bg-[#152033] border-slate-600 text-slate-200',
          text: 'text-slate-300',
          border: 'border-slate-600',
          table: 'bg-[#0b1329] text-slate-200',
        };
      case 'nordic':
        return {
          bg: 'bg-[#1a2332] text-slate-100',
          card: 'bg-[#243044] border-slate-600 shadow-lg text-slate-100',
          sub: 'bg-[#1e2a3c] border-slate-600 text-slate-200',
          text: 'text-slate-300',
          border: 'border-slate-600',
          table: 'bg-[#172130] text-slate-200',
        };
      case 'oled':
        return {
          bg: 'bg-[#000000] text-slate-100',
          card: 'bg-[#0a0a0a] border-zinc-800 shadow-xl text-slate-100',
          sub: 'bg-[#121212] border-zinc-800 text-slate-200',
          text: 'text-zinc-400',
          border: 'border-zinc-800',
          table: 'bg-[#181818] text-slate-200',
        };
      case 'cyber':
      default:
        return {
          bg: 'bg-[#070b14] text-slate-100',
          card: 'bg-[#0f172a] border-slate-700 shadow-lg text-slate-100',
          sub: 'bg-[#162032] border-slate-700 text-slate-200',
          text: 'text-slate-300',
          border: 'border-slate-700',
          table: 'bg-[#1a263d] text-slate-100',
        };
    }
  }, [theme]);

  const kpis = [
    {
      key: 'realtime' as KPIKey,
      label: 'Realtime (30m)',
      value: formatNumber(realtimeUsers),
      sub: 'Active right now',
      icon: Radio,
      color: 'text-emerald-400',
      current: realtimeUsers,
      previous: null,
      pulse: true,
    },
    {
      key: 'dau' as KPIKey,
      label: 'DAU',
      value: formatNumber(dau),
      sub: 'Latest active day',
      icon: Users,
      color: 'text-indigo-400',
      current: dau,
      previous: previous.total_users,
    },
    {
      key: 'wau' as KPIKey,
      label: 'WAU',
      value: formatNumber(wau),
      sub: 'Rolling 7 days',
      icon: Activity,
      color: 'text-sky-400',
      current: wau,
      previous: null,
    },
    {
      key: 'mau' as KPIKey,
      label: 'MAU',
      value: formatNumber(mau),
      sub: 'Rolling 30 days',
      icon: Calendar,
      color: 'text-purple-400',
      current: mau,
      previous: null,
    },
    {
      key: 'stickiness' as KPIKey,
      label: 'Stickiness',
      value: formatPercent(stickiness),
      sub: 'DAU / MAU ratio',
      icon: Zap,
      color: 'text-emerald-400',
      current: stickiness,
      previous: null,
    },
    {
      key: 'gameStarts' as KPIKey,
      label: 'Game Starts',
      value: formatNumber(gameStarts),
      sub: game !== 'all' ? `${game} Plays` : 'Gameplay activated',
      icon: Gamepad2,
      color: 'text-violet-400',
      current: gameStarts,
      previous: previous.game_start_sessions,
    },
    {
      key: 'conversion' as KPIKey,
      label: 'Conversion',
      value: formatPercent(conversion),
      sub: 'Landing → Play',
      icon: Target,
      color: 'text-emerald-400',
      current: conversion,
      previous: previous.conversion_rate_pct,
    },
    {
      key: 'sessions' as KPIKey,
      label: 'Sessions',
      value: formatNumber(totalSessions),
      sub: `${formatNumber(s.engaged_sessions)} engaged`,
      icon: BarChart3,
      color: 'text-amber-400',
      current: totalSessions,
      previous: previous.total_sessions,
    },
  ];

  return (
    <div
      style={{ filter: `brightness(${brightness}%)` }}
      className={`min-h-screen ${themeClasses.bg} transition-colors duration-200`}
    >
      {/* HEADER */}
      <header className={`sticky top-0 z-50 border-b backdrop-blur-xl ${themeClasses.card}`}>
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            {view !== 'overview' && (
              <button
                onClick={() => setView('overview')}
                className="flex items-center gap-1 rounded-lg border border-indigo-500 bg-indigo-600/20 px-3 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-600 hover:text-white transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Overview
              </button>
            )}

            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 font-black text-white shadow-lg">
              E
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-tight text-white">Play-Ezygamers</span>
                <span className="hidden font-mono text-xs text-slate-400 sm:inline">
                  / Telemetry Command Studio
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Live BigQuery Telemetry ({formatNumber(realtimeUsers)} active in 30m)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`hidden rounded-lg border p-1 md:flex ${themeClasses.sub}`}>
              {[
                ['overview', 'Overview'],
                ['journey', 'Journey & Dwell'],
                ['games', 'Games & Rankings'],
                ['acquisition', 'Acquisition'],
                ['geo', 'Cities & Geo'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setView(id as View);
                    setSelectedKPI(null);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    view === id ? 'bg-indigo-600 text-white shadow' : `${themeClasses.text} hover:text-white`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Brightness Controller */}
            <div className={`hidden lg:flex items-center gap-2 rounded-lg border px-3 py-1 text-xs ${themeClasses.sub}`}>
              <Sun className="h-3.5 w-3.5 text-amber-400" />
              <input
                type="range"
                min="70"
                max="130"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-16 h-1 bg-slate-700 rounded-lg cursor-pointer accent-indigo-500"
                title={`Brightness: ${brightness}%`}
              />
              <span className="text-[10px] font-mono text-white font-bold">{brightness}%</span>
            </div>

            {/* Expanded 5-Theme Switcher */}
            <div className={`flex rounded-lg border p-0.5 ${themeClasses.sub}`}>
              {[
                { id: 'cyber', label: 'Cyber', icon: Moon },
                { id: 'slate', label: 'Slate', icon: Sliders },
                { id: 'nordic', label: 'Nordic', icon: Compass },
                { id: 'oled', label: 'OLED', icon: ShieldCheck },
                { id: 'light', label: 'Light', icon: Sun },
              ].map((t) => {
                const Icon = t.icon;
                const active = theme === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id as ThemeMode)}
                    className={`rounded p-1.5 text-xs flex items-center gap-1 font-semibold transition ${
                      active ? 'bg-indigo-600 text-white font-bold shadow' : themeClasses.text
                    }`}
                    title={`${t.label} Theme`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden xl:inline text-[10px]">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 lg:px-8">
        
        {/* SLICERS BAR */}
        <section className={`rounded-2xl border p-4 ${themeClasses.card}`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-indigo-400">
                <span>Active Slicers</span>
                <div className="group relative cursor-pointer">
                  <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-indigo-400 transition" />
                  <div className="pointer-events-none absolute left-0 top-5 z-50 hidden w-64 rounded-xl border border-slate-700 bg-slate-950 p-3 text-[11px] text-slate-200 shadow-2xl group-hover:block">
                    <b>Live Filters</b>: Adjusting dropdowns queries BigQuery directly. Changing games instantly adjusts Trend line charts and Platform Health Snapshots.
                  </div>
                </div>
              </div>
              <div className="mt-1 text-xs text-white font-semibold">
                <span className="text-indigo-400 font-bold">{dateMode === 'custom' ? `${startDate} → ${endDate}` : `Preset: ${days.toUpperCase()}`}</span> &bull; 
                <span className="text-amber-400 font-bold"> {device.toUpperCase()}</span> &bull; 
                <span className="text-emerald-400 font-bold"> {game === 'all' ? 'All Games' : game}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className={`flex rounded-lg border p-0.5 ${themeClasses.sub}`}>
                <button
                  onClick={() => setDateMode('preset')}
                  className={`rounded px-2.5 py-1.5 text-xs font-bold ${
                    dateMode === 'preset' ? 'bg-indigo-600 text-white' : themeClasses.text
                  }`}
                >
                  Presets
                </button>
                <button
                  onClick={() => setDateMode('custom')}
                  className={`rounded px-2.5 py-1.5 text-xs font-bold ${
                    dateMode === 'custom' ? 'bg-indigo-600 text-white' : themeClasses.text
                  }`}
                >
                  Custom
                </button>
              </div>

              {dateMode === 'preset' ? (
                <div className={`flex rounded-lg border p-1 ${themeClasses.sub}`}>
                  {PRESETS.map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setDays(val)}
                      className={`rounded px-2.5 py-1.5 text-[11px] font-bold ${
                        days === val ? 'bg-indigo-600 text-white shadow' : `${themeClasses.text} hover:text-white`
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${themeClasses.sub}`}>
                  <Calendar className="h-3.5 w-3.5 text-indigo-400" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-transparent outline-none cursor-pointer text-white font-semibold"
                  />
                  <span className="text-slate-400 font-bold">&rarr;</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-transparent outline-none cursor-pointer text-white font-semibold"
                  />
                </div>
              )}

              {/* Game Slicer */}
              <select
                value={game}
                onChange={(e) => setGame(e.target.value)}
                className={`rounded-lg border px-3 py-2 text-xs outline-none cursor-pointer text-white font-bold ${themeClasses.sub}`}
              >
                <option value="all" className="bg-slate-900 text-white">All Games (Platform)</option>
                {games.map((g: any) => (
                  <option key={g.game_id} value={g.game_id} className="bg-slate-900 text-white">
                    {g.game_id}
                  </option>
                ))}
              </select>

              {/* Device Slicer */}
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                className={`rounded-lg border px-3 py-2 text-xs outline-none cursor-pointer text-white font-bold ${themeClasses.sub}`}
              >
                <option value="all" className="bg-slate-900 text-white">All Devices</option>
                <option value="desktop" className="bg-slate-900 text-white">Desktop</option>
                <option value="mobile" className="bg-slate-900 text-white">Mobile</option>
                <option value="tablet" className="bg-slate-900 text-white">Tablet</option>
              </select>

              {/* Source Slicer */}
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={`max-w-[150px] rounded-lg border px-3 py-2 text-xs outline-none cursor-pointer text-white font-bold ${themeClasses.sub}`}
              >
                <option value="all" className="bg-slate-900 text-white">All Platforms / Sources</option>
                {acquisition.map((a: any) => (
                  <option key={`${a.source}-${a.medium}`} value={a.source} className="bg-slate-900 text-white">
                    {a.source}
                  </option>
                ))}
              </select>

              <button
                onClick={fetchData}
                className={`rounded-lg border p-2 hover:border-indigo-500 transition ${themeClasses.sub}`}
                title="Refresh Live BigQuery Data"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-indigo-400' : 'text-slate-200'}`} />
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4 text-sm text-rose-300">
            <div className="font-bold">Pipeline Error:</div>
            <div className="mt-1 font-mono text-xs">{error}</div>
          </div>
        )}

        {/* HIGH-CONTRAST 8-COLUMN KPI GRID */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            const active = selectedKPI === kpi.key;
            const info = KPI_INFO[kpi.key];

            return (
              <div key={kpi.key} className="group relative">
                <button
                  onClick={() => setSelectedKPI(active ? null : kpi.key)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 ${
                    active ? 'border-indigo-500 bg-indigo-600/20' : themeClasses.card
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{kpi.label}</span>
                    <Icon className={`h-4 w-4 ${kpi.color} ${kpi.pulse ? 'animate-pulse' : ''}`} />
                  </div>

                  <div className="mt-3 text-2xl font-black text-white tracking-tight">{kpi.value}</div>
                  <div className="mt-1 text-[10px] text-slate-300 font-medium">{kpi.sub}</div>

                  <div className="mt-2">
                    <DeltaBadge current={kpi.current} previous={kpi.previous} />
                  </div>
                </button>

                <div className="pointer-events-none absolute left-0 top-full z-40 hidden w-64 rounded-xl border border-slate-700 bg-slate-950 p-3 text-[11px] text-slate-200 shadow-2xl group-hover:block mt-1">
                  <div className="flex items-center gap-1.5 font-bold text-white">
                    <Info className="h-3.5 w-3.5 text-indigo-400" /> {info.title}
                  </div>
                  <div className="mt-1 text-slate-300">{info.short}</div>
                  <div className="mt-2 rounded bg-black/50 p-1.5 font-mono text-[10px] text-indigo-300 border border-slate-800">
                    {info.formula}
                  </div>
                  <div className="mt-2 text-emerald-400 font-semibold text-[10px]">
                    Insight: {info.insight}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        {/* OVERVIEW VIEW */}
        {view === 'overview' && (
          <div className="space-y-6">
            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className={`rounded-2xl border p-6 lg:col-span-2 ${themeClasses.card}`}>
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-white text-base">
                      Usage Telemetry Trend {game !== 'all' ? `(${game})` : ''}
                    </h2>
                    <p className={`mt-1 text-xs ${themeClasses.text}`}>Daily active users, sessions and gameplay starts</p>
                  </div>
                  <BarChart3 className="h-5 w-5 text-indigo-400" />
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend}>
                      <defs>
                        <linearGradient id="usersFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#475569" />
                      <XAxis dataKey="date_label" tick={{ fontSize: 10, fill: '#cbd5e1' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#cbd5e1' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#475569', borderRadius: 8, fontSize: 12, color: '#fff' }} />
                      <Area type="monotone" dataKey="dau" stroke="#818cf8" strokeWidth={2.5} fill="url(#usersFill)" name="DAU" />
                      <Line type="monotone" dataKey="plays" stroke="#34d399" strokeWidth={2.5} name="Game Starts" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Reactive Health Snapshot with Explanations */}
              <div className={`rounded-2xl border p-6 ${themeClasses.card}`}>
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-emerald-400" />
                  <h2 className="font-bold text-white text-base">
                    Platform Health Snapshot {game !== 'all' ? `(${game})` : ''}
                  </h2>
                </div>

                <div className="mt-5 space-y-3">
                  {[
                    ['Stickiness (DAU/MAU)', formatPercent(stickiness), 'text-emerald-400', 'Active gamer return habit (Benchmark >20%)'],
                    ['Engagement Rate', formatPercent(engagement), 'text-sky-400', 'Sessions exceeding 10s or viewing 2+ pages'],
                    ['Landing → Gameplay', formatPercent(conversion), 'text-indigo-400', 'Direct conversion from entrance to play'],
                    ['Avg Session Dwell', `${avgDuration.toFixed(1)}s`, 'text-amber-400', 'Total active session duration in milliseconds'],
                    ['Catalog Drop-Off', formatPercent(previewDrop), 'text-rose-400', 'Entrances bouncing before opening game preview'],
                  ].map(([label, value, color, desc]) => (
                    <div key={label} className={`rounded-xl border p-3 flex flex-col gap-1 ${themeClasses.sub}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">{label}</span>
                        <span className={`text-base font-black ${color}`}>{value}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Benchmark vs Current Performance Table */}
            <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
              <div className="mb-4">
                <h2 className="font-bold text-white text-base">Industry Benchmarks vs. Platform Health Targets</h2>
                <p className={`mt-1 text-xs ${themeClasses.text}`}>
                  Where Play-Ezygamers currently stands against peer casual web arcade standards
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={themeClasses.table}>
                    <tr>
                      <th className="p-3 font-bold text-slate-200">Core Performance Metric</th>
                      <th className="p-3 font-bold text-slate-200">Current Scope</th>
                      <th className="p-3 font-bold text-slate-200">Peer Benchmark</th>
                      <th className="p-3 font-bold text-slate-200">Target Goal</th>
                      <th className="p-3 font-bold text-slate-200">Evaluation Diagnosis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {benchmarkMatrix.map((b) => (
                      <tr key={b.metric} className={`border-t ${themeClasses.border} hover:bg-slate-800/20`}>
                        <td className="p-3 font-bold text-white">{b.metric}</td>
                        <td className="p-3 font-black text-indigo-400 text-sm">{b.current}</td>
                        <td className="p-3 text-slate-300 font-semibold">{b.benchmark}</td>
                        <td className="p-3 text-emerald-400 font-bold">{b.target}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-[11px] font-bold ${
                            b.status === 'success' ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800' :
                            b.status === 'warning' ? 'bg-amber-950/60 text-amber-300 border border-amber-800' :
                            'bg-rose-950/60 text-rose-300 border border-rose-800'
                          }`}>
                            {b.evaluation}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* JOURNEY VIEW (Deep Step Dwell Times & Drop-off Flow) */}
        {view === 'journey' && (
          <div className="space-y-6">
            <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-white text-base">
                    Player Funnel Step-by-Step Progression {game !== 'all' ? `(${game})` : ''}
                  </h2>
                  <p className={`mt-1 text-xs ${themeClasses.text}`}>
                    Where players enter, preview rules, and convert to active gameplay
                  </p>
                </div>
                <div className="text-xs text-rose-400 font-bold bg-rose-950/40 border border-rose-900/60 px-3 py-1 rounded-lg">
                  Primary Churn Point: -{previewDrop.toFixed(1)}% at Catalog
                </div>
              </div>

              {/* Step Dwell Times Breakdown with Total Playtime */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
                  <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Step 1: Landing Entrance</div>
                  <div className="mt-2 text-3xl font-black text-white">{formatNumber(landing)} Sessions</div>
                  <div className="mt-1 text-xs text-slate-300">Avg Dwell: <b className="text-white">{s?.avg_landing_dwell_sec || 0}s</b> before click</div>
                </div>

                <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
                  <div className="text-xs font-bold text-purple-400 uppercase tracking-wider">Step 2: Modal Preview</div>
                  <div className="mt-2 text-3xl font-black text-white">{formatNumber(preview)} Previews</div>
                  <div className="mt-1 text-xs text-purple-300 font-semibold">Avg Dwell: <b className="text-white">{s?.avg_preview_dwell_sec || 0}s</b> reading rules</div>
                </div>

                <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
                  <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Step 3: Active Gameplay</div>
                  <div className="mt-2 text-3xl font-black text-emerald-400">{formatNumber(gameStarts)} Plays</div>
                  <div className="mt-1 text-xs text-emerald-300 font-semibold">Avg Playtime: <b className="text-white">{s?.avg_gameplay_dwell_sec || 0}s</b> in-game</div>
                </div>

                <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
                  <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Cumulative Playtime</div>
                  <div className="mt-2 text-3xl font-black text-amber-400">{formatNumber(s?.total_gameplay_playtime_sec || 0)}s</div>
                  <div className="mt-1 text-xs text-slate-300">Total in-game engagement</div>
                </div>
              </div>

              <div className="mt-6 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { step: 'Landing', value: landing },
                    { step: 'Preview', value: preview },
                    { step: 'Gameplay', value: gameStarts },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} stroke="#475569" />
                    <XAxis dataKey="step" tick={{ fill: '#cbd5e1', fontWeight: 'bold' }} />
                    <YAxis tick={{ fill: '#cbd5e1' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#475569', borderRadius: 8, fontSize: 12, color: '#fff' }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      <Cell fill="#6366f1" />
                      <Cell fill="#a855f7" />
                      <Cell fill="#10b981" />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            {/* Terminal Drop-off Diagnostics */}
            <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
              <div className="mb-4">
                <h2 className="font-bold text-white text-base">
                  Terminal Drop-Off & Exit Diagnostics {game !== 'all' ? `(${game})` : ''}
                </h2>
                <p className={`mt-1 text-xs ${themeClasses.text}`}>Exact event where players quit the session and inferred cause</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={themeClasses.table}>
                    <tr>
                      <th className="p-3 font-bold text-slate-200">Terminal Event</th>
                      <th className="p-3 font-bold text-slate-200">Sessions Ended</th>
                      <th className="p-3 font-bold text-slate-200">Users Lost</th>
                      <th className="p-3 font-bold text-slate-200">Dwell Before Churn</th>
                      <th className="p-3 font-bold text-slate-200">Behavioral Diagnosis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dropoffs.map((d: any) => (
                      <tr key={d.terminal_event} className={`border-t ${themeClasses.border} hover:bg-slate-800/20`}>
                        <td className="p-3 font-mono font-bold text-rose-400">{d.terminal_event}</td>
                        <td className="p-3 font-black text-white text-sm">{formatNumber(d.sessions_ended_here)}</td>
                        <td className="p-3 font-bold text-slate-300">{formatNumber(d.users_lost)}</td>
                        <td className="p-3 font-bold text-amber-400">{Number(d.avg_dwell_before_churn_sec || 0).toFixed(1)}s</td>
                        <td className="p-3">
                          <span className="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700 font-semibold">
                            {d.churn_reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* GAMES VIEW (Top 5 by Avg Dwell, Top 5 by Total Playtime, Low Games) */}
        {view === 'games' && (
          <div className="space-y-6">
            
            {/* Top 5 Rankings Cards Filtered by Active Date */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              
              {/* Top 5 by Avg Dwell */}
              <div className={`rounded-2xl border p-6 ${themeClasses.card}`}>
                <div className="flex items-center gap-2 mb-4">
                  <Crown className="h-5 w-5 text-amber-400" />
                  <div>
                    <h2 className="font-bold text-white text-base">Top 5 Games by Average Playtime</h2>
                    <p className={`text-xs ${themeClasses.text}`}>Titles keeping players immersed longest per session (Scope: {dateMode === 'custom' ? `${startDate} → ${endDate}` : `Last ${days.toUpperCase()}`})</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {topByAvgDwell.map((g: any, i: number) => (
                    <div key={g.game_id} className={`p-3 rounded-xl border flex items-center justify-between ${themeClasses.sub}`}>
                      <div className="flex items-center gap-3">
                        <span className="h-6 w-6 rounded-full bg-indigo-600/30 text-indigo-400 font-bold flex items-center justify-center text-xs">
                          {i + 1}
                        </span>
                        <div>
                          <div className="font-bold text-white text-sm">{g.game_id}</div>
                          <div className="text-[10px] text-slate-400">{g.starts} starts &bull; {g.unique_players} players</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-black text-emerald-400">{g.avg_dwell_sec}s</div>
                        <div className="text-[10px] text-slate-400">avg dwell</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top 5 by Total Cumulative Playtime */}
              <div className={`rounded-2xl border p-6 ${themeClasses.card}`}>
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="h-5 w-5 text-indigo-400" />
                  <div>
                    <h2 className="font-bold text-white text-base">Top 5 Games by Total Playtime</h2>
                    <p className={`text-xs ${themeClasses.text}`}>Highest cumulative seconds played across active date scope</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {topByTotalPlaytime.map((g: any, i: number) => (
                    <div key={g.game_id} className={`p-3 rounded-xl border flex items-center justify-between ${themeClasses.sub}`}>
                      <div className="flex items-center gap-3">
                        <span className="h-6 w-6 rounded-full bg-purple-600/30 text-purple-400 font-bold flex items-center justify-center text-xs">
                          {i + 1}
                        </span>
                        <div>
                          <div className="font-bold text-white text-sm">{g.game_id}</div>
                          <div className="text-[10px] text-slate-400">{g.starts} starts &bull; {g.bounce_rate_pct}% bounce</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-base font-black text-purple-400">{g.total_playtime_sec}s</div>
                        <div className="text-[10px] text-slate-400">total time</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Low-Performing Games Alert */}
            <div className={`rounded-2xl border p-6 border-amber-900/60 bg-amber-950/10`}>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                <h3 className="font-bold text-amber-300 text-sm">Low-Engagement Titles (Action Required)</h3>
              </div>
              <p className="text-xs text-slate-300 mb-4">
                Titles with high bounce rates (&gt;50%) or low dwell times (&lt;5s) indicate loading latency or unintuitive controls.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {lowestByAvgDwell.map((g: any) => (
                  <div key={g.game_id} className="p-3 rounded-xl bg-slate-900 border border-slate-700">
                    <div className="font-bold text-white text-xs">{g.game_id}</div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Avg Dwell: <b className="text-amber-400">{g.avg_dwell_sec}s</b></span>
                      <span className="text-rose-400 font-bold">{g.bounce_rate_pct}% Bounce</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Complete Game Ledger */}
            <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
              <h2 className="font-bold text-white text-base mb-4">Complete Game Catalog Diagnostics</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={themeClasses.table}>
                    <tr>
                      <th className="p-3 font-bold text-slate-200">Game Title</th>
                      <th className="p-3 font-bold text-slate-200">Starts</th>
                      <th className="p-3 font-bold text-slate-200">Players</th>
                      <th className="p-3 font-bold text-slate-200">Total Playtime</th>
                      <th className="p-3 font-bold text-slate-200">Avg Playtime</th>
                      <th className="p-3 font-bold text-slate-200">Bounce Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.map((g: any) => (
                      <tr key={g.game_id} className={`border-t ${themeClasses.border} hover:bg-slate-800/20`}>
                        <td className="p-3 font-bold text-white">{g.game_id}</td>
                        <td className="p-3 font-black text-purple-400">{formatNumber(g.starts)}</td>
                        <td className="p-3 font-semibold text-slate-300">{formatNumber(g.unique_players)}</td>
                        <td className="p-3 font-semibold text-slate-300">{formatNumber(g.total_playtime_sec)}s</td>
                        <td className="p-3 text-emerald-400 font-black">{Number(g.avg_dwell_sec || 0).toFixed(1)}s</td>
                        <td className={`p-3 font-bold ${Number(g.bounce_rate_pct || 0) > 25 ? 'text-rose-400' : 'text-slate-300'}`}>
                          {formatPercent(g.bounce_rate_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ACQUISITION PLATFORMS VIEW */}
        {view === 'acquisition' && (
          <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-white text-base">Inbound Acquisition Platforms</h2>
                <p className={`mt-1 text-xs ${themeClasses.text}`}>
                  Where players come from (Direct, Google Search, Social Media) and gameplay conversion quality
                </p>
              </div>
              <Share2 className="h-5 w-5 text-indigo-400" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className={themeClasses.table}>
                  <tr>
                    <th className="p-3 font-bold text-slate-200">Platform / Source</th>
                    <th className="p-3 font-bold text-slate-200">Medium</th>
                    <th className="p-3 font-bold text-slate-200">Users</th>
                    <th className="p-3 font-bold text-slate-200">Sessions</th>
                    <th className="p-3 font-bold text-slate-200">Game Starts</th>
                    <th className="p-3 font-bold text-slate-200">Conversion Rate</th>
                    <th className="p-3 font-bold text-slate-200">Avg Dwell</th>
                  </tr>
                </thead>
                <tbody>
                  {acquisition.map((a: any) => (
                    <tr key={`${a.source}-${a.medium}`} className={`border-t ${themeClasses.border} hover:bg-slate-800/20`}>
                      <td className="p-3 font-bold text-white">{a.source}</td>
                      <td className="p-3 text-slate-300">{a.medium}</td>
                      <td className="p-3 font-bold text-indigo-400">{formatNumber(a.users)}</td>
                      <td className="p-3 text-slate-200">{formatNumber(a.sessions)}</td>
                      <td className="p-3 text-purple-400 font-black">{formatNumber(a.game_starts)}</td>
                      <td className="p-3 text-emerald-400 font-black">{formatPercent(a.conversion_rate_pct)}</td>
                      <td className="p-3 text-amber-400 font-bold">{Number(a.avg_dwell_sec || 0).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ALL CITIES & GEO VIEW */}
        {view === 'geo' && (
          <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-cyan-400" />
                <div>
                  <h2 className="font-bold text-white text-base">All Cities & Regions With Gameplay</h2>
                  <p className={`mt-1 text-xs ${themeClasses.text}`}>Every municipality that generated player sessions</p>
                </div>
              </div>
              <span className="text-xs font-mono text-cyan-400 font-bold bg-cyan-950/40 border border-cyan-800/50 px-3 py-1 rounded-lg">
                Total Locations: {locations.length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className={themeClasses.table}>
                  <tr>
                    <th className="p-3 font-bold text-slate-200">City / Municipality</th>
                    <th className="p-3 font-bold text-slate-200">Country</th>
                    <th className="p-3 font-bold text-slate-200">Users</th>
                    <th className="p-3 font-bold text-slate-200">Sessions</th>
                    <th className="p-3 font-bold text-slate-200">Game Starts</th>
                    <th className="p-3 font-bold text-slate-200">Avg Dwell</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l: any) => (
                    <tr key={`${l.city}-${l.country}`} className={`border-t ${themeClasses.border} hover:bg-slate-800/20`}>
                      <td className="p-3 font-bold text-white">{l.city}</td>
                      <td className="p-3 text-slate-300">{l.country}</td>
                      <td className="p-3 text-cyan-400 font-bold">{formatNumber(l.users)}</td>
                      <td className="p-3 text-slate-200">{formatNumber(l.sessions)}</td>
                      <td className="p-3 text-purple-400 font-bold">{formatNumber(l.game_starts)}</td>
                      <td className="p-3 text-amber-400 font-black">{Number(l.avg_dwell_sec || 0).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* DYNAMIC CONTEXT-AWARE EXECUTIVE INSIGHTS PANEL */}
        <section className={`rounded-2xl border p-6 ${themeClasses.card}`}>
          <div className="flex flex-col justify-between gap-3 border-b border-slate-700 pb-4 md:flex-row md:items-center">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-400" />
                <h2 className="font-bold text-white text-base">
                  Executive Diagnostics, Strategic Plan & Future Analysis
                </h2>
              </div>
              <p className={`mt-1 text-xs ${themeClasses.text}`}>
                Context dynamically updates based on your active tab and selected game slicer.
              </p>
            </div>

            <span className="rounded-lg border border-indigo-500 bg-indigo-950/60 px-3 py-1.5 text-xs font-mono text-indigo-300 font-bold">
              ACTIVE SCOPE: {view.toUpperCase()} &bull; {game}
            </span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-400">
                <Sparkles className="h-4 w-4" /> 1. Diagnostic Findings
              </div>
              <h3 className="mt-3 font-bold text-white">
                {game !== 'all' ? `${game} Funnel Friction` : 'Catalog Exploration Hurdle'}
              </h3>
              <p className="mt-2 text-xs leading-6 text-slate-200">
                {game !== 'all'
                  ? `For ${game}, ${previewDrop.toFixed(1)}% of inbound sessions churned before the preview modal. Total starts reached ${formatNumber(gameStarts)} with an overall conversion of ${formatPercent(conversion)}.`
                  : `${previewDrop.toFixed(1)}% of landing sessions abandon without opening a preview modal. However, when users enter gameplay, they dwell for an average of ${avgDuration.toFixed(1)}s.`
                }
              </p>
            </div>

            <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                <Lightbulb className="h-4 w-4" /> 2. Immediate Tactical Plan
              </div>
              <h3 className="mt-3 font-bold text-white">High-Impact Actions</h3>
              <p className="mt-2 text-xs leading-6 text-slate-200">
                {game !== 'all'
                  ? `Promote ${game} directly on the homepage with an instant-launch button, bypassing the preview modal step entirely to capture hesitant visitors.`
                  : 'Deploy 1-click "Play Now" buttons on homepage game cards to bypass modal friction, and feature Neon Dash prominently above the fold.'
                }
              </p>
            </div>

            <div className={`rounded-2xl border p-5 ${themeClasses.sub}`}>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-400">
                <TrendingUp className="h-4 w-4" /> 3. Telemetry Roadmap
              </div>
              <h3 className="mt-3 font-bold text-white">Future Instrumentation</h3>
              <p className="mt-2 text-xs leading-6 text-slate-200">
                Instrument in-game events (<code className="text-purple-300">level_start</code>, <code className="text-purple-300">game_over</code>, <code className="text-purple-300">retry_clicked</code>) to build complete in-game retention and level completion funnels.
              </p>
            </div>
          </div>
        </section>

      </main>

      {/* KPI DRILLDOWN DRAWER */}
      {selectedKPI && (
        <div className="fixed inset-0 z-[100] flex justify-end bg-black/70 backdrop-blur-sm">
          <div
            className={`h-full w-full max-w-xl overflow-y-auto border-l p-6 shadow-2xl ${
              theme === 'light' ? 'border-slate-300 bg-white text-slate-900' : 'border-slate-700 bg-[#0f172a] text-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">KPI Drilldown</div>
                <h2 className="mt-1 text-2xl font-black">{KPI_INFO[selectedKPI].title}</h2>
              </div>
              <button
                onClick={() => setSelectedKPI(null)}
                className="rounded-lg border border-slate-700 p-2 hover:bg-slate-800 transition"
              >
                <X className="h-4 w-4 text-white" />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className={`rounded-xl border p-4 ${themeClasses.sub}`}>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Current Value</div>
                <div className="mt-1 text-2xl font-black text-white">
                  {kpis.find((k) => k.key === selectedKPI)?.value || '0'}
                </div>
              </div>
              <div className={`rounded-xl border p-4 ${themeClasses.sub}`}>
                <div className="text-[10px] font-bold text-slate-400 uppercase">Selected Scope</div>
                <div className="mt-1 text-sm font-bold text-indigo-300 truncate">{days.toUpperCase()} &bull; {device}</div>
              </div>
            </div>

            <div className={`mt-4 rounded-xl border p-5 ${themeClasses.sub}`}>
              <div className="text-xs font-bold text-indigo-400 uppercase">DEFINITION</div>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                {KPI_INFO[selectedKPI].definition}
              </p>

              <div className="mt-5 text-xs font-bold text-indigo-400 uppercase">CALCULATION FORMULA</div>
              <p className="mt-2 rounded-lg bg-black/50 p-3 font-mono text-xs text-indigo-300 border border-slate-800">
                {KPI_INFO[selectedKPI].formula}
              </p>

              <div className="mt-5 text-xs font-bold text-indigo-400 uppercase">WHY IT MATTERS</div>
              <p className="mt-2 text-sm leading-6 text-slate-200">
                {KPI_INFO[selectedKPI].why}
              </p>
            </div>

            <div className={`mt-4 rounded-xl border p-5 ${themeClasses.sub}`}>
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase">
                <CheckCircle2 className="h-4 w-4" /> Strategic Diagnostic
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-200">
                {KPI_INFO[selectedKPI].insight}
              </p>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed bottom-5 right-5 z-[110] flex items-center gap-2 rounded-xl border border-indigo-500 bg-slate-950 px-4 py-3 text-xs text-indigo-300 shadow-2xl font-bold">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Querying BigQuery telemetry shards…
        </div>
      )}
    </div>
  );
}