import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, AlertTriangle, BedDouble, CheckCircle2, Clock, Cpu, FlaskConical, Gauge, HeartPulse, Info, Layers, Loader2, Moon, MoonStar,
  PenLine, PhoneCall, RefreshCw, Repeat, Scale, Sparkles, Split, Timer, TrendingDown, WifiOff, Zap,
} from 'lucide-react';
import { useBootstrapSelection, useSubjects } from '../../../hooks/useAstro';
import { createObservation } from '../../../services/observations.service';
import { getSleepAdvice, getSleepInsight } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { hasSelection, useRunStore } from '../../../store/useRunStore';
import { EvidenceTag, PageHeader, Panel, Stat, type Tone } from '../../../shared/components/live';

/* ==========================================================================================================
   SLEEP TRACKER  ·  one file, own CSS (prefix "sl-"). Two real data sources, nothing typed in:

   A. Your logged nights   POST /ml/sleep-insight → log   (Daily Check-in: hours per night, quality rating, vitals, cognitive tests)
   B. Measured night       POST /ml/sleep-insight → lab   (one MMASH volunteer's measured night against 21 volunteers)

   Every guideline, band, threshold, cut-off and usual range arrives in the response. A section with nothing to show is
   left out; it is never drawn empty. Recommendations are written by the AI through the backend
   (POST /ml/sleep-recommendations, Gemini first, Groq fallback). What this page leaves to other pages: HRV windows and
   heart-rate trends (Vitals), the poor-sleep flag line and 7-day change (Overview), mood / stress / fatigue and the
   sleep-quality rating on its own (Mental Wellbeing).
   ========================================================================================================== */

const CSS = `
.sl-sec { margin:32px 0 13px; } .sl-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; } .sl-sec h2 svg { color:#7aa8ff; }
.sl-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:800px; line-height:1.5; }
.sl-grid { display:grid; gap:14px; align-items:stretch; margin-bottom:14px; } .sl-grid > * { min-width:0; }
.sl-g2 { grid-template-columns:1.4fr 1fr; } .sl-g2e { grid-template-columns:1fr 1fr; }
.sl-grid .panel { margin-bottom:0; height:100%; }
.sl-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:13px; margin-bottom:6px; } .sl-kpis .metric-card { margin:0; }
.sl-mono { font:9px 'DM Mono',monospace; letter-spacing:.8px; color:#8992b1; text-transform:uppercase; }
.sl-chip { display:inline-block; font:9px 'DM Mono',monospace; letter-spacing:.5px; text-transform:uppercase; padding:3px 8px; border-radius:6px; border:1px solid; white-space:nowrap; }
.sl-seg { display:inline-flex; flex-wrap:wrap; border:1px solid #343d62; border-radius:8px; overflow:hidden; margin-bottom:10px; }
.sl-seg button { padding:7px 12px; font-size:10px; border:0; background:#111832; color:#8992b1; font-weight:700; cursor:pointer; } .sl-seg button.on { background:#22346b; color:#e4eeff; }
.sl-banner { display:flex; gap:11px; align-items:flex-start; border:1px solid; border-radius:11px; padding:13px 15px; font-size:12px; line-height:1.6; margin:0 0 14px; }
.sl-banner b { display:block; font-size:13px; margin-bottom:3px; color:#fff; } .sl-banner svg { flex:0 0 auto; margin-top:2px; }
.sl-banner.ok { background:#123329; border-color:#2f8c70; color:#9ff0d0; } .sl-banner.warn { background:#35291b; border-color:#8c6737; color:#ffd38b; }
.sl-banner.bad { background:#3a1c2a; border-color:#8c3753; color:#ffb4c4; } .sl-banner.mute { background:#171a3a; border-color:#4a3f8a; color:#cbb5ff; }
.sl-read { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:11px; margin-bottom:14px; }
.sl-card { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:13px 14px; font-size:11.5px; line-height:1.6; color:#cfd4ea; display:flex; flex-direction:column; gap:9px; justify-content:space-between; }
.sl-card b { color:#f1f3fb; font-size:12.5px; display:block; margin-bottom:4px; }
.sl-card.ok { border-left-color:#55e6b1; } .sl-card.warn { border-left-color:#ffd37c; } .sl-card.bad { border-left-color:#ff6b8b; } .sl-card.mute { border-left-color:#7aa8ff; }
.sl-row { display:grid; grid-template-columns:minmax(130px,.9fr) 2.2fr minmax(120px,.9fr); gap:16px; align-items:center; padding:13px 0; border-top:1px solid #1f2745; } .sl-row:first-of-type { border-top:0; }
.sl-name { font-size:12px; color:#e8ebf7; font-weight:600; line-height:1.4; } .sl-name small { display:block; font:9px 'DM Mono',monospace; color:#7f89a8; font-weight:400; margin-top:3px; letter-spacing:.3px; }
.sl-val { text-align:right; font:600 17px 'DM Mono',monospace; color:#fff; } .sl-val small { display:block; font:9px 'DM Mono',monospace; color:#8992b1; margin-top:4px; font-weight:400; }
.sl-track { position:relative; height:12px; background:#252c49; border-radius:7px; margin:8px 0 0; }
.sl-track .band { position:absolute; top:0; bottom:0; border-radius:7px; background:#4f7de355; border:1px solid #4f7de3aa; }
.sl-track .tick { position:absolute; top:-5px; bottom:-5px; width:2px; background:#fff; opacity:.8; } .sl-track .ref { position:absolute; top:-6px; bottom:-6px; width:2px; background:#ff6b8b; }
.sl-track .dot { position:absolute; top:50%; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 12px #0008; }
.sl-scale { display:flex; justify-content:space-between; gap:8px; font:8px 'DM Mono',monospace; color:#6f799a; margin-top:7px; }
.sl-legend { display:flex; gap:15px; flex-wrap:wrap; font-size:10px; color:#aeb6d0; margin:6px 0 2px; } .sl-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
.sl-kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:12px 0 4px; }
.sl-kv div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; } .sl-kv span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; }
.sl-kv b { display:block; font-size:19px; margin-top:6px; letter-spacing:-.5px; } .sl-kv small { display:block; font-size:9.5px; color:#8d97b4; margin-top:3px; line-height:1.4; }
.sl-bar { display:grid; grid-template-columns:minmax(120px,1fr) 2fr 92px; gap:12px; align-items:center; padding:8px 0; border-top:1px solid #1f2745; font-size:11px; color:#d2d7e9; }
.sl-bar:first-of-type { border-top:0; } .sl-bar span.r { font:600 11px 'DM Mono',monospace; text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:5px; }
.sl-div { position:relative; height:10px; background:#252c49; border-radius:6px; } .sl-div i { position:absolute; top:0; bottom:0; border-radius:6px; } .sl-div b { position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:#fff; opacity:.5; }
.sl-stack { display:flex; height:22px; border-radius:7px; overflow:hidden; border:1px solid #ffffff1a; margin:6px 0 10px; } .sl-stack i { display:block; height:100%; }
.sl-note { font-size:10.5px; color:#8992b1; line-height:1.55; margin:12px 0 0; }
.sl-form { display:grid; gap:14px; } .sl-form .fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:16px; align-items:end; }
.sl-form input[type=number], .sl-form input[type=date] { width:100%; background:#121a37; color:#e8ebf7; border:1px solid #343d62; border-radius:8px; padding:9px 11px; font-size:12px; font-family:inherit; }
.sl-form input:focus { outline:none; border-color:#7aa8ff; } .sl-form label > span { display:block; font:9px 'DM Mono',monospace; letter-spacing:.8px; color:#8992b1; text-transform:uppercase; margin-bottom:6px; }
.sl-ck { display:grid; grid-template-columns:22px 1fr; gap:10px; padding:11px 0; border-top:1px solid #1f2745; font-size:12px; line-height:1.5; color:#dfe3f3; } .sl-ck:first-of-type { border-top:0; }
.sl-ck small { display:block; font:9px 'DM Mono',monospace; color:#8992b1; margin-top:2px; letter-spacing:.3px; }
.sl-flags { display:flex; flex-wrap:wrap; gap:9px; margin:4px 0 12px; }
.sl-flag { background:#35291b; border:1px solid #8c6737; border-radius:10px; padding:9px 12px; font-size:11px; color:#ffd38b; line-height:1.45; max-width:300px; } .sl-flag b { display:block; color:#fff; font-size:12px; margin-bottom:2px; }
.sl-ai-meta { font:9px 'DM Mono',monospace; letter-spacing:.8px; text-transform:uppercase; color:#8992b1; margin-top:12px; }
.sl-ai-find { display:flex; gap:10px; padding:8px 0; border-top:1px solid #1f2745; font-size:12px; line-height:1.55; color:#dfe3f3; } .sl-ai-find i { width:6px; height:6px; border-radius:50%; background:#7aa8ff; margin-top:7px; flex:none; }
.sl-ai-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 14px; padding:10px 13px; background:#171a3a; border:1px solid #3d3470; border-radius:10px; font-size:11px; color:#cbb5ff; }
.sl-gauge { position:relative; height:14px; background:#252c49; border-radius:8px; margin:12px 0 6px; } .sl-gauge i { position:absolute; top:0; bottom:0; left:0; border-radius:8px; } .sl-gauge b { position:absolute; top:-6px; bottom:-6px; width:2px; background:#fff; } .sl-gauge u { position:absolute; top:-6px; bottom:-6px; width:2px; background:#ffd37c; text-decoration:none; }
@media (max-width:1100px) { .sl-g2, .sl-g2e { grid-template-columns:1fr; } }
@media (max-width:760px) { .sl-row { grid-template-columns:1fr; gap:8px; } .sl-val { text-align:left; } .sl-bar { grid-template-columns:1fr 80px; } .sl-bar .sl-div { grid-column:1 / -1; order:3; } }
`;

/* ---------------------------------------------------------------- helpers ---------------------------------------------------------------- */

const C = { blue: '#7aa8ff', cyan: '#58d8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', grey: '#8992b1', grid: '#252d4b', axis: '#8992b1' };
const TIP = { background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 };
const BAND_COLOR: Record<string, string> = { ok: '#3fbf95', below: '#e0b650', inadequate: '#ff8a5c', severe: '#ff5577' };
const BAND_TONE: Record<string, Tone> = { ok: 'ok', below: 'warn', inadequate: 'bad', severe: 'bad' };
const TONE_HEX: Record<string, string> = { ok: C.green, warn: C.amber, bad: C.pink, mute: C.blue };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const signed = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}`);
const hm = (h: number | null | undefined) => { if (h == null) return '—'; const m = Math.round(h * 60); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const dayLabel = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
const pText = (p: number) => (p < 0.001 ? 'p<0.001' : `p ${p.toFixed(3)}`);
const uid = () => globalThis.crypto?.randomUUID?.() ?? `sl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

function Section({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="sl-sec"><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div>;
}
function Chip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="sl-chip" style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>{children}</span>;
}
function Banner({ tone, title, children, icon }: { tone: 'ok' | 'warn' | 'bad' | 'mute'; title?: string; children: ReactNode; icon?: ReactNode }) {
  return <div className={`sl-banner ${tone}`}>{icon ?? <Info size={17} />}<div>{title && <b>{title}</b>}{children}</div></div>;
}
function Readings({ cards }: { cards: any[] }) {
  if (!cards?.length) return null;
  return (
    <div className="sl-read">
      {cards.map((c, i) => (
        <div className={`sl-card ${c.tone}`} key={`${c.title}-${i}`}>
          <div><b>{c.title}</b>{c.text}</div>
          {c.evidence && <div><EvidenceTag kind={c.evidence} /></div>}
        </div>
      ))}
    </div>
  );
}

/** Shows a lab value the way people read it: hours as "5 h 39 min", the rest with its unit. */
const labValue = (v: any, x = v.value) => (v.key === 'total_sleep_hours' ? hm(x) : `${fmt(x, v.unit === '%' || v.unit === 'min' ? 0 : 1)}${v.unit ? ` ${v.unit}` : ''}`);

/* ======================================================================================================
   LOG A NIGHT  (the one input on this page; saved through the existing observations endpoint)
   ====================================================================================================== */

function LogNight({ astronautId, defaultOpen }: { astronautId: number; defaultOpen: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [hours, setHours] = useState('7');
  const [date, setDate] = useState(todayIso());
  const h = Number(hours);
  const valid = hours !== '' && Number.isFinite(h) && h >= 0 && h <= 24;
  const save = useMutation({
    mutationFn: () => {
      const at = date === todayIso() ? new Date() : new Date(`${date}T08:00:00Z`);
      return createObservation({ astronaut_id: astronautId, observed_at: at.toISOString(), sleep_hours: h, client_uuid: uid() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sl-insight'] });
      qc.invalidateQueries({ queryKey: ['sl-ai'] });
      qc.invalidateQueries({ queryKey: ['ov-checkin'] });
    },
  });
  return (
    <Panel title="Log a night" subtitle={`Saved to the backend for astronaut #${astronautId} through the same record Daily Check-in uses. The sleep-quality rating and the day's vitals come from Daily Check-in.`} icon={<PenLine size={18} className="purple-icon" />}>
      {!open && <button className="primary-button" onClick={() => setOpen(true)}><PenLine size={15} /> Add a night</button>}
      {open && (
        <div className="sl-form">
          <div className="fields">
            <label><span>Hours slept</span><input type="number" min={0} max={24} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Hours slept" /></label>
            <label><span>The morning it was logged</span><input type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></label>
            <div>
              <button className="primary-button" disabled={save.isPending || !valid} onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 size={15} className="av-spin" /> : <CheckCircle2 size={15} />} Save night
              </button>
            </div>
          </div>
          {save.isSuccess && <span className="success-line" style={{ margin: 0 }}><CheckCircle2 size={14} /> Saved. The page below now includes it.</span>}
          {save.isError && <span style={{ color: C.pink, fontSize: 11 }}>{(save.error as Error).message}</span>}
          <p className="sl-note" style={{ margin: 0 }}>Two entries on the same morning are averaged. A night that is not logged is left out, never counted as short or long.</p>
        </div>
      )}
    </Panel>
  );
}

/* ======================================================================================================
   A. YOUR LOGGED NIGHTS
   ====================================================================================================== */

function NightByNight({ log }: { log: any }) {
  const rows = log.nightly.map((n: any) => ({ ...n, label: dayLabel(n.date) }));
  const target = log.rules.target_hours;
  const u = log.summary.last_night.usual;
  const top = Math.max(10, Math.ceil(Math.max(...rows.map((r: any) => r.hours)) + 1));
  return (
    <Panel title="Night by night" subtitle="Bar colour = the backend sleep rule. Line = average of the last 7 nights. Dashed line = the recommended hours." icon={<Moon size={18} className="icon-muted" />}>
      <div style={{ height: 290 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            {u && <ReferenceArea y1={u.low} y2={u.high} fill={C.blue} fillOpacity={0.12} strokeOpacity={0} />}
            <ReferenceLine y={target} stroke={C.green} strokeDasharray="4 3" label={{ value: `${target} h`, position: 'insideTopRight', fill: C.green, fontSize: 9 }} />
            <XAxis dataKey="label" stroke={C.axis} fontSize={10} interval="preserveStartEnd" minTickGap={18} />
            <YAxis stroke={C.axis} fontSize={10} width={30} domain={[0, top]} />
            <Tooltip contentStyle={TIP} formatter={(v: any, name: any) => [name === 'hours' ? hm(v) : hm(v), name === 'hours' ? 'Slept' : '7-night average']}
              labelFormatter={(l, p: any) => `${l}${p?.[0]?.payload?.rating != null ? ` · rated ${p[0].payload.rating}/10` : ''}`} />
            <Bar dataKey="hours" name="hours" radius={[3, 3, 0, 0]}>{rows.map((r: any) => <Cell key={r.date} fill={BAND_COLOR[r.band]} />)}</Bar>
            <Line type="monotone" dataKey="avg7" name="avg7" stroke="#fff" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="sl-legend">
        {log.rules.bands.map((b: any) => <span key={b.band}><i style={{ background: BAND_COLOR[b.band] }} />{b.text}</span>)}
        {u && <span><i style={{ background: '#4f7de355', border: '1px solid #4f7de3aa' }} />your usual range</span>}
      </div>
      <p className="sl-note">{log.rules.source}</p>
    </Panel>
  );
}

function BalancePanel({ log }: { log: any }) {
  const d = log.debt; const s = log.summary;
  const rows = d.balance.map((b: any) => ({ ...b, label: dayLabel(b.date) }));
  const neg = d.net_hours < 0;
  const color = neg ? C.pink : C.green;
  return (
    <Panel title="Sleep balance" subtitle={`Running total of hours slept minus ${d.target_hours} h a night. Falling = debt growing; rising = catching up.`} icon={<Scale size={18} className="icon-muted" />}>
      <div style={{ height: 200 }}>
        <ResponsiveContainer>
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <defs><linearGradient id="slbal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.4} /><stop offset="100%" stopColor={color} stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" stroke={C.axis} fontSize={10} interval="preserveStartEnd" minTickGap={18} />
            <YAxis stroke={C.axis} fontSize={10} width={36} tickFormatter={(v) => `${v}h`} />
            <ReferenceLine y={0} stroke="#fff" strokeOpacity={0.5} />
            <Tooltip contentStyle={TIP} formatter={(v: any) => [`${signed(v)} h`, 'Balance']} />
            <Area type="monotone" dataKey="balance" stroke={color} strokeWidth={2} fill="url(#slbal)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="sl-kv">
        <div><span>Balance now</span><b style={{ color }}>{signed(d.net_hours)} h</b><small>{neg ? `about ${fmt(d.nights_equivalent_lost)} full nights short` : 'at or above the guideline'}</small></div>
        <div><span>Short by, in total</span><b>{fmt(d.short_hours_total)} h</b><small>across {s.nights_below_guideline} short nights</small></div>
        <div><span>Slept extra</span><b>{fmt(d.extra_hours_total)} h</b><small>on nights above {d.target_hours} h</small></div>
        <div><span>Last {d.nights_last7} nights short by</span><b style={{ color: d.short_hours_last7 > 0 ? C.amber : C.green }}>{fmt(d.short_hours_last7)} h</b><small>this week only</small></div>
      </div>
      <p className="sl-note">{d.note}</p>
    </Panel>
  );
}

function ShapePanel({ log }: { log: any }) {
  const s = log.summary; const b = s.bands; const total = s.nights;
  const hist = useMemo(() => {
    const hs: number[] = log.nightly.map((n: any) => n.hours);
    const lo = Math.floor(Math.min(...hs)); const hi = Math.floor(Math.max(...hs));
    return Array.from({ length: hi - lo + 1 }, (_, i) => ({ bin: lo + i, label: `${lo + i}–${lo + i + 1} h`, nights: hs.filter((h) => h >= lo + i && h < lo + i + 1).length }));
  }, [log.nightly]);
  return (
    <Panel title="How the nights fall" subtitle="Share of logged nights in each band, and the longest runs." icon={<Layers size={18} className="icon-muted" />}>
      <div className="sl-stack" role="img" aria-label="Nights by band">
        {log.rules.bands.map((x: any) => b[x.band] > 0 && <i key={x.band} style={{ width: `${(b[x.band] / total) * 100}%`, background: BAND_COLOR[x.band] }} title={`${x.text}: ${b[x.band]} nights`} />)}
      </div>
      <div className="sl-legend">
        {log.rules.bands.map((x: any) => <span key={x.band}><i style={{ background: BAND_COLOR[x.band] }} />{x.text} · {b[x.band]}</span>)}
      </div>
      <div className="sl-kv">
        <div><span>Short nights in a row now</span><b style={{ color: s.current_short_run >= 3 ? C.pink : s.current_short_run ? C.amber : C.green }}>{s.current_short_run}</b><small>nights under {log.rules.target_hours} h</small></div>
        <div><span>Longest short run</span><b>{s.longest_short_run}</b><small>in this window</small></div>
        <div><span>Longest good run</span><b>{s.longest_ok_run}</b><small>nights meeting the guideline</small></div>
        <div><span>Shortest night</span><b>{hm(s.shortest.hours)}</b><small>{dayLabel(s.shortest.date)}</small></div>
        <div><span>Longest night</span><b>{hm(s.longest.hours)}</b><small>{dayLabel(s.longest.date)}</small></div>
      </div>
      <div className="sl-mono" style={{ margin: '16px 0 4px' }}>Nights by length</div>
      <div style={{ height: 130 }}>
        <ResponsiveContainer>
          <BarChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" stroke={C.axis} fontSize={9} />
            <YAxis stroke={C.axis} fontSize={9} width={24} allowDecimals={false} />
            <Tooltip contentStyle={TIP} formatter={(v: any) => [`${v} night${v === 1 ? '' : 's'}`, '']} />
            <ReferenceLine x={hist.find((x) => x.bin === log.rules.target_hours)?.label} stroke={C.green} strokeDasharray="4 3" />
            <Bar dataKey="nights" fill={C.blue} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function RegularityPanel({ log }: { log: any }) {
  const r = log.regularity; const h = r.halves; const rb = r.rebound;
  const hasAny = h || rb || r.swing_hours != null;
  if (!hasAny) return null;
  const dir = h ? ({ more_erratic: { t: 'less regular', c: C.amber }, steadier: { t: 'steadier', c: C.green }, similar: { t: 'about the same', c: C.grey } } as any)[h.direction] : null;
  return (
    <Panel title="Regularity and catch-up" subtitle="Is sleep staying steady, and are short nights being made up?" icon={<Repeat size={18} className="icon-muted" />}>
      <div className="sl-kv" style={{ marginTop: 0 }}>
        <div><span>Spread of nights</span><b>{fmt(r.sd_hours, 2)} h</b><small>how far nights wander from the average</small></div>
        <div><span>Swing night to night</span><b>{r.swing_hours == null ? '—' : `${fmt(r.swing_hours, 2)} h`}</b><small>average change between neighbouring nights</small></div>
        {r.usual && <div><span>Your usual night</span><b>{fmt(r.usual.low)}–{fmt(r.usual.high)} h</b><small>centre {fmt(r.usual.mean)} h, from {r.usual.n} earlier nights</small></div>}
      </div>
      {h && (
        <>
          <div className="sl-mono" style={{ margin: '16px 0 6px' }}>Spread, first half of the window against the second {dir && <Chip color={dir.c}>{dir.t}</Chip>}</div>
          <div style={{ height: 120 }}>
            <ResponsiveContainer>
              <BarChart layout="vertical" data={[{ n: 'First half', v: h.first_sd, m: h.first_mean }, { n: 'Second half', v: h.second_sd, m: h.second_mean }]} margin={{ top: 4, right: 16, left: 6, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} horizontal={false} />
                <XAxis type="number" stroke={C.axis} fontSize={10} tickFormatter={(v) => `${v} h`} />
                <YAxis type="category" dataKey="n" stroke={C.axis} fontSize={10} width={78} />
                <Tooltip contentStyle={TIP} formatter={(v: any, _n: any, p: any) => [`${fmt(v, 2)} h spread · average ${fmt(p.payload.m)} h`, '']} />
                <Bar dataKey="v" radius={[0, 4, 4, 0]}><Cell fill={C.blue} /><Cell fill={h.direction === 'more_erratic' ? C.amber : h.direction === 'steadier' ? C.green : C.blue} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      {rb && (
        <>
          <div className="sl-mono" style={{ margin: '14px 0 6px' }}>The night after a short night {rb.catches_up ? <Chip color={C.green}>catching up</Chip> : <Chip color={C.amber}>not catching up</Chip>}</div>
          {([['After a short night', rb.after_short_mean, rb.n_after_short, C.amber], ['After a good night', rb.after_ok_mean, rb.n_after_ok, C.green]] as const).map(([label, v, n, col]) => (
            <div className="sl-bar" key={label} style={{ gridTemplateColumns: 'minmax(130px,1fr) 2fr 80px' }}>
              <span>{label}<span style={{ color: '#6f799a' }}> · {n} nights</span></span>
              <div className="sl-div"><i style={{ left: 0, width: `${Math.min(100, (v / 10) * 100)}%`, background: col }} /></div>
              <span className="r">{hm(v)}</span>
            </div>
          ))}
          <p className="sl-note">{rb.rule}</p>
        </>
      )}
    </Panel>
  );
}

function RatingPanel({ r }: { r: any }) {
  const q = r.quadrants;
  const cells: [string, number, string, string][] = [
    ['Enough hours and rested', q.enough_and_rested, C.green, `${r.target_hours} h or more, rated ${r.quality_ok}+ of 10`],
    ['Enough hours, not rested', q.enough_not_rested, C.amber, 'long enough, but rated lower'],
    ['Short but rested', q.short_but_rested, C.cyan, 'under the guideline, rated well'],
    ['Short and not rested', q.short_and_not_rested, C.pink, 'both measures say poor'],
  ];
  return (
    <Panel title="Hours against how rested you felt" subtitle={`${r.n} nights with both an hours entry and a sleep-quality rating`} icon={<Gauge size={18} className="icon-muted" />}>
      <div style={{ height: 250 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 18 }}>
            <CartesianGrid stroke={C.grid} />
            <XAxis type="number" dataKey="hours" name="Hours" stroke={C.axis} fontSize={10} domain={['dataMin - 0.5', 'dataMax + 0.5']} tickFormatter={(v) => fmt(v, 1)} label={{ value: 'Hours slept', position: 'insideBottom', offset: -10, fill: C.axis, fontSize: 10 }} />
            <YAxis type="number" dataKey="rating" name="Rating" stroke={C.axis} fontSize={10} width={30} domain={[0, 10]} />
            <ReferenceLine x={r.target_hours} stroke={C.green} strokeDasharray="4 3" />
            <ReferenceLine y={r.quality_ok} stroke={C.green} strokeDasharray="4 3" />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={TIP} formatter={(v: any, n: any) => [n === 'Hours' ? hm(v) : `${v}/10`, n]} />
            <Scatter data={r.points} fill={C.blue} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="sl-kv">
        {cells.map(([label, n, col, sub]) => <div key={label}><span>{label}</span><b style={{ color: col }}>{n}</b><small>{sub}</small></div>)}
      </div>
      <p className="sl-note">{r.r != null ? <>Spearman {signed(r.r, 2)} · {pText(r.p)} · {r.strength}. </> : null}Nights that land in the two "not rested" and "short but rested" boxes are where hours alone would mislead.</p>
    </Panel>
  );
}

function CostPanel({ cost }: { cost: any }) {
  return (
    <Panel title="The day after a short night" subtitle={`${cost.short_days} days after a short night against ${cost.ok_days} after a night that met the guideline, using what was recorded the same day`} icon={<HeartPulse size={18} className="icon-muted" />}>
      {cost.rows.map((r: any) => {
        const bad = r.worse_after_short === true;
        const col = !r.noticeable ? C.grey : r.worse_after_short == null ? C.blue : bad ? C.pink : C.green;
        return (
          <div className="sl-bar" key={r.key} style={{ gridTemplateColumns: 'minmax(130px,1fr) 1.2fr 150px' }}>
            <span>{r.label}<span style={{ display: 'block', font: "9px 'DM Mono',monospace", color: '#6f799a', marginTop: 2 }}>{r.n_short} and {r.n_ok} days</span></span>
            <div className="sl-div"><b /><i style={{ background: col, left: r.effect >= 0 ? '50%' : `${50 + Math.max(-1, r.effect / 2) * 50}%`, width: `${Math.min(1, Math.abs(r.effect) / 2) * 50}%` }} /></div>
            <span className="r" style={{ color: col }}>{fmt(r.after_short)} vs {fmt(r.after_ok)} {r.unit}{r.noticeable ? <Chip color={col}>noticeable</Chip> : null}</span>
          </div>
        );
      })}
      <p className="sl-note">{cost.rule} Bar = size of the difference in spreads, right of the line = higher after a short night.</p>
    </Panel>
  );
}

function LogSection({ log }: { log: any }) {
  return (
    <>
      <Section icon={<BedDouble size={17} />} title="Your logged nights"
        sub={`${log.summary.nights} nights with hours · ${dayLabel(log.window.start)} to ${dayLabel(log.window.end)}. Judged against the backend sleep rule and your own usual, not against other people.`} />
      {log.window.days_since_latest >= 2 && (
        <Banner tone="mute" title={`Last logged night was ${log.window.days_since_latest} days ago`}>The window ends at that night, so older nights still count. Log a new one to bring it up to date.</Banner>
      )}
      <Readings cards={log.reading} />
      <div className="sl-grid sl-g2"><NightByNight log={log} /><BalancePanel log={log} /></div>
      <div className="sl-grid sl-g2e"><ShapePanel log={log} /><RegularityPanel log={log} /></div>
      {(log.rating || log.cost) && (
        <div className="sl-grid sl-g2e">
          {log.rating ? <RatingPanel r={log.rating} /> : <div />}
          {log.cost ? <CostPanel cost={log.cost} /> : <div />}
        </div>
      )}
    </>
  );
}

/* ======================================================================================================
   B. ONE MEASURED NIGHT AGAINST THE VOLUNTEER COHORT
   ====================================================================================================== */

function verdictColor(v: any): string {
  if (v.past_reference) return C.amber;
  if (!v.verdict || v.higher_is_better == null || v.verdict === 'typical') return C.grey;
  return (v.verdict === 'higher') !== v.higher_is_better ? C.amber : C.green;
}

function CohortStrips({ vars, n }: { vars: any[]; n: number }) {
  return (
    <div>
      {vars.map((v) => {
        const refV = v.reference?.value;
        const lo = Math.min(v.min, refV ?? v.min); const hi = Math.max(v.max, refV ?? v.max);
        const pos = (x: number) => `${hi === lo ? 50 : Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100))}%`;
        const color = verdictColor(v);
        return (
          <div className="sl-row" key={v.key}>
            <div className="sl-name">{v.label}<small>{v.note}{v.higher_is_better != null ? ` · ${v.higher_is_better ? 'higher is better' : 'lower is better'}` : ''}</small></div>
            <div>
              <div className="sl-track" aria-label={`${v.label} against the volunteers`}>
                <i className="band" style={{ left: pos(v.q25), width: `calc(${pos(v.q75)} - ${pos(v.q25)})` }} />
                <i className="tick" style={{ left: pos(v.middle) }} title={`cohort middle ${fmt(v.middle)}`} />
                {refV != null && <i className="ref" style={{ left: pos(refV) }} title={v.reference.text} />}
                <i className="dot" style={{ left: pos(v.value), background: color }} title={labValue(v)} />
              </div>
              <div className="sl-scale"><span>{labValue(v, v.min)}</span><span>middle {labValue(v, v.middle)}{v.reference ? ` · red line: ${v.reference.text}` : ''}</span><span>{labValue(v, v.max)}</span></div>
            </div>
            <div className="sl-val" style={{ color }}>
              {labValue(v)}
              <small>{v.verdict ? <Chip color={color}>{v.verdict === 'typical' ? 'typical' : `${v.verdict} than most`}</Chip> : null}<br />{v.rank_from_top} of {n} from the top</small>
            </div>
          </div>
        );
      })}
      <div className="sl-legend">
        <span><i style={{ background: '#4f7de355', border: '1px solid #4f7de3aa' }} />middle half of the volunteers</span>
        <span><i style={{ background: '#fff' }} />cohort middle</span>
        <span><i style={{ background: C.pink }} />reference line (sleep convention)</span>
      </div>
    </div>
  );
}

function ProfilePanel({ p }: { p: any }) {
  return (
    <Panel title="This night against the lines" subtitle="Four checks: duration, efficiency, time awake, fragmentation" icon={<MoonStar size={18} className="icon-muted" />}>
      {p.clear
        ? <Banner tone="ok" title="No flag on this night" icon={<CheckCircle2 size={17} />}>{p.summary}</Banner>
        : (
          <>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#dfe3f3' }}>{p.summary}</p>
            <div className="sl-flags">{p.flags.map((f: any) => <div className="sl-flag" key={f.key}><b>{f.label}</b>{f.text}</div>)}</div>
          </>
        )}
    </Panel>
  );
}

function PerceptionPanel({ p }: { p: any }) {
  const tone = p.verdict.startsWith('agree') ? (p.verdict === 'agree_good' ? 'ok' : 'warn') : 'mute';
  return (
    <Panel title="What they say against what was measured" subtitle="The volunteer's own sleep questionnaire next to the sensor" icon={<Activity size={18} className="icon-muted" />}>
      {p.rows.map((r: any) => (
        <div className="sl-ck" key={r.source}>
          {r.poor ? <AlertTriangle size={17} color={C.amber} /> : <CheckCircle2 size={17} color={C.green} />}
          <div>{r.source}<small>{r.detail}</small></div>
        </div>
      ))}
      <div style={{ height: 8 }} />
      <Banner tone={tone as any} title={p.verdict === 'feels_worse' || p.verdict === 'feels_better' ? 'Feeling and measurement differ' : 'Feeling and measurement agree'} icon={<Info size={17} />}>{p.text}</Banner>
    </Panel>
  );
}

function SplitPanel({ split, n }: { split: any[]; n: number }) {
  const [sel, setSel] = useState(split[0].outcome);
  const s = split.find((x) => x.outcome === sel) ?? split[0];
  const mine = s.selected_group;
  return (
    <Panel title="Better sleepers against the rest" subtitle={`The ${s.n_better} volunteers with ${s.higher_is_better ? 'higher' : 'lower'} ${s.label.toLowerCase()} against the other ${s.n_worse}${mine ? ` · this volunteer is in the ${mine === 'better' ? 'better-sleeping' : 'other'} half` : ''}`} icon={<Split size={18} className="icon-muted" />}>
      <div className="sl-seg" role="tablist">
        {split.map((x) => <button key={x.outcome} role="tab" aria-selected={sel === x.outcome} className={sel === x.outcome ? 'on' : ''} onClick={() => setSel(x.outcome)}>{x.label}</button>)}
      </div>
      <div className="sl-row" style={{ gridTemplateColumns: 'minmax(150px,1.1fr) 1fr 1fr 1.2fr', padding: '4px 0 8px', borderTop: 0 }}>
        <span className="sl-mono">Measure</span><span className="sl-mono" style={{ textAlign: 'right' }}>Better half</span><span className="sl-mono" style={{ textAlign: 'right' }}>The rest</span><span className="sl-mono">Link (Spearman)</span>
      </div>
      {s.rows.map((r: any) => (
        <div className="sl-row" key={r.key} style={{ gridTemplateColumns: 'minmax(150px,1.1fr) 1fr 1fr 1.2fr', padding: '9px 0' }}>
          <span className="sl-name" style={{ fontWeight: 500 }}>{r.label}</span>
          <span style={{ textAlign: 'right', font: "12px 'DM Mono',monospace", color: '#fff' }}>{fmt(r.better_mean, 1)}<small style={{ color: '#7f89a8' }}> {r.unit}</small></span>
          <span style={{ textAlign: 'right', font: "12px 'DM Mono',monospace", color: '#d2d7e9' }}>{fmt(r.worse_mean, 1)}<small style={{ color: '#7f89a8' }}> {r.unit}</small></span>
          <span style={{ display: 'grid', gridTemplateColumns: '1fr 62px', gap: 8, alignItems: 'center' }}>
            <div className="sl-div">{r.r != null && <><b /><i style={{ background: r.meaningful ? (r.r > 0 ? C.blue : C.cyan) : '#3b4672', left: r.r >= 0 ? '50%' : `${50 + r.r * 50}%`, width: `${Math.abs(r.r) * 50}%` }} /></>}</div>
            <span title={r.p != null ? `${r.strength} · ${pText(r.p)} · n ${r.n}` : ''} style={{ font: "600 11px 'DM Mono',monospace", textAlign: 'right' }}>{signed(r.r, 2)}{r.meaningful && <span style={{ color: C.green }}> ✓</span>}</span>
          </span>
        </div>
      ))}
      <p className="sl-note">✓ = |rho| of 0.4 or more and p under 0.05. With {n} volunteers and {s.rows.length} comparisons some links appear by chance, so each is a lead, not a finding. Cut between halves: {fmt(s.cut, 1)}.</p>
    </Panel>
  );
}

function DriversPanel({ d }: { d: any }) {
  const max = Math.max(...d.drivers.map((x: any) => Math.abs(x.push)), 0.1);
  return (
    <Panel title="Why the poor-sleep model said what it said" subtitle="Each input's push on the saved model's answer, in log-odds. Right = raises the chance of poor sleep." icon={<Cpu size={18} className="icon-muted" />}>
      <Banner tone="warn" title="Weak evidence" icon={<AlertTriangle size={17} />}>
        {d.warning ?? 'This model does not beat chance.'} {d.roc_auc != null ? `ROC AUC ${fmt(d.roc_auc, 2)} (0.50 = a coin flip).` : ''}
      </Banner>
      <div className="sl-mono">Model's chance of poor sleep · {fmt(d.probability * 100, 0)}% · {d.flagged ? 'over the 50% flag line' : 'under the 50% flag line'}</div>
      <div className="sl-gauge" role="img" aria-label="Poor-sleep probability">
        <i style={{ width: `${d.probability * 100}%`, background: d.flagged ? C.pink : C.blue }} />
        <u style={{ left: `${d.average_input_probability * 100}%` }} title={`chance with all inputs at the training average ${fmt(d.average_input_probability * 100, 0)}%`} />
        <b style={{ left: '50%' }} title="50% flag line" />
      </div>
      <div className="sl-scale"><span>0%</span><span>yellow tick = chance if every input were average ({fmt(d.average_input_probability * 100, 0)}%) · white = 50% flag line</span><span>100%</span></div>
      <div style={{ height: 8 }} />
      {d.drivers.map((x: any) => {
        const col = x.push > 0 ? C.pink : C.blue;
        return (
          <div className="sl-bar" key={x.key} style={{ gridTemplateColumns: 'minmax(140px,1.1fr) 1.6fr 150px' }}>
            <span>{x.label}<span style={{ display: 'block', font: "9px 'DM Mono',monospace", color: '#6f799a', marginTop: 2 }}>{x.imputed ? 'missing, replaced by the training median' : `${fmt(x.z, 1)} spreads ${x.z >= 0 ? 'above' : 'below'} the training average`}</span></span>
            <div className="sl-div"><b /><i style={{ background: col, left: x.push >= 0 ? '50%' : `${50 + (x.push / max) * 50}%`, width: `${(Math.abs(x.push) / max) * 50}%` }} /></div>
            <span className="r" style={{ color: col }}>{signed(x.push, 2)}{x.as_expected === false ? <Chip color={C.amber}>against sleep science</Chip> : null}</span>
          </div>
        );
      })}
      <p className="sl-note">{d.judged ? `${d.against_expectation} of the ${d.judged} inputs with a clear sleep-science direction (time asleep, wake time, awakenings, efficiency, stress, anxiety) push the opposite way. ` : ''}{d.note}</p>
    </Panel>
  );
}

function LabSection({ lab, hasLog }: { lab: any; hasLog: boolean }) {
  return (
    <>
      <Section icon={<FlaskConical size={17} />} title={hasLog ? 'A measured night for comparison' : 'A measured night'}
        sub={`${lab.participant} against ${lab.cohort_size} MMASH volunteers. ${lab.population_note} Use it to see how a night compares and what travels with good sleep, not to judge the person.`} />
      <Readings cards={lab.reading} />
      <div className="sl-grid sl-g2e">
        <ProfilePanel p={lab.profile} />
        {lab.perception ? <PerceptionPanel p={lab.perception} /> : <div />}
      </div>
      <div style={{ marginBottom: 14 }}>
        <Panel title="The measured night against the volunteers" subtitle="Dot = this volunteer. Blue band = the middle half of the cohort. White tick = cohort middle." icon={<Gauge size={18} className="icon-muted" />}>
          <CohortStrips vars={lab.variables} n={lab.cohort_size} />
        </Panel>
      </div>
      {lab.split && <div style={{ marginBottom: 14 }}><SplitPanel split={lab.split} n={lab.cohort_size} /></div>}
      {lab.drivers && <DriversPanel d={lab.drivers} />}
    </>
  );
}

/* ======================================================================================================
   AI BRIEFING
   ====================================================================================================== */

function AiBriefing({ req }: { req: any }) {
  const ai = useQuery({ queryKey: ['sl-ai', req], queryFn: () => getSleepAdvice(req), retry: 0, staleTime: 60 * 60_000 });
  const result = ai.data?.ai?.result ?? null;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  return (
    <Panel title="Recommendations" subtitle={ai.data?.ai?.model ? `${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : 'Written by the AI from your nights and the measured night above'} icon={<Sparkles size={18} className="purple-icon" />}>
      <div className="sl-ai-bar">
        <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>
          {ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again
        </button>
        <span>The AI never changes a Good / Warning / Critical level. Log a new night, then ask again to get advice for it.</span>
      </div>
      {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for sleep recommendations…</p>}
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
          {(result.key_findings ?? []).map((f) => <div className="sl-ai-find" key={f}><i /><span>{f}</span></div>)}
          {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">Could not be checked</div>}
          {(result.data_gaps ?? []).map((g) => <div className="sl-ai-find" key={g}><i style={{ background: C.grey }} /><span>{g}</span></div>)}
          <div className="sl-ai-meta">{result.disclaimer ?? ai.data?.disclaimer}</div>
        </>
      )}
    </Panel>
  );
}

/* ======================================================================================================
   PAGE
   ====================================================================================================== */

function Kpis({ log, lab }: { log: any | null; lab: any | null }) {
  if (log) {
    const s = log.summary; const d = log.debt; const ln = s.last_night;
    const last = log.nightly[log.nightly.length - 1];
    const u = ln.usual;
    return (
      <div className="sl-kpis">
        <Stat icon={<Moon size={18} />} label="LAST NIGHT" value={hm(ln.hours)} tone={BAND_TONE[ln.band]} tag="strong"
          sub={u ? `${signed(u.latest_difference)} h vs your usual ${fmt(u.mean)} h` : log.rules.bands.find((b: any) => b.band === ln.band)?.text} />
        <Stat icon={<Clock size={18} />} label="7-NIGHT AVERAGE" value={last.avg7 != null ? hm(last.avg7) : '—'} tone={last.avg7 == null ? 'mute' : last.avg7 >= d.target_hours ? 'ok' : last.avg7 >= d.target_hours - 1 ? 'warn' : 'bad'}
          sub={`guideline ${d.target_hours} h or more`} tag="strong" />
        <Stat icon={<Scale size={18} />} label="SLEEP BALANCE" value={signed(d.net_hours)} unit=" h" tone={d.net_hours >= 0 ? 'ok' : d.net_hours > -7 ? 'warn' : 'bad'}
          sub={`over ${s.nights} logged nights vs ${d.target_hours} h`} tag="proxy" />
        <Stat icon={<TrendingDown size={18} />} label="SHORT NIGHTS IN A ROW" value={s.current_short_run} tone={s.current_short_run >= 3 ? 'bad' : s.current_short_run ? 'warn' : 'ok'}
          sub={`longest run ${s.longest_short_run} · ${s.nights_below_guideline} of ${s.nights} below guideline`} tag="proxy" />
      </div>
    );
  }
  if (!lab) return null;
  const by = Object.fromEntries(lab.variables.map((v: any) => [v.key, v]));
  const keys: [string, ReactNode][] = [['total_sleep_hours', <Moon size={18} />], ['sleep_efficiency_percent', <Gauge size={18} />], ['total_awakenings', <Zap size={18} />], ['awakenings_per_hour', <Timer size={18} />]];
  return (
    <div className="sl-kpis">
      {keys.filter(([k]) => by[k]).map(([k, icon]) => {
        const v = by[k];
        const tone: Tone = v.past_reference ? 'warn' : v.verdict && v.verdict !== 'typical' && (v.verdict === 'higher') !== v.higher_is_better ? 'warn' : 'ok';
        return <Stat key={k} icon={icon} label={v.label.toUpperCase()} value={labValue(v)} tone={tone} tag="proxy" sub={v.higher_than != null ? (v.higher_than >= 0.995 ? 'above every other volunteer' : v.higher_than <= 0.005 ? 'below every other volunteer' : `above ${Math.round(v.higher_than * 100)}% of the other ${v.n - 1}`) : ''} />;
      })}
    </div>
  );
}

function Body() {
  useBootstrapSelection();
  const subjects = useSubjects();
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const req = useMemo(() => ({
    astronaut_id: astronautId, scenario_id: (selection as any)?.scenario_id ?? null, subject_id: (selection as any)?.subject_id ?? null,
    mmash_user: (selection as any)?.mmash_user ?? null, days: 30, language,
  }), [astronautId, selection, language]);
  const q = useQuery({ queryKey: ['sl-insight', req], queryFn: () => getSleepInsight(req), enabled: hasSelection(selection) || astronautId > 0, retry: 0, staleTime: 60_000 });

  const log = q.data?.log?.available ? q.data.log : null;
  const lab = q.data?.lab?.available ? q.data.lab : null;
  const fewNights = q.data?.log && !q.data.log.available ? q.data.log : null;
  const labReason = q.data?.lab && !q.data.lab.available ? q.data.lab.reason : null;

  if (q.isError && subjects.isError) {
    return (
      <div className="panel av-state">
        <WifiOff size={26} /><h3>Cannot reach the backend</h3>
        <p>{(q.error as Error).message}</p>
        <p className="muted">Start the backend (uvicorn on port 8000) and make sure Vite's /api proxy points to it. Then refresh this page.</p>
        <button className="primary-button" onClick={() => { subjects.refetch(); q.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (q.isLoading) return <div className="panel av-state"><Loader2 className="av-spin" size={26} /><h3>Reading your nights and the sleep data…</h3></div>;
  if (q.isError) {
    return (
      <div className="panel av-state"><AlertTriangle size={26} /><h3>The sleep analysis could not be built</h3><p>{(q.error as Error).message}</p>
        <button className="primary-button" onClick={() => q.refetch()}>Try again</button></div>
    );
  }

  const intro = !log && !lab;
  return (
    <>
      {(log || lab) && <Kpis log={log} lab={lab} />}

      <div style={{ marginTop: log || lab ? 20 : 0 }}><LogNight astronautId={astronautId} defaultOpen={!log} /></div>

      {fewNights && <div style={{ marginTop: 14 }}><Banner tone="mute" title="Not enough nights yet">{fewNights.reason} The analysis of your own sleep appears once enough nights are logged.</Banner></div>}

      {intro && (
        <div className="panel av-state" style={{ marginTop: 16 }}>
          <Info size={26} />
          <h3>Nothing to analyse yet</h3>
          <p>Log a few nights above and this page fills in with your sleep balance, regularity and the cost of short nights.</p>
          {labReason && <p className="muted">{labReason}</p>}
          {!labReason && !hasSelection(selection) && <p className="muted">No sleep volunteer is selected either. Choose data sources in Daily Check-in to compare a measured night with the 21 volunteers.</p>}
        </div>
      )}

      {log && <LogSection log={log} />}
      {lab && <LabSection lab={lab} hasLog={Boolean(log)} />}

      {(log || lab) && (
        <>
          <Section icon={<Sparkles size={17} />} title="AI sleep briefing" sub="Written by the AI from your data through the backend. No advice on this page is typed in; if the AI cannot answer, nothing is shown in its place." />
          <AiBriefing req={req} />
          <div className="notice-panel" style={{ marginTop: 16 }}>
            <Info size={18} />
            <div>
              <b>What this page can and cannot see</b>
              <p>
                Bedtime, light, noise, cabin temperature, caffeine and sleep stages are not measured, so the page describes how long and how steadily you slept, not why.
                {lab ? ' The measured night comes from an Earth volunteer, and the poor-sleep model is weak (it does not beat chance).' : ''} {q.data?.disclaimer ?? ''}
              </p>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function SleepPage() {
  return (
    <section className="page-enter sl">
      <style>{CSS}</style>
      <PageHeader eyebrow="REST & RECOVERY" title="Sleep Tracker"
        intro="How long and how steadily you sleep against the recommended hours, the debt that builds up, what short nights cost the next day, and how a measured night compares with 21 volunteers. Weak models are labelled as weak; nothing here is a diagnosis." />
      <Body />
    </section>
  );
}
