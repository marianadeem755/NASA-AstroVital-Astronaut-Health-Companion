import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, ErrorBar, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, AlertTriangle, BarChart3, Bell, Droplets, FlaskConical, GitCompare, Info, Layers, Loader2, Rocket, ShieldAlert, TrendingUp, WifiOff } from 'lucide-react';
import { useDay, useModels, useSubjects } from '../../../hooks/useAstro';
import { checkDay, getAnalyticsInsight } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { DataGate, EvidenceTag, Notice, PageHeader, Panel, RecToggle, TONE_COLOR, type Tone } from '../../../shared/components/live';

/* ==========================================================================================================
   TRENDS & ANALYTICS · own CSS (prefix "an-"). The two panels that were here (blood across the mission, model AUC) are
   unchanged in content; their charts now carry axis titles and the same hover card the Overview page uses. Below them,
   POST /ml/analytics-insight adds: the astronaut's logged data, how the measures move together, risk and alerts, the
   blood signal across the whole crew and a scorecard of every saved model. Every reference, range, interval and number
   arrives in the response. A section with nothing to show is left out, never drawn empty.
   ========================================================================================================== */

const AN_CSS = `
.an-sec { margin:32px 0 13px; } .an-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; } .an-sec h2 svg { color:#b47bff; }
.an-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:820px; line-height:1.5; }
.an-grid { display:grid; gap:14px; align-items:stretch; margin-bottom:14px; } .an-grid > * { min-width:0; } .an-g2 { grid-template-columns:1.4fr 1fr; } .an-g2e { grid-template-columns:1fr 1fr; } .an-g12 { grid-template-columns:1fr 1.5fr; }
.an-grid .panel { margin-bottom:0; height:100%; } .an-gap { margin-bottom:14px; }
.an-chip { display:inline-block; font:9px 'DM Mono',monospace; letter-spacing:.5px; text-transform:uppercase; padding:3px 8px; border-radius:6px; border:1px solid; white-space:nowrap; }
.an-seg { display:inline-flex; flex-wrap:wrap; border:1px solid #343d62; border-radius:8px; overflow:hidden; margin-bottom:10px; }
.an-seg button { padding:7px 12px; font-size:10px; border:0; background:#111832; color:#8992b1; font-weight:700; cursor:pointer; } .an-seg button.on { background:#22346b; color:#e4eeff; } .an-seg button:hover { color:#fff; }
.an-pills { display:flex; flex-wrap:wrap; gap:7px; margin:0 0 12px; }
.an-pill { display:inline-flex; align-items:center; gap:7px; padding:6px 11px; font-size:10.5px; border-radius:999px; border:1px solid #343d62; background:#111832; color:#aab2d0; cursor:pointer; font-weight:600; }
.an-pill i { width:8px; height:8px; border-radius:50%; display:inline-block; } .an-pill.on { background:#22346b; color:#fff; border-color:#5b78d6; } .an-pill:hover { border-color:#b47bff; color:#fff; }
.an-read { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:11px; margin-bottom:14px; }
.an-card { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:13px 14px; font-size:11.5px; line-height:1.6; color:#cfd4ea; display:flex; flex-direction:column; gap:9px; justify-content:space-between; }
.an-card b { color:#f1f3fb; font-size:12.5px; display:block; margin-bottom:4px; }
.an-card.ok { border-left-color:#55e6b1; } .an-card.warn { border-left-color:#ffd37c; } .an-card.bad { border-left-color:#ff6b8b; } .an-card.mute { border-left-color:#7aa8ff; }
.an-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:2px 0 14px; }
.an-kpis div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; } .an-kpis span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; }
.an-kpis b { display:block; font-size:19px; margin-top:6px; letter-spacing:-.5px; } .an-kpis small { display:block; font-size:9.5px; color:#8d97b4; margin-top:3px; line-height:1.4; }
.an-tbl { width:100%; border-collapse:collapse; font-size:11.5px; } .an-tbl th { text-align:left; font:8.5px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; padding:8px 10px; border-bottom:1px solid #2a3355; white-space:nowrap; }
.an-tbl td { padding:10px; border-top:1px solid #1f2745; color:#dfe3f3; vertical-align:top; line-height:1.45; } .an-tbl tr:first-child td { border-top:0; } .an-tbl tbody tr:hover td { background:#141c3d; }
.an-tbl td small { display:block; font:9px 'DM Mono',monospace; color:#7f89a8; margin-top:3px; letter-spacing:.2px; line-height:1.45; } .an-tbl td.n { font:600 12px 'DM Mono',monospace; color:#fff; white-space:nowrap; } .an-tbl td.n small { font-weight:400; }
.an-wrap { overflow-x:auto; }
.an-note { font-size:10.5px; color:#8992b1; line-height:1.55; margin:12px 0 0; }
.an-chart { position:relative; } .an-legend { display:flex; gap:15px; flex-wrap:wrap; font-size:10px; color:#aeb6d0; margin:8px 0 2px; } .an-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
.an-meter { height:8px; background:#252c49; border-radius:6px; overflow:hidden; min-width:70px; } .an-meter i { display:block; height:100%; border-radius:6px; }
.an-heat { display:grid; gap:3px; } .an-heat .c { aspect-ratio:1; border-radius:4px; min-width:0; cursor:default; border:1px solid transparent; transition:border-color .12s; } .an-heat .c:hover { border-color:#fff; }
.an-cm { border-collapse:separate; border-spacing:3px; width:100%; table-layout:fixed; } .an-cm th { font:8px 'DM Mono',monospace; color:#8992b1; text-transform:uppercase; letter-spacing:.4px; font-weight:400; padding:4px 2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.an-cm th.row { text-align:right; padding-right:8px; width:96px; } .an-cm td { height:34px; text-align:center; border-radius:5px; font:600 9.5px 'DM Mono',monospace; color:#fff; cursor:pointer; border:1px solid transparent; transition:border-color .12s; } .an-cm td:hover { border-color:#fff; } .an-cm td.sel { border-color:#b47bff; box-shadow:0 0 0 1px #b47bff; }
.an-bt { display:grid; gap:3px; } .an-bt .cell { border-radius:6px; padding:9px 4px; text-align:center; font:600 11px 'DM Mono',monospace; color:#0b1020; border:1px solid transparent; cursor:default; transition:border-color .12s; } .an-bt .cell:hover { border-color:#fff; } .an-bt .hd { font:8.5px 'DM Mono',monospace; color:#8992b1; text-align:center; padding:4px 2px; } .an-bt .rw { font:600 11px 'DM Mono',monospace; color:#dfe3f3; align-self:center; }
.an-cap { min-height:44px; margin:10px 0 0; padding:10px 12px; border-radius:9px; background:#0f1630; border:1px solid #293252; font-size:11px; color:#cfd4ea; line-height:1.55; }
.an-tip { box-sizing:border-box; width:min(320px, calc(100vw - 32px)); min-width:0; max-width:calc(100vw - 32px); background:#0a1029; border:1px solid #4a5688; border-left:5px solid var(--tip,#b47bff); border-radius:10px; padding:12px 15px 13px; box-shadow:0 14px 40px #000a; pointer-events:none; overflow-wrap:anywhere; }
.an-tip-title { min-width:0; font-size:15px; font-weight:700; color:#fff; line-height:1.35; letter-spacing:-.2px; overflow-wrap:anywhere; }
.an-tip-sub { min-width:0; font:10px 'DM Mono',monospace; color:#9aa4c6; margin-top:4px; line-height:1.5; overflow-wrap:anywhere; }
.an-tip-rows { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:6px 12px; margin-top:10px; padding-top:10px; border-top:1px solid #2c3560; align-items:baseline; min-width:0; } .an-tip-rows span { min-width:0; overflow-wrap:anywhere; }
.an-tip-rows span:nth-child(odd) { font:10px 'DM Mono',monospace; color:#8f99ba; text-transform:uppercase; letter-spacing:.5px; } .an-tip-rows span:nth-child(even) { font-size:13px; font-weight:700; color:#f2f4ff; text-align:right; }
.an-tip-note { min-width:0; margin-top:10px; font-size:11px; color:#c3c9e4; line-height:1.5; overflow-wrap:anywhere; }
@media (max-width:1100px) { .an-g2, .an-g2e, .an-g12 { grid-template-columns:1fr; } }
`;

/* ---------------------------------------------------------------- shared helpers ---------------------------------------------------------------- */

const C = { blue: '#7aa8ff', cyan: '#58d8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', orange: '#ff9a5c', grey: '#8992b1', grid: '#252d4b' };
const PALETTE = [C.cyan, C.violet, C.amber, C.green, C.pink, C.blue];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TONE_HEX: Record<string, string> = { ok: C.green, warn: C.amber, bad: C.pink, mute: C.blue };
const LEVEL_COLOR: Record<string, string> = { low: C.green, medium: C.amber, high: C.orange, critical: C.pink };
const axis = { stroke: '#8992b1', fontSize: 10 };

const f1 = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const sg = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${f1(Math.abs(v), d)}`);
const pc = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const dlab = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
const pTxt = (p: number | null | undefined) => (p == null ? '—' : p < 0.001 ? 'p<0.001' : `p ${p.toFixed(3)}`);

/** Axis title props for recharts (x goes under the axis, y is rotated on the left). Give the chart bottom margin ~16 and the axis a height/width. */
const xl = (value: string) => ({ value, position: 'insideBottom' as const, offset: -14, fill: C.grey, fontSize: 11 });
const yl = (value: string) => ({ value, angle: -90, position: 'insideLeft' as const, offset: 14, style: { textAnchor: 'middle' as const }, fill: C.grey, fontSize: 11 });

/** Hover card shared by every chart on this page. Same look as the Overview page: full name first, then which value is shown and what it means. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TipItem = { name?: string | number; value?: number | string; dataKey?: string | number; color?: string; payload?: Record<string, any> };
type TipSpec = { title: string; sub?: string; rows: [string, ReactNode][]; tone?: Tone; note?: string };
function RichTip({ active, payload, label, spec }: { active?: boolean; payload?: TipItem[]; label?: string | number; spec: (items: TipItem[], label?: string | number) => TipSpec | null }) {
  if (!active || !payload?.length) return null;
  const t = spec(payload, label);
  if (!t) return null;
  return (
    <div className="an-tip" style={{ ['--tip' as string]: !t.tone || t.tone === 'mute' ? '#b47bff' : TONE_COLOR[t.tone] }}>
      <div className="an-tip-title">{t.title}</div>
      {t.sub && <div className="an-tip-sub">{t.sub}</div>}
      <div className="an-tip-rows">{t.rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
      {t.note && <div className="an-tip-note">{t.note}</div>}
    </div>
  );
}
/** The same card as plain markup, for the heatmaps (hover caption). */
function TipCard({ t }: { t: TipSpec }) {
  return (
    <div className="an-tip" style={{ ['--tip' as string]: !t.tone || t.tone === 'mute' ? '#b47bff' : TONE_COLOR[t.tone], width: 'min(380px, 100%)' }}>
      <div className="an-tip-title">{t.title}</div>
      {t.sub && <div className="an-tip-sub">{t.sub}</div>}
      <div className="an-tip-rows">{t.rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
      {t.note && <div className="an-tip-note">{t.note}</div>}
    </div>
  );
}
const cursorLine = { stroke: '#b47bff', strokeDasharray: '3 3' };
const cursorBar = { fill: '#b47bff', fillOpacity: 0.12 };

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="an-chip" style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>{children}</span>;
}
function Section({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="an-sec"><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div>;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Readings({ cards }: { cards?: any[] }) {
  if (!cards?.length) return null;
  return (
    <div className="an-read">
      {cards.map((c, i) => (
        <div className={`an-card ${c.tone ?? 'mute'}`} key={i}>
          <div><b>{c.title}</b>{c.text}</div>
          {c.evidence && <div><EvidenceTag kind={c.evidence} /></div>}
        </div>
      ))}
    </div>
  );
}
function Pills({ items, on, toggle }: { items: { key: string; label: string; color?: string }[]; on: string[]; toggle: (k: string) => void }) {
  return (
    <div className="an-pills">
      {items.map((i) => (
        <button key={i.key} className={`an-pill ${on.includes(i.key) ? 'on' : ''}`} onClick={() => toggle(i.key)}>{i.color && <i style={{ background: i.color }} />}{i.label}</button>
      ))}
    </div>
  );
}

const SHORT: Record<string, string> = { hr: 'HR', spo2: 'SpO2', temp: 'Temp', sys: 'Sys BP', dia: 'Dia BP', sleep: 'Sleep', fatigue: 'Fatig', stress: 'Stress', mood: 'Mood', reaction: 'React', attention: 'Attn', exercise: 'Exer' };
const phaseText = (tp: string) => {
  const m = /^([LR])[+-]?(\d+)$/i.exec(tp.trim());
  if (!m) return undefined;
  const n = Number(m[2]);
  return m[1].toUpperCase() === 'L' ? `${n} days before launch` : `${n} day${n === 1 ? '' : 's'} after landing`;
};

/* ==================================================================================================================
   EXISTING PANEL 1 · Blood trend across the mission (same content, axis titles + hover card added)
   ================================================================================================================== */

function BloodTimeline() {
  const subjects = useSubjects();
  const day = useDay();
  const astronauts = Object.keys(subjects.data?.blood_astronauts ?? {});
  const [picked, setPicked] = useState<string>('');
  const astronaut = picked || day.data?.inputs_used.blood_astronaut || astronauts[0] || '';
  const timepoints = subjects.data?.blood_astronauts?.[astronaut] ?? [];

  const results = useQueries({
    queries: timepoints.map((tp) => ({
      queryKey: ['ml-timeline', astronaut, tp],
      queryFn: () => checkDay({ blood_astronaut: astronaut, timepoint: tp }),
      staleTime: 10 * 60_000,
      retry: 0,
    })),
  });
  const data = useMemo(() => timepoints.map((tp, i) => {
    const sc = results[i]?.data?.check_day.scores ?? {};
    return { timepoint: tp, cmp: sc['P_R+1_like_insp4_blood'] ?? null, metabolomics: sc['P_R+1_like_osd571_blood'] ?? null };
  }), [timepoints, results]);
  const loading = results.some((r) => r.isLoading);

  return (
    <Panel title="Blood trend across the mission" subtitle="How post-flight-like the blood looks at every sample time of one astronaut" icon={<Droplets size={18} className="purple-icon" />}>
      {astronauts.length === 0 ? <p className="muted">The backend lists no blood astronauts (Inspiration4 file not found).</p> : (
        <>
          <div className="av-btn-row">
            <label className="av-inline">Astronaut
              <select className="select-control" value={astronaut} onChange={(e) => setPicked(e.target.value)}>{astronauts.map((a) => <option key={a}>{a}</option>)}</select>
            </label>
            {loading && <span className="muted">Running models for each timepoint…</span>}
          </div>
          <div className="chart-wrap" style={{ height: 300 }}>
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 16 }}>
                <CartesianGrid stroke="#252d4b" vertical={false} />
                <XAxis dataKey="timepoint" stroke="#8992b1" fontSize={10} height={50} label={xl('Sample time (L- = days before launch, R+ = days after return)')} />
                <YAxis stroke="#8992b1" fontSize={10} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={64} label={yl('Chance the blood looks like 1 day after landing')} />
                <Tooltip cursor={cursorLine} content={<RichTip spec={(items, lab) => {
                  const over = items.some((i) => Number(i.value) > 0.5);
                  return { title: `Blood sample ${lab}`, sub: `${astronaut}${phaseText(String(lab)) ? ` · ${phaseText(String(lab))}` : ''}`, tone: over ? 'bad' : 'ok',
                    rows: [...items.map((i): [string, ReactNode] => [String(i.name), i.value == null ? '—' : `${Math.round(Number(i.value) * 100)}%`]), ['Flag line', '50%'], ['Status', over ? 'OVER THE LINE' : 'UNDER THE LINE']],
                    note: 'Each value is the chance that the blood sample looks like a sample taken 1 day after landing.' };
                }} />} />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0.5} stroke="#ffd37c" strokeDasharray="4 4" label={{ value: 'flag line', fill: '#ffd37c', fontSize: 10, position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="cmp" name="CMP + CBC model" stroke="#b47bff" strokeWidth={2} dot={{ r: 3.5 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }} connectNulls />
                <Line type="monotone" dataKey="metabolomics" name="Metabolomics model" stroke="#58d8ff" strokeWidth={2} dot={{ r: 3.5 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="muted">L- = before launch, R+ = days after return. A good model stays low before flight and rises right after landing.</p>
        </>
      )}
    </Panel>
  );
}

/* ==================================================================================================================
   EXISTING PANEL 2 · How good is each model? (same content, axis titles + hover card + bar highlight added)
   ================================================================================================================== */

function ModelQuality() {
  const models = useModels();
  const [hot, setHot] = useState<number | null>(null);
  const rows = (models.data ?? []).map((m) => {
    const x = (m.metrics ?? {}) as Record<string, unknown>;
    const score = [x.roc_auc, x.macro_auc_ovr].find((v) => typeof v === 'number') as number | undefined;
    return { model: m.model.replace('_logreg', '').replace('_isoforest', '').replace('_pca', ''), full: m.model, score: score ?? null, predicts: m.predicts, population: m.population, status: m.status, validation: m.validation };
  }).filter((r) => r.score !== null);
  return (
    <Panel title="How good is each model?" subtitle="AUC from the backend model files · 0.5 is a coin flip" icon={<BarChart3 size={18} className="icon-muted" />}>
      {models.isLoading ? <p className="muted">Loading…</p> : (
        <div className="chart-wrap" style={{ height: 320 }} onMouseLeave={() => setHot(null)}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 16 }}>
              <CartesianGrid stroke="#252d4b" vertical={false} />
              <XAxis dataKey="model" stroke="#8992b1" fontSize={9} interval={0} height={50} label={xl('Saved model')} />
              <YAxis stroke="#8992b1" fontSize={10} domain={[0, 1]} width={56} label={yl('AUC (0.5 = coin flip, 1 = perfect)')} />
              <Tooltip cursor={cursorBar} content={<RichTip spec={(items) => {
                const d = items[0]?.payload as (typeof rows)[number] | undefined;
                if (!d || d.score == null) return null;
                const good = d.score >= 0.7;
                return { title: d.full, sub: d.population ?? undefined, tone: good ? 'ok' : d.score < 0.55 ? 'bad' : 'warn',
                  rows: [['AUC', d.score.toFixed(3)], ['Reads as', d.score < 0.55 ? 'no better than a coin flip' : good ? 'some real signal' : 'weak signal'], ['Validation', d.validation ?? '—']],
                  note: [d.predicts, d.status].filter(Boolean).join(' · ') || undefined };
              }} />} />
              <ReferenceLine y={0.5} stroke="#ffd37c" strokeDasharray="4 4" label={{ value: 'coin flip', fill: '#ffd37c', fontSize: 10, position: 'insideTopRight' }} />
              <Bar dataKey="score" name="AUC" radius={[4, 4, 0, 0]} onMouseEnter={(_d: unknown, i: number) => setHot(i)}>
                {rows.map((r, i) => <Cell key={r.model} fill={(r.score ?? 0) >= 0.7 ? '#55e6b1' : '#b47bff'} fillOpacity={hot == null || hot === i ? 1 : 0.35} stroke={hot === i ? '#fff' : 'none'} strokeWidth={hot === i ? 2 : 0} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/* ==================================================================================================================
   NEW · logged data
   ================================================================================================================== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function CoverageStrip({ cov }: { cov: Any }) {
  const [hot, setHot] = useState<Any | null>(null);
  const max = Math.max(...cov.heat.map((h: Any) => h.n), 1);
  const cols = Math.min(cov.heat.length, 90);
  return (
    <Panel title="How complete is the log?" subtitle={`${cov.days_with_data} of ${cov.span_days} days have data · longest stretch with none: ${cov.longest_gap_days} day${cov.longest_gap_days === 1 ? '' : 's'}`} icon={<Layers size={18} className="purple-icon" />}>
      <div className="an-heat" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, maxWidth: cols * 34 }} onMouseLeave={() => setHot(null)}>
        {cov.heat.map((h: Any) => (
          <div key={h.date} className="c" onMouseEnter={() => setHot(h)} style={{ background: h.n ? `rgba(180,123,255,${0.18 + (h.n / max) * 0.82})` : '#1a2142' }} />
        ))}
      </div>
      <div className="an-cap">
        {hot ? <><b>{dlab(hot.date)}</b> · {hot.n ? `${hot.n} measure${hot.n === 1 ? '' : 's'} logged` : 'nothing logged'}</> : 'Each square is one day, oldest first. Darker = more measures logged that day. Hover a square.'}
      </div>
    </Panel>
  );
}

function MetricExplorer({ metrics }: { metrics: Any[] }) {
  const [key, setKey] = useState(metrics[0].key);
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  const vals = m.series.map((s: Any) => s.value).filter((v: number | null) => v != null) as number[];
  const lo = m.reference?.low, hi = m.reference?.high;
  const mn = Math.min(...vals, lo ?? Infinity), mx = Math.max(...vals, hi ?? -Infinity);
  const pad = (mx - mn) * 0.12 || 1;
  const y0 = mn - pad, y1 = mx + pad;
  const t = m.trend;
  const tone: Tone = t.direction === 'steady' ? 'mute' : m.better ? ((t.direction === 'falling') === (m.better === 'higher') ? 'warn' : 'ok') : 'mute';
  return (
    <Panel title="Every logged measure, day by day" subtitle="Pick a measure. Dots = daily value, line = 7-day mean, dashed = fitted trend" icon={<Activity size={18} className="purple-icon" />}>
      <div className="an-seg">{metrics.map((x) => <button key={x.key} className={key === x.key ? 'on' : ''} onClick={() => setKey(x.key)}>{x.label}</button>)}</div>
      <div className="an-chart" style={{ height: 320 }}>
        <ResponsiveContainer>
          <ComposedChart data={m.series} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} tickFormatter={dlab} height={50} minTickGap={22} label={xl('Date')} />
            <YAxis {...axis} domain={[y0, y1]} tickFormatter={(v) => f1(v, y1 - y0 > 12 ? 0 : 1)} width={64} label={yl(`${m.label} (${m.unit})`)} />
            {m.reference && <ReferenceArea y1={lo ?? y0} y2={hi ?? y1} fill={C.green} fillOpacity={0.09} stroke={C.green} strokeOpacity={0.35} label={{ value: `range: ${m.reference.text}`, fill: C.green, fontSize: 9, position: 'insideTopRight' }} />}
            <Tooltip cursor={cursorLine} content={<RichTip spec={(items) => {
              const d = items[0]?.payload as Any | undefined;
              if (!d) return null;
              const out = m.reference && d.value != null && ((lo != null && d.value < lo) || (hi != null && d.value > hi));
              return { title: `${m.label} · ${dlab(d.date)}`, sub: `${m.unit} · ${m.n_days} days with data`, tone: out ? 'warn' : 'mute',
                rows: [['Value', `${f1(d.value, 2)} ${m.unit}`], ['7-day mean', d.roll != null ? `${f1(d.roll, 2)} ${m.unit}` : '—'], ['Fitted trend', d.trend != null ? `${f1(d.trend, 2)} ${m.unit}` : '—'],
                  ['Own average', `${f1(m.stats.mean, 2)} ${m.unit}`], ...(m.reference ? [['Reference', out ? `OUTSIDE ${m.reference.text}` : `inside ${m.reference.text}`] as [string, ReactNode]] : [])],
                note: m.reference?.source };
            }} />} />
            <Line type="monotone" dataKey="value" name="Daily value" stroke="none" dot={{ r: 3.5, fill: C.violet, stroke: '#0d132a' }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="roll" name="7-day mean" stroke={C.cyan} strokeWidth={2.4} dot={false} activeDot={{ r: 5, stroke: '#fff' }} connectNulls />
            <Line type="linear" dataKey="trend" name="Trend" stroke={C.amber} strokeWidth={1.8} strokeDasharray="6 4" dot={false} activeDot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="an-kpis" style={{ marginTop: 14 }}>
        <div><span>Latest</span><b>{f1(m.latest.value, 1)} <small style={{ display: 'inline' }}>{m.unit}</small></b><small>{dlab(m.latest.date)}{m.latest.days_ago > 0 ? ` · ${m.latest.days_ago} d ago` : ''}</small></div>
        <div><span>Average ± spread</span><b>{f1(m.stats.mean, 1)}</b><small>± {f1(m.stats.sd, 1)} · {f1(m.stats.min, 1)} to {f1(m.stats.max, 1)}</small></div>
        <div><span>Trend</span><b style={{ color: TONE_HEX[tone === 'mute' ? 'mute' : tone] }}>{t.direction}</b><small>{t.slope_per_week != null ? `${sg(t.slope_per_week, 2)} ${m.unit}/week · ${pTxt(t.p)}` : 'not enough variation'}</small></div>
        <div><span>Last 7 vs the 7 before</span><b>{m.wow ? sg(m.wow.diff, 1) : '—'}</b><small>{m.wow ? `${f1(m.wow.last7)} vs ${f1(m.wow.prev7)}${m.wow.noticeable ? ' · noticeable' : ' · within usual swing'}` : 'needs 3 days in each week'}</small></div>
        {m.reference && <div><span>Outside the range</span><b style={{ color: m.reference.share_outside >= 0.25 ? C.amber : C.green }}>{pc(m.reference.share_outside)}</b><small>{m.reference.days_outside} of {m.n_days} days · {m.reference.text}</small></div>}
      </div>
      {m.reference && <p className="an-note">{m.reference.source}</p>}
    </Panel>
  );
}

function Overview({ metrics, cov }: { metrics: Any[]; cov: Any }) {
  const covBy: Record<string, Any> = Object.fromEntries(cov.rows.map((r: Any) => [r.key, r]));
  return (
    <Panel title="All measures at a glance" subtitle="Latest value, direction and how the last week compares" icon={<TrendingUp size={18} className="purple-icon" />}>
      <div className="an-wrap">
        <table className="an-tbl">
          <thead><tr><th>Measure</th><th>Latest</th><th>Average ± spread</th><th>Trend (per week)</th><th>Last 7 vs before</th><th>Outside range</th><th>Logged</th></tr></thead>
          <tbody>{metrics.map((m) => {
            const t = m.trend;
            const worse = t.direction !== 'steady' && m.better && (t.direction === 'falling') === (m.better === 'higher');
            const col = t.direction === 'steady' ? C.grey : m.better ? (worse ? C.amber : C.green) : C.blue;
            return (
              <tr key={m.key}>
                <td><b>{m.label}</b><small>{m.n_days} days · {m.unit}</small></td>
                <td className="n">{f1(m.latest.value, 1)}<small>{dlab(m.latest.date)}</small></td>
                <td className="n">{f1(m.stats.mean, 1)}<small>± {f1(m.stats.sd, 1)}</small></td>
                <td className="n" style={{ color: col }}>{t.direction === 'steady' ? 'steady' : `${t.direction === 'rising' ? '↑' : '↓'} ${sg(t.slope_per_week, 2)}`}<small>{pTxt(t.p)}</small></td>
                <td className="n">{m.wow ? sg(m.wow.diff, 1) : '—'}<small>{m.wow ? (m.wow.noticeable ? 'noticeable' : 'usual swing') : ''}</small></td>
                <td>{m.reference ? <><div className="an-meter"><i style={{ width: `${m.reference.share_outside * 100}%`, background: m.reference.share_outside >= 0.25 ? C.amber : C.green }} /></div><small>{pc(m.reference.share_outside)} · {m.reference.text}</small></> : <small>no published range</small>}</td>
                <td className="n">{covBy[m.key] ? `${covBy[m.key].days} d` : '—'}<small>{covBy[m.key] ? `${pc(covBy[m.key].share)} · gap ${covBy[m.key].longest_gap_days} d` : ''}</small></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function ZOverlay({ metrics }: { metrics: Any[] }) {
  const [on, setOn] = useState<string[]>(() => metrics.slice(0, 3).map((m) => m.key));
  const toggle = (k: string) => setOn((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= 5 ? p : [...p, k]));
  const rows = useMemo(() => {
    const by: Record<string, Any> = {};
    metrics.filter((m) => on.includes(m.key)).forEach((m) => m.series.forEach((s: Any) => { (by[s.date] ??= { date: s.date })[`${m.key}_z`] = s.z; by[s.date][`${m.key}_v`] = s.value; }));
    return Object.values(by).sort((a, b) => a.date.localeCompare(b.date));
  }, [metrics, on]);
  const colorOf = (k: string) => PALETTE[metrics.findIndex((m) => m.key === k) % PALETTE.length];
  return (
    <Panel title="Measures on one scale" subtitle="Each line shows how far a measure is from its own average, in spreads, so different units can be compared. Up to 5" icon={<Layers size={18} className="purple-icon" />}>
      <Pills items={metrics.map((m) => ({ key: m.key, label: m.label, color: colorOf(m.key) }))} on={on} toggle={toggle} />
      <div className="an-chart" style={{ height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} tickFormatter={dlab} height={50} minTickGap={22} label={xl('Date')} />
            <YAxis {...axis} width={64} tickFormatter={(v) => f1(v, 1)} label={yl('Spreads from own average (z-score)')} />
            <ReferenceLine y={0} stroke={C.grey} />
            <Tooltip cursor={cursorLine} content={<RichTip spec={(items) => {
              const d = items[0]?.payload as Any | undefined;
              if (!d) return null;
              return { title: dlab(d.date), sub: 'Each row: raw value (and how far from own average)', tone: 'mute',
                rows: metrics.filter((m) => on.includes(m.key) && d[`${m.key}_v`] != null).map((m): [string, ReactNode] => [m.label, `${f1(d[`${m.key}_v`], 1)} ${m.unit} (${sg(d[`${m.key}_z`], 1)} sd)`]),
                note: '0 = this measure\'s own average. +1 = one usual spread above it.' };
            }} />} />
            {metrics.filter((m) => on.includes(m.key)).map((m) => (
              <Line key={m.key} type="monotone" dataKey={`${m.key}_z`} name={m.label} stroke={colorOf(m.key)} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} connectNulls />
            ))}
            <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ==================================================================================================================
   NEW · relations
   ================================================================================================================== */

function corrColor(r: number, clear: boolean) {
  const a = 0.15 + Math.abs(r) * 0.8;
  return r >= 0 ? `rgba(88,216,255,${clear ? a : a * 0.35})` : `rgba(255,107,139,${clear ? a : a * 0.35})`;
}

function Relations({ rel, metrics }: { rel: Any; metrics: Any[] }) {
  const cell = useMemo(() => { const m: Record<string, Any> = {}; rel.matrix.forEach((c: Any) => { m[`${c.a}|${c.b}`] = c; m[`${c.b}|${c.a}`] = c; }); return m; }, [rel]);
  const first = rel.top[0] ?? rel.matrix[0];
  const [sel, setSel] = useState<[string, string]>([first.a, first.b]);
  const [hot, setHot] = useState<Any | null>(null);
  const [hotBar, setHotBar] = useState<number | null>(null);
  const L = rel.labels as Record<string, string>;
  const mm = (k: string) => metrics.find((m) => m.key === k)!;
  const scatter = useMemo(() => {
    const [a, b] = sel; const sa = mm(a).series, sb = Object.fromEntries(mm(b).series.map((s: Any) => [s.date, s.value]));
    return sa.filter((s: Any) => s.value != null && sb[s.date] != null).map((s: Any) => ({ date: s.date, x: s.value, y: sb[s.date] }));
  }, [sel, metrics]); // eslint-disable-line react-hooks/exhaustive-deps
  const spanOf = (k: 'x' | 'y') => { const v = scatter.map((d: Any) => d[k]); return v.length ? Math.max(...v) - Math.min(...v) : 0; };
  const cur = cell[`${sel[0]}|${sel[1]}`];
  const tipOf = (c: Any): TipSpec => ({ title: `${L[c.a]} and ${L[c.b]}`, sub: `same-day relation · ${c.n} days where both were logged`, tone: c.clear ? (c.r > 0 ? 'ok' : 'warn') : 'mute',
    rows: [['Spearman r', sg(c.r, 2)], ['Strength', c.strength], ['p-value', pTxt(c.p)], ['Clear?', c.clear ? 'yes (p under 0.05)' : 'no, could be chance']], note: c.r > 0 ? 'They tend to rise and fall together.' : 'When one is higher the other tends to be lower.' });
  const bars = [...rel.top.map((c: Any) => ({ ...c, kind: 'same day', name: `${L[c.a]} ↔ ${L[c.b]}` })), ...rel.top_next_day.map((c: Any) => ({ ...c, kind: 'next day', name: `${L[c.a]} today → ${L[c.b]} tomorrow` }))];
  return (
    <>
      <Section icon={<GitCompare size={17} />} title="How the measures move together" sub={rel.note} />
      <Readings cards={rel.reading} />
      <div className="an-grid an-g2">
        <Panel title="Relation map" subtitle="Click a cell to plot that pair. Faded cells are not clearly different from chance" icon={<GitCompare size={18} className="purple-icon" />}>
          <div className="an-wrap">
            <table className="an-cm" onMouseLeave={() => setHot(null)}>
              <thead><tr><th className="row" />{rel.keys.map((k: string) => <th key={k} title={L[k]}>{SHORT[k] ?? k}</th>)}</tr></thead>
              <tbody>{rel.keys.map((a: string) => (
                <tr key={a}>
                  <th className="row" title={L[a]}>{L[a].length > 14 ? `${L[a].slice(0, 13)}…` : L[a]}</th>
                  {rel.keys.map((b: string) => {
                    if (a === b) return <td key={b} style={{ background: '#1a2142', cursor: 'default' }}>·</td>;
                    const c = cell[`${a}|${b}`];
                    if (!c) return <td key={b} style={{ background: '#121a37', cursor: 'default', color: '#5a6385' }} onMouseEnter={() => setHot(null)}>–</td>;
                    const isSel = (sel[0] === a && sel[1] === b) || (sel[0] === b && sel[1] === a);
                    return <td key={b} className={isSel ? 'sel' : ''} style={{ background: corrColor(c.r, c.clear) }} onMouseEnter={() => setHot(c)} onClick={() => setSel([a, b])}>{c.r.toFixed(2).replace('0.', '.').replace('-0.', '-.')}</td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="an-legend"><span><i style={{ background: 'rgba(88,216,255,.8)' }} />rise together</span><span><i style={{ background: 'rgba(255,107,139,.8)' }} />move opposite</span><span><i style={{ background: '#121a37' }} />too few shared days</span></div>
          <div className="an-cap" style={{ background: 'transparent', border: 0, padding: 0 }}>{hot ? <TipCard t={tipOf(hot)} /> : <span className="an-note">Hover a cell for the details, click it to plot the pair on the right.</span>}</div>
        </Panel>
        <Panel title={`${L[sel[0]]} vs ${L[sel[1]]}`} subtitle={cur ? `Each dot is one day · Spearman r ${sg(cur.r, 2)} · ${cur.strength} · n ${cur.n} · ${pTxt(cur.p)}` : 'Each dot is one day'} icon={<Activity size={18} className="purple-icon" />}>
          <div className="an-chart" style={{ height: 440 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 16 }}>
                <CartesianGrid stroke={C.grid} />
                <XAxis type="number" dataKey="x" name={L[sel[0]]} {...axis} domain={['auto', 'auto']} tickFormatter={(v) => f1(v, spanOf('x') > 6 ? 0 : 1)} height={50} label={xl(`${L[sel[0]]} (${mm(sel[0]).unit})`)} />
                <YAxis type="number" dataKey="y" name={L[sel[1]]} {...axis} domain={['auto', 'auto']} tickFormatter={(v) => f1(v, spanOf('y') > 6 ? 0 : 1)} width={64} label={yl(`${L[sel[1]]} (${mm(sel[1]).unit})`)} />
                <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#b47bff' }} content={<RichTip spec={(items) => {
                  const d = items[0]?.payload as Any | undefined;
                  if (!d) return null;
                  return { title: dlab(d.date), sub: 'One day', tone: 'mute', rows: [[L[sel[0]], `${f1(d.x, 2)} ${mm(sel[0]).unit}`], [L[sel[1]], `${f1(d.y, 2)} ${mm(sel[1]).unit}`]] };
                }} />} />
                <Scatter data={scatter} fill={C.violet} fillOpacity={0.75} stroke="#0d132a" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      {bars.length > 0 && (
        <Panel title="Clearest relations" subtitle="Spearman r, from −1 (opposite) to +1 (together). Only pairs with p under 0.05" icon={<TrendingUp size={18} className="purple-icon" />}>
          <div className="an-chart" style={{ height: Math.max(180, bars.length * 38 + 70) }} onMouseLeave={() => setHotBar(null)}>
            <ResponsiveContainer>
              <BarChart data={bars} layout="vertical" margin={{ top: 6, right: 22, left: 8, bottom: 16 }}>
                <CartesianGrid stroke={C.grid} horizontal={false} />
                <XAxis type="number" domain={[-1, 1]} {...axis} height={50} label={xl('Spearman r (−1 = opposite, +1 = together)')} />
                <YAxis type="category" dataKey="name" width={230} {...axis} label={{ value: 'Pair of measures', angle: -90, position: 'insideLeft', offset: -2, style: { textAnchor: 'middle' }, fill: C.grey, fontSize: 11 }} />
                <ReferenceLine x={0} stroke={C.grey} />
                <Tooltip cursor={cursorBar} content={<RichTip spec={(items) => {
                  const d = items[0]?.payload as Any | undefined;
                  if (!d) return null;
                  return { title: d.name, sub: `${d.kind} relation`, tone: d.r > 0 ? 'ok' : 'warn', rows: [['Spearman r', sg(d.r, 2)], ['Strength', d.strength], ['Days compared', String(d.n)], ['p-value', pTxt(d.p)]],
                    note: d.kind === 'next day' ? 'Order in time is not proof of cause.' : 'An association, not a cause.' };
                }} />} />
                <Bar dataKey="r" radius={4} onMouseEnter={(_d: unknown, i: number) => setHotBar(i)}>
                  {bars.map((b: Any, i: number) => <Cell key={`${b.kind}${b.name}`} fill={b.r > 0 ? C.cyan : C.pink} fillOpacity={hotBar == null || hotBar === i ? (b.kind === 'next day' ? 0.7 : 1) : 0.3} stroke={hotBar === i ? '#fff' : 'none'} strokeWidth={hotBar === i ? 2 : 0} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="an-legend"><span><i style={{ background: C.cyan }} />positive</span><span><i style={{ background: C.pink }} />negative</span><span>paler bars = next-day relations</span></div>
        </Panel>
      )}
    </>
  );
}

/* ==================================================================================================================
   NEW · risk and alerts
   ================================================================================================================== */

function RiskSection({ risk }: { risk: Any }) {
  const a = risk.assessments, al = risk.alerts;
  const [cat, setCat] = useState<string>(a?.categories?.[0]?.category);
  const c = a?.categories?.find((x: Any) => x.category === cat) ?? a?.categories?.[0];
  const priRows = al ? Object.entries(al.by_priority).map(([p, v]) => ({ priority: p, ...(v as Any) })) : [];
  return (
    <>
      <Section icon={<ShieldAlert size={17} />} title="Risk and alerts over time" sub="Rule-engine assessments and the alert queue for this astronaut. These come from the stored risk history, not from the blood or sleep models." />
      <Readings cards={risk.reading} />
      {a && (
        <div className="an-grid an-g2">
          <Panel title="Assessments by week" subtitle={`${a.total} assessments · how many landed in each level`} icon={<ShieldAlert size={18} className="purple-icon" />}>
            <div className="an-chart" style={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={a.weeks} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="week" {...axis} tickFormatter={dlab} height={50} label={xl('Week starting (Monday)')} />
                  <YAxis {...axis} allowDecimals={false} width={56} label={yl('Risk assessments')} />
                  <Tooltip cursor={cursorBar} content={<RichTip spec={(items) => {
                    const d = items[0]?.payload as Any | undefined;
                    if (!d) return null;
                    const worst = d.critical ? 'bad' : d.high ? 'warn' : 'ok';
                    return { title: `Week of ${dlab(d.week)}`, sub: `${d.total} assessments`, tone: worst as Tone, rows: ['low', 'medium', 'high', 'critical'].map((l): [string, ReactNode] => [l, String(d[l])]), note: 'Higher levels mean the rule engine saw more factors outside their limits.' };
                  }} />} />
                  <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
                  {['low', 'medium', 'high', 'critical'].map((l) => <Bar key={l} dataKey={l} stackId="r" fill={LEVEL_COLOR[l]} name={l} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Categories" subtitle="Latest level, how often high or critical, and the score trend" icon={<Layers size={18} className="purple-icon" />}>
            <div className="an-wrap">
              <table className="an-tbl">
                <thead><tr><th>Category</th><th>Latest</th><th>High / critical</th><th>Score trend</th></tr></thead>
                <tbody>{a.categories.map((x: Any) => (
                  <tr key={x.category} style={{ cursor: 'pointer' }} onClick={() => setCat(x.category)}>
                    <td><b>{x.label}</b><small>{x.n} assessments</small></td>
                    <td><Chip color={LEVEL_COLOR[x.latest_level] ?? C.grey}>{x.latest_level}</Chip><small>score {f1(x.latest_score, 2)}</small></td>
                    <td className="n">{pc(x.share_high_or_critical)}</td>
                    <td className="n">{x.trend ? `${x.trend.direction === 'steady' ? 'steady' : x.trend.direction === 'rising' ? '↑ rising' : '↓ falling'}` : '—'}<small>{x.trend ? `${sg(x.trend.slope_per_week, 3)}/week · ${pTxt(x.trend.p)}` : 'needs 4 assessments'}</small></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}
      {c && (
        <Panel title={`Risk score · ${c.label}`} subtitle="Pick a category in the table above or here. Each dot is one assessment, coloured by its level" icon={<Activity size={18} className="purple-icon" />}>
          <div className="an-seg">{a.categories.map((x: Any) => <button key={x.category} className={x.category === c.category ? 'on' : ''} onClick={() => setCat(x.category)}>{x.label}</button>)}</div>
          <div className="an-chart" style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={c.points} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="at" {...axis} tickFormatter={dlab} height={50} minTickGap={24} label={xl('Date of assessment')} />
                <YAxis {...axis} width={56} tickFormatter={(v) => f1(v, 1)} label={yl('Risk score')} />
                <Tooltip cursor={cursorLine} content={<RichTip spec={(items) => {
                  const d = items[0]?.payload as Any | undefined;
                  if (!d) return null;
                  return { title: `${c.label} · ${dlab(d.at)}`, tone: d.level === 'critical' ? 'bad' : d.level === 'high' ? 'warn' : 'ok', rows: [['Score', f1(d.score, 2)], ['Level', String(d.level).toUpperCase()]] };
                }} />} />
                <Line type="monotone" dataKey="score" stroke={C.violet} strokeWidth={2} dot={(p: Any) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4.5} fill={LEVEL_COLOR[p.payload.level] ?? C.grey} stroke="#0d132a" />} activeDot={{ r: 8, stroke: '#fff', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
      {al && (
        <div className="an-grid an-g12" style={{ marginTop: 14 }}>
          <Panel title="Alert queue" subtitle={`${al.total} alerts in total`} icon={<Bell size={18} className="purple-icon" />}>
            <div className="an-kpis">
              <div><span>Open</span><b style={{ color: al.open ? C.amber : C.green }}>{al.open}</b><small>waiting for acknowledgement</small></div>
              <div><span>Acknowledged</span><b>{al.acknowledged}</b><small>closed</small></div>
              <div><span>Median time to acknowledge</span><b>{al.median_hours_to_acknowledge != null ? `${f1(al.median_hours_to_acknowledge, 1)} h` : '—'}</b><small>acknowledged alerts only</small></div>
              {al.oldest_open_hours != null && <div><span>Oldest open</span><b>{f1(al.oldest_open_hours, 0)} h</b><small>age of the longest-waiting alert</small></div>}
            </div>
          </Panel>
          <Panel title="Alerts by priority" subtitle="Open and acknowledged" icon={<Bell size={18} className="purple-icon" />}>
            <div className="an-chart" style={{ height: 250 }}>
              <ResponsiveContainer>
                <BarChart data={priRows} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="priority" {...axis} height={50} label={xl('Alert priority')} />
                  <YAxis {...axis} allowDecimals={false} width={56} label={yl('Number of alerts')} />
                  <Tooltip cursor={cursorBar} content={<RichTip spec={(items) => {
                    const d = items[0]?.payload as Any | undefined;
                    if (!d) return null;
                    return { title: `${String(d.priority).toUpperCase()} priority`, tone: d.open ? (d.priority === 'critical' || d.priority === 'high' ? 'bad' : 'warn') : 'ok', rows: [['Open', String(d.open)], ['Acknowledged', String(d.acknowledged)]] };
                  }} />} />
                  <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="open" stackId="a" name="Open" fill={C.amber} />
                  <Bar dataKey="acknowledged" stackId="a" name="Acknowledged" fill={C.green} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}

/* ==================================================================================================================
   NEW · blood across the crew
   ================================================================================================================== */

function probColor(p: number) { return p > 0.5 ? `rgba(255,107,139,${0.55 + (p - 0.5) * 0.9})` : `rgba(85,230,177,${0.25 + (0.5 - p) * 1.1})`; }

function BloodCrew({ blood }: { blood: Any }) {
  const [model, setModel] = useState<'cbc' | 'metabolomics'>('cbc');
  const [hot, setHot] = useState<Any | null>(null);
  const [hotBar, setHotBar] = useState<number | null>(null);
  const modelName = model === 'cbc' ? 'CMP + CBC model' : 'Metabolomics model';
  const tps: Any[] = blood.timepoints;
  const crew: string[] = blood.astronauts.map((g: Any) => g.astronaut);
  const val = (g: Any, tp: string) => g.points.find((p: Any) => p.tp === tp)?.[model] ?? null;
  const lineRows = tps.map((t) => {
    const r: Any = { tp: t.tp, phase: t.phase };
    blood.astronauts.forEach((g: Any) => { r[g.astronaut] = val(g, t.tp); });
    r.crew = blood.crew_mean.find((c: Any) => c.tp === t.tp)?.[model] ?? null;
    return r;
  });
  const an = blood.analytes;
  const anRows = an ? an.rows.map((r: Any) => ({ ...r, err: [r.mean_pct - r.min_pct, r.max_pct - r.mean_pct] })) : [];
  return (
    <>
      <Section icon={<Rocket size={17} />} title="Blood across the whole crew" sub={`The two post-flight blood models run on every sample of every crew member. ${blood.flag_line * 100}% is the same flag line the Overview page uses. Both models were trained on this same crew (16 rows), so this is a proof of concept, not a test.`} />
      <Readings cards={blood.reading} />
      <div className="an-grid an-g2">
        <Panel title="Chance the blood looks like 1 day after landing" subtitle="One line per crew member, thick line = crew average" icon={<Droplets size={18} className="purple-icon" />}>
          <div className="an-seg"><button className={model === 'cbc' ? 'on' : ''} onClick={() => setModel('cbc')}>CMP + CBC model</button><button className={model === 'metabolomics' ? 'on' : ''} onClick={() => setModel('metabolomics')}>Metabolomics model</button></div>
          <div className="an-chart" style={{ height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={lineRows} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="tp" {...axis} height={50} label={xl('Sample time (L- = before launch, R+ = after landing)')} />
                <YAxis {...axis} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={64} label={yl('Chance it looks like 1 day after landing')} />
                <ReferenceLine y={blood.flag_line} stroke={C.amber} strokeDasharray="4 4" label={{ value: 'flag line', fill: C.amber, fontSize: 10, position: 'insideTopRight' }} />
                <Tooltip cursor={cursorLine} content={<RichTip spec={(items) => {
                  const d = items[0]?.payload as Any | undefined;
                  if (!d) return null;
                  const over = d.crew != null && d.crew > blood.flag_line;
                  return { title: `Blood sample ${d.tp}`, sub: `${modelName}${d.phase ? ` · ${d.phase}` : ''}`, tone: over ? 'bad' : 'ok',
                    rows: [...crew.map((a): [string, ReactNode] => [a, d[a] == null ? '—' : `${Math.round(d[a] * 100)}%`]), ['Crew average', d.crew == null ? '—' : `${Math.round(d.crew * 100)}%`], ['Flag line', `${blood.flag_line * 100}%`]],
                    note: 'The chance that the sample looks like one taken 1 day after landing.' };
                }} />} />
                <Legend verticalAlign="top" wrapperStyle={{ fontSize: 11 }} />
                {crew.map((a, i) => <Line key={a} type="monotone" dataKey={a} stroke={PALETTE[i % PALETTE.length]} strokeWidth={1.6} dot={{ r: 2.5 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} connectNulls />)}
                <Line type="monotone" dataKey="crew" name="Crew average" stroke="#ffffff" strokeWidth={3.2} dot={{ r: 4 }} activeDot={{ r: 7, stroke: C.violet, strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Crew by sample" subtitle="Red = over the flag line, green = under. Hover a cell" icon={<Layers size={18} className="purple-icon" />}>
          <div className="an-bt" style={{ gridTemplateColumns: `72px repeat(${tps.length}, minmax(0,1fr))` }} onMouseLeave={() => setHot(null)}>
            <div />{tps.map((t) => <div className="hd" key={t.tp}>{t.tp}</div>)}
            {blood.astronauts.map((g: Any) => (
              <Fragment key={g.astronaut}>
                <div className="rw">{g.astronaut}</div>
                {tps.map((t) => { const v = val(g, t.tp); return <div key={t.tp} className="cell" style={{ background: v == null ? '#1a2142' : probColor(v), color: v == null ? '#5a6385' : '#0b1020' }} onMouseEnter={() => v != null && setHot({ a: g.astronaut, tp: t.tp, phase: t.phase, v })}>{v == null ? '–' : Math.round(v * 100)}</div>; })}
              </Fragment>
            ))}
          </div>
          <div className="an-cap">{hot ? <><b>{hot.a} · {hot.tp}</b> ({hot.phase ?? '—'}) · {modelName}: <b>{Math.round(hot.v * 100)}%</b> {hot.v > blood.flag_line ? 'looks like 1 day after landing (over the line)' : 'is under the flag line'}</> : 'Numbers are percent. Hover a cell.'}</div>
          <div className="an-wrap" style={{ marginTop: 12 }}>
            <table className="an-tbl">
              <thead><tr><th>Astronaut</th><th>Peak</th><th>Before launch</th><th>Last sample</th></tr></thead>
              <tbody>{blood.summaries.map((s: Any) => (
                <tr key={s.astronaut}><td>{s.astronaut}</td><td className="n" style={{ color: s.peak_over_line ? C.pink : C.green }}>{pc(s.peak)}<small>{s.peak_tp}</small></td><td className="n">{pc(s.pre_mean)}</td><td className="n" style={{ color: s.last_under_line ? C.green : C.pink }}>{pc(s.last)}<small>{s.last_tp}</small></td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      </div>
      {an && (
        <Panel title="Blood values that moved the same way in the whole crew" subtitle={`Change at ${an.first_post.join(' / ')} against each astronaut's own pre-flight average · ${an.crew} crew`} icon={<FlaskConical size={18} className="purple-icon" />}>
          <div className="an-chart" style={{ height: Math.max(240, an.rows.length * 34 + 80) }} onMouseLeave={() => setHotBar(null)}>
            <ResponsiveContainer>
              <BarChart data={anRows} layout="vertical" margin={{ top: 6, right: 22, left: 8, bottom: 16 }}>
                <CartesianGrid stroke={C.grid} horizontal={false} />
                <XAxis type="number" unit="%" {...axis} height={50} label={xl('Change after landing vs own pre-flight average (%)')} />
                <YAxis type="category" dataKey="marker" width={130} {...axis} label={{ value: 'Blood value', angle: -90, position: 'insideLeft', offset: -2, style: { textAnchor: 'middle' }, fill: C.grey, fontSize: 11 }} />
                <ReferenceLine x={0} stroke={C.grey} />
                <Tooltip cursor={cursorBar} content={<RichTip spec={(items) => {
                  const d = items[0]?.payload as Any | undefined;
                  if (!d) return null;
                  return { title: d.marker, sub: `${d.panel}${d.unit ? ` · ${d.unit}` : ''} · ${d.n} astronauts`, tone: Math.abs(d.mean_pct) > 50 ? 'warn' : 'mute',
                    rows: [['Crew average', `${sg(d.mean_pct, 0)}%`], ['Range', `${sg(d.min_pct, 0)}% to ${sg(d.max_pct, 0)}%`], ['Moved', `${d.up} up, ${d.down} down`], ['At last sample', d.last_pct == null ? '—' : `${sg(d.last_pct, 0)}%`], ['Recovered', d.recovered_share == null ? '—' : pc(d.recovered_share)]],
                    note: 'A blood value counts here only if it moved the same way in every astronaut.' };
                }} />} />
                <Bar dataKey="mean_pct" radius={4} onMouseEnter={(_d: unknown, i: number) => setHotBar(i)}>
                  {anRows.map((r: Any, i: number) => <Cell key={r.marker} fill={r.mean_pct >= 0 ? C.pink : C.cyan} fillOpacity={hotBar == null || hotBar === i ? 1 : 0.3} stroke={hotBar === i ? '#fff' : 'none'} strokeWidth={hotBar === i ? 2 : 0} />)}
                  <ErrorBar dataKey="err" direction="x" stroke="#ffffffaa" strokeWidth={1.4} width={5} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="an-wrap" style={{ marginTop: 12 }}>
            <table className="an-tbl">
              <thead><tr><th>Blood value</th><th>Crew change</th><th>Range</th><th>At last sample</th><th>Recovered</th></tr></thead>
              <tbody>{an.rows.map((r: Any) => (
                <tr key={r.marker}><td><b>{r.marker}</b><small>{r.panel} · {r.unit}</small></td><td className="n">{sg(r.mean_pct, 0)}%</td><td className="n">{sg(r.min_pct, 0)} to {sg(r.max_pct, 0)}%</td><td className="n">{r.last_pct == null ? '—' : `${sg(r.last_pct, 0)}%`}</td>
                  <td>{r.recovered_share == null ? '—' : <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><div className="an-meter" style={{ width: 90 }}><i style={{ width: `${r.recovered_share * 100}%`, background: r.recovered_share >= 0.7 ? C.green : C.amber }} /></div><small style={{ margin: 0 }}>{pc(r.recovered_share)}</small></div>}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="an-note">{an.note}</p>
        </Panel>
      )}
    </>
  );
}

/* ==================================================================================================================
   NEW · model scorecard
   ================================================================================================================== */

function ModelScorecard({ models }: { models: Any }) {
  const [hot, setHot] = useState<number | null>(null);
  const rows: Any[] = models.rows.filter((r: Any) => r.auc != null).map((r: Any) => ({ ...r, err: r.auc_ci ? [r.auc - r.auc_ci[0], r.auc_ci[1] - r.auc] : undefined }));
  return (
    <>
      <Section icon={<ShieldAlert size={17} />} title="Model scorecard" sub="How far each saved model can be trusted: sample size, validation, a 95% interval on the AUC where it can be computed, and whether it beats the naive guess." />
      <Readings cards={models.reading} />
      <Panel title="AUC with its uncertainty" subtitle="Bar = AUC, whisker = 95% interval (Hanley and McNeil). With few positive rows the whisker is wide" icon={<BarChart3 size={18} className="purple-icon" />}>
        <div className="an-chart" style={{ height: 320 }} onMouseLeave={() => setHot(null)}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 16 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="short" {...axis} interval={0} height={50} label={xl('Saved model')} />
              <YAxis {...axis} domain={[0, 1]} width={56} label={yl('AUC (0.5 = coin flip)')} />
              <ReferenceLine y={0.5} stroke={C.amber} strokeDasharray="4 4" label={{ value: 'coin flip', fill: C.amber, fontSize: 10, position: 'insideTopRight' }} />
              <Tooltip cursor={cursorBar} content={<RichTip spec={(items) => {
                const d = items[0]?.payload as Any | undefined;
                if (!d) return null;
                return { title: d.model, sub: d.population ?? undefined, tone: d.tone, rows: [['AUC', f1(d.auc, 3)], ['95% interval', d.auc_ci ? `${f1(d.auc_ci[0], 2)} to ${f1(d.auc_ci[1], 2)}` : 'n/a (multi-class or large n)'], ['Rows / positives', `${d.n ?? '—'} / ${d.positives ?? '—'}`],
                  ['Inputs', String(d.features ?? '—')], ['Reads as', d.verdict]], note: d.validation ?? undefined };
              }} />} />
              <Bar dataKey="auc" radius={[4, 4, 0, 0]} onMouseEnter={(_d: unknown, i: number) => setHot(i)}>
                {rows.map((r, i) => <Cell key={r.model} fill={TONE_HEX[r.tone] ?? C.blue} fillOpacity={hot == null || hot === i ? 1 : 0.35} stroke={hot === i ? '#fff' : 'none'} strokeWidth={hot === i ? 2 : 0} />)}
                <ErrorBar dataKey="err" direction="y" stroke="#ffffffcc" strokeWidth={1.6} width={6} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <div className="an-gap" />
      <Panel title="Scorecard" subtitle="Every saved model, side by side" icon={<Layers size={18} className="purple-icon" />}>
        <div className="an-wrap">
          <table className="an-tbl">
            <thead><tr><th>Model</th><th>Reads as</th><th>Rows / positives</th><th>Inputs</th><th>Events per input</th><th>AUC (95%)</th><th>Accuracy vs naive</th><th>Validation</th></tr></thead>
            <tbody>{models.rows.map((r: Any) => (
              <tr key={r.model}>
                <td><b>{r.short}</b><small>{r.predicts ?? ''}</small></td>
                <td><Chip color={TONE_HEX[r.tone] ?? C.blue}>{r.verdict}</Chip></td>
                <td className="n">{r.n ?? 'n/a'}<small>{r.cells?.rows_sub ?? (r.positives != null ? `${r.positives} positive` : '')}</small></td>
                <td className="n">{r.features ?? 'n/a'}</td>
                <td className="n" style={{ color: r.events_per_feature != null && r.events_per_feature < 1 ? C.amber : undefined }}>{r.cells?.events ?? r.events_per_feature ?? 'n/a'}<small>{r.cells?.events_sub ?? ''}</small></td>
                <td className="n">{r.cells?.auc ?? (r.auc != null ? f1(r.auc, 2) : 'Not scored')}<small>{r.cells?.auc_sub ?? (r.auc_ci ? `${f1(r.auc_ci[0], 2)} to ${f1(r.auc_ci[1], 2)}` : '')}</small></td>
                <td className="n">{r.cells?.acc ?? (r.accuracy != null ? pc(r.accuracy) : 'Not scored')}<small>{r.cells?.acc_sub ?? ''}</small></td>
                <td><small style={{ margin: 0 }}>{r.validation ?? 'none (not validated)'}</small></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="an-note">Events per input = positive rows divided by the number of inputs; a common guide is 10 or more. All models here are demo or proof of concept; none changes the Good / Warning / Critical level on its own.</p>
      </Panel>
    </>
  );
}

/* ==================================================================================================================
   the new block
   ================================================================================================================== */

function AnalyticsInsights() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['an-insight', astronautId, days], queryFn: () => getAnalyticsInsight({ astronaut_id: astronautId, days }), enabled: astronautId > 0, retry: 0, staleTime: 60_000 });
  const d = q.data;
  const L = d?.logged;
  return (
    <>
      <style>{AN_CSS}</style>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} className="av-spin" /> Reading the logs, risk history and models…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The deeper analytics could not be loaded. The panels above still work.</p>}
      {d && (
        <>
          {L && (
            <>
              <Section icon={<Activity size={17} />} title="Your logged data" sub="Everything this astronaut has logged in Daily Check-in and the exercise log, in one place. Ranges are published references; trends are straight-line fits with a p-value." />
              <div className="an-seg">{[14, 30, 90].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>Last {n} days</button>)}</div>
              <Readings cards={L.reading} />
              <div className="an-kpis">
                <div><span>Days with data</span><b>{L.coverage.days_with_data}/{L.coverage.span_days}</b><small>{pc(L.coverage.share)} of the window</small></div>
                <div><span>Measures tracked</span><b>{L.metrics.length}</b><small>with 5 or more days</small></div>
                <div><span>Clear trends</span><b>{L.metrics.filter((m: Any) => m.trend.direction !== 'steady').length}</b><small>slope with p under 0.05</small></div>
                <div><span>Often out of range</span><b style={{ color: L.metrics.some((m: Any) => m.reference && m.reference.share_outside >= 0.25) ? C.amber : C.green }}>{L.metrics.filter((m: Any) => m.reference && m.reference.share_outside >= 0.25).length}</b><small>25% or more of days</small></div>
              </div>
              <MetricExplorer metrics={L.metrics} />
              <div className="an-gap" />
              <CoverageStrip cov={L.coverage} />
              <div className="an-gap" />
              <ZOverlay metrics={L.metrics} />
              <div className="an-gap" />
              <Overview metrics={L.metrics} cov={L.coverage} />
              {L.relations && <Relations rel={L.relations} metrics={L.metrics} />}
            </>
          )}
          {d.risk && <RiskSection risk={d.risk} />}
          {d.blood && <BloodCrew blood={d.blood} />}
          {d.models && <ModelScorecard models={d.models} />}
          {!L && !d.risk && (
            <p className="muted" style={{ marginTop: 24 }}><Info size={13} /> No logged data for this astronaut yet. Log a check-in or an exercise session and the trend sections appear here.</p>
          )}
          <p className="an-note">{d.disclaimer}</p>
        </>
      )}
    </>
  );
}

export function AnalyticsPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="LONGITUDINAL ANALYTICS" title="Trends & Analytics" intro="Real trends the backend data supports: blood across mission timepoints, baseline changes, and model quality." />
      <Notice tone="warning"><b>No 7-day or 30-day series.</b><p>The sleep and stress data are 2-day averages per volunteer, so the backend cannot draw daily trends for them. The blood data has real timepoints (before launch and after return), so that is what is plotted.</p></Notice>
      <BloodTimeline />
      <div className="av-gap-top"><ModelQuality /></div>
      <AnalyticsInsights />
      <DataGate>{() => <div className="av-gap-top"><RecToggle domains={['blood', 'hrv', 'general']} title="Recommendations · trends" /></div>}</DataGate>
    </section>
  );
}
