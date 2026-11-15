import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, Bone, Brain, CheckCircle2, CircleSlash, Compass, Database, Droplets, Gauge, HeartPulse, Info,
  ListChecks, Loader2, PhoneCall, Rocket, ShieldAlert, ShieldCheck, Sparkles, Target, TrendingUp,
} from 'lucide-react';
import { useAI, useModels, useSubjects } from '../../../hooks/useAstro';
import type { Domain } from '../../../hooks/useAstro';
import { checkDay } from '../../../services/ml.service';
import { getDashboardTrends } from '../../../services/dashboard.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { useRunStore } from '../../../store/useRunStore';
import {
  DataGate, EvidenceTag, Kv, Notice, Panel, RecToggle, TONE_COLOR, WarningList, bloodMax, boneTone, levelTone, num, pct, type Tone,
} from '../../../shared/components/live';
import type { AiRecommendation, AiResult, BaselineChange, DayResult, Level, ModelInfo } from '../../../types/ml';

/* ==========================================================================================================
   OVERVIEW PAGE  ·  one file, own CSS (prefix "ov-"), no other file needs to change.
   Everything below is computed from what the backend already returns (/ml/check-day, /ml/recommendations,
   /ml/models, /ml/subjects). Nothing is invented: if a number is not in the backend result it is not drawn.
   ========================================================================================================== */

const CSS = `
.ov { --ov-line:#293252; --ov-soft:#1f2745; --ov-mute:#8992b1; }
.ov-sec { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; margin:30px 0 13px; }
.ov-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; }
.ov-sec h2 svg { color:#c18aff; }
.ov-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:760px; line-height:1.5; }
.ov-grid2 { display:grid; grid-template-columns:1.35fr 1fr; gap:14px; margin-bottom:14px; }
.ov-grid2.even { grid-template-columns:1fr 1fr; }
.ov-kpis { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:6px; }
.ov-card { background:linear-gradient(145deg,rgba(18,26,55,.94),rgba(13,19,42,.94)); border:1px solid var(--ov-line); border-radius:13px; padding:15px 16px; min-width:0; position:relative; }
.ov-kpi { border-top:3px solid var(--ov-line); }
.ov-kpi.ok { border-top-color:#55e6b1; } .ov-kpi.warn { border-top-color:#ffd37c; } .ov-kpi.bad { border-top-color:#ff6b8b; } .ov-kpi.mute { border-top-color:#5a6385; }
.ov-kpi-top { display:flex; align-items:center; gap:8px; font:9px 'DM Mono',monospace; letter-spacing:.7px; color:#929bb8; text-transform:uppercase; }
.ov-kpi-top svg { color:#c18aff; flex-shrink:0; }
.ov-kpi-val { font-size:27px; font-weight:700; letter-spacing:-1px; margin:11px 0 5px; line-height:1; }
.ov-kpi-val small { font:10px 'DM Mono',monospace; color:#8993b2; margin-left:5px; letter-spacing:0; }
.ov-kpi-sub { font-size:10px; color:#8d97b4; line-height:1.45; }

.ov-hero { position:relative; overflow:hidden; border-radius:16px; border:1px solid #7650c66b; padding:26px 30px; display:grid; grid-template-columns:1fr auto; gap:26px; align-items:center;
  background:radial-gradient(ellipse at 85% 40%,#4d258c66,transparent 45%),linear-gradient(105deg,#17153c,#111a3a 60%,#15153a); box-shadow:0 12px 50px #5b2ab51a; }
.ov-hero.green { border-color:#2f8c70aa; }
.ov-hero.amber { border-color:#8c6f37; background:radial-gradient(ellipse at 85% 40%,#8c6f3744,transparent 45%),linear-gradient(105deg,#231f33,#1a1f38 60%,#1e1b30); }
.ov-hero.red { border-color:#9b3553; background:radial-gradient(ellipse at 85% 40%,#9b355355,transparent 45%),linear-gradient(105deg,#2d1731,#1c1a38 60%,#241633); }
.ov-hero.unknown { border-color:#3a4267; }
.ov-kicker { font:9px 'DM Mono',monospace; letter-spacing:1.5px; color:#bda0ff; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.ov-hero h2 { font-size:27px; margin:10px 0 8px; letter-spacing:-.7px; line-height:1.2; }
.ov-hero h2 span { color:#c38bff; }
.ov-lead { font-size:12px; color:#c3c9e4; line-height:1.7; margin:0 0 14px; max-width:780px; }
.ov-chips { display:flex; flex-wrap:wrap; gap:8px; }
.ov-chip { display:inline-flex; align-items:center; gap:7px; font:9px 'DM Mono',monospace; letter-spacing:.5px; padding:6px 10px; border-radius:999px; border:1px solid #343d62; background:#0f1630; color:#b9c0dc; }
.ov-chip b { color:#fff; font-weight:500; }
.ov-chip svg { color:#c18aff; }
.ov-ring { position:relative; width:150px; height:150px; margin:0 auto; }
.ov-ring svg { transform:rotate(-90deg); }
.ov-ring-mid { position:absolute; inset:0; display:grid; place-content:center; text-align:center; }
.ov-ring-mid strong { font-size:30px; letter-spacing:-1px; line-height:1; }
.ov-ring-mid small { font:8px 'DM Mono',monospace; color:#939aba; letter-spacing:1px; margin-top:6px; }
.ov-ring-cap { text-align:center; font:8px 'DM Mono',monospace; letter-spacing:1px; color:#b2b7d1; margin-top:8px; }

.ov-ai-head { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
.ov-seg { display:inline-flex; border:1px solid #343d62; border-radius:8px; overflow:hidden; }
.ov-seg button { background:transparent; border:0; color:#9aa3c2; padding:6px 11px; font:9px 'DM Mono',monospace; letter-spacing:.6px; }
.ov-seg button.on { background:#3a2764; color:#fff; }
.ov-summary { font-size:13px; line-height:1.75; color:#e6e8f6; margin:0 0 14px; padding-left:14px; border-left:3px solid #a56bff; }
.ov-find-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; }
.ov-find { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:12px 13px; font-size:11px; line-height:1.6; color:#d2d7e9; display:flex; flex-direction:column; gap:9px; justify-content:space-between; }
.ov-callout { display:flex; gap:11px; align-items:flex-start; background:#3d1a29; border:1px solid #9b3553; color:#ffb3c6; border-radius:10px; padding:12px 14px; margin:0 0 12px; }
.ov-callout p { margin:4px 0 0; font-size:11px; color:#e8b7c4; line-height:1.5; }
.ov-note { font-size:10px; color:#ffd38b; margin:10px 0 0; line-height:1.5; }
.ov-note.mute { color:#8992b1; }
.ov-skel { height:11px; border-radius:6px; background:linear-gradient(90deg,#1a2245,#262f58,#1a2245); background-size:200% 100%; animation:ovsk 1.3s linear infinite; margin:10px 0; }
@keyframes ovsk { to { background-position:-200% 0; } }

.ov-act-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(290px,1fr)); gap:10px; }
.ov-act { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:12px 14px; display:flex; flex-direction:column; gap:10px; }
.ov-act.high { border-left-color:#ff6b8b; } .ov-act.medium { border-left-color:#ffd37c; } .ov-act.low { border-left-color:#55e6b1; }
.ov-act p { margin:0; font-size:12px; line-height:1.55; color:#e5e7f4; }
.ov-act-meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.ov-pill { font:8px 'DM Mono',monospace; letter-spacing:.6px; text-transform:uppercase; padding:3px 7px; border-radius:6px; border:1px solid #343d62; color:#aab4d2; white-space:nowrap; }
.ov-pill.high { color:#ff6b8b; border-color:#9b3553; background:#3d1a29; } .ov-pill.medium { color:#ffd37c; border-color:#8c6f37; background:#3b301a; } .ov-pill.low { color:#55e6b1; border-color:#2f8c70; background:#12382f; }

.ov-sig { display:grid; grid-template-columns:minmax(150px,1.1fr) 2fr 70px 92px; gap:14px; align-items:center; padding:11px 0; border-top:1px solid var(--ov-soft); }
.ov-sig:first-of-type { border-top:0; }
.ov-sig-name { font-size:11px; color:#e5e7f4; font-weight:600; line-height:1.4; }
.ov-sig-name small { display:block; font:9px 'DM Mono',monospace; color:var(--ov-mute); font-weight:400; margin-top:3px; }
.ov-bar { position:relative; height:10px; background:#252c49; border-radius:6px; }
.ov-bar i { display:block; height:100%; border-radius:6px; transition:width .5s ease; }
.ov-bar b { position:absolute; top:-5px; bottom:-5px; left:50%; width:2px; background:#fff; opacity:.75; }
.ov-bar-cap { display:flex; justify-content:space-between; font:8px 'DM Mono',monospace; color:#6f799a; margin-top:6px; }
.ov-sig-val { font:600 12px 'DM Mono',monospace; text-align:right; }
.ov-state { display:inline-block; font:8px 'DM Mono',monospace; letter-spacing:.6px; text-transform:uppercase; padding:4px 8px; border-radius:6px; border:1px solid; text-align:center; white-space:nowrap; }
.ov-state.ok { color:#55e6b1; border-color:#2f8c70; background:#12382f; } .ov-state.warn { color:#ffd37c; border-color:#8c6f37; background:#3b301a; }
.ov-state.bad { color:#ff6b8b; border-color:#9b3553; background:#3d1a29; } .ov-state.mute { color:#8992b1; border-color:#3a4267; background:#1d2340; }
.ov-legend-line { display:flex; gap:16px; flex-wrap:wrap; font:9px 'DM Mono',monospace; color:#8992b1; margin-top:10px; align-items:center; }
.ov-legend-line i { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:-1px; }

.ov-chart { width:100%; height:270px; }
.ov-chart.tall { height:330px; } .ov-chart.short { height:210px; }
.ov-insight { display:flex; gap:10px; align-items:flex-start; margin-top:12px; padding:11px 13px; background:#171a3a; border:1px solid #3d3470; border-radius:10px; font-size:11px; color:#cbb5ff; line-height:1.6; }
.ov-insight svg { flex-shrink:0; margin-top:2px; }
.ov-insight.warn { background:#35291b; border-color:#6f5a2f; color:#ffd38b; }
.ov-tp-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
.ov-tp { background:#0f1630; border:1px solid #343d62; border-radius:10px; padding:8px 11px; color:#c9cce0; min-width:84px; text-align:left; }
.ov-tp span { display:flex; align-items:center; gap:6px; font:600 11px 'DM Mono',monospace; }
.ov-tp small { display:block; font:8px 'DM Mono',monospace; color:#7f89a8; margin-top:5px; letter-spacing:.4px; }
.ov-tp.on { border-color:#a56bff; background:#251d46; box-shadow:0 0 14px #a56bff33; }
.ov-tp:hover { border-color:#7650c6; }
.ov-dot { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }

.ov-tw { overflow-x:auto; }
.ov-tbl { width:100%; border-collapse:collapse; font-size:11px; min-width:560px; }
.ov-tbl th { text-align:left; font:9px 'DM Mono',monospace; letter-spacing:.8px; color:#8992b1; padding:8px 10px; border-bottom:1px solid #293252; text-transform:uppercase; white-space:nowrap; }
.ov-tbl td { padding:10px; border-bottom:1px solid var(--ov-soft); color:#d2d7e9; vertical-align:top; line-height:1.5; }
.ov-tbl td.num { font-family:'DM Mono',monospace; white-space:nowrap; }
.ov-tbl td.up { color:#c08aff; } .ov-tbl td.down { color:#58d8ff; }
.ov-tbl tr.dim td { opacity:.62; }
.ov-trust { height:6px; background:#252c49; border-radius:4px; width:90px; position:relative; margin-top:8px; }
.ov-trust i { display:block; height:100%; border-radius:4px; }
.ov-trust b { position:absolute; top:-3px; bottom:-3px; left:50%; width:1px; background:#fff; opacity:.6; }

.ov-rules { display:grid; gap:9px; margin-bottom:6px; }
.ov-rule { display:grid; grid-template-columns:72px 1fr; gap:12px; align-items:center; padding:10px 12px; border:1px solid #293252; border-radius:10px; background:#0f1630; opacity:.55; }
.ov-rule.on { opacity:1; border-color:#7650c6; box-shadow:0 0 16px #7650c622; }
.ov-rule p { margin:0; font-size:11px; line-height:1.55; color:#cfd4ea; }

.ov-cov-tag { display:inline-flex; align-items:center; gap:6px; font:8px 'DM Mono',monospace; letter-spacing:.6px; text-transform:uppercase; padding:4px 8px; border-radius:6px; border:1px solid #343d62; white-space:nowrap; }
.ov-cov-tag.ok { color:#8ff0cc; border-color:#2f8c70; background:#12382f; } .ov-cov-tag.proxy { color:#c9b4ff; border-color:#5a4a93; background:#251d46; } .ov-cov-tag.no { color:#ff9bb0; border-color:#9b3553; background:#3d1a29; }
.ov-flag { display:flex; gap:10px; align-items:flex-start; padding:8px 0; }
.ov-flag p { margin:0; font-size:12px; line-height:1.55; color:#d2d7e9; }
.ov-flag .ov-dot { margin-top:5px; }
.ov-empty { padding:26px 18px; text-align:center; border:1px dashed #343d62; border-radius:12px; color:#9aa3c2; font-size:11px; line-height:1.7; }
.ov-empty h4 { margin:0 0 8px; font-size:13px; color:#e5e7f4; }
.ov-link { display:inline-flex; align-items:center; gap:7px; margin-top:12px; font-size:11px; color:#e1d3ff; text-decoration:none; border:1px solid #5a4a93; padding:8px 12px; border-radius:8px; background:#251d46; }

.ov-dom { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:6px; }
.ov-dom-card { border-top:3px solid var(--ov-line); }
.ov-dom-card.ok { border-top-color:#55e6b1; } .ov-dom-card.warn { border-top-color:#ffd37c; } .ov-dom-card.bad { border-top-color:#ff6b8b; } .ov-dom-card.mute { border-top-color:#5a6385; }
.ov-dom-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:4px; }
.ov-dom-head h3 { margin:0; font-size:14px; display:flex; align-items:center; gap:8px; } .ov-dom-head h3 svg { color:#c18aff; }
.ov-dom-sub { font:9px 'DM Mono',monospace; color:#8992b1; letter-spacing:.5px; margin:0 0 8px; }
.ov-dom-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--ov-soft); font-size:11px; color:#d2d7e9; }
.ov-dom-row span:last-child { font:600 11px 'DM Mono',monospace; display:flex; align-items:center; gap:7px; }
.ov-dom-gap { margin:10px 0 0; font-size:10px; color:#8992b1; line-height:1.5; display:flex; gap:7px; align-items:flex-start; }
.ov-dom-gap svg { flex-shrink:0; margin-top:1px; }
.ov-ts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; margin-bottom:6px; }
.ov-ts-card h3 { margin:8px 0 6px; font-size:14px; } .ov-ts-card p { margin:0; font-size:11px; line-height:1.6; color:#cfd4ea; }
.ov-pat { display:flex; gap:10px; align-items:flex-start; padding:11px 0; border-top:1px solid var(--ov-soft); }
.ov-pat:first-of-type { border-top:0; } .ov-pat p { margin:0; font-size:12px; line-height:1.6; color:#d2d7e9; }

.ov-chart { position:relative; }
.ov-tip {
  box-sizing:border-box;
  width:min(320px, calc(100vw - 32px));
  min-width:0;
  max-width:calc(100vw - 32px);
  background:#0a1029;
  border:1px solid #4a5688;
  border-left:5px solid var(--tip,#b47bff);
  border-radius:10px;
  padding:12px 15px 13px;
  box-shadow:0 14px 40px #000a;
  pointer-events:none;
  overflow-wrap:anywhere;
}
.ov-tip-title { min-width:0; font-size:15px; font-weight:700; color:#fff; line-height:1.35; letter-spacing:-.2px; overflow-wrap:anywhere; }
.ov-tip-sub { min-width:0; font:10px 'DM Mono',monospace; color:#9aa4c6; margin-top:4px; line-height:1.5; overflow-wrap:anywhere; }
.ov-tip-rows { display:grid; grid-template-columns:minmax(0, .9fr) minmax(0, 1.1fr); gap:6px 12px; margin-top:10px; padding-top:10px; border-top:1px solid #2c3560; align-items:baseline; min-width:0; }
.ov-tip-rows span { min-width:0; overflow-wrap:anywhere; }
.ov-tip-rows span:nth-child(odd) { font:10px 'DM Mono',monospace; color:#8f99ba; text-transform:uppercase; letter-spacing:.5px; }
.ov-tip-rows span:nth-child(even) { font-size:13px; font-weight:700; color:#f2f4ff; text-align:right; }
.ov-tip-note { min-width:0; margin-top:10px; font-size:11px; color:#c3c9e4; line-height:1.5; overflow-wrap:anywhere; }
.ov-pie-mid { position:absolute; left:50%; top:46%; transform:translate(-50%,-50%); width:26%; min-width:92px; text-align:center; pointer-events:none; }
.ov-pie-mid b { display:block; font-size:12px; line-height:1.3; color:#fff; }
.ov-pie-mid span { display:block; font:9px 'DM Mono',monospace; color:#9aa4c6; margin-top:4px; }
@media (max-width:1250px) { .ov-kpis { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:1100px) { .ov-grid2, .ov-grid2.even { grid-template-columns:1fr; } .ov-dom, .ov-ts { grid-template-columns:1fr; } }
@media (max-width:760px) {
  .ov-hero { grid-template-columns:1fr; padding:20px 18px; } .ov-hero h2 { font-size:21px; }
  .ov-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; } .ov-kpi-val { font-size:22px; }
  .ov-sig { grid-template-columns:1fr auto; } .ov-sig > div:nth-child(2) { grid-column:1 / -1; order:3; } .ov-sig-val { text-align:left; }
}
`;

/* ---------------------------------------------------------------- helpers ---------------------------------------------------------------- */

type Evidence = 'strong' | 'weak' | 'screening' | 'proxy';

/** Status colours are never written as colour names on this page: green = Good, amber = Warning, red = Critical. */
const LEVEL_WORD: Record<Level, string> = { green: 'GOOD', amber: 'WARNING', red: 'CRITICAL', unknown: 'UNKNOWN' };
const TONE_WORD: Record<Tone, string> = { ok: 'good', warn: 'warning', bad: 'critical', mute: 'no data' };
const keepCase = (from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
/** The backend / AI text may still say amber, green or red. Show the status words instead ("red blood cell" is left alone). */
const plain = (t: string) => t
  .replace(/\bamber\b/gi, (m) => keepCase(m, 'warning'))
  .replace(/\bgreen\b/gi, (m) => keepCase(m, 'good'))
  .replace(/\bred\b(?!\s*(?:blood|cell|-))/gi, (m) => keepCase(m, 'critical'));

const HEADLINE: Record<Level, [string, string]> = {
  green: ['No flag raised', 'on the signals we could check.'],
  amber: ['Needs your', 'attention today.'],
  red: ['Contact the medical', 'officer today.'],
  unknown: ['Not enough data', 'to give a status yet.'],
};

/** "L-92" = before launch, "R+1" = after landing. */
function describePhase(tp?: string | null): { short: string; long: string; post: boolean } | null {
  if (!tp) return null;
  const m = tp.match(/^([LR])([+-])(\d+)$/i);
  if (!m) return { short: tp, long: tp, post: false };
  const n = Number(m[3]);
  if (m[1].toUpperCase() === 'L') return { short: 'PRE-FLIGHT', long: `${n} days before launch`, post: false };
  return { short: 'POST-FLIGHT', long: `${n} ${n === 1 ? 'day' : 'days'} after landing`, post: true };
}

type Signal = {
  id: string; label: string; sub: string; value: number | undefined; display: string;
  limit: number; limitLabel: string; lowerIsWorse?: boolean; tone: Tone; evidence: Evidence; radar: string;
};

/** Every score the backend gave today, with the exact line where its rules raise a flag. */
function buildSignals(day: DayResult): Signal[] {
  const s = day.check_day.scores ?? {};
  const out: Signal[] = [];
  const ex = day.inputs_used.exercise_minutes;
  const steps = day.inputs_used.steps;
  const insp = s['P_R+1_like_insp4_blood'];
  const osd = s['P_R+1_like_osd571_blood'];

  if (s.hrv_anomaly_frac != null)
    out.push({ id: 'hrv', label: 'Unusual HRV windows', sub: `${s.hrv_windows_checked ?? day.inputs_used.hrv_windows_checked ?? '?'} windows checked`,
      value: s.hrv_anomaly_frac, display: pct(s.hrv_anomaly_frac), limit: 0.1, limitLabel: 'flag over 10%', tone: s.hrv_anomaly_frac > 0.1 ? 'bad' : 'ok', evidence: 'strong', radar: 'HRV' });
  if (insp != null)
    out.push({ id: 'b1', label: 'Blood looks post-flight (CBC + serum)', sub: 'Inspiration4 blood model',
      value: insp, display: pct(insp), limit: 0.5, limitLabel: 'flag over 50%', tone: insp > 0.5 ? 'bad' : 'ok', evidence: 'strong', radar: 'Blood A' });
  if (osd != null)
    out.push({ id: 'b2', label: 'Blood looks post-flight (metabolomics)', sub: 'OSD-571 metabolite model',
      value: osd, display: pct(osd), limit: 0.5, limitLabel: 'flag over 50%', tone: osd > 0.5 ? 'bad' : 'ok', evidence: 'strong', radar: 'Blood B' });
  if (s.P_poor_sleep != null)
    out.push({ id: 'sleep', label: 'Poor-sleep probability', sub: 'weak model, not reliable',
      value: s.P_poor_sleep, display: pct(s.P_poor_sleep), limit: 0.5, limitLabel: 'flag over 50%', tone: s.P_poor_sleep > 0.5 ? 'warn' : 'ok', evidence: 'weak', radar: 'Sleep' });
  if (s.predicted_daily_stress != null)
    out.push({ id: 'stress', label: 'Predicted daily stress', sub: 'scale 0-100 · weak model',
      value: s.predicted_daily_stress, display: num(s.predicted_daily_stress, 1), limit: 50, limitLabel: 'flag over 50', tone: s.predicted_daily_stress > 50 ? 'warn' : 'ok', evidence: 'weak', radar: 'Stress' });
  if (ex != null)
    out.push({ id: 'ex', label: 'Exercise today', sub: 'proxy · no muscle model',
      value: ex, display: `${ex} min`, limit: 20, limitLabel: 'flag under 20 min', lowerIsWorse: true, tone: ex < 20 ? 'warn' : 'ok', evidence: 'proxy', radar: 'Exercise' });
  else if (steps != null)
    out.push({ id: 'steps', label: 'Steps per day', sub: 'proxy · no muscle model',
      value: steps, display: steps.toLocaleString(), limit: 5000, limitLabel: 'flag under 5,000', lowerIsWorse: true, tone: steps < 5000 ? 'warn' : 'ok', evidence: 'proxy', radar: 'Activity' });
  return out;
}

/** How close a signal is to its flag line. 100 = exactly on the line, over 100 = flagged. */
function loadPct(sig: Signal): number {
  if (sig.value == null) return 0;
  const raw = sig.lowerIsWorse ? sig.limit / Math.max(sig.value, sig.limit * 0.05) : sig.value / sig.limit;
  return Math.round(Math.min(raw, 2) * 100);
}

const trimEvidence = (flag: string) => plain(flag.replace(/\s*\[[^\]]*evidence\]\s*/i, '').trim());

function evidenceFromText(t: string): Evidence | null {
  const m = t.toLowerCase().match(/\b(strong|weak|screening|proxy)\s+evidence/);
  return m ? (m[1] as Evidence) : null;
}

/* ------------------------------------------------ AI answer: rescue raw / cut-off JSON ------------------------------------------------ */

type CleanAi = { summary: string; findings: string[]; recs: AiRecommendation[]; contact: boolean; contactReason: string; recovered: boolean };

const unescapeJson = (s: string) => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };
const STR = '"((?:[^"\\\\]|\\\\.)*)"';

/** The backend can hand back the model's JSON text (or a cut-off piece of it) inside `summary`. A person must never see that. */
function cleanAi(r: AiResult): CleanAi {
  const c = cleanAiRaw(r);
  return { ...c, summary: plain(c.summary), findings: c.findings.map(plain), contactReason: plain(c.contactReason), recs: c.recs.map((x) => ({ ...x, action: plain(x.action) })) };
}

function cleanAiRaw(r: AiResult): CleanAi {
  const base: CleanAi = {
    summary: r.summary ?? '', findings: r.key_findings ?? [], recs: r.recommendations ?? [],
    contact: Boolean(r.contact_medical_officer), contactReason: r.contact_reason ?? '', recovered: false,
  };
  const text = (r.summary ?? '').trim();
  if (!/^(```|\{)/.test(text)) return base;

  const body = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const o = JSON.parse(body) as AiResult;
    return {
      summary: String(o.summary ?? ''), findings: (o.key_findings ?? []).map(String), recs: (o.recommendations ?? []) as AiRecommendation[],
      contact: Boolean(o.contact_medical_officer), contactReason: String(o.contact_reason ?? ''), recovered: true,
    };
  } catch { /* cut-off reply: keep the complete pieces that did arrive */ }

  const summary = body.match(new RegExp(`"summary"\\s*:\\s*${STR}`))?.[1];
  const kf = body.match(/"key_findings"\s*:\s*\[([\s\S]*?)(\]|$)/)?.[1] ?? '';
  const findings = [...kf.matchAll(new RegExp(STR, 'g'))].map((m) => unescapeJson(m[1]));
  const recs: AiRecommendation[] = [];
  for (const m of body.matchAll(/\{[^{}]*"action"[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]);
      if (o.action) recs.push({ domain: String(o.domain ?? 'general'), action: String(o.action), priority: String(o.priority ?? 'medium'), evidence: String(o.evidence ?? '') });
    } catch { /* skip */ }
  }
  return {
    summary: summary ? unescapeJson(summary) : '', findings, recs: recs.length ? recs : base.recs,
    contact: /"contact_medical_officer"\s*:\s*true/.test(body),
    contactReason: unescapeJson(body.match(new RegExp(`"contact_reason"\\s*:\\s*${STR}`))?.[1] ?? ''), recovered: true,
  };
}

const PRIO_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const DOMAIN_LABEL: Record<string, string> = {
  sleep: 'Sleep', stress: 'Stress', cardiovascular: 'Heart', blood: 'Blood', bone_muscle: 'Bone & muscle', exercise: 'Exercise', general: 'General',
};

/* ------------------------------------------------ tiny building blocks ------------------------------------------------ */

function Section({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="ov-sec"><div><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div></div>;
}

function Kpi({ icon, label, value, sub, tone = 'mute' }: { icon: ReactNode; label: string; value: ReactNode; sub: ReactNode; tone?: Tone }) {
  return (
    <div className={`ov-card ov-kpi ${tone}`}>
      <div className="ov-kpi-top">{icon}<span>{label}</span></div>
      <div className="ov-kpi-val" style={{ color: tone === 'mute' ? '#f4f3ff' : TONE_COLOR[tone] }}>{value}</div>
      <div className="ov-kpi-sub">{sub}</div>
    </div>
  );
}

function Ring({ done, total, tone }: { done: number; total: number; tone: Tone }) {
  const r = 62; const c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  return (
    <div>
      <div className="ov-ring">
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r={r} fill="none" stroke="#252c49" strokeWidth="11" />
          <circle cx="75" cy="75" r={r} fill="none" stroke={TONE_COLOR[tone]} strokeWidth="11" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`}
            style={{ transition: 'stroke-dasharray .6s ease', filter: `drop-shadow(0 0 8px ${TONE_COLOR[tone]}88)` }} />
        </svg>
        <div className="ov-ring-mid"><strong>{total ? `${done}/${total}` : 'None'}</strong><small>WITHIN LIMITS</small></div>
      </div>
      <div className="ov-ring-cap">SIGNALS CHECKED TODAY</div>
    </div>
  );
}

const tipStyle = { background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 };

/** Hover card shared by every chart on this page: the full name first, then exactly which value is shown and what it means. */
type TipSpec = { title: string; sub?: string; rows: [string, ReactNode][]; tone?: Tone; note?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TipItem = { name?: string | number; value?: number | string; dataKey?: string | number; color?: string; payload?: Record<string, any> };
function RichTip({ active, payload, label, spec }: { active?: boolean; payload?: TipItem[]; label?: string | number; spec: (items: TipItem[], label?: string | number) => TipSpec | null }) {
  if (!active || !payload?.length) return null;
  const t = spec(payload, label);
  if (!t) return null;
  return (
    <div className="ov-tip" style={{ ['--tip' as string]: TONE_COLOR[t.tone ?? 'mute'] === TONE_COLOR.mute ? '#b47bff' : TONE_COLOR[t.tone as Tone] }}>
      <div className="ov-tip-title">{t.title}</div>
      {t.sub && <div className="ov-tip-sub">{t.sub}</div>}
      <div className="ov-tip-rows">{t.rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
      {t.note && <div className="ov-tip-note">{t.note}</div>}
    </div>
  );
}
const EVIDENCE_MEANING: Record<Evidence, string> = {
  strong: 'Strong evidence: a model that works and can raise a Critical level.',
  weak: 'Weak evidence: a model that is barely better than a guess. Can only raise a Warning.',
  screening: 'Screening evidence: reported as a watch item. Does not change the level.',
  proxy: 'Proxy evidence: a simple stand-in measure, not a model.',
};
const axis = { stroke: '#8992b1', fontSize: 10 };

/* ------------------------------------------------ sections ------------------------------------------------ */

function AiBriefing() {
  const ai = useAI();
  const language = useRunStore((s) => s.language);
  const setLanguage = useRunStore((s) => s.setLanguage);
  useEffect(() => { if (language !== 'en') setLanguage('en'); }, [language, setLanguage]); // briefing is English only
  const block = ai.data?.ai;
  const clean = useMemo(() => (block?.result ? cleanAi(block.result) : null), [block]);

  return (
    <Panel title="AI briefing" subtitle="Plain-language read of every model result. The AI explains; it never changes the Good / Warning / Critical level." icon={<Sparkles size={18} className="purple-icon" />}>
      <div className="ov-ai-head">
        {block?.model && <span className="ov-pill">written by {block.model}{block.cached ? ' · cached' : ''}</span>}
        {ai.isFetching && <Loader2 size={13} className="av-spin" />}
      </div>

      {ai.isLoading && <><div className="ov-skel" style={{ width: '92%' }} /><div className="ov-skel" style={{ width: '78%' }} /><div className="ov-skel" style={{ width: '85%' }} /></>}
      {ai.isError && <p className="ov-note">AI briefing unavailable: {(ai.error as Error).message}. The rule-based result above is still valid.</p>}
      {block && !block.result && <p className="ov-note">No AI provider answered ({block.error ?? 'unknown reason'}). Rule-based advice is shown in “Priority actions”.</p>}

      {clean && (
        <>
          {clean.contact && (
            <div className="ov-callout"><PhoneCall size={17} /><div><b style={{ fontSize: 12 }}>Contact the mission medical officer.</b>{clean.contactReason && <p>{clean.contactReason}</p>}</div></div>
          )}
          {clean.summary
            ? <p className="ov-summary">{clean.summary}</p>
            : <p className="muted">The AI reply had no readable summary. The findings below are what could be recovered.</p>}
          {clean.findings.length > 0 && (
            <div className="ov-find-grid">
              {clean.findings.map((f) => {
                const ev = evidenceFromText(f);
                return <div className="ov-find" key={f}><span>{f}</span>{ev && <span><EvidenceTag kind={ev} /></span>}</div>;
              })}
            </div>
          )}
          {clean.recovered && <p className="ov-note mute">The AI reply came back as raw text, so the readable parts were extracted. If this keeps happening, raise llm_max_output_tokens in the backend .env.</p>}
        </>
      )}
    </Panel>
  );
}

function PriorityActions({ day }: { day: DayResult }) {
  const ai = useAI();
  const clean = useMemo(() => (ai.data?.ai?.result ? cleanAi(ai.data.ai.result) : null), [ai.data]);
  const aiRecs = useMemo(() => [...(clean?.recs ?? [])].sort((a, b) => (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3)), [clean]);
  const rules = useMemo(() => {
    const list = [...(day.check_day.recommendations ?? [])];
    if (day.bone_risk?.advice) list.push(`Bone: ${day.bone_risk.advice}`);
    return Array.from(new Set(list.map(plain)));
  }, [day]);

  return (
    <Panel title="Priority actions" subtitle="AI steps first, ordered by priority; then the fixed rule-based steps from the backend." icon={<ListChecks size={18} className="icon-muted" />}>
      {aiRecs.length > 0 && (
        <div className="ov-act-grid">
          {aiRecs.map((r, i) => (
            <div className={`ov-act ${r.priority}`} key={`${r.action}-${i}`}>
              <p>{r.action}</p>
              <div className="ov-act-meta">
                <span className={`ov-pill ${r.priority}`}>{r.priority} priority</span>
                <span className="ov-pill">{DOMAIN_LABEL[r.domain] ?? r.domain}</span>
                {r.evidence && <EvidenceTag kind={r.evidence} />}
              </div>
            </div>
          ))}
        </div>
      )}
      {ai.isLoading && !aiRecs.length && <p className="muted"><Loader2 size={13} className="av-spin" /> AI steps are being written. Rule-based steps are ready below.</p>}
      {rules.length > 0 && (
        <>
          <div className="av-sub-head" style={aiRecs.length ? undefined : { marginTop: 0, borderTop: 0, paddingTop: 0 }}>Rule-based steps</div>
          <div className="ov-act-grid">{rules.map((t) => <div className="ov-act" key={t}><p>{t}</p></div>)}</div>
        </>
      )}
      {!aiRecs.length && !rules.length && !ai.isLoading && <p className="muted">No action is needed. Keep the normal routine.</p>}
    </Panel>
  );
}

function SignalBoard({ signals }: { signals: Signal[] }) {
  const [hot, setHot] = useState<number | null>(null);
  if (!signals.length) {
    return <Panel title="Signals vs their flag line"><div className="ov-empty"><h4>No model signal today</h4>No model produced a score for this selection, so there is nothing to compare with a flag line.</div></Panel>;
  }
  const pie = signals.map((s) => ({ name: s.radar, full: s.label, sub: s.sub, display: s.display, limitLabel: s.limitLabel, tone: s.tone, evidence: s.evidence, load: loadPct(s), state: TONE_WORD[s.tone] }));
  const PIE_COLORS = ['#b47bff', '#58d8ff', '#ffd37c', '#55e6b1', '#ff8aa3', '#8fa2ff', '#f59ad8'];
  const top = [...signals].sort((a, b) => loadPct(b) - loadPct(a))[0];
  return (
    <div className="ov-grid2">
      <Panel title="Signals vs their flag line" subtitle="White line = where the backend rule raises a flag. A bar past the line is flagged." icon={<Gauge size={18} className="icon-muted" />}>
        {signals.map((s) => {
          const w = Math.max(0, Math.min(100, ((s.value ?? 0) / (s.limit * 2)) * 100));
          return (
            <div className="ov-sig" key={s.id}>
              <div className="ov-sig-name">{s.label}<small>{s.sub}</small></div>
              <div>
                <div className="ov-bar"><i style={{ width: `${w}%`, background: TONE_COLOR[s.tone] }} /><b /></div>
                <div className="ov-bar-cap"><span>0</span><span>{s.limitLabel}</span><span>{s.lowerIsWorse ? `${s.limit * 2}+` : 'max'}</span></div>
              </div>
              <div className="ov-sig-val" style={{ color: TONE_COLOR[s.tone] }}>{s.display}</div>
              <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
                <span className={`ov-state ${s.tone}`}>{TONE_WORD[s.tone]}</span>
                <EvidenceTag kind={s.evidence} />
              </div>
            </div>
          );
        })}
        <div className="ov-legend-line">
          <span><i style={{ background: TONE_COLOR.ok }} />good · within limit</span>
          <span><i style={{ background: TONE_COLOR.warn }} />warning · weak-evidence flag</span>
          <span><i style={{ background: TONE_COLOR.bad }} />critical · strong-evidence flag</span>
        </div>
      </Panel>

      <Panel title="Load vs flag line" subtitle="Each slice is one signal. A slice shows how much of its flag line is used: 100% = exactly on the line, a bigger slice = closer to a flag." icon={<Target size={18} className="icon-muted" />}>
        <div className="ov-chart" onMouseLeave={() => setHot(null)}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pie} dataKey="load" nameKey="name" cx="50%" cy="46%" innerRadius="38%" outerRadius="72%" paddingAngle={2} stroke="#0d132a"
                /* Keep the hover card tied to the active slice. The chart wrapper also clears
                   the active slice when the pointer leaves the whole plot, not just a sector. */
                onMouseEnter={(_d: unknown, i: number) => setHot(i)} onMouseLeave={() => setHot(null)}>
                {pie.map((d, i) => <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} fillOpacity={hot == null || hot === i ? 1 : 0.35} stroke={hot === i ? '#ffffff' : '#0d132a'} strokeWidth={hot === i ? 3 : 1} />)}
              </Pie>
              <Tooltip
                active={hot !== null}
                position={{ x: 8, y: 8 }}
                wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
                content={<RichTip spec={(items) => {
                  const d = items[0]?.payload as (typeof pie)[number] | undefined;
                  if (!d) return null;
                  return { title: d.full, sub: d.sub, tone: d.tone, rows: [
                    ['Value today', d.display], ['Flag line', d.limitLabel], ['Slice shows', `${d.load}% of the flag line`], ['Status', d.state.toUpperCase()], ['Evidence', d.evidence],
                  ], note: EVIDENCE_MEANING[d.evidence as Evidence] };
                }} />}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="ov-pie-mid"><b>FLAG LINE</b><span>usage by signal</span></div>
        </div>
        <div className="ov-insight">
          <Info size={14} />
          <span>Closest to its flag line: <b>{top.label}</b> at {loadPct(top)}% of the limit{top.tone === 'ok' ? ' (still within limit).' : ' (flagged).'}</span>
        </div>
      </Panel>
    </div>
  );
}

/* ----- Daily Check-in history (backend /dashboard/{id}/trends): SpO2, heart rate, mood, fatigue, symptoms ----- */

type DailyPt = { date: string; mean: number };
type Series = { key: string; label: string; unit: string; higherIsBetter: boolean | null; daily: DailyPt[]; latest: number; count: number };
type Symptom = { region_code: string; region_name: string; count: number; latest_severity: number; symptom_types: Record<string, number> };
type CheckinData = { series: Series[]; symptoms: Symptom[]; days: number };

const SERIES_LABEL: Record<string, string> = {
  heart_rate_bpm: 'Heart rate', spo2_percent: 'SpO₂', body_temperature_c: 'Body temperature', systolic_bp: 'Systolic BP', diastolic_bp: 'Diastolic BP',
  sleep_hours: 'Sleep hours', sleep_quality: 'Sleep quality', mood: 'Mood', stress: 'Stress (check-in)', fatigue: 'Fatigue',
};

/** Reads the stored Daily Check-in history. A failure here never breaks the page: the rest of Overview does not need it. */
function useCheckin(): { data: CheckinData | null; loading: boolean; failed: boolean; astronautId: number } {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const q = useQuery({
    queryKey: ['ov-checkin', astronautId],
    queryFn: async (): Promise<CheckinData> => {
      const r = await getDashboardTrends(astronautId, 30);
      const mk = (m: { metric: string; unit?: string; higher_is_better?: boolean; latest: number; count: number; daily?: { date: string; mean: number }[] }): Series => ({
        key: m.metric, label: SERIES_LABEL[m.metric] ?? m.metric.replace(/_/g, ' '), unit: m.unit ?? '', higherIsBetter: m.higher_is_better ?? null,
        daily: (m.daily ?? []).map((d) => ({ date: String(d.date), mean: d.mean })), latest: m.latest, count: m.count,
      });
      return { days: r?.days ?? 30, series: [...(r?.vitals ?? []), ...(r?.wellbeing ?? [])].map(mk), symptoms: r?.symptoms ?? [] };
    },
    retry: 0, staleTime: 60_000,
  });
  return { data: q.data ?? null, loading: q.isLoading, failed: q.isError, astronautId };
}

const DAY_MS = 86_400_000;
const dayMs = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
const pctChange = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);

type Shift = { s: Series; last7: number | null; prev7: number | null; base: number | null; shortPct: number | null; longPct: number | null };

/** Windows are measured back from the newest reading in the data, not from today's date. */
function computeShifts(ck: CheckinData | null): { end: number | null; rows: Shift[] } {
  if (!ck) return { end: null, rows: [] };
  const all = ck.series.flatMap((s) => s.daily.map((d) => dayMs(d.date))).filter((t) => !Number.isNaN(t));
  if (!all.length) return { end: null, rows: [] };
  const end = Math.max(...all);
  const win = (s: Series, from: number, to: number) => s.daily.filter((d) => { const t = dayMs(d.date); return t > from && t <= to; }).map((d) => d.mean);
  const rows = ck.series.map((s) => {
    const a = win(s, end - 7 * DAY_MS, end); const b = win(s, end - 14 * DAY_MS, end - 7 * DAY_MS); const c = s.daily.map((d) => d.mean);
    const last7 = a.length >= 2 ? mean(a) : null; const prev7 = b.length >= 2 ? mean(b) : null; const base = c.length >= 7 ? mean(c) : null;
    return { s, last7, prev7, base, shortPct: last7 != null && prev7 != null ? pctChange(last7, prev7) : null, longPct: last7 != null && base != null ? pctChange(last7, base) : null };
  });
  return { end, rows };
}
const fmtVal = (v: number | null, unit = '') => (v == null ? 'No data' : `${Math.round(v * 10) / 10}${unit ? ` ${unit}` : ''}`);
const fmtDay = (ms: number | null) => (ms == null ? '' : new Date(ms).toISOString().slice(0, 10));
const FLUID_REGION = /face|head|neck|back|lumbar|spine/i;

/* ----- three health domains (Physical / Mental / Bone & muscle) ----- */

function DomainTriad({ day, signals, ck }: { day: DayResult; signals: Signal[]; ck: CheckinData | null }) {
  const boneLabel = day.bone_risk?.bone_risk_label ?? null;
  const has = (k: string) => Boolean(ck?.series.some((x) => x.key === k));
  const spo2 = has('spo2_percent'); const mood = has('mood') || has('fatigue');
  const defs = [
    { id: 'phys', title: 'Physical health', sub: 'HRV and blood · strong evidence', icon: <HeartPulse size={16} />, ids: ['hrv', 'b1', 'b2'],
      ck: ['heart_rate_bpm', 'spo2_percent', 'body_temperature_c', 'systolic_bp', 'diastolic_bp'],
      gaps: spo2 ? 'Radiation dose is not measured.' : 'SpO₂ and radiation dose are not measured.' },
    { id: 'mind', title: 'Mental wellbeing', sub: 'Sleep and stress models · weak evidence', icon: <Brain size={16} />, ids: ['sleep', 'stress'],
      ck: ['mood', 'fatigue', 'stress', 'sleep_quality', 'sleep_hours'],
      gaps: mood ? 'Daily self-report is shown without a flag line.' : 'Mood and energy are not measured. Collect them in Daily Check-in.' },
    { id: 'bm', title: 'Bone & muscle', sub: 'Screening and activity proxy', icon: <Bone size={16} />, ids: ['ex', 'steps'], ck: [] as string[],
      gaps: 'In-flight bone and muscle change is not measured.' },
  ];
  return (
    <div className="ov-dom">
      {defs.map((d) => {
        const sig = signals.filter((s) => d.ids.includes(s.id));
        const own = (ck?.series ?? []).filter((x) => d.ck.includes(x.key));
        const boneWatch = d.id === 'bm' && boneLabel && boneLabel !== 'Low';
        const hasData = sig.length > 0 || own.length > 0 || (d.id === 'bm' && Boolean(boneLabel));
        const tone: Tone = !hasData ? 'mute' : sig.some((s) => s.tone === 'bad') ? 'bad' : sig.some((s) => s.tone === 'warn') || boneWatch ? 'warn' : sig.length || (d.id === 'bm' && boneLabel) ? 'ok' : 'mute';
        const within = sig.filter((s) => s.tone === 'ok').length;
        return (
          <div className={`ov-card ov-dom-card ${tone}`} key={d.id}>
            <div className="ov-dom-head">
              <h3>{d.icon}{d.title}</h3>
              <span className={`ov-state ${tone}`}>{tone === 'mute' ? (hasData ? 'no flag line' : 'no data') : TONE_WORD[tone]}</span>
            </div>
            <p className="ov-dom-sub">{d.sub}{sig.length ? ` · ${within}/${sig.length} within limits` : ''}</p>
            {sig.map((s) => (
              <div className="ov-dom-row" key={s.id}><span>{s.label}</span><span style={{ color: TONE_COLOR[s.tone] }}>{s.display}</span></div>
            ))}
            {d.id === 'bm' && (
              <div className="ov-dom-row"><span>Bone-risk screening</span><span style={{ color: day.bone_risk ? TONE_COLOR[boneTone(day.bone_risk.bone_risk_label)] : TONE_COLOR.mute }}>{boneLabel ?? 'No profile'}</span></div>
            )}
            {own.map((x) => (
              <div className="ov-dom-row" key={x.key}><span>{x.label}<small style={{ display: 'block', font: "8px 'DM Mono',monospace", color: '#7f89a8', marginTop: 2 }}>Daily Check-in · {x.count} readings</small></span><span>{fmtVal(x.latest, x.unit)}</span></div>
            ))}
            {d.id === 'bm' && ck && ck.symptoms.length > 0 && (
              <div className="ov-dom-row"><span>Symptom logs<small style={{ display: 'block', font: "8px 'DM Mono',monospace", color: '#7f89a8', marginTop: 2 }}>body map · last {ck.days} days</small></span><span>{ck.symptoms.reduce((a, x) => a + x.count, 0)} reports</span></div>
            )}
            {!hasData && <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>No model produced a score for this area with the current selection.</p>}
            <p className="ov-dom-gap"><CircleSlash size={12} />{d.gaps}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ----- combined patterns: several signs together ----- */

function CrossSignals({ day, signals, shifts }: { day: DayResult; signals: Signal[]; shifts: Shift[] }) {
  const t = (id: string) => signals.find((s) => s.id === id)?.tone;
  const activityLow = t('ex') === 'warn' || t('steps') === 'warn';
  const mindWarn = t('sleep') === 'warn' || t('stress') === 'warn';
  const boneWatch = day.bone_risk && day.bone_risk.bone_risk_label !== 'Low';
  const sh = (k: string) => shifts.find((x) => x.s.key === k)?.shortPct ?? null;
  const sleepDown = [sh('sleep_quality'), sh('sleep_hours')].some((v) => v != null && v <= -5);
  const stressUp = sh('stress') != null && (sh('stress') as number) >= 5;
  const found: { tone: Tone; text: string; ev: Evidence }[] = [];
  if (sleepDown && stressUp)
    found.push({ tone: 'warn', ev: 'proxy', text: `Sleep is down and stress is up in the last 7 days compared with the 7 days before${activityLow ? ', and activity is low' : ''}. This is the slow decline that a single day’s reading hides. Rest, an easier exercise load and a short check-in with the medical officer are the first steps.` });
  if (t('sleep') === 'warn' && t('stress') === 'warn')
    found.push({ tone: 'warn', ev: 'weak', text: 'Poor-sleep and high-stress estimates are both over their limits. Together they are a stronger prompt to do a check-in than either alone, but both models are weak.' });
  if (mindWarn && activityLow)
    found.push({ tone: 'warn', ev: 'weak', text: 'A sleep or stress flag together with low activity. Rest, light exercise and a short check-in are the first steps.' });
  if (activityLow && boneWatch)
    found.push({ tone: 'warn', ev: 'screening', text: `Low activity while bone screening shows ${day.bone_risk?.bone_risk_label} risk. Regular loading exercise matters most for this pair.` });
  if (t('hrv') === 'bad' && (t('b1') === 'bad' || t('b2') === 'bad'))
    found.push({ tone: 'bad', ev: 'strong', text: 'Unusual HRV and a post-flight-like blood signal at the same time. Both are strong evidence; contact the medical officer.' });
  return (
    <Panel title="Patterns across indicators" subtitle="Looks for signs that appear together, using today’s model flags and the 7-day change in Daily Check-in data." icon={<Compass size={18} className="icon-muted" />}>
      {found.length
        ? found.map((f) => (
          <div className="ov-pat" key={f.text}><i className="ov-dot" style={{ background: TONE_COLOR[f.tone], marginTop: 6 }} /><p>{f.text} <EvidenceTag kind={f.ev} /></p></div>
        ))
        : <p className="muted">No combined pattern today. Each flag, if any, stands alone in the Signals section above.</p>}
    </Panel>
  );
}

/* ----- three time scales ----- */

function ShiftRows({ rows, field, empty }: { rows: Shift[]; field: 'shortPct' | 'longPct'; empty: string }) {
  const list = rows.filter((r) => r[field] != null).sort((a, b) => Math.abs(b[field] as number) - Math.abs(a[field] as number)).slice(0, 5);
  if (!list.length) return <p>{empty}</p>;
  return (
    <div style={{ marginTop: 4 }}>
      {list.map((r) => {
        const v = r[field] as number; const ref = field === 'shortPct' ? r.prev7 : r.base;
        const bad = r.s.higherIsBetter == null ? false : r.s.higherIsBetter ? v <= -5 : v >= 5;
        return (
          <div className="ov-dom-row" key={r.s.key}>
            <span>{r.s.label}<small style={{ display: 'block', font: "8px 'DM Mono',monospace", color: '#7f89a8', marginTop: 2 }}>{fmtVal(ref, r.s.unit)} → {fmtVal(r.last7, r.s.unit)}</small></span>
            <span style={{ color: bad ? TONE_COLOR.warn : '#d2d7e9' }}>{v > 0 ? '+' : ''}{v}%</span>
          </div>
        );
      })}
    </div>
  );
}

function TimeScales({ day, shifts, end, ck }: { day: DayResult; shifts: Shift[]; end: number | null; ck: { loading: boolean; failed: boolean } }) {
  const rows = [...day.baseline_changes].sort((a, b) => Math.abs(b.percent_change) - Math.abs(a.percent_change));
  const top = rows[0];
  const lvlTone = levelTone(day.level);
  const hasShort = shifts.some((r) => r.shortPct != null);
  const hasLong = shifts.some((r) => r.longPct != null);
  const noHistory = ck.failed ? 'Daily Check-in history could not be loaded from the backend.' : ck.loading ? 'Loading Daily Check-in history…' : 'No daily history is stored for this astronaut yet. It needs at least 2 daily readings in each 7-day window.';
  return (
    <>
      <div className="ov-ts">
        <div className="ov-card ov-ts-card">
          <span className={`ov-state ${lvlTone}`}>available</span>
          <h3>Daily snapshot</h3>
          <p>Today’s status is <b>{LEVEL_WORD[day.level]}</b> with {day.check_day.n_strong_flags} strong and {day.check_day.n_weak_flags} weak flags.</p>
        </div>
        <div className="ov-card ov-ts-card">
          <span className={`ov-state ${hasShort ? 'ok' : 'mute'}`}>{hasShort ? 'available' : 'not available'}</span>
          <h3>Last 7 days vs previous 7</h3>
          <ShiftRows rows={shifts} field="shortPct" empty={noHistory} />
        </div>
        <div className="ov-card ov-ts-card">
          <span className={`ov-state ${top || hasLong ? 'ok' : 'mute'}`}>{top && hasLong ? 'available' : top || hasLong ? 'partly available' : 'not available'}</span>
          <h3>Long-term vs own baseline</h3>
          {top
            ? <p>Blood: {rows.length} values vs this crew member’s own pre-flight mean. Biggest move: <b>{top.marker}</b> {top.percent_change > 0 ? 'up' : 'down'} {Math.abs(top.percent_change)}%.</p>
            : <p>Blood: no baseline comparison for this selection.</p>}
          <ShiftRows rows={shifts} field="longPct" empty="Check-in: needs at least 7 daily readings for a personal baseline." />
        </div>
      </div>
      {end != null && <p className="ov-note mute">Check-in windows are measured back from the newest reading ({fmtDay(end)}), not from today’s date. Baseline = this astronaut’s own average over the 30-day window. Rising or falling is reported, not good or bad.</p>}
    </>
  );
}

/* ----- body map ----- */

type System = { id: string; label: string; x: number; y: number; domains: Domain[]; tone: Tone; lines: [string, ReactNode][]; verdict: string };

function buildSystems(day: DayResult): System[] {
  const s = day.check_day.scores ?? {};
  const blood = bloodMax(day);
  const hrvT: Tone = s.hrv_anomaly_frac == null ? 'mute' : s.hrv_anomaly_frac > 0.1 ? 'bad' : 'ok';
  const bloodT: Tone = blood == null ? 'mute' : blood > 0.5 ? 'bad' : 'ok';
  const cardio: Tone = hrvT === 'bad' || bloodT === 'bad' ? 'bad' : hrvT === 'mute' && bloodT === 'mute' ? 'mute' : 'ok';
  const sleepT: Tone = s.P_poor_sleep == null ? 'mute' : s.P_poor_sleep > 0.5 ? 'warn' : 'ok';
  const stressT: Tone = s.predicted_daily_stress == null ? 'mute' : s.predicted_daily_stress > 50 ? 'warn' : 'ok';
  const mind: Tone = sleepT === 'warn' || stressT === 'warn' ? 'warn' : sleepT === 'mute' && stressT === 'mute' ? 'mute' : 'ok';
  const ex = day.inputs_used.exercise_minutes; const steps = day.inputs_used.steps;
  const exT: Tone = ex != null ? (ex < 20 ? 'warn' : 'ok') : steps != null ? (steps < 5000 ? 'warn' : 'ok') : 'mute';
  const say = (t: Tone, ok: string, warn: string, bad: string) => (t === 'ok' ? ok : t === 'warn' ? warn : t === 'bad' ? bad : 'No data for this system.');
  return [
    { id: 'mind', label: 'Brain · sleep & stress', x: 90, y: 28, domains: ['sleep', 'stress'], tone: mind,
      verdict: say(mind, 'Sleep and stress models are under their limits (weak evidence).', 'Sleep or stress is over its limit (weak evidence).', ''),
      lines: [['Poor-sleep probability', pct(s.P_poor_sleep)], ['Predicted stress', num(s.predicted_daily_stress, 1)], ['Evidence', 'weak, see model trust below']] },
    { id: 'heart', label: 'Heart & blood', x: 90, y: 100, domains: ['hrv', 'blood'], tone: cardio,
      verdict: say(cardio, 'HRV and blood models show nothing unusual (strong evidence).', '', 'HRV or blood crossed its flag line (strong evidence).'),
      lines: [['Unusual HRV windows', pct(s.hrv_anomaly_frac)], ['Blood looks post-flight', pct(blood)], ['Evidence', 'strong (HRV, blood)']] },
    { id: 'bone', label: 'Bone · hips & spine', x: 90, y: 178, domains: ['bone'], tone: day.bone_risk ? boneTone(day.bone_risk.bone_risk_label) : 'mute',
      verdict: day.bone_risk ? `Screening says ${day.bone_risk.bone_risk_label} risk. It is reported here but does not change the level.` : 'No bone profile for this subject.',
      lines: [['Bone-risk screening', day.bone_risk?.bone_risk_label ?? 'No profile'], ['Trained on', 'US adults 40-80'], ['Evidence', 'screening only']] },
    { id: 'muscle', label: 'Muscle · legs', x: 90, y: 255, domains: ['exercise'], tone: exT,
      verdict: say(exT, 'Activity is above the minimum.', 'Activity is under the minimum (20 min or 5,000 steps).', ''),
      lines: [['Exercise today', ex != null ? `${ex} min` : 'Not provided'], ['Steps per day', steps != null ? steps.toLocaleString() : 'Not provided'], ['Evidence', 'proxy only, no muscle model']] },
  ];
}

function BodySystems({ day }: { day: DayResult }) {
  const systems = buildSystems(day);
  const [selected, setSelected] = useState('heart');
  const cur = systems.find((s) => s.id === selected) ?? systems[0];
  return (
    <div className="av-body">
      <svg viewBox="0 0 180 310" className="body-silhouette" role="img" aria-label="Body systems. Select a point to see its status.">
        <circle cx="90" cy="28" r="20" fill="#25244e" stroke="#b784ff" strokeWidth="2" />
        <path d="M65 55 Q90 45 115 55 L126 132 L112 145 L108 205 L118 300 L94 300 L90 210 L86 300 L62 300 L72 205 L68 145 L54 132Z" fill="#1b2850" stroke="#7e8dce" strokeWidth="2" />
        <path d="M55 68 L28 150 L40 158 L68 102 M125 68 L152 150 L140 158 L112 102" fill="none" stroke="#7e8dce" strokeWidth="12" strokeLinecap="round" />
        {systems.map((s) => (
          <g key={s.id} onClick={() => setSelected(s.id)} style={{ cursor: 'pointer' }}>
            <circle cx={s.x} cy={s.y} r={selected === s.id ? 14 : 9} fill={TONE_COLOR[s.tone]} fillOpacity={0.28} />
            <circle cx={s.x} cy={s.y} r="7" fill={TONE_COLOR[s.tone]} stroke="#fff" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      <div className="av-body-info">
        <div className="av-chip-row">
          {systems.map((s) => (
            <button key={s.id} className={`region-chip ${selected === s.id ? 'selected' : ''}`} onClick={() => setSelected(s.id)}>
              <span className="av-dot" style={{ background: TONE_COLOR[s.tone] }} />{s.label}
            </button>
          ))}
        </div>
        {cur.verdict && <p className="muted" style={{ marginTop: 4, lineHeight: 1.6 }}>{cur.verdict}</p>}
        <Kv rows={cur.lines} />
        <RecToggle domains={cur.domains} title={`Recommendations · ${cur.label}`} />
      </div>
    </div>
  );
}

function BoneProbabilities({ day }: { day: DayResult }) {
  const b = day.bone_risk;
  if (!b) {
    return (
      <Panel title="Bone-risk screening" subtitle="NHANES model · screening only" icon={<Bone size={18} className="icon-muted" />}>
        <div className="ov-empty"><h4>No bone profile for this subject</h4>The bone model needs age, sex, BMI, grip strength, activity and sleep hours. Add them in Daily Check-in or in crew_map.json.
          <div><Link to="/checkin" className="ov-link">Open Daily Check-in</Link></div></div>
      </Panel>
    );
  }
  const rows = (['Low', 'Medium', 'High'] as const).map((k) => ({ k, p: Math.round((b.probabilities[k] ?? 0) * 100) }));
  const color = { Low: TONE_COLOR.ok, Medium: TONE_COLOR.warn, High: TONE_COLOR.bad };
  return (
    <Panel title="Bone-risk screening" subtitle="Probability of each class · trained on US adults 40-80, not astronauts" icon={<Bone size={18} className="icon-muted" />}>
      <div className="ov-chart short">
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 18, left: 4, bottom: 0 }}>
            <CartesianGrid stroke="#252d4b" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} unit="%" {...axis} /><YAxis type="category" dataKey="k" width={56} {...axis} />
            <Tooltip content={<RichTip spec={(items) => {
              const d = items[0]?.payload as { k: 'Low' | 'Medium' | 'High'; p: number } | undefined;
              if (!d) return null;
              const meaning = { Low: 'Femoral-neck T-score at or above -1.', Medium: 'T-score between -2.5 and -1.', High: 'T-score at or below -2.5.' }[d.k];
              return { title: `${d.k} bone risk`, sub: 'Bone-risk screening model', tone: boneTone(d.k), rows: [['Probability', `${d.p}%`], ['Model’s pick', d.k === b.bone_risk_label ? 'Yes, this class' : 'No'], ['Class means', meaning]], note: 'Screening only, not a diagnosis. Trained on US adults 40-80, not astronauts.' };
            }} />} />
            <Bar dataKey="p" radius={[0, 4, 4, 0]}>{rows.map((r) => <Cell key={r.k} fill={color[r.k]} fillOpacity={r.k === b.bone_risk_label ? 1 : 0.4} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className={`ov-insight ${b.bone_risk_label === 'Low' ? '' : 'warn'}`}><Info size={14} /><span>{b.advice}</span></div>
      {b.inputs_missing.length > 0 && <p className="ov-note mute">Filled with training medians because these inputs were missing: {b.inputs_missing.join(', ')}.</p>}
    </Panel>
  );
}

/* ----- mission trajectory: the same models run on every blood timepoint ----- */

function Trajectory({ day }: { day: DayResult }) {
  const subjects = useSubjects();
  const selection = useRunStore((s) => s.selection);
  const setSelection = useRunStore((s) => s.setSelection);
  const astro = day.inputs_used.blood_astronaut;
  const tps: string[] = (astro && subjects.data?.blood_astronauts?.[astro]) || [];

  const results = useQueries({
    queries: tps.map((tp) => ({
      queryKey: ['ml-day-tp', selection, astro, tp],
      queryFn: () => checkDay({ ...selection, blood_astronaut: astro, timepoint: tp }),
      staleTime: 5 * 60_000, retry: 0,
    })),
  });

  if (!astro || tps.length < 2) {
    return (
      <Panel title="Mission trajectory" subtitle="Blood models across the mission" icon={<Rocket size={18} className="icon-muted" />}>
        <div className="ov-empty"><h4>No blood timeline for this selection</h4>Pick a scenario or crew member that has blood samples to see how the blood signal moves from pre-flight to recovery.<div><Link to="/checkin" className="ov-link">Open Daily Check-in</Link></div></div>
      </Panel>
    );
  }

  const rows = tps.map((tp, i) => {
    const d = results[i]?.data;
    const sc = d?.check_day.scores ?? {};
    const a = sc['P_R+1_like_insp4_blood']; const b = sc['P_R+1_like_osd571_blood'];
    return {
      tp, level: (d?.level ?? 'unknown') as Level, loading: Boolean(results[i]?.isLoading),
      a: a != null ? Math.round(a * 100) : null, b: b != null ? Math.round(b * 100) : null,
    };
  });
  const loaded = rows.filter((r) => r.a != null || r.b != null);
  const maxOf = (r: { a: number | null; b: number | null }) => Math.max(r.a ?? 0, r.b ?? 0);
  const peak = loaded.reduce<(typeof rows)[number] | null>((best, r) => (!best || maxOf(r) > maxOf(best) ? r : best), null);
  const last = loaded[loaded.length - 1];
  const current = day.inputs_used.timepoint;
  const anyLoading = results.some((r) => r.isLoading);

  return (
    <Panel title="Mission trajectory" subtitle={`${astro} · the blood models run on every sample. Sleep and HRV inputs stay the same, only the blood sample changes.`} icon={<Rocket size={18} className="icon-muted" />}>
      <div className="ov-chart">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 10, right: 14, left: -8, bottom: 0 }}>
            <CartesianGrid stroke="#252d4b" vertical={false} />
            <XAxis dataKey="tp" {...axis} /><YAxis {...axis} unit="%" domain={[0, 100]} />
            <ReferenceLine y={50} stroke="#ff6b8b" strokeDasharray="5 4" label={{ value: 'flag line 50%', fill: '#ff8aa3', fontSize: 9, position: 'insideTopRight' }} />
            {current && <ReferenceLine x={current} stroke="#b47bff" strokeDasharray="3 3" label={{ value: 'selected', fill: '#c9a8ff', fontSize: 9, position: 'insideTop' }} />}
            <Tooltip content={<RichTip spec={(items, lab) => {
              const ph = describePhase(String(lab));
              const over = items.some((i) => Number(i.value) > 50);
              return { title: `Blood sample ${lab}`, sub: ph ? `${ph.short} · ${ph.long}` : undefined, tone: over ? 'bad' : 'ok',
                rows: [...items.map((i): [string, ReactNode] => [String(i.name), `${i.value}% post-flight-like`]), ['Flag line', '50%'], ['Status', over ? 'CRITICAL (over the line)' : 'GOOD (under the line)']],
                note: 'Each value is the chance that the blood sample looks like a sample taken 1 day after landing.' };
            }} />} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" name="Blood A (CBC + serum)" dataKey="a" stroke="#58d8ff" strokeWidth={2.2} dot={{ r: 3.5 }} connectNulls />
            <Line type="monotone" name="Blood B (metabolomics)" dataKey="b" stroke="#b47bff" strokeWidth={2.2} dot={{ r: 3.5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="ov-tp-row" role="group" aria-label="Pick a blood timepoint">
        {rows.map((r) => {
          const ph = describePhase(r.tp);
          return (
            <button key={r.tp} className={`ov-tp ${r.tp === current ? 'on' : ''}`} onClick={() => setSelection({ timepoint: r.tp })} title={ph?.long}>
              <span><i className="ov-dot" style={{ background: r.loading ? '#5a6385' : TONE_COLOR[levelTone(r.level)] }} />{r.tp}</span>
              <small>{r.loading ? 'running…' : `${LEVEL_WORD[r.level]} · ${ph?.post ? 'POST' : 'PRE'}`}</small>
            </button>
          );
        })}
      </div>

      {!anyLoading && peak && last && (
        <div className="ov-insight">
          <TrendingUp size={14} />
          <span>
            The blood signal is highest at <b>{peak.tp}</b> ({maxOf(peak)}%) and is <b>{maxOf(last) > 50 ? 'still over' : 'back under'}</b> the 50% flag line at <b>{last.tp}</b> ({maxOf(last)}%).
            {maxOf(peak) > 50 && maxOf(last) <= 50 ? ' That is the expected pattern: a post-landing blood shift that recovers.' : ''}
            {' '}Click a timepoint to make the whole app use that sample.
          </span>
        </div>
      )}
    </Panel>
  );
}

function BaselinePanel({ day }: { day: DayResult }) {
  const setSelection = useRunStore((s) => s.setSelection);
  const subjects = useSubjects();
  const rows = [...day.baseline_changes].sort((a, b) => Math.abs(b.percent_change) - Math.abs(a.percent_change));
  const astro = day.inputs_used.blood_astronaut;
  const firstPost = (astro && subjects.data?.blood_astronauts?.[astro]?.find((t) => t.toUpperCase().startsWith('R'))) || null;
  const tp = day.inputs_used.timepoint;

  if (!rows.length) {
    const preflight = Boolean(tp?.toUpperCase().startsWith('L'));
    return (
      <Panel title="Change from own pre-flight baseline" subtitle="Each blood value compared with this crew member’s own pre-flight average" icon={<Droplets size={18} className="icon-muted" />}>
        <div className="ov-empty">
          <h4>{preflight ? `${tp} is a pre-flight sample, so it is the baseline itself` : 'No blood sample is selected'}</h4>
          {preflight ? 'The comparison starts after landing. Choose a post-flight sample to see which blood values moved most.' : 'Choose a crew member with a post-flight sample to see which blood values moved most.'}
          <div>{firstPost
            ? <button className="ov-link" onClick={() => setSelection({ timepoint: firstPost })}><Target size={13} />Show {firstPost} now</button>
            : <Link to="/checkin" className="ov-link">Open Daily Check-in</Link>}</div>
        </div>
      </Panel>
    );
  }
  const up = rows.filter((r) => r.percent_change > 0).length;
  const top = rows[0];
  return (
    <Panel title="Change from own pre-flight baseline" subtitle={`${tp ?? 'Selected sample'} vs the pre-flight mean · ${rows.length} biggest moves, in percent`} icon={<Droplets size={18} className="icon-muted" />}>
      <div className="ov-chart tall">
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 0 }}>
            <CartesianGrid stroke="#252d4b" horizontal={false} />
            <XAxis type="number" unit="%" {...axis} /><YAxis type="category" dataKey="marker" width={104} {...axis} />
            <ReferenceLine x={0} stroke="#8992b1" />
            <Tooltip content={<RichTip spec={(items) => {
              const d = items[0]?.payload as BaselineChange | undefined;
              if (!d) return null;
              return { title: d.marker, sub: 'Blood value vs this crew member’s own pre-flight mean', tone: 'mute',
                rows: [['Pre-flight mean', d.baseline_mean], ['Selected sample', d.current], ['Change', `${d.percent_change > 0 ? '+' : ''}${d.percent_change}% (${d.percent_change >= 0 ? 'up' : 'down'})`]],
                note: 'Size of change only, not a diagnosis.' };
            }} />} />
            <Bar dataKey="percent_change" radius={[0, 4, 4, 0]}>{rows.map((r) => <Cell key={r.marker} fill={r.percent_change >= 0 ? '#b47bff' : '#58d8ff'} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="ov-insight"><Info size={14} /><span>Biggest move: <b>{top.marker}</b> {top.percent_change > 0 ? 'up' : 'down'} {Math.abs(top.percent_change)}% from the pre-flight mean. {up} of the {rows.length} values shown went up, {rows.length - up} went down. This shows size of change only, not a diagnosis.</span></div>
      <div className="ov-tw" style={{ marginTop: 12 }}>
        <table className="ov-tbl" style={{ minWidth: 380 }}>
          <thead><tr><th>Marker</th><th>Pre-flight mean</th><th>Now</th><th>Change</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.marker}><td>{r.marker}</td><td className="num">{r.baseline_mean}</td><td className="num">{r.current}</td><td className={`num ${r.percent_change >= 0 ? 'up' : 'down'}`}>{r.percent_change > 0 ? '+' : ''}{r.percent_change}%</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ----- how the level was decided + evidence mix ----- */

function LevelLogic({ day, signals }: { day: DayResult; signals: Signal[] }) {
  const strong = day.check_day.n_strong_flags; const weak = day.check_day.n_weak_flags;
  const rules: { lvl: Level; text: string }[] = [
    { lvl: 'red', text: 'Critical: 2 or more strong-evidence flags, or 1 strong flag plus at least 1 weak flag.' },
    { lvl: 'amber', text: 'Warning: 1 strong-evidence flag, or any weak-evidence flag. Weak evidence alone can never make the level Critical.' },
    { lvl: 'green', text: 'Good: no flag on any signal that could be checked.' },
  ];
  const tiers: Evidence[] = ['strong', 'weak', 'screening', 'proxy'];
  const mix = tiers.map((t) => ({ t, n: signals.filter((s) => s.evidence === t).length + (t === 'screening' && day.bone_risk ? 1 : 0) })).filter((x) => x.n > 0);
  const COL: Record<Evidence, string> = { strong: '#55e6b1', weak: '#ffd37c', screening: '#58d8ff', proxy: '#b47bff' };
  const strongSignals = signals.filter((s) => s.evidence === 'strong').length;
  return (
    <div className="ov-grid2 even">
      <Panel title="How today’s level was decided" subtitle="Fixed rules in the backend (app/ml/predict.py). The AI cannot change them." icon={<ShieldCheck size={18} className="icon-muted" />}>
        <div className="ov-rules">
          {rules.map((r) => (
            <div className={`ov-rule ${day.level === r.lvl ? 'on' : ''}`} key={r.lvl}>
              <span className={`av-level av-level-${r.lvl}`} style={{ textAlign: 'center' }}>{LEVEL_WORD[r.lvl]}</span><p>{r.text}</p>
            </div>
          ))}
        </div>
        <Kv rows={[['Strong flags today', strong], ['Weak flags today', weak], ['Result', LEVEL_WORD[day.level]]]} />
        {day.bone_risk && <p className="ov-note mute">Bone screening is reported but is not one of the rule inputs, so it never changes the level.</p>}
      </Panel>
      <Panel title="Evidence mix of today’s signals" subtitle="How much of today’s picture rests on strong evidence" icon={<Activity size={18} className="icon-muted" />}>
        {mix.length ? (
          <>
            <div className="ov-chart short">
              <ResponsiveContainer>
                <BarChart data={mix.map((m) => ({ name: m.t, n: m.n, names: [...signals.filter((x) => x.evidence === m.t).map((x) => x.label), ...(m.t === 'screening' && day.bone_risk ? ['Bone-risk screening'] : [])] }))} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="#252d4b" vertical={false} />
                  <XAxis dataKey="name" {...axis} /><YAxis allowDecimals={false} {...axis} />
                  <Tooltip content={<RichTip spec={(items) => {
                    const d = items[0]?.payload as { name: Evidence; n: number; names: string[] } | undefined;
                    if (!d) return null;
                    return { title: `${d.name[0].toUpperCase()}${d.name.slice(1)} evidence`, sub: `${d.n} ${d.n === 1 ? 'signal' : 'signals'} today`, rows: [['Signals', d.names.join(', ') || 'None']], note: EVIDENCE_MEANING[d.name] };
                  }} />} />
                  <Bar dataKey="n" radius={[4, 4, 0, 0]}>{mix.map((m) => <Cell key={m.t} fill={COL[m.t]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="ov-insight"><Info size={14} /><span>
              {strongSignals} of {signals.length} signals are strong evidence (HRV, blood). Sleep and stress models are weak, so a flag from them alone only ever gives a Warning.
            </span></div>
          </>
        ) : <p className="muted">No signals to classify.</p>}
      </Panel>
    </div>
  );
}

/* ----- model trust ----- */

function metricText(m: ModelInfo): { text: string; auc?: number } {
  const x = (m.metrics ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof x[k] === 'number' ? (x[k] as number) : undefined);
  const auc = n('roc_auc'); const macro = n('macro_auc_ovr'); const r2 = n('r2'); const u4 = n('user_4_anomaly_rate');
  if (auc != null) return { text: `AUC ${auc.toFixed(2)}`, auc };
  if (macro != null) return { text: `macro AUC ${macro.toFixed(2)}`, auc: macro };
  if (r2 != null) return { text: `R² ${r2.toFixed(2)} · MAE ${n('mae') ?? 'not reported'}` };
  if (u4 != null) return { text: `flags ${(u4 * 100).toFixed(0)}% of the held-out outlier user` };
  const evr = x.explained_variance_ratio;
  if (Array.isArray(evr) && evr.length) return { text: `${evr.length} components explain ${(evr.reduce((a: number, b: unknown) => a + Number(b), 0) * 100).toFixed(0)}% of the variance` };
  const first = Object.entries(x).find(([, v]) => typeof v === 'number');
  if (first) return { text: `${first[0].replace(/_/g, ' ')} ${(first[1] as number).toFixed(2)}` };
  return { text: 'No score reported' };
}

function trustOf(m: ModelInfo): { label: string; tone: Tone } {
  const s = (m.status ?? '').toLowerCase();
  if (/does not|no signal|exploration|not a classifier/.test(s)) return { label: 'No usable signal', tone: 'bad' };
  if (/proof of concept|do not use/.test(s)) return { label: 'Proof of concept', tone: 'warn' };
  if (/works|real signal/.test(s)) return { label: 'Works for screening', tone: 'ok' };
  return { label: 'Unknown', tone: 'mute' };
}

type ModelCard = ModelInfo & { factors?: string[]; factor_count?: number | null; factor_note?: string | null };

/** "serum__albumin_value_gram_per_deciliter" -> "Serum albumin" */
const prettyFactor = (f: string) => f
  .replace(/^(serum|cbc)__/i, (_m, g: string) => (g.toLowerCase() === 'cbc' ? 'CBC ' : 'Serum '))
  .replace(/^(ANP|RP_MTBE)__/, '').replace(/_value_.*$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

function Factors({ m }: { m: ModelCard }) {
  const list = (m.factors ?? []).map(prettyFactor);
  const total = m.factor_count ?? list.length;
  if (!list.length && !m.factor_note) return <span>Factor list not sent by the backend. Update ml_service.py.</span>;
  const shown = Math.min(list.length, 4);
  const rest = Math.max(total - shown, 0);
  return (
    <div>
      {total > 0 && <b>{total.toLocaleString()} {total === 1 ? 'factor' : 'factors'}</b>}
      {m.factor_note && <div style={{ color: '#8992b1', marginTop: 4 }}>{m.factor_note}</div>}
      {list.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', color: '#c9b4ff' }}>{list.slice(0, shown).join(', ')}{rest > 0 ? ` + ${rest.toLocaleString()} more` : ''}</summary>
          <div style={{ marginTop: 6 }}>{list.join(', ')}{total > list.length ? ` … and ${(total - list.length).toLocaleString()} more` : ''}</div>
        </details>
      )}
    </div>
  );
}

function ModelTrust({ day }: { day: DayResult }) {
  const models = useModels();
  const usedToday = new Set(day.model_reliability.map((m) => m.model));
  const list = models.data ?? [];
  const aucRows = list
    .map((m) => ({ name: m.model.replace(/_/g, ' '), auc: metricText(m).auc, used: usedToday.has(m.model), predicts: m.predicts, trust: trustOf(m).label }))
    .filter((r): r is { name: string; auc: number; used: boolean; predicts: string | null; trust: string } => r.auc != null);

  return (
    <>
      <div className="ov-grid2">
        <Panel title="How much to trust each model" subtitle="Cross-validated score on the data it was trained on. The white line is a coin flip (0.50)." icon={<Gauge size={18} className="icon-muted" />}>
          {models.isLoading && <p className="muted"><Loader2 size={13} className="av-spin" /> Loading model cards…</p>}
          {models.isError && <p className="ov-note">Model list unavailable: {(models.error as Error).message}</p>}
          {aucRows.length > 0 && (
            <div className="ov-chart short">
              <ResponsiveContainer>
                <BarChart data={aucRows} layout="vertical" margin={{ top: 4, right: 18, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#252d4b" horizontal={false} />
                  <XAxis type="number" domain={[0, 1]} {...axis} /><YAxis type="category" dataKey="name" width={150} {...axis} />
                  <ReferenceLine x={0.5} stroke="#fff" strokeDasharray="4 4" />
                  <Tooltip content={<RichTip spec={(items) => {
                    const d = items[0]?.payload as (typeof aucRows)[number] | undefined;
                    if (!d) return null;
                    return { title: d.name, sub: d.predicts ?? undefined, tone: d.auc < 0.5 ? 'bad' : d.auc < 0.7 ? 'warn' : 'ok',
                      rows: [['AUC score', d.auc.toFixed(2)], ['Coin flip', '0.50'], ['Trust', d.trust], ['Used today', d.used ? 'Yes' : 'No']],
                      note: 'AUC is the chance the model ranks a real case above a normal one. 0.50 is a guess, 1.00 is perfect.' };
                  }} />} />
                  <Bar dataKey="auc" radius={[0, 4, 4, 0]}>{aucRows.map((r) => <Cell key={r.name} fill={r.auc < 0.5 ? TONE_COLOR.bad : r.auc < 0.7 ? TONE_COLOR.warn : TONE_COLOR.ok} fillOpacity={r.used ? 1 : 0.45} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="ov-insight warn"><AlertTriangle size={14} /><span>The sleep model scores below a coin flip and the stress model has no signal, so a flag or a clear result from them alone should not drive a decision. Faded bars were not used for today’s selection.</span></div>
        </Panel>

        <Panel title="What the models learned from" subtitle="Training population behind every model used today" icon={<Database size={18} className="icon-muted" />}>
          <Kv rows={day.model_reliability.length
            ? day.model_reliability.map((m) => [m.model.replace(/_/g, ' '), m.population ?? 'unknown'] as [string, ReactNode])
            : [['Models used today', 'none']]} />
        </Panel>
      </div>

      {list.length > 0 && (
        <Panel title="Models and the factors they use" subtitle="What each model predicts, which factors go into it, how it was checked, and how much to trust it">
          <div className="ov-tw">
            <table className="ov-tbl">
              <thead><tr><th>Model</th><th>Predicts</th><th>Factors used</th><th>Check</th><th>Score</th><th>Trust</th></tr></thead>
              <tbody>{list.map((m) => {
                const t = trustOf(m); const mt = metricText(m); const used = usedToday.has(m.model);
                return (
                  <tr key={m.model} className={used || m.separate_call ? '' : 'dim'}>
                    <td><b>{m.model.replace(/_/g, ' ')}</b>
                      <div style={{ marginTop: 6 }}>{used ? <span className="ov-pill low">used today</span> : <span className="ov-pill">{m.used_in_check_day ? 'no input today' : m.separate_call ? 'separate call' : 'not in daily check'}</span>}</div></td>
                    <td>{m.predicts ?? 'Not reported'}</td><td><Factors m={m as ModelCard} /></td><td>{m.validation ?? 'Not checked'}</td>
                    <td className="num">{mt.text}</td>
                    <td><span className={`ov-state ${t.tone}`}>{t.label}</span>
                      <div className="ov-trust"><i style={{ width: `${mt.auc != null ? Math.max(4, Math.min(100, mt.auc * 100)) : 4}%`, background: TONE_COLOR[t.tone] }} /><b /></div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

/* ----- the bottom of the page: what is measured, what is not, and why ----- */

type Cov = { domain: string; state: 'ok' | 'proxy' | 'no'; source: string; value: string; why: string; fix: string };

function buildCoverage(day: DayResult, ck: CheckinData | null): Cov[] {
  const s = day.check_day.scores ?? {};
  const has = (v: unknown) => v != null;
  const steps = day.inputs_used.steps; const ex = day.inputs_used.exercise_minutes;
  const insp = s['P_R+1_like_insp4_blood']; const osd = s['P_R+1_like_osd571_blood'];
  const blood = has(insp) || has(osd);
  const ser = (k: string) => ck?.series.find((x) => x.key === k);
  const spo2 = ser('spo2_percent'); const mood = ser('mood'); const fat = ser('fatigue');
  const moodN = Math.max(mood?.count ?? 0, fat?.count ?? 0);
  const fluid = (ck?.symptoms ?? []).filter((x) => FLUID_REGION.test(x.region_code) || FLUID_REGION.test(x.region_name));
  const fluidN = fluid.reduce((a, x) => a + x.count, 0);
  const NONE = 'Nothing missing';
  const boneP = day.bone_risk ? Math.round((day.bone_risk.probabilities[day.bone_risk.bone_risk_label] ?? 0) * 100) : null;
  const hrvWin = s.hrv_windows_checked ?? day.inputs_used.hrv_windows_checked;
  return [
    { domain: 'Heart rate variability', state: has(s.hrv_anomaly_frac) ? 'ok' : 'no', source: 'MMASH RR-interval windows (Earth volunteers)',
      value: has(s.hrv_anomaly_frac) ? `${pct(s.hrv_anomaly_frac)} of ${hrvWin ?? 'the'} windows unusual` : 'No reading',
      why: has(s.hrv_anomaly_frac) ? 'Measured from heartbeat windows.' : 'No HRV windows were selected.', fix: has(s.hrv_anomaly_frac) ? NONE : 'Choose an HRV user or a scenario that has one.' },
    { domain: 'Blood & metabolomics', state: blood ? 'ok' : 'no', source: 'Inspiration4 CBC, serum, OSD-571 metabolomics (4 crew)',
      value: blood ? [has(insp) ? `CBC + serum ${pct(insp)}` : '', has(osd) ? `metabolomics ${pct(osd)}` : ''].filter(Boolean).join(' · ') + ` post-flight-like${day.inputs_used.timepoint ? ` at ${day.inputs_used.timepoint}` : ''}` : 'No reading',
      why: blood ? 'Measured from the selected blood timepoint.' : 'No blood timepoint is selected.', fix: blood ? NONE : 'Pick a crew member and timepoint.' },
    { domain: 'Sleep', state: has(s.P_poor_sleep) ? 'ok' : 'no', source: 'MMASH sleep summary (21 volunteers)',
      value: has(s.P_poor_sleep) ? `${pct(s.P_poor_sleep)} chance of poor sleep` : 'No reading',
      why: has(s.P_poor_sleep) ? 'Model estimate, weak evidence.' : 'No MMASH volunteer is selected.', fix: has(s.P_poor_sleep) ? NONE : 'Choose a sleep/stress volunteer.' },
    { domain: 'Stress', state: has(s.predicted_daily_stress) ? 'ok' : 'no', source: 'MMASH questionnaires (21 volunteers)',
      value: has(s.predicted_daily_stress) ? `${num(s.predicted_daily_stress, 1)} out of 100` : 'No reading',
      why: has(s.predicted_daily_stress) ? 'Model estimate, weak evidence.' : 'No MMASH volunteer is selected.', fix: has(s.predicted_daily_stress) ? NONE : 'Choose a sleep/stress volunteer.' },
    { domain: 'Bone', state: day.bone_risk ? 'ok' : 'no', source: 'CDC NHANES 2013-14 (US adults 40-80)',
      value: day.bone_risk ? `${day.bone_risk.bone_risk_label} risk (${boneP}% probability)` : 'No profile',
      why: day.bone_risk ? 'Screening estimate from a profile.' : 'No bone profile for this subject.', fix: day.bone_risk ? NONE : 'Add a bone profile in Daily Check-in.' },
    { domain: 'Muscle & activity', state: ex != null || steps != null ? 'proxy' : 'no', source: 'Steps or logged exercise minutes',
      value: ex != null ? `${ex} min of exercise` : steps != null ? `${steps.toLocaleString()} steps` : 'Not provided',
      why: 'No muscle model exists; only a simple activity threshold is used.', fix: 'Needs muscle-strength or imaging data from a long-duration crew.' },
    spo2
      ? { domain: 'Oxygen saturation (SpO₂)', state: 'ok', source: `Daily Check-in readings (${spo2.count} in the last ${ck?.days ?? 30} days)`, value: `${fmtVal(spo2.latest, '%')} latest`, why: 'Logged by the astronaut or a device. Shown without a flag line.', fix: NONE }
      : { domain: 'Oxygen saturation (SpO₂)', state: 'no', source: 'none in the loaded datasets', value: 'No reading', why: 'No file in the AstroVital data contains pulse-oximetry.', fix: 'Add a pulse-oximeter feed or daily manual entry.' },
    { domain: 'Radiation dose', state: 'no', source: 'none in the loaded datasets', value: 'No reading', why: 'No dosimeter data is part of the supplied files.', fix: 'Add mission dosimetry (crew dosimeter readings).' },
    moodN > 0
      ? { domain: 'Mood & energy', state: 'ok', source: 'Daily Check-in wellbeing assessments', value: [mood ? `mood ${fmtVal(mood.latest)}` : '', fat ? `fatigue ${fmtVal(fat.latest)}` : ''].filter(Boolean).join(' · ') + ' latest', why: `Self-reported, ${moodN} entries in the last ${ck?.days ?? 30} days. Not used by the models.`, fix: NONE }
      : { domain: 'Mood & energy', state: 'no', source: 'none in the loaded datasets', value: 'No reading', why: 'No daily self-report exists in the data the models use.', fix: 'Collect it in the Daily Check-in page.' },
    fluidN > 0
      ? { domain: 'Fluid shift', state: 'proxy', source: 'Body-map symptom logs (face, head, neck, back)', value: `${fluidN} symptom ${fluidN === 1 ? 'report' : 'reports'}`, why: 'Self-reported symptoms only. No imaging or direct fluid measurement.', fix: 'Needs imaging such as ultrasound to measure fluid shift directly.' }
      : { domain: 'Fluid shift', state: 'no', source: 'none', value: 'No reports', why: 'No model measures puffy face or back pain directly.', fix: 'Needs symptom logs or imaging such as ultrasound.' },
    { domain: 'Bone & muscle change in space', state: 'no', source: 'none', value: 'No data', why: 'No open human dataset of in-flight bone or muscle change was loaded.', fix: 'Needs in-flight or return-day DXA / MRI studies.' },
  ];
}

function CoverageTable({ day, rows, ck }: { day: DayResult; rows: Cov[]; ck: ReturnType<typeof useCheckin> }) {
  const measured = rows.filter((r) => r.state !== 'no').length;
  const ckN = ck.data ? ck.data.series.reduce((a, x) => a + x.count, 0) : 0;
  const gaps = [
    ...day.check_day.missing,
    ...(ck.failed ? ['Daily Check-in history could not be loaded from the backend.'] : []),
    ...(!ck.failed && !ck.loading && ck.data && ckN === 0 ? [`No Daily Check-in readings are stored yet for astronaut #${ck.astronautId}.`] : []),
  ];
  const sources = [
    ...day.data_provenance,
    ...(ck.data && ckN > 0 ? [`Daily Check-in history: ${ckN} readings across ${ck.data.series.length} metrics in the last ${ck.data.days} days (astronaut #${ck.astronautId}, stored in the backend database)`] : []),
  ];
  const label = { ok: 'measured', proxy: 'proxy only', no: 'not measured' } as const;
  return (
    <>
      <Section icon={<CircleSlash size={17} />} title="What is measured, what is not, and why" sub={`${measured} of ${rows.length} health areas have any data today. The rest are listed with the reason and what would fill the gap.`} />
      <div className="ov-grid2">
        <Panel title="Data coverage">
          <div className="ov-tw">
            <table className="ov-tbl">
              <thead><tr><th>Area</th><th>Status</th><th>Source</th><th>Today’s value</th><th>Why</th><th>What would fix it</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.domain}>
                  <td><b>{r.domain}</b></td>
                  <td><span className={`ov-cov-tag ${r.state}`}>{r.state === 'ok' ? <CheckCircle2 size={11} /> : r.state === 'proxy' ? <Compass size={11} /> : <CircleSlash size={11} />}{label[r.state]}</span></td>
                  <td>{r.source}</td><td><b>{r.value}</b></td><td>{r.why}</td><td>{r.fix}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
        <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
          <Panel title="Flags raised" subtitle="Plain-language reasons for today’s level" icon={<ShieldAlert size={18} className="icon-muted" />}>
            {day.check_day.flags.length
              ? day.check_day.flags.map((f) => {
                const ev = evidenceFromText(f);
                return <div className="ov-flag" key={f}><i className="ov-dot" style={{ background: f.includes('strong') ? TONE_COLOR.bad : TONE_COLOR.warn }} /><p>{trimEvidence(f)} {ev && <EvidenceTag kind={ev} />}</p></div>;
              })
              : <p className="muted">No flag is on for the data that was checked.</p>}
            <div className="av-sub-head">Could not check in this run</div>
            {gaps.length
              ? gaps.map((m) => <div className="ov-flag" key={m}><i className="ov-dot" style={{ background: TONE_COLOR.mute }} /><p>{m}</p></div>)
              : <p className="muted">Every model input had data.</p>}
          </Panel>
          <Panel title="Where today’s numbers come from" icon={<Database size={18} className="icon-muted" />}>
            {sources.length
              ? sources.map((p) => <div className="ov-flag" key={p}><i className="ov-dot" style={{ background: '#b47bff' }} /><p>{p}</p></div>)
              : <p className="muted">No data source was used.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------ page ------------------------------------------------ */

export function OverviewPage() {
  return (
    <section className="page-enter ov">
      <style>{CSS}</style>
      <DataGate>{(day) => <Content day={day} />}</DataGate>
    </section>
  );
}

function Content({ day }: { day: DayResult }) {
  const signals = useMemo(() => buildSignals(day), [day]);
  const ck = useCheckin();
  const coverage = useMemo(() => buildCoverage(day, ck.data), [day, ck.data]);
  const shiftData = useMemo(() => computeShifts(ck.data), [ck.data]);
  const okCount = signals.filter((s) => s.tone === 'ok').length;
  const who = day.subject.display_name || day.subject.subject_id || day.inputs_used.blood_astronaut || day.inputs_used.mmash_user || 'Selected data';
  const phase = describePhase(day.inputs_used.timepoint);
  const [h1, h2] = HEADLINE[day.level];
  const tone = levelTone(day.level);
  const strong = day.check_day.n_strong_flags; const weak = day.check_day.n_weak_flags;
  const boneWatch = day.bone_risk && day.bone_risk.bone_risk_label !== 'Low' ? day.bone_risk.bone_risk_label : null;
  const top = [...signals].sort((a, b) => loadPct(b) - loadPct(a))[0];
  const unmeasured = coverage.filter((c) => c.state === 'no').length;

  // One honest sentence that explains the colour.
  const lead = (() => {
    if (day.level === 'unknown') return 'No model had any input, so the status cannot be Good. Select a scenario or add data in Daily Check-in.';
    const parts: string[] = [];
    if (day.level === 'green') parts.push(`${okCount} of ${signals.length} checked signals are inside their limits.`);
    else parts.push(`${day.check_day.flags.map(trimEvidence).join(' · ')}.`);
    if (boneWatch) parts.push(`Bone screening shows ${boneWatch} risk (a watch item that does not change the level).`);
    if (unmeasured) parts.push(`${unmeasured} health areas, such as ${coverage.filter((c) => c.state === 'no').slice(0, 3).map((c) => c.domain.replace(/\s*\(.*\)/, '')).join(', ')}, cannot be measured with the current data.`);
    return parts.join(' ');
  })();

  return (
    <>
      <div className="hero-heading">
        <div>
          <div className="eyebrow"><span className="live-dot" /> LIVE BACKEND SNAPSHOT</div>
          <h1>Mission <em>Overview</em></h1>
          <p className="muted">Every model, rule and data source behind today’s crew status, in one place.</p>
        </div>
        <div className="mission-day">
          <span>SCENARIO</span>
          <b className="av-scenario-name">{day.subject.scenario_id ?? 'Custom selection'}</b>
          <small>{day.inputs_used.timepoint ? `BLOOD SAMPLE ${day.inputs_used.timepoint}` : who}</small>
        </div>
      </div>

      <WarningList day={day} />

      {/* 1. status */}
      <div className={`ov-hero ${day.level}`}>
        <div>
          <div className="ov-kicker"><span>CREW HEALTH STATUS</span><span className={`av-level av-level-${day.level}`}>{LEVEL_WORD[day.level]}</span></div>
          <h2>{h1} <span>{h2}</span></h2>
          <p className="ov-lead">{lead}</p>
          <div className="ov-chips">
            <span className="ov-chip"><Rocket size={12} />Crew <b>{who}</b></span>
            {phase && <span className="ov-chip"><Compass size={12} /><b>{phase.short}</b> · {day.inputs_used.timepoint} · {phase.long}</span>}
            {day.inputs_used.hrv_windows_checked != null && <span className="ov-chip"><HeartPulse size={12} /><b>{day.inputs_used.hrv_windows_checked}</b> HRV windows</span>}
            <span className="ov-chip"><Database size={12} /><b>{day.data_provenance.length}</b> data sources</span>
          </div>
        </div>
        <Ring done={okCount} total={signals.length} tone={tone === 'mute' ? 'mute' : okCount === signals.length ? 'ok' : tone} />
      </div>

      {/* 2. KPI strip */}
      <Section icon={<Gauge size={17} />} title="Today in numbers" sub="Counts come straight from the backend rule check." />
      <div className="ov-kpis">
        <Kpi icon={<CheckCircle2 size={13} />} label="Within limits" value={`${okCount}/${signals.length}`} tone={signals.length === 0 ? 'mute' : okCount === signals.length ? 'ok' : 'warn'} sub="signals under their flag line" />
        <Kpi icon={<ShieldAlert size={13} />} label="Strong flags" value={strong} tone={strong ? 'bad' : 'ok'} sub="HRV or blood over the line" />
        <Kpi icon={<AlertTriangle size={13} />} label="Weak flags" value={weak} tone={weak ? 'warn' : 'ok'} sub="sleep, stress or low activity" />
        <Kpi icon={<Target size={13} />} label="Closest to limit" value={top ? `${loadPct(top)}%` : 'None'} tone={top ? top.tone : 'mute'} sub={top ? top.label : 'no signal'} />
        <Kpi icon={<Bone size={13} />} label="Bone screening" value={day.bone_risk?.bone_risk_label ?? 'No profile'} tone={day.bone_risk ? boneTone(day.bone_risk.bone_risk_label) : 'mute'} sub={day.bone_risk ? 'watch item, not a diagnosis' : 'no bone profile'} />
        <Kpi icon={<Database size={13} />} label="Areas with data" value={`${coverage.length - unmeasured}/${coverage.length}`} tone={unmeasured > coverage.length / 2 ? 'warn' : 'ok'} sub={`${unmeasured} not measurable, listed at the bottom`} />
      </div>

      {/* 2b. three domains */}
      <Section icon={<Activity size={17} />} title="Three health domains" sub="Physical health, mental wellbeing, and bone & muscle, each from the signals the backend could check today." />
      <DomainTriad day={day} signals={signals} ck={ck.data} />

      {/* 3. explanation + actions */}
      <Section icon={<Sparkles size={17} />} title="What it means and what to do" />
      <AiBriefing />
      <div style={{ height: 14 }} />
      <PriorityActions day={day} />

      {/* 4. signals */}
      <Section icon={<Activity size={17} />} title="Signals" sub="Each model score next to the exact line where a flag is raised." />
      <SignalBoard signals={signals} />
      <CrossSignals day={day} signals={signals} shifts={shiftData.rows} />

      {/* 5. body */}
      <Section icon={<Brain size={17} />} title="Body systems" sub="Select a point on the body to see its status and what to do." />
      <div className="ov-grid2">
        <Panel title="Body map" subtitle="Colour = status of that system today" icon={<Activity size={18} className="icon-muted" />}><BodySystems day={day} /></Panel>
        <BoneProbabilities day={day} />
      </div>

      {/* 6. mission context */}
      <Section icon={<Rocket size={17} />} title="Mission context" sub="How the blood signal moves from pre-flight through recovery, and which values changed most." />
      <div className="ov-grid2 even">
        <Trajectory day={day} />
        <BaselinePanel day={day} />
      </div>

      {/* 6b. time scales */}
      <Section icon={<TrendingUp size={17} />} title="Three time scales" sub="Daily snapshot, last 7 days vs the 7 before, and long-term change against the person’s own baseline. Gaps are shown, not filled." />
      <TimeScales day={day} shifts={shiftData.rows} end={shiftData.end} ck={ck} />

      {/* 7. trust */}
      <Section icon={<ShieldCheck size={17} />} title="How much to trust this" sub="The level comes from fixed rules; the models behind them differ a lot in quality." />
      <LevelLogic day={day} signals={signals} />
      <ModelTrust day={day} />

      {/* 8. gaps go last */}
      <CoverageTable day={day} rows={coverage} ck={ck} />

      <Notice>
        <p>{day.disclaimer} Evidence labels: <EvidenceTag kind="strong" /> <EvidenceTag kind="weak" /> <EvidenceTag kind="screening" /> <EvidenceTag kind="proxy" /></p>
      </Notice>
    </>
  );
}