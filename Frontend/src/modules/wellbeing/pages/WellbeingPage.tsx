import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend as ChartLegend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, BookOpen, Brain, CheckCircle2, Compass, FlaskConical, Gauge, Info, Link2, Loader2, Moon, PenLine, PhoneCall, RefreshCw,
  Smile, Sparkles, Target, TrendingDown, TrendingUp, Users, WifiOff, Zap,
} from 'lucide-react';
import { useBootstrapSelection, useSubjects } from '../../../hooks/useAstro';
import { getMoodOptions, getWellbeingInsight, submitWellbeing } from '../../../services/wellbeing.service';
import { getWellbeingAdvice, getWellbeingMindInsight } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { hasSelection, useRunStore } from '../../../store/useRunStore';
import { EvidenceTag, PageHeader, Panel, Stat, type Tone } from '../../../shared/components/live';

/* ==========================================================================================================
   MENTAL WELLBEING  ·  one file, own CSS (prefix "mw-"). Two real data sources, nothing typed in:

   A. Your own check-ins   GET  /wellbeing/{astronaut}/insight   (mood, stress, fatigue, sleep quality, cognitive tests, journal)
   B. Questionnaire cohort POST /ml/wellbeing-insight            (MMASH volunteer scores vs 21 volunteers, mind-body links, model check)

   Recommendations are written by the AI through the backend (POST /ml/wellbeing-recommendations, Gemini first, Groq fallback).
   Every threshold, usual range, concern line and cut-off arrives in the response. A section that has nothing to
   show is left out; it is never drawn empty. What this page leaves to other pages: HRV windows, blood, steps
   (Vitals), predicted-stress flag line and level logic (Overview), dose (Radiation).
   ========================================================================================================== */

const CSS = `
.mw-sec { margin:32px 0 13px; } .mw-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; } .mw-sec h2 svg { color:#c18aff; }
.mw-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:780px; line-height:1.5; }
.mw-grid { display:grid; gap:14px; align-items:stretch; margin-bottom:14px; } .mw-grid > * { min-width:0; }
.mw-g2 { grid-template-columns:1.35fr 1fr; } .mw-g2e { grid-template-columns:1fr 1fr; } .mw-g3 { grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); }
.mw-grid .panel { margin-bottom:0; height:100%; }
.mw-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:13px; margin-bottom:6px; }
.mw-kpis .metric-card { margin:0; }
.mw-mono { font:9px 'DM Mono',monospace; letter-spacing:.8px; color:#8992b1; text-transform:uppercase; }
.mw-chip { display:inline-block; font:9px 'DM Mono',monospace; letter-spacing:.5px; text-transform:uppercase; padding:3px 8px; border-radius:6px; border:1px solid; white-space:nowrap; }
.mw-seg { display:inline-flex; flex-wrap:wrap; border:1px solid #343d62; border-radius:8px; overflow:hidden; margin-bottom:10px; }
.mw-seg button { padding:7px 12px; font-size:10px; border:0; background:#111832; color:#8992b1; font-weight:700; cursor:pointer; }
.mw-seg button.on { background:#3a2a63; color:#f1e6ff; }
.mw-banner { display:flex; gap:11px; align-items:flex-start; border:1px solid; border-radius:11px; padding:13px 15px; font-size:12px; line-height:1.6; margin:0 0 14px; }
.mw-banner b { display:block; font-size:13px; margin-bottom:3px; color:#fff; } .mw-banner svg { flex:0 0 auto; margin-top:2px; }
.mw-banner.ok { background:#123329; border-color:#2f8c70; color:#9ff0d0; } .mw-banner.warn { background:#35291b; border-color:#8c6737; color:#ffd38b; }
.mw-banner.bad { background:#3a1c2a; border-color:#8c3753; color:#ffb4c4; } .mw-banner.mute { background:#171a3a; border-color:#4a3f8a; color:#cbb5ff; }
.mw-read { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:11px; margin-bottom:14px; }
.mw-card { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:13px 14px; font-size:11.5px; line-height:1.6; color:#cfd4ea; display:flex; flex-direction:column; gap:9px; justify-content:space-between; }
.mw-card b { color:#f1f3fb; font-size:12.5px; display:block; margin-bottom:4px; }
.mw-card.ok { border-left-color:#55e6b1; } .mw-card.warn { border-left-color:#ffd37c; } .mw-card.bad { border-left-color:#ff6b8b; } .mw-card.mute { border-left-color:#8c78d6; }
.mw-row { display:grid; grid-template-columns:minmax(130px,.9fr) 2.2fr minmax(120px,.9fr); gap:16px; align-items:center; padding:13px 0; border-top:1px solid #1f2745; }
.mw-row:first-of-type { border-top:0; }
.mw-name { font-size:12px; color:#e8ebf7; font-weight:600; line-height:1.4; } .mw-name small { display:block; font:9px 'DM Mono',monospace; color:#7f89a8; font-weight:400; margin-top:3px; letter-spacing:.3px; }
.mw-val { text-align:right; font:600 17px 'DM Mono',monospace; color:#fff; } .mw-val small { display:block; font:9px 'DM Mono',monospace; color:#8992b1; margin-top:4px; font-weight:400; }
.mw-track { position:relative; height:12px; background:#252c49; border-radius:7px; margin:8px 0 0; }
.mw-track .band { position:absolute; top:0; bottom:0; border-radius:7px; background:#7d58d355; border:1px solid #7d58d3aa; }
.mw-track .zone { position:absolute; top:0; bottom:0; background:#ff6b8b24; }
.mw-track .tick { position:absolute; top:-5px; bottom:-5px; width:2px; background:#fff; opacity:.8; }
.mw-track .ref { position:absolute; top:-6px; bottom:-6px; width:2px; background:#ff6b8b; }
.mw-track .dot { position:absolute; top:50%; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 12px #0008; }
.mw-scale { display:flex; justify-content:space-between; font:8px 'DM Mono',monospace; color:#6f799a; margin-top:7px; }
.mw-cells { display:flex; flex-wrap:wrap; gap:5px; margin:4px 0 12px; }
.mw-cell { width:20px; height:26px; border-radius:5px; border:1px solid #ffffff1a; }
.mw-legend { display:flex; gap:15px; flex-wrap:wrap; font-size:10px; color:#aeb6d0; margin:6px 0 2px; } .mw-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
.mw-kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:12px 0 4px; }
.mw-kv div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; } .mw-kv span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; }
.mw-kv b { display:block; font-size:19px; margin-top:6px; letter-spacing:-.5px; } .mw-kv small { display:block; font-size:9.5px; color:#8d97b4; margin-top:3px; line-height:1.4; }
.mw-bar { display:grid; grid-template-columns:minmax(120px,1fr) 2fr 86px; gap:12px; align-items:center; padding:8px 0; border-top:1px solid #1f2745; font-size:11px; color:#d2d7e9; cursor:default; }
.mw-bar.click { cursor:pointer; } .mw-bar.click:hover { background:#141b3b; } .mw-bar.on { background:#1b1840; }
.mw-div { position:relative; height:10px; background:#252c49; border-radius:6px; } .mw-div i { position:absolute; top:0; bottom:0; border-radius:6px; } .mw-div b { position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:#fff; opacity:.5; }
.mw-bar span.r { font:600 11px 'DM Mono',monospace; text-align:right; }
.mw-ai-meta { font:9px 'DM Mono',monospace; letter-spacing:.8px; text-transform:uppercase; color:#8992b1; margin-top:12px; }
.mw-ai-find { display:flex; gap:10px; padding:8px 0; border-top:1px solid #1f2745; font-size:12px; line-height:1.55; color:#dfe3f3; } .mw-ai-find i { width:6px; height:6px; border-radius:50%; background:#b47bff; margin-top:7px; flex:none; }
.mw-ai-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 14px; padding:10px 13px; background:#171a3a; border:1px solid #3d3470; border-radius:10px; font-size:11px; color:#cbb5ff; }
.mw-note { font-size:10.5px; color:#8992b1; line-height:1.55; margin:12px 0 0; }
.mw-form { display:grid; gap:14px; } .mw-form .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; }
.mw-moods { display:flex; gap:7px; flex-wrap:wrap; } .mw-moods button { background:#111832; border:1px solid #343d62; color:#aeb6d0; border-radius:8px; padding:8px 12px; font-size:11px; cursor:pointer; }
.mw-moods button.on { background:#3a2a63; border-color:#a56bff; color:#fff; }
.mw-form textarea { width:100%; min-height:62px; background:#121a37; color:#d8dcf0; border:1px solid #343d62; border-radius:8px; padding:9px 11px; font-size:11px; font-family:inherit; resize:vertical; }
.mw-form textarea:focus { outline:none; border-color:#a56bff; }
.mw-j { display:flex; gap:12px; padding:12px 0; border-top:1px solid #1f2745; } .mw-j:first-of-type { border-top:0; }
.mw-j p { margin:6px 0 0; font-size:12px; color:#d8dcf0; line-height:1.6; }
.mw-dot { width:9px; height:9px; border-radius:50%; flex:0 0 auto; margin-top:5px; display:inline-block; }
.mw-model { display:grid; gap:18px; } .mw-lane { position:relative; height:46px; margin:24px 0 6px; }
.mw-lane .line { position:absolute; left:0; right:0; top:26px; height:4px; background:#252c49; border-radius:3px; }
.mw-lane .span { position:absolute; top:22px; height:12px; background:#ffd37c33; border:1px solid #ffd37c88; border-radius:6px; }
.mw-lane .pin { position:absolute; top:0; transform:translateX(-50%); text-align:center; font:9px 'DM Mono',monospace; letter-spacing:.4px; color:#cfd4ea; white-space:nowrap; }
.mw-lane .pin i { display:block; width:14px; height:14px; margin:5px auto 0; border-radius:50%; border:2px solid #fff; }
.mw-lane .pin.pred i { border-radius:3px; transform:rotate(45deg); }
.mw-lane .avg { position:absolute; top:18px; width:2px; height:20px; background:#8992b1; }
@media (max-width:1100px) { .mw-g2, .mw-g2e { grid-template-columns:1fr; } }
@media (max-width:760px) { .mw-row { grid-template-columns:1fr; gap:8px; } .mw-val { text-align:left; } .mw-bar { grid-template-columns:1fr 70px; } .mw-bar .mw-div { grid-column:1 / -1; order:3; } }
`;

/* ---------------------------------------------------------------- helpers ---------------------------------------------------------------- */

const C = { cyan: '#58d8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', grey: '#8992b1', grid: '#252d4b', axis: '#8992b1' };
const TIP = { background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 };
const METRIC_COLOR: Record<string, string> = { mood: C.green, stress: C.pink, fatigue: C.amber, sleep_quality: C.cyan };
const LEVEL_COLOR: Record<string, string> = { none: '#245e50', low: '#8c8a45', medium: '#e0b650', high: '#ff6b8b' };
const LEVEL_TEXT: Record<string, string> = { none: 'no concern', low: 'low concern', medium: 'medium concern', high: 'high concern' };
const TONE_HEX: Record<string, string> = { ok: C.green, warn: C.amber, bad: C.pink, mute: '#9a86d8' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const signed = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`);
const dayLabel = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
const pText = (p: number) => (p < 0.001 ? 'p<0.001' : `p ${p.toFixed(3)}`);
const uid = () => globalThis.crypto?.randomUUID?.() ?? `wb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function Section({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="mw-sec"><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div>;
}

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="mw-chip" style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>{children}</span>;
}

function Banner({ tone, title, children, icon }: { tone: 'ok' | 'warn' | 'bad' | 'mute'; title?: string; children: ReactNode; icon?: ReactNode }) {
  return <div className={`mw-banner ${tone}`}>{icon ?? <Info size={17} />}<div>{title && <b>{title}</b>}{children}</div></div>;
}

function Readings({ cards }: { cards: any[] }) {
  if (!cards?.length) return null;
  return (
    <div className="mw-read">
      {cards.map((c, i) => (
        <div className={`mw-card ${c.tone}`} key={`${c.title}-${i}`}>
          <div><b>{c.title}</b>{c.text}</div>
          {c.evidence && <div><EvidenceTag kind={c.evidence} /></div>}
        </div>
      ))}
    </div>
  );
}

const DIR: Record<string, { text: string; color: string }> = {
  improving: { text: 'improving', color: C.green }, worsening: { text: 'worsening', color: C.pink },
  stable: { text: 'steady', color: C.grey }, insufficient_data: { text: 'too few check-ins', color: C.grey },
};

const pastLine = (line: any, v: number) => Boolean(line) && ((line.op === 'ge' && v >= line.value) || (line.op === 'le' && v <= line.value));
const lineText = (line: any) => (line ? `${line.op === 'ge' ? 'at or above' : 'at or below'} ${line.value}` : '');

function metricTone(m: any): Tone {
  if (pastLine(m.high_line, m.latest)) return 'bad';
  if (pastLine(m.concern_line, m.latest)) return 'warn';
  if (m.usual?.latest_is_worse) return 'warn';
  return 'ok';
}

/* ======================================================================================================
   A. YOUR OWN CHECK-INS
   ====================================================================================================== */

/** The one input on this page: a short daily check-in saved through the backend (POST /wellbeing/assessment). */
function LogCheckin({ astronautId, defaultOpen }: { astronautId: number; defaultOpen: boolean }) {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ['wb-mood-options'], queryFn: getMoodOptions, retry: 0, staleTime: Infinity });
  const [open, setOpen] = useState(defaultOpen);
  const [mood, setMood] = useState<string | null>(null);
  const [stress, setStress] = useState(5);
  const [fatigue, setFatigue] = useState(5);
  const [sleep, setSleep] = useState(5);
  const [note, setNote] = useState('');
  const options = opts.data ?? [];
  const moodValue = mood ?? options[Math.floor(options.length / 2)]?.value ?? null;
  const save = useMutation({
    mutationFn: () => submitWellbeing({
      astronaut_id: astronautId, mood_option: moodValue, stress, fatigue, sleep_quality: sleep, notes: note.trim() || undefined, client_uuid: uid(),
    }),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['wb-insight'] });
      qc.invalidateQueries({ queryKey: ['ov-checkin'] });
    },
  });
  return (
    <Panel title="Log today's check-in" subtitle={`Saved to the backend for astronaut #${astronautId}. Every chart below updates from what you log.`} icon={<PenLine size={18} className="purple-icon" />}>
      {!open && <button className="primary-button" onClick={() => setOpen(true)}><PenLine size={15} /> Add a check-in</button>}
      {open && (
        <div className="mw-form">
          <div>
            <div className="mw-mono" style={{ marginBottom: 8 }}>How is your mood?</div>
            <div className="mw-moods" role="group" aria-label="Mood">
              {options.map((o) => <button key={o.value} className={moodValue === o.value ? 'on' : ''} onClick={() => setMood(o.value)}>{o.label}</button>)}
              {!options.length && <span className="muted">{opts.isLoading ? 'Loading mood choices…' : 'Mood choices could not be loaded from the backend.'}</span>}
            </div>
          </div>
          <div className="fields">
            {([['Stress', stress, setStress, 'higher = more stressed'], ['Fatigue', fatigue, setFatigue, 'higher = more drained'], ['Sleep quality', sleep, setSleep, 'higher = slept better']] as const).map(([label, value, setter, hint]) => (
              <label className="range-field" key={label}>
                <span>{label}<b>{value}/10</b></span>
                <input type="range" min={0} max={10} value={value} onChange={(e) => setter(Number(e.target.value))} />
                <small className="muted" style={{ margin: 0, fontSize: 10 }}>{hint}</small>
              </label>
            ))}
          </div>
          <label className="range-field">
            <span>Journal note (optional)</span>
            <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What is on your mind today?" />
          </label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="primary-button" disabled={save.isPending || !moodValue} onClick={() => save.mutate()}>
              {save.isPending ? <Loader2 size={15} className="av-spin" /> : <CheckCircle2 size={15} />} Save check-in
            </button>
            {save.isSuccess && <span className="success-line" style={{ margin: 0 }}><CheckCircle2 size={14} /> Saved. The page below now includes it.</span>}
            {save.isError && <span style={{ color: C.pink, fontSize: 11 }}>{(save.error as Error).message}</span>}
          </div>
          <p className="mw-note" style={{ margin: 0 }}>Notes are stored in the backend database. Access control is not implemented yet, so write nothing you would not want the crew to read.</p>
        </div>
      )}
    </Panel>
  );
}

/** Where the latest check-in sits against the astronaut's own usual range, with the concern line. */
function UsualStrips({ metrics, scale, minForUsual, count }: { metrics: any[]; scale: { min: number; max: number }; minForUsual: number; count: number }) {
  const span = scale.max - scale.min;
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - scale.min) / span) * 100))}%`;
  return (
    <div>
      {metrics.map((m) => {
        const tone = metricTone(m);
        const line = m.concern_line;
        const u = m.usual;
        return (
          <div className="mw-row" key={m.key} style={{ gridTemplateColumns: 'minmax(110px,.8fr) 2.2fr minmax(110px,.8fr)' }}>
            <div className="mw-name">{m.label}<small>{m.higher_is_better ? 'higher is better' : 'lower is better'}</small></div>
            <div>
              <div className="mw-track" aria-label={`${m.label} against your usual range`}>
                {line && <i className="zone" style={line.op === 'ge' ? { left: pos(line.value), right: 0 } : { left: 0, width: pos(line.value) }} />}
                {u && <i className="band" style={{ left: pos(u.low), width: `calc(${pos(u.high)} - ${pos(u.low)})` }} />}
                {line && <i className="ref" style={{ left: pos(line.value) }} title={`concern line ${lineText(line)}`} />}
                <i className="dot" style={{ left: pos(m.latest), background: TONE_HEX[tone] }} title={`latest ${m.latest}`} />
              </div>
              <div className="mw-scale"><span>{scale.min}</span><span>{u ? `your usual ${fmt(u.low)}–${fmt(u.high)}` : `needs ${Math.max(1, minForUsual + 1 - count)} more check-ins for your usual range`}</span><span>{scale.max}</span></div>
            </div>
            <div className="mw-val" style={{ color: TONE_HEX[tone] }}>
              {m.latest}<span style={{ fontSize: 10, color: '#8992b1' }}> /{scale.max}</span>
              <small>{u ? `${signed(u.latest_difference)} vs usual ${fmt(u.mean)}` : `average ${fmt(m.mean)}`}</small>
            </div>
          </div>
        );
      })}
      <div className="mw-legend">
        <span><i style={{ background: '#7d58d355', border: '1px solid #7d58d3aa' }} />your usual range (mean ± one spread of earlier check-ins)</span>
        <span><i style={{ background: C.pink }} />concern line, shaded beyond it</span>
        <span><i style={{ background: '#fff', borderRadius: 8 }} />latest check-in</span>
      </div>
    </div>
  );
}

function DayByDay({ metrics, scale }: { metrics: any[]; scale: { min: number; max: number } }) {
  const [sel, setSel] = useState<string>(metrics.find((m) => m.key === 'mood') ? 'mood' : metrics[0].key);
  const rows = useMemo(() => {
    const map = new Map<string, any>();
    metrics.forEach((m) => m.daily.forEach((p: any) => { const r = map.get(p.date) ?? { date: p.date, label: dayLabel(p.date) }; r[m.key] = p.mean; map.set(p.date, r); }));
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [metrics]);
  const m = metrics.find((x) => x.key === sel);
  const line = m?.concern_line;
  const u = m?.usual;
  const ticks = Array.from({ length: Math.floor((scale.max - scale.min) / 2) + 1 }, (_, i) => scale.min + i * 2);
  return (
    <Panel title="Day by day" subtitle="Daily average of what you logged. Pick one scale to see your usual range and its concern line." icon={<Activity size={18} className="icon-muted" />}>
      <div className="mw-seg" role="tablist">
        {metrics.map((x) => <button key={x.key} role="tab" aria-selected={sel === x.key} className={sel === x.key ? 'on' : ''} onClick={() => setSel(x.key)}>{x.label}</button>)}
        <button role="tab" aria-selected={sel === 'all'} className={sel === 'all' ? 'on' : ''} onClick={() => setSel('all')}>All four</button>
      </div>
      <div style={{ height: 270 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            {m && line && <ReferenceArea y1={line.op === 'ge' ? line.value : scale.min} y2={line.op === 'ge' ? scale.max : line.value} fill={C.pink} fillOpacity={0.07} strokeOpacity={0} />}
            {m && u && <ReferenceArea y1={u.low} y2={u.high} fill={C.violet} fillOpacity={0.2} strokeOpacity={0} />}
            {m && line && <ReferenceLine y={line.value} stroke={C.pink} strokeDasharray="4 3" label={{ value: 'concern line', position: 'insideTopRight', fill: C.pink, fontSize: 9 }} />}
            <XAxis dataKey="label" stroke={C.axis} fontSize={10} interval="preserveStartEnd" minTickGap={18} />
            <YAxis stroke={C.axis} fontSize={10} width={30} domain={[scale.min, scale.max]} ticks={ticks} />
            <Tooltip contentStyle={TIP} />
            {sel === 'all'
              ? metrics.map((x) => <Line key={x.key} type="monotone" name={x.label} dataKey={x.key} stroke={METRIC_COLOR[x.key]} strokeWidth={2} dot={{ r: 2.5 }} connectNulls />)
              : <Line type="monotone" name={m.label} dataKey={m.key} stroke={METRIC_COLOR[m.key]} strokeWidth={2.2} dot={{ r: 4, fill: METRIC_COLOR[m.key], stroke: '#0d1330' }} activeDot={{ r: 6, fill: '#fff' }} connectNulls />}
            {sel === 'all' && <ChartLegend wrapperStyle={{ fontSize: 11 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {m && (
        <p className="mw-note">
          {m.label}: {m.count} check-ins, average {fmt(m.mean)}, lowest {m.min}, highest {m.max}.
          {m.concern_line && ` ${m.days_past_line} of them ${m.days_past_line === 1 ? 'was' : 'were'} past the concern line (${lineText(m.concern_line)}).`}
          {m.half_change != null && ` Second half of the window against the first: ${signed(m.half_change)} (${fmt(m.first_half_mean)} to ${fmt(m.second_half_mean)}).`}
        </p>
      )}
    </Panel>
  );
}

function ConcernPanel({ c }: { c: any }) {
  const worst = c.most_common?.[0];
  return (
    <Panel title="Concern level, day by day" subtitle="Each square is a day, coloured by the highest concern level of its check-ins. The rules are the backend wellbeing rules, not clinical cut-offs." icon={<AlertTriangle size={18} className="icon-muted" />}>
      <div className="mw-cells" role="img" aria-label="Concern level per day">
        {c.strip.map((d: any) => (
          <i key={d.date} className="mw-cell" style={{ background: LEVEL_COLOR[d.level] }}
            title={`${dayLabel(d.date)} · ${LEVEL_TEXT[d.level]}${d.concerns.length ? '\n' + d.concerns.map((x: any) => `${x.message} (${x.value})`).join('\n') : ''}`} />
        ))}
      </div>
      <div className="mw-legend">{Object.keys(LEVEL_COLOR).map((k) => <span key={k}><i style={{ background: LEVEL_COLOR[k] }} />{LEVEL_TEXT[k]}</span>)}</div>
      <div className="mw-kv">
        <div><span>Check-ins at medium or high</span><b>{c.flagged_checkins}<span style={{ display: 'inline', font: 'inherit', color: '#8992b1' }}> / {c.checkins}</span></b><small>{fmt(c.flagged_share * 100, 0)}% of the window</small></div>
        <div><span>In a row right now</span><b style={{ color: c.current_run >= 3 ? C.pink : c.current_run ? C.amber : C.green }}>{c.current_run}</b><small>check-ins at medium or high concern</small></div>
        <div><span>Longest run</span><b>{c.longest_run ? c.longest_run.checkins : 0}</b><small>{c.longest_run ? `${dayLabel(c.longest_run.start)} to ${dayLabel(c.longest_run.end)}` : 'no run in this window'}</small></div>
        <div><span>Since the last concern</span><b>{c.days_since_last_concern == null ? '—' : `${c.days_since_last_concern} d`}</b><small>{c.last_concern_date ? `last on ${dayLabel(c.last_concern_date)}` : 'no concern in this window'}</small></div>
      </div>
      {c.most_common?.length > 0 && (
        <>
          <div className="mw-mono" style={{ margin: '16px 0 4px' }}>What trips the line most</div>
          {c.most_common.map((x: any) => (
            <div className="mw-bar" key={x.message} style={{ gridTemplateColumns: 'minmax(150px,1.2fr) 2fr 70px' }}>
              <span>{x.message}</span>
              <div className="mw-track" style={{ margin: 0 }}><i className="band" style={{ left: 0, width: `${x.share * 100}%`, background: `${METRIC_COLOR[x.metric] ?? C.violet}88`, borderColor: METRIC_COLOR[x.metric] ?? C.violet }} /></div>
              <span className="r">{x.count}/{c.checkins}</span>
            </div>
          ))}
          {worst && <p className="mw-note">{worst.label} crosses its line most often ({fmt(worst.share * 100, 0)}% of check-ins).</p>}
        </>
      )}
    </Panel>
  );
}

function PatternPanel({ p, metrics }: { p: any; metrics: any[] }) {
  return (
    <Panel title="Decline pattern check" subtitle="Isolation and heavy workload rarely hit one scale. They show up as several scales drifting the same way." icon={<Compass size={18} className="icon-muted" />}>
      <Banner tone={p.tone} title={p.title} icon={p.verdict === 'steady' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}>{p.text}</Banner>
      <div className="mw-mono" style={{ margin: '4px 0 2px' }}>First half of the window to the second half</div>
      {metrics.map((m) => {
        const d = DIR[m.direction] ?? DIR.insufficient_data;
        return (
          <div className="mw-bar" key={m.key} style={{ gridTemplateColumns: 'minmax(110px,.9fr) 1.6fr 120px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {m.direction === 'worsening' ? <TrendingDown size={15} color={C.pink} /> : m.direction === 'improving' ? <TrendingUp size={15} color={C.green} /> : <Activity size={15} color={C.grey} />}{m.label}
            </span>
            <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
              {m.half_change == null ? '—' : <>{fmt(m.first_half_mean)} → {fmt(m.second_half_mean)} <span style={{ color: '#8992b1' }}>({signed(m.half_change)})</span></>}
            </span>
            <span style={{ textAlign: 'right' }}><Chip color={d.color}>{d.text}</Chip></span>
          </div>
        );
      })}
      <p className="mw-note">{p.rule}</p>
    </Panel>
  );
}

function LinksPanel({ links }: { links: any }) {
  const nd = links.next_day;
  return (
    <div className="mw-grid mw-g2e">
      <Panel title="How your scales move together" subtitle={`Inside your own history · ${links.days} days with a check-in`} icon={<Link2 size={18} className="icon-muted" />}>
        {links.pairs.map((x: any) => (
          <div className="mw-bar" key={`${x.a}-${x.b}`} style={{ gridTemplateColumns: 'minmax(130px,1fr) 1.6fr 100px' }}>
            <span>{x.a_label} <span style={{ color: '#6f799a' }}>↔</span> {x.b_label}</span>
            <div className="mw-div">
              <b />
              <i style={{ background: x.together ? C.violet : C.cyan, left: x.r >= 0 ? '50%' : `${50 + x.r * 50}%`, width: `${Math.abs(x.r) * 50}%` }} />
            </div>
            <span className="r" title={`${x.strength} · ${pText(x.p)}`}>{signed(x.r, 2)} <span style={{ color: '#6f799a', fontWeight: 400 }}>{x.strength}</span></span>
          </div>
        ))}
        <p className="mw-note">Right of the line = the two rise and fall together; left = one rises as the other falls. {links.note}</p>
      </Panel>
      <Panel title="The day after a poorer night" subtitle={nd ? `Nights rated below ${fmt(nd.threshold)} against better nights · ${nd.n_poorer} and ${nd.n_better} following days` : 'Compares the next day with how you slept'} icon={<Moon size={18} className="icon-muted" />}>
        {nd ? (
          <>
            <div style={{ height: 230 }}>
              <ResponsiveContainer>
                <BarChart data={nd.rows.map((r: any) => ({ name: r.label, poorer: r.after_poorer_night, better: r.after_better_night }))} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="name" stroke={C.axis} fontSize={10} />
                  <YAxis stroke={C.axis} fontSize={10} width={30} domain={[0, 10]} />
                  <Tooltip contentStyle={TIP} />
                  <ChartLegend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="poorer" name="after a poorer night" fill={C.pink} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="better" name="after a better night" fill={C.green} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mw-note">{nd.rows.map((r: any) => `${r.label} ${signed(r.difference)}`).join(' · ')} after a poorer night. A pattern in your own history, not proof of cause.</p>
          </>
        ) : <p className="muted">The next-day comparison appears once there are enough consecutive days on each side.</p>}
      </Panel>
    </div>
  );
}

function CognitivePanel({ cog, needed }: { cog: any; needed: number }) {
  const rows = cog.metrics.filter((m: any) => m.count > 0 || m.baseline_mean != null);
  if (!rows.length) return null;
  return (
    <div className="mw-grid mw-g3">
      {rows.map((m: any) => {
        const color = m.deviates ? C.pink : m.baseline_mean != null ? C.green : C.grey;
        return (
          <Panel key={m.key} title={m.label} subtitle={`${cog.tests_total} test${cog.tests_total === 1 ? '' : 's'} in total`} icon={<Chip color={color}>{m.deviates ? 'off baseline' : m.baseline_mean != null ? 'within baseline' : 'building baseline'}</Chip>}>
            <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: -1 }}>{fmt(m.latest)}<small style={{ font: "10px 'DM Mono',monospace", color: '#8993b2', marginLeft: 5 }}>{m.unit} latest</small></div>
            {m.baseline_mean != null
              ? <p className="mw-note" style={{ marginTop: 6 }}>Baseline {fmt(m.baseline_mean)} → recent {fmt(m.recent_mean)} {m.unit}{m.change_percent != null && <> ({signed(m.change_percent, 0)}%)</>}</p>
              : <p className="mw-note" style={{ marginTop: 6 }}>Your baseline appears after {needed} tests ({Math.max(0, needed - cog.tests_total)} to go).</p>}
            {m.daily.length > 1 && (
              <div style={{ height: 70, marginTop: 8 }}>
                <ResponsiveContainer>
                  <LineChart data={m.daily} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                    <XAxis dataKey="date" hide />
                    <YAxis hide domain={['auto', 'auto']} />
                    {m.baseline_mean != null && <ReferenceLine y={m.baseline_mean} stroke={C.violet} strokeDasharray="3 3" />}
                    <Tooltip contentStyle={TIP} labelFormatter={(l) => dayLabel(String(l))} formatter={(v: any) => [`${fmt(v)} ${m.unit}`, m.label]} />
                    <Line type="monotone" dataKey="mean" stroke={color} strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {m.message && <p className="mw-note">{m.message}</p>}
          </Panel>
        );
      })}
    </div>
  );
}

function JournalPanel({ j }: { j: any }) {
  return (
    <Panel title="Journal" subtitle={`Your latest notes, with that check-in's scores · ${j.total_with_notes} note${j.total_with_notes === 1 ? '' : 's'} in the window`} icon={<BookOpen size={18} className="icon-muted" />}>
      {j.entries.map((e: any) => (
        <div className="mw-j" key={e.date}>
          <i className="mw-dot" style={{ background: LEVEL_COLOR[e.level] }} title={LEVEL_TEXT[e.level]} />
          <div>
            <div className="mw-mono">{dayLabel(e.date)} · mood {e.mood} · stress {e.stress} · fatigue {e.fatigue} · sleep {e.sleep_quality}</div>
            <p>{e.text}</p>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function SelfReportSection({ d }: { d: any }) {
  const metrics: any[] = d.metrics;
  const hasCards = d.reading?.length > 0;
  return (
    <>
      <Section icon={<Smile size={17} />} title="Your own check-ins"
        sub={`${d.checkins} check-in${d.checkins === 1 ? '' : 's'} on ${d.days_with_checkins} day${d.days_with_checkins === 1 ? '' : 's'} · ${dayLabel(d.window.start)} to ${dayLabel(d.window.end)}. Compared with your own normal, not with other people.`} />
      {d.window.days_since_latest >= 2 && (
        <Banner tone="mute" title={`Latest check-in was ${d.window.days_since_latest} days ago`}>The window ends at that check-in, so older entries still count. Log a new one to bring it up to date.</Banner>
      )}
      {hasCards && <Readings cards={d.reading} />}
      <div className="mw-grid mw-g2">
        <DayByDay metrics={metrics} scale={d.scale} />
        <Panel title="Latest against your usual" subtitle="Dot = latest check-in. Violet band = your usual range. Red line = where the wellbeing rules raise a concern." icon={<Gauge size={18} className="icon-muted" />}>
          <UsualStrips metrics={metrics} scale={d.scale} minForUsual={d.rules.min_for_usual} count={d.checkins} />
        </Panel>
      </div>
      <div className="mw-grid mw-g2">
        <ConcernPanel c={d.concerns} />
        {d.pattern ? <PatternPanel p={d.pattern} metrics={metrics} /> : <div />}
      </div>
      {d.links && <LinksPanel links={d.links} />}
      {d.cognitive && (
        <>
          <Section icon={<Brain size={17} />} title="Thinking speed and focus" sub={`Cognitive tests against your own baseline. ${d.cognitive.baseline_rule}`} />
          <CognitivePanel cog={d.cognitive} needed={d.rules.cognitive_tests_needed} />
        </>
      )}
      {d.journal && <JournalPanel j={d.journal} />}
    </>
  );
}

/* ======================================================================================================
   B. QUESTIONNAIRES AGAINST THE VOLUNTEER COHORT
   ====================================================================================================== */

function verdictColor(v: any): string {
  if (!v.verdict || v.higher_is_better == null) return C.grey;
  if (v.verdict === 'typical') return C.grey;
  return (v.verdict === 'higher') !== v.higher_is_better ? C.amber : C.green;
}

function CohortStrips({ vars, n }: { vars: any[]; n: number }) {
  return (
    <div>
      {vars.map((v) => {
        const refV = v.reference?.value;
        const lo = Math.min(v.min, refV ?? v.min);
        const hi = Math.max(v.max, refV ?? v.max);
        const pos = (x: number) => `${hi === lo ? 50 : Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
        const color = v.past_reference ? C.amber : verdictColor(v);
        return (
          <div className="mw-row" key={v.key}>
            <div className="mw-name">{v.label}<small>{v.note}</small></div>
            <div>
              <div className="mw-track" aria-label={`${v.label} against the volunteers`}>
                <i className="band" style={{ left: pos(v.q25), width: `calc(${pos(v.q75)} - ${pos(v.q25)})` }} />
                <i className="tick" style={{ left: pos(v.middle) }} title={`cohort middle ${fmt(v.middle)}`} />
                {refV != null && <i className="ref" style={{ left: pos(refV) }} title={v.reference.text} />}
                <i className="dot" style={{ left: pos(v.value), background: color }} title={`${fmt(v.value)}`} />
              </div>
              <div className="mw-scale"><span>{fmt(v.min)}</span><span>middle {fmt(v.middle)}{v.reference ? ` · red line: ${v.reference.text}` : ''}</span><span>{fmt(v.max)}</span></div>
            </div>
            <div className="mw-val" style={{ color }}>
              {fmt(v.value)}
              <small>{v.verdict ? <Chip color={color}>{v.verdict === 'typical' ? 'typical' : `${v.verdict} than most`}</Chip> : null}<br />{v.rank_from_top} of {n} from the top</small>
            </div>
          </div>
        );
      })}
      <div className="mw-legend">
        <span><i style={{ background: '#7d58d355', border: '1px solid #7d58d3aa' }} />middle half of the volunteers</span>
        <span><i style={{ background: '#fff' }} />cohort middle</span>
        <span><i style={{ background: C.pink }} />reference line (screening convention)</span>
      </div>
    </div>
  );
}

function MindMap({ mind }: { mind: any }) {
  const vars: any[] = mind.variables;
  const pairs: any[] = mind.pairs;
  const byKey = useMemo(() => Object.fromEntries(vars.map((v) => [v.key, v])), [vars]);
  const pairOf = (a: string, b: string) => pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  const firstMind = vars.find((v) => v.group === 'mind')?.key ?? vars[0].key;
  const [yKey, setY] = useState<string>(byKey.Daily_stress ? 'Daily_stress' : firstMind);
  const partners = (y: string) => pairs.filter((p) => p.a === y || p.b === y).map((p) => ({ ...p, other: p.a === y ? p.b : p.a })).filter((p) => byKey[p.other]).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const [xKey, setX] = useState<string>(() => partners(byKey.Daily_stress ? 'Daily_stress' : firstMind)[0]?.other ?? vars.find((v) => v.key !== firstMind)?.key ?? firstMind);
  const x = byKey[xKey]; const y = byKey[yKey];
  const pair = pairOf(xKey, yKey);
  const points = mind.cohort.map((c: any) => ({ x: c.values[xKey], y: c.values[yKey], participant: c.participant, selected: c.selected })).filter((p: any) => p.x != null && p.y != null);
  const others = points.filter((p: any) => !p.selected);
  const mine = points.filter((p: any) => p.selected);
  const list = partners(yKey).slice(0, 9);
  const unit = (v: any) => (v.unit ? ` (${v.unit})` : '');
  const optGroups: [string, string][] = [['mind', 'Questionnaires'], ['sleep', 'Sleep'], ['body', 'Activity and heart']];
  const select = (value: string, set: (v: string) => void, label: string) => (
    <select className="select-control" style={{ width: '100%' }} value={value} aria-label={label} onChange={(e) => set(e.target.value)}>
      {optGroups.map(([g, name]) => vars.some((v) => v.group === g) && (
        <optgroup key={g} label={name}>{vars.filter((v) => v.group === g).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</optgroup>
      ))}
    </select>
  );
  const dot = (color: string, r: number) => (p: any) => (p.cx == null ? <g /> : <circle cx={p.cx} cy={p.cy} r={r} fill={color} stroke="#fff" strokeWidth={r > 6 ? 2 : 0.8} fillOpacity={r > 6 ? 1 : 0.75} />);
  return (
    <div className="mw-grid mw-g2">
      <Panel title="Mind–body map" subtitle={`Every volunteer is a dot; ${mind.participant} is the pink one. Pick any two measures.`} icon={<Target size={18} className="icon-muted" />}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
          <div><div className="mw-mono" style={{ marginBottom: 5 }}>Across (x)</div>{select(xKey, setX, 'x axis')}</div>
          <div><div className="mw-mono" style={{ marginBottom: 5 }}>Up (y)</div>{select(yKey, setY, 'y axis')}</div>
        </div>
        <div style={{ height: 300 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 10, right: 16, left: 4, bottom: 18 }}>
              <CartesianGrid stroke={C.grid} />
              <XAxis type="number" dataKey="x" name={x.label} stroke={C.axis} fontSize={10} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 0)} label={{ value: `${x.label}${unit(x)}`, position: 'insideBottom', offset: -10, fill: C.axis, fontSize: 10 }} />
              <YAxis type="number" dataKey="y" name={y.label} stroke={C.axis} fontSize={10} width={46} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 0)} />
              <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={TIP}
                content={({ active, payload }: any) => {
                  const p = active && payload?.[0]?.payload;
                  if (!p) return null;
                  return <div style={{ ...TIP, padding: '9px 11px', color: '#e8ebf7' }}><b>{p.participant}</b>{p.selected ? ' · selected' : ''}<br />{x.label}: {fmt(p.x, 2)} {x.unit}<br />{y.label}: {fmt(p.y, 2)} {y.unit}</div>;
                }} />
              <Scatter data={others} shape={dot(C.violet, 5)} isAnimationActive={false} />
              <Scatter data={mine} shape={dot(C.pink, 9)} isAnimationActive={false} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="mw-note">
          {xKey === yKey ? 'Pick two different measures to compare.'
            : pair ? <>Spearman <b style={{ color: '#fff' }}>{signed(pair.r, 2)}</b> · {pText(pair.p)} · {pair.n} volunteers · <b style={{ color: '#fff' }}>{pair.strength}</b>{pair.p < mind.link_rule.alpha && Math.abs(pair.r) >= mind.link_rule.meaningful_r ? ' · worth reading' : ' · not strong enough to read anything into'}.</>
              : 'Too few volunteers have both values for a correlation.'}
        </p>
      </Panel>
      <Panel title={`What goes with ${y.label.toLowerCase()}`} subtitle="Strongest links first. Click a row to put it on the map." icon={<Link2 size={18} className="icon-muted" />}>
        {list.map((p: any) => {
          const meaningful = p.p < mind.link_rule.alpha && Math.abs(p.r) >= mind.link_rule.meaningful_r;
          return (
            <div key={p.other} className={`mw-bar click ${p.other === xKey ? 'on' : ''}`} onClick={() => setX(p.other)} style={{ gridTemplateColumns: 'minmax(130px,1fr) 1.5fr 92px' }}>
              <span>{byKey[p.other].label}</span>
              <div className="mw-div"><b /><i style={{ background: meaningful ? (p.r > 0 ? C.violet : C.cyan) : '#3b4672', left: p.r >= 0 ? '50%' : `${50 + p.r * 50}%`, width: `${Math.abs(p.r) * 50}%` }} /></div>
              <span className="r" title={`${p.strength} · ${pText(p.p)} · ${p.n} volunteers`}>{signed(p.r, 2)}{meaningful && <span style={{ color: C.green }}> ✓</span>}</span>
            </div>
          );
        })}
        <p className="mw-note">✓ = {mind.link_rule.text}</p>
      </Panel>
    </div>
  );
}

function ModelCheck({ mc }: { mc: any }) {
  const s = mc.stress; const sl = mc.sleep;
  const top = s ? Math.ceil(Math.max(s.reported, s.predicted + (s.typical_miss ?? 0), (s.cohort_average ?? 0) + (s.cohort_spread ?? 0) * 2.5) / 10) * 10 : 100;
  const at = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  return (
    <Panel title="Model against what was reported" subtitle={`The saved stress and sleep models, set next to this volunteer's own questionnaire answers · ${mc.population ?? 'MMASH volunteers'}`} icon={<FlaskConical size={18} className="icon-muted" />}>
      <div className="mw-model">
        {s && (
          <div>
            <div className="mw-mono">Daily stress · reported {fmt(s.reported)} · model said {fmt(s.predicted, 0)}</div>
            <div className="mw-lane" role="img" aria-label="Reported against predicted daily stress">
              <i className="line" />
              {s.typical_miss != null && <i className="span" style={{ left: at(Math.max(0, s.predicted - s.typical_miss)), width: `calc(${at(s.predicted + s.typical_miss)} - ${at(Math.max(0, s.predicted - s.typical_miss))})` }} title={`typical miss ±${s.typical_miss}`} />}
              {s.cohort_average != null && <i className="avg" style={{ left: at(s.cohort_average) }} title={`cohort average ${s.cohort_average}`} />}
              <span className="pin pred" style={{ left: at(s.predicted) }}>model<i style={{ background: C.amber }} /></span>
              <span className="pin" style={{ left: at(s.reported), top: 30 }}><i style={{ background: C.pink, margin: '0 auto 5px' }} />reported</span>
            </div>
            <div className="mw-scale"><span>0</span><span>shaded = the model's typical miss (±{fmt(s.typical_miss)}) · grey tick = cohort average {fmt(s.cohort_average)}</span><span>{top}</span></div>
            <p className="mw-note">
              The model is {Math.abs(s.miss) <= (s.typical_miss ?? Infinity) ? 'inside' : 'outside'} its usual miss here ({signed(-s.miss, 1)} from the reported score). Guessing the cohort average would have missed by {fmt(s.miss_if_guessing_average)}.
              {s.r2 != null && ` Its leave-one-out R² is ${fmt(s.r2, 2)}${s.r2 <= 0 ? ', so it does no better than the average' : ''}.`}
            </p>
          </div>
        )}
        {sl && (
          <Banner tone={sl.agrees ? 'mute' : 'warn'} title={`Sleep: reported PSQI ${fmt(sl.reported_psqi, 0)} (${sl.reported_poor ? 'poor sleeper' : 'not a poor sleeper'}) · model gave ${fmt(sl.predicted_poor_probability * 100, 0)}% chance of poor sleep`}
            icon={sl.agrees ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}>
            {sl.agrees ? 'The model and the questionnaire agree for this volunteer, ' : 'The model and the questionnaire disagree for this volunteer, '}
            but its ROC AUC is {fmt(sl.roc_auc, 2)} (0.50 = a coin flip), so a match or a miss tells you little either way.
          </Banner>
        )}
        <p className="mw-note" style={{ margin: 0 }}>{mc.note}</p>
      </div>
    </Panel>
  );
}

function MindSection({ mind, headline }: { mind: any; headline: boolean }) {
  const vars: any[] = mind.variables;
  const judged = vars.filter((v) => v.group === 'mind');
  const n = mind.cohort_size;
  return (
    <>
      <Section icon={<Users size={17} />} title="Questionnaire profile"
        sub={`${mind.participant} against ${n} MMASH volunteers. ${mind.population_note} Use it to see how a score compares and what travels with it, not to judge the person.`} />
      {headline && <Readings cards={mind.reading} />}
      {!headline && <Readings cards={mind.reading} />}
      <Panel title="Scores against the volunteers" subtitle="Dot = this volunteer. Violet band = the middle half of the cohort. White tick = cohort middle." icon={<Gauge size={18} className="icon-muted" />}>
        <CohortStrips vars={judged} n={n} />
      </Panel>
      <div style={{ height: 14 }} />
      <MindMap mind={mind} />
      {mind.model_check && <ModelCheck mc={mind.model_check} />}
    </>
  );
}

/* ======================================================================================================
   PAGE
   ====================================================================================================== */

function Kpis({ self, mind }: { self: any | null; mind: any | null }) {
  if (self) {
    const by = Object.fromEntries(self.metrics.map((m: any) => [m.key, m]));
    const icon: Record<string, ReactNode> = { mood: <Smile size={18} />, stress: <Brain size={18} />, fatigue: <Zap size={18} />, sleep_quality: <Moon size={18} /> };
    const p = self.pattern;
    return (
      <div className="mw-kpis">
        {['mood', 'stress', 'fatigue', 'sleep_quality'].filter((k) => by[k]).map((k) => {
          const m = by[k]; const u = m.usual;
          return (
            <Stat key={k} icon={icon[k]} label={m.label.toUpperCase()} value={m.latest} unit={`/${self.scale.max}`} tone={metricTone(m)}
              sub={u ? `${signed(u.latest_difference)} vs your usual ${fmt(u.mean)} · ${(DIR[m.direction] ?? DIR.insufficient_data).text}` : `${m.count} check-in${m.count === 1 ? '' : 's'} · average ${fmt(m.mean)}`} />
          );
        })}
        {p && <Stat icon={<Compass size={18} />} label="DECLINE PATTERN" value={p.verdict === 'raise' ? 'Raise it' : p.verdict === 'watch' ? 'Watch' : 'Steady'} tone={p.tone}
          sub={`${p.worsening.length} of ${p.indicators_compared} scales worsening · ${self.concerns.current_run} in a row at concern`} tag="proxy" />}
      </div>
    );
  }
  if (!mind) return null;
  const keys = ['Daily_stress', 'STAI1', 'affect_balance', 'Pittsburgh'];
  const vs = keys.map((k) => mind.variables.find((v: any) => v.key === k)).filter(Boolean);
  const icon: Record<string, ReactNode> = { Daily_stress: <Brain size={18} />, STAI1: <Zap size={18} />, affect_balance: <Smile size={18} />, Pittsburgh: <Moon size={18} /> };
  return (
    <div className="mw-kpis">
      {vs.map((v: any) => {
        const worse = v.past_reference || ((v.verdict === 'higher' || v.verdict === 'lower') && (v.verdict === 'higher') !== v.higher_is_better);
        return <Stat key={v.key} icon={icon[v.key]} label={v.label.toUpperCase()} value={fmt(v.value)} tag="proxy" tone={worse ? 'warn' : 'ok'}
          sub={v.higher_than != null ? `above ${Math.round(v.higher_than * 100)}% of the other ${v.n - 1} volunteers` : ''} />;
      })}
    </div>
  );
}

/** Recommendations written by the AI through the backend. Nothing advisory is typed in on this page. */
function AiBriefing({ astronautId, selection, language }: { astronautId: number; selection: any; language: any }) {
  const req = useMemo(() => ({ astronaut_id: astronautId, scenario_id: selection?.scenario_id ?? null, subject_id: selection?.subject_id ?? null, mmash_user: selection?.mmash_user ?? null, days: 30, language }), [astronautId, selection, language]);
  const ai = useQuery({ queryKey: ['wb-ai', req], queryFn: () => getWellbeingAdvice(req), retry: 0, staleTime: 60 * 60_000 });
  const result = ai.data?.ai?.result ?? null;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  return (
    <Panel title="Recommendations" subtitle={ai.data?.ai?.model ? `${ai.data.ai.source} \u00b7 ${ai.data.ai.model}${ai.data.ai.cached ? ' \u00b7 cached' : ''}` : 'Written by the AI from your check-ins and the questionnaire profile above'} icon={<Sparkles size={18} className="purple-icon" />}>
      <div className="mw-ai-bar">
        <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>
          {ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again
        </button>
        <span>The AI never changes a concern level. Log a new check-in, then ask again to get advice for it.</span>
      </div>
      {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for mental wellbeing recommendations…</p>}
      {problem && !ai.isFetching && <p className="av-rec-note warn">AI recommendations are not available right now ({problem}). Tap “Ask the AI again” in a moment.</p>}
      {result && (
        <>
          {result.summary && <p className="av-summary">{result.summary}</p>}
          {result.contact_medical_officer && (
            <div className="av-callout"><PhoneCall size={17} /><div><b>Contact the mission medical officer.</b>{result.contact_reason && <p>{result.contact_reason}</p>}</div></div>
          )}
          {(result.recommendations ?? []).map((r, i) => (
            <div className="av-rec-item" key={`${r.action}-${i}`}>
              <p>{r.action}</p>
              <div className="av-rec-meta"><span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span>{r.evidence && <EvidenceTag kind={r.evidence} />}</div>
            </div>
          ))}
          {(result.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
          {(result.key_findings ?? []).map((f) => <div className="mw-ai-find" key={f}><i /><span>{f}</span></div>)}
          {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">Could not be checked</div>}
          {(result.data_gaps ?? []).map((g) => <div className="mw-ai-find" key={g}><i style={{ background: C.grey }} /><span>{g}</span></div>)}
          <div className="mw-ai-meta">{result.disclaimer ?? ai.data?.disclaimer}</div>
        </>
      )}
    </Panel>
  );
}

function Body() {
  useBootstrapSelection();
  const subjects = useSubjects();
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const selfQ = useQuery({ queryKey: ['wb-insight', astronautId], queryFn: () => getWellbeingInsight(astronautId, 30), retry: 0, staleTime: 60_000 });
  const mindQ = useQuery({ queryKey: ['wb-mind', selection], queryFn: () => getWellbeingMindInsight(selection), enabled: hasSelection(selection), retry: 0, staleTime: 5 * 60_000 });

  const self = selfQ.data?.available ? selfQ.data : null;
  const mind = mindQ.data?.mind?.available ? mindQ.data.mind : null;
  const astronautExists = !selfQ.isError;
  const loading = (selfQ.isLoading || mindQ.isLoading || subjects.isLoading) && !self && !mind;

  if (subjects.isError && selfQ.isError) {
    return (
      <div className="panel av-state">
        <WifiOff size={26} /><h3>Cannot reach the backend</h3>
        <p>{(subjects.error as Error).message}</p>
        <p className="muted">Start the backend (uvicorn on port 8000) and make sure Vite's /api proxy points to it. Then refresh this page.</p>
        <button className="primary-button" onClick={() => { subjects.refetch(); selfQ.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (loading) return <div className="panel av-state"><Loader2 className="av-spin" size={26} /><h3>Reading your check-ins and the questionnaire data…</h3></div>;

  const intro = !self && !mind;
  return (
    <>
      {(self || mind) && <Kpis self={self} mind={mind} />}

      {astronautExists && selfQ.data && (
        <div style={{ marginTop: self || mind ? 20 : 0 }}>
          <LogCheckin astronautId={astronautId} defaultOpen={!self} />
        </div>
      )}

      {intro && (
        <div className="panel av-state" style={{ marginTop: 16 }}>
          <Info size={26} />
          <h3>Nothing to analyse yet</h3>
          {!astronautExists && <p>Astronaut #{astronautId} was not found in the backend database, so check-ins cannot be saved or read. Create the astronaut first (POST /api/v1/astronauts).</p>}
          {astronautExists && <p>Log a first check-in above and this page fills in with your trends.</p>}
          {!hasSelection(selection) && <p>No questionnaire volunteer is selected either. Choose data sources in Daily Check-in to compare questionnaire scores with the 21 volunteers.</p>}
          {hasSelection(selection) && mindQ.isError && <p>{(mindQ.error as Error).message}</p>}
          <Link to="/checkin" className="primary-button">Open Daily Check-in</Link>
        </div>
      )}

      {self && <SelfReportSection d={self} />}
      {mind && <MindSection mind={mind} headline={!self} />}

      {(self || mind) && (
        <>
          <Section icon={<Sparkles size={17} />} title="AI wellbeing briefing" sub="Written by the AI from your data through the backend. No advice on this page is typed in; if the AI cannot answer, nothing is shown in its place." />
          <AiBriefing astronautId={astronautId} selection={selection} language={language} />
          <div className="notice-panel" style={{ marginTop: 16 }}>
            <Info size={18} />
            <div>
              <b>What this page can and cannot see</b>
              <p>
                Isolation, confinement, crew conflict and time since home contact are not measured. The decline pattern is inferred from how several self-reports and cognitive tests move together.
                {mind ? ' Questionnaire comparisons use Earth volunteers, not astronauts.' : ''} {self?.disclaimer ?? mindQ.data?.disclaimer ?? ''}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function WellbeingPage() {
  return (
    <section className="page-enter mw">
      <style>{CSS}</style>
      <PageHeader eyebrow="MENTAL WELLBEING" title="Mental Wellbeing"
        intro="Mood, stress and fatigue against your own normal, how they move together, and how questionnaire scores compare with 21 volunteers. Weak models are labelled as weak; nothing here is a diagnosis." />
      <Body />
    </section>
  );
}
