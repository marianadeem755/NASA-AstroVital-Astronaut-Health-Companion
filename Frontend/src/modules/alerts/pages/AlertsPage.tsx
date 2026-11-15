import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BarChart3, BellRing, Layers, Loader2, PhoneCall, RefreshCw, ShieldAlert, Sparkles, WifiOff } from 'lucide-react';
import { useAI } from '../../../hooks/useAstro';
import { acknowledgeAlert } from '../../../services/alerts.service';
import { getAlertsAdvice, getAlertsInsight } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { useRunStore } from '../../../store/useRunStore';
import { DataGate, EvidenceTag, Notice, PageHeader, Panel, RecToggle, WarningList } from '../../../shared/components/live';
import type { DayRequest } from '../../../types/ml';

/* ==========================================================================================================
   FACTOR ALERTS · own CSS (prefix "al-"). Everything above the new sections is the page as it was. POST /ml/alerts-insight
   raises alerts per factor from the astronaut's own logged data, body-map reports and the check-day models; the AI
   panel (POST /ml/alerts-recommendations, Gemini then Groq) writes the steps from those same alerts. Every line, source and
   number arrives in the response. A section with nothing to show is left out.
   ========================================================================================================== */

const AL_CSS = `
.al-sec { margin:32px 0 13px; } .al-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; } .al-sec h2 svg { color:#b47bff; }
.al-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:820px; line-height:1.5; }
.al-grid { display:grid; gap:14px; align-items:stretch; margin-bottom:14px; } .al-grid > * { min-width:0; } .al-g2e { grid-template-columns:1fr 1fr; } .al-grid .panel { margin-bottom:0; height:100%; } .al-gap { margin-bottom:14px; }
.al-seg { display:inline-flex; border:1px solid #343d62; border-radius:8px; overflow:hidden; margin-bottom:10px; } .al-seg button { padding:7px 12px; font-size:10px; border:0; background:#111832; color:#8992b1; font-weight:700; cursor:pointer; } .al-seg button.on { background:#22346b; color:#e4eeff; } .al-seg button:hover { color:#fff; }
.al-read { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:11px; margin-bottom:14px; }
.al-card { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:13px 14px; font-size:11.5px; line-height:1.6; color:#cfd4ea; display:flex; flex-direction:column; gap:9px; justify-content:space-between; } .al-card b { color:#f1f3fb; font-size:12.5px; display:block; margin-bottom:4px; }
.al-card.ok { border-left-color:#55e6b1; } .al-card.warn { border-left-color:#ffd37c; } .al-card.bad { border-left-color:#ff6b8b; } .al-card.mute { border-left-color:#7aa8ff; }
.al-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:2px 0 14px; } .al-kpis div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; } .al-kpis span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; }
.al-kpis b { display:block; font-size:19px; margin-top:6px; letter-spacing:-.5px; } .al-kpis small { display:block; font-size:9.5px; color:#8d97b4; margin-top:3px; line-height:1.4; }
.al-board { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:11px; margin-bottom:14px; }
.al-dom { background:#0f1630; border:1px solid #293252; border-top:3px solid var(--c,#5a6385); border-radius:10px; padding:12px 13px; transition:border-color .12s, transform .12s; } .al-dom:hover { border-color:var(--c,#5a6385); transform:translateY(-2px); }
.al-dom span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; } .al-dom b { display:block; font-size:16px; margin:6px 0 4px; color:var(--c,#dfe3f3); text-transform:capitalize; } .al-dom small { display:block; font-size:10px; color:#aab2d0; line-height:1.45; }
.al-chip { display:inline-block; font:9px 'DM Mono',monospace; letter-spacing:.5px; text-transform:uppercase; padding:3px 8px; border-radius:6px; border:1px solid; white-space:nowrap; }
.al-item { display:grid; grid-template-columns:auto 1fr; gap:12px; padding:13px 2px; border-top:1px solid #1f2745; } .al-item:first-child { border-top:0; padding-top:4px; }
.al-item h4 { margin:0 0 4px; font-size:13px; color:#f1f3fb; } .al-item p { margin:0; font-size:11.5px; color:#cfd4ea; line-height:1.55; }
.al-do { margin-top:8px; padding:8px 11px; border-radius:8px; background:#101a3a; border:1px solid #2b3a6b; font-size:11px; color:#d8e2ff; line-height:1.5; } .al-do b { color:#9fb8ff; font:8.5px 'DM Mono',monospace; letter-spacing:.6px; text-transform:uppercase; margin-right:7px; }
.al-meta { display:flex; flex-wrap:wrap; gap:8px 14px; margin-top:7px; font:9.5px 'DM Mono',monospace; color:#7f89a8; } .al-meta i { font-style:normal; color:#aab2d0; }
.al-heat { display:grid; gap:3px; align-items:center; } .al-heat .c { height:24px; border-radius:4px; border:1px solid transparent; cursor:default; transition:border-color .12s; } .al-heat .c:hover { border-color:#fff; } .al-heat .rw { font:9px 'DM Mono',monospace; color:#9aa4c6; text-align:right; padding-right:8px; white-space:nowrap; }
.al-cap { min-height:44px; margin:10px 0 0; padding:10px 12px; border-radius:9px; background:#0f1630; border:1px solid #293252; font-size:11px; color:#cfd4ea; line-height:1.55; }
.al-legend { display:flex; gap:15px; flex-wrap:wrap; font-size:10px; color:#aeb6d0; margin:8px 0 2px; } .al-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
.al-tbl { width:100%; border-collapse:collapse; font-size:11.5px; } .al-tbl th { text-align:left; font:8.5px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; padding:8px 10px; border-bottom:1px solid #2a3355; white-space:nowrap; }
.al-tbl td { padding:10px; border-top:1px solid #1f2745; color:#dfe3f3; vertical-align:top; line-height:1.45; } .al-tbl td small { display:block; font:9px 'DM Mono',monospace; color:#7f89a8; margin-top:3px; line-height:1.45; } .al-wrap { overflow-x:auto; }
.al-note { font-size:10.5px; color:#8992b1; line-height:1.55; margin:12px 0 0; } .al-chart { position:relative; }
.al-ack { padding:6px 11px; font-size:10px; border-radius:8px; border:1px solid #3a4778; background:#16214a; color:#dbe6ff; font-weight:700; cursor:pointer; } .al-ack:hover { border-color:#b47bff; } .al-ack:disabled { opacity:.5; cursor:default; }
.al-details summary { cursor:pointer; font-size:11px; color:#9fb8ff; padding:6px 0; font-weight:700; } .al-details summary:hover { color:#fff; }
.al-tip { box-sizing:border-box; width:min(320px, calc(100vw - 32px)); min-width:0; background:#0a1029; border:1px solid #4a5688; border-left:5px solid var(--tip,#b47bff); border-radius:10px; padding:12px 15px 13px; box-shadow:0 14px 40px #000a; pointer-events:none; overflow-wrap:anywhere; }
.al-tip-title { font-size:15px; font-weight:700; color:#fff; line-height:1.35; letter-spacing:-.2px; } .al-tip-sub { font:10px 'DM Mono',monospace; color:#9aa4c6; margin-top:4px; line-height:1.5; }
.al-tip-rows { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:6px 12px; margin-top:10px; padding-top:10px; border-top:1px solid #2c3560; align-items:baseline; } .al-tip-rows span { min-width:0; overflow-wrap:anywhere; }
.al-tip-rows span:nth-child(odd) { font:10px 'DM Mono',monospace; color:#8f99ba; text-transform:uppercase; letter-spacing:.5px; } .al-tip-rows span:nth-child(even) { font-size:13px; font-weight:700; color:#f2f4ff; text-align:right; }
.al-tip-note { margin-top:10px; font-size:11px; color:#c3c9e4; line-height:1.5; }
@media (max-width:1100px) { .al-g2e { grid-template-columns:1fr; } }
`;

const C = { blue: '#7aa8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', orange: '#ff9a5c', grey: '#8992b1', grid: '#252d4b' };
const PRI = ['low', 'medium', 'high', 'critical'] as const;
const PRI_COLOR: Record<string, string> = { clear: C.green, low: C.green, medium: C.amber, high: C.orange, critical: C.pink };
const TONE_HEX: Record<string, string> = { ok: C.green, warn: C.amber, bad: C.pink, mute: C.blue };
const axis = { stroke: '#8992b1', fontSize: 10 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const uv = (v: Any, u: string) => `${v}${u.startsWith('/') ? u : u ? ` ${u}` : ''}`;
const dlab = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
const xl = (value: string) => ({ value, position: 'insideBottom' as const, offset: -14, fill: C.grey, fontSize: 11 });
const yl = (value: string) => ({ value, angle: -90, position: 'insideLeft' as const, offset: 14, style: { textAnchor: 'middle' as const }, fill: C.grey, fontSize: 11 });

type TipSpec = { title: string; sub?: string; rows: [string, ReactNode][]; color?: string; note?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function TipBody({ t }: { t: TipSpec }) {
  return (
    <div className="al-tip" style={{ ['--tip' as string]: t.color ?? '#b47bff' }}>
      <div className="al-tip-title">{t.title}</div>
      {t.sub && <div className="al-tip-sub">{t.sub}</div>}
      <div className="al-tip-rows">{t.rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
      {t.note && <div className="al-tip-note">{t.note}</div>}
    </div>
  );
}
function RichTip({ active, payload, label, spec }: { active?: boolean; payload?: { payload?: Any }[]; label?: string | number; spec: (p: Any, label?: string | number) => TipSpec | null }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const t = spec(payload[0].payload, label);
  return t ? <TipBody t={t} /> : null;
}
const cursorBar = { fill: '#b47bff', fillOpacity: 0.12 };

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="al-chip" style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>{children}</span>;
}
function Section({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="al-sec"><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div>;
}
function Readings({ cards }: { cards?: Any[] }) {
  if (!cards?.length) return null;
  return (
    <div className="al-read">
      {cards.map((c, i) => (
        <div className={`al-card ${c.tone ?? 'mute'}`} key={i}>
          <div><b>{c.title}</b>{c.text}</div>
          {c.evidence && <div><EvidenceTag kind={c.evidence} /></div>}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- query ---------------------------------------------------------------- */

function useAlertsQuery(days: number) {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days, language }), [astronautId, selection, days, language]);
  const q = useQuery({ queryKey: ['al-insight', req], queryFn: () => getAlertsInsight(req), enabled: astronautId > 0, retry: 0, staleTime: 60_000 });
  return { q, req };
}

/* ---------------------------------------------------------------- sections ---------------------------------------------------------------- */

function FactorBoard({ board }: { board: Any[] }) {
  const hot = board.filter((b) => b.status !== 'clear');
  const clear = board.filter((b) => b.status === 'clear');
  return (
    <>
      {hot.length > 0 && (
        <div className="al-board">
          {hot.map((b) => (
            <div className="al-dom" key={b.domain} style={{ ['--c' as string]: PRI_COLOR[b.status] ?? C.grey }}>
              <span>{b.label}</span>
              <b>{`${b.status} · ${b.count} alert${b.count > 1 ? 's' : ''}`}</b>
              <small>{b.top}</small>
            </div>
          ))}
        </div>
      )}
      {clear.length > 0 && <p className="al-note" style={{ marginTop: 0 }}>Inside their lines: {clear.map((b) => b.label.toLowerCase()).join(', ')}.</p>}
    </>
  );
}

function WatchPanel({ watch }: { watch: Any[] }) {
  return (
    <Panel title="Close to the line" subtitle="Not alerts yet. These are on the safe side of a line but within 10% of it, so they are the first to watch" icon={<ShieldAlert size={18} className="icon-muted" />}>
      {watch.map((w) => (
        <div className="al-item" key={w.id}>
          <div><Chip color={C.amber}>{w.distance_pct}% away</Chip></div>
          <div>
            <h4>{w.factor}</h4>
            <p>{w.text}</p>
            <div className="al-meta"><span>healthy line <i>{w.line}</i></span><EvidenceTag kind={w.evidence} /></div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function AlertList({ alerts }: { alerts: Any[] }) {
  return (
    <Panel title="Alerts by factor" subtitle="Highest priority first. Each one shows what was measured, the line, how long it has lasted and the step to take" icon={<AlertTriangle size={18} className="icon-muted" />}>
      {alerts.map((a) => (
        <div className="al-item" key={a.id}>
          <div><Chip color={PRI_COLOR[a.priority]}>{a.priority}</Chip></div>
          <div>
            <h4>{a.title}</h4>
            <p>{a.message}</p>
            <div className="al-meta">
              <span>factor <i>{a.factor}</i></span>
              {a.observed != null && <span>measured <i>{uv(a.observed, a.unit)}</i></span>}
              <span>line <i>{a.line}</i></span>
              {a.run > 1 && a.kind === 'reading' && <span>lasted <i>{a.run} {a.unit === 'days' ? 'days' : 'readings'}</i></span>}
              {a.since && <span>since <i>{dlab(a.since)}</i></span>}
              <EvidenceTag kind={a.evidence} />
            </div>
            <div className="al-do"><b>What to do</b>{a.action}</div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function Timeline({ rows }: { rows: Any[] }) {
  const [hot, setHot] = useState<number | null>(null);
  return (
    <Panel title="Readings outside their lines, day by day" subtitle="Each bar is one logged day. Colour = how strong the alert was that day (before any lift for lasting)" icon={<BarChart3 size={18} className="purple-icon" />}>
      <div className="al-chart" style={{ height: 300 }} onMouseLeave={() => setHot(null)}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 10, right: 14, left: 0, bottom: 16 }} onMouseMove={(s: Any) => setHot(s?.activeTooltipIndex ?? null)}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" {...axis} tickFormatter={dlab} minTickGap={22} height={50} label={xl('Day (only days with logged data)')} />
            <YAxis {...axis} allowDecimals={false} width={56} label={yl('Readings outside their line')} />
            <Tooltip cursor={cursorBar} content={<RichTip spec={(d) => ({
              title: dlab(d.date), sub: `${d.total} reading${d.total === 1 ? '' : 's'} outside a line`, color: d.critical ? PRI_COLOR.critical : d.high ? PRI_COLOR.high : d.medium ? PRI_COLOR.medium : PRI_COLOR.low,
              rows: d.items.length ? d.items.map((i: Any) => [i.factor, `${uv(i.value, i.unit)} · ${i.priority}`] as [string, ReactNode]) : [['All readings', 'inside their lines']],
            })} />} />
            {PRI.map((p) => (
              <Bar key={p} dataKey={p} stackId="a" fill={PRI_COLOR[p]} name={p}>
                {rows.map((r, i) => <Cell key={r.date} fillOpacity={hot == null || hot === i ? 1 : 0.3} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="al-legend">{PRI.map((p) => <span key={p}><i style={{ background: PRI_COLOR[p] }} />{p}</span>)}</div>
    </Panel>
  );
}

function HeatBoard({ rows }: { rows: Any[] }) {
  const [hov, setHov] = useState<{ row: string; cell: Any } | null>(null);
  const n = rows[0]?.cells.length ?? 0;
  const shade = (lvl: number) => (lvl < 0 ? '#1a2242' : PRI_COLOR[PRI[lvl]]);
  return (
    <Panel title="Which factor, which day" subtitle="One cell per logged day for each factor. Colour = the worst priority that day; dark = inside its line" icon={<Layers size={18} className="purple-icon" />}>
      <div className="al-heat" style={{ gridTemplateColumns: `130px repeat(${n}, minmax(0,1fr))` }} onMouseLeave={() => setHov(null)}>
        {rows.map((r) => (
          <Fragment key={r.domain}>
            <div className="rw">{r.label}</div>
            {r.cells.map((c: Any) => <div className="c" key={c.date} style={{ background: shade(c.level) }} onMouseEnter={() => setHov({ row: r.label, cell: c })} />)}
          </Fragment>
        ))}
      </div>
      <div className="al-cap">
        {hov ? (
          <TipBody t={{ title: `${hov.row} · ${dlab(hov.cell.date)}`, sub: hov.cell.level < 0 ? 'Inside every line' : `Worst: ${PRI[hov.cell.level]}`, color: shade(hov.cell.level),
            rows: hov.cell.items.length ? hov.cell.items.map((i: Any) => [i.factor, `${uv(i.value, i.unit)} · ${i.priority}`] as [string, ReactNode]) : [['Readings', 'all inside their lines']] }} />
        ) : 'Hover a cell to see what was outside its line that day.'}
      </div>
    </Panel>
  );
}

function EnginePanel({ engine, onChanged }: { engine: Any; onChanged: () => void }) {
  const ack = useMutation({ mutationFn: (id: number) => acknowledgeAlert(id, { acknowledged_by: 'astronaut' }), onSuccess: onChanged });
  return (
    <Panel title="Alerts already raised by the rule engine" subtitle="Saved by the risk engine from stored observations. Acknowledge one once it has been read" icon={<BellRing size={18} className="icon-muted" />}>
      {engine.items.map((a: Any) => (
        <div className="al-item" key={a.id}>
          <div><Chip color={PRI_COLOR[a.priority] ?? C.grey}>{a.priority}</Chip></div>
          <div>
            <h4>{a.title}</h4>
            <p>{a.message}</p>
            <div className="al-meta"><span>raised <i>{dlab(a.created_at)}</i></span><span>open for <i>{a.age_hours < 48 ? `${Math.round(a.age_hours)} h` : `${Math.round(a.age_hours / 24)} days`}</i></span></div>
            <div style={{ marginTop: 8 }}><button className="al-ack" disabled={ack.isPending} onClick={() => ack.mutate(a.id)}>{ack.isPending && ack.variables === a.id ? 'Saving…' : 'Acknowledge'}</button></div>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function Rules({ rules }: { rules: Any[] }) {
  return (
    <details className="al-details" style={{ marginTop: 6 }}>
      <summary>The lines behind these alerts</summary>
      <div className="al-wrap">
        <table className="al-tbl">
          <thead><tr><th>Factor</th><th>Healthy line</th><th>Alert tiers</th><th>Basis</th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.factor}><td><b>{r.factor}</b><small>{r.domain}</small></td><td>{r.line}</td><td>{r.tiers.join(' · ')}</td><td>{r.source}<small><EvidenceTag kind={r.evidence} /></small></td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="al-note">Readings outside a line for 3 or more in a row move up one level (never above high by lasting alone). Cognition is judged against the astronaut's own earlier readings. These are general-population references, not NASA flight-surgeon limits.</p>
    </details>
  );
}

/** AI recommendations: written by the backend (Gemini first, Groq fallback) from the same alerts. */
function AlertsAdvice({ req, alerts }: { req: Any; alerts: Any[] }) {
  const base = useAI();   // the page's own AI call goes first; the free tiers need a gap between calls
  const run = async () => {
    let r = await getAlertsAdvice(req);
    const waits = [...(r.ai?.error ?? '').matchAll(/retry in (\d+)s/g)].map((m) => Number(m[1]));
    if (!r.ai?.result && waits.length) {   // "called too recently": wait the time the backend asked for, then ask once more
      await new Promise((res) => setTimeout(res, (Math.max(...waits) + 1) * 1000));
      r = await getAlertsAdvice(req);
    }
    return r;
  };
  const ai = useQuery({ queryKey: ['al-ai', req], queryFn: run, enabled: alerts.length > 0 && !base.isFetching, retry: 0, staleTime: 60 * 60_000 });
  const result = ai.data?.ai?.result ?? null;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  const title = (id?: string) => (id && id !== 'all' ? alerts.find((a) => a.id === id)?.title : null);
  return (
    <Panel title="What to do about these alerts · AI" subtitle={`Written by the AI from the alerts above, in order of priority${ai.data?.ai?.model ? ` · ${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : ''}`} icon={<Sparkles size={18} className="purple-icon" />}>
      <p className="av-rec-note">It only sees the alerts, never raw files or keys, and it never changes a priority or the Good / Warning / Critical level. Each alert above already has its own rule-based step.</p>
      <div style={{ margin: '8px 0 12px' }}>
        <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>{ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again</button>
      </div>
      {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for recommendations…</p>}
      {problem && !ai.isFetching && <p className="av-rec-note warn">AI recommendations are not available right now</p>}
      {result && (
        <>
          {result.summary && <p className="av-summary">{result.summary}</p>}
          {result.contact_medical_officer && <div className="av-callout"><PhoneCall size={17} /><div><b>Contact the mission medical officer.</b>{result.contact_reason && <p>{result.contact_reason}</p>}</div></div>}
          {(result.recommendations ?? []).map((r: Any, i: number) => (
            <div className="av-rec-item" key={`${r.action}-${i}`}>
              <p>{r.action}</p>
              <div className="av-rec-meta">
                <span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span>
                {r.evidence && <EvidenceTag kind={r.evidence} />}
                {(title(r.alert) || r.alert === 'all') && <span className="muted" style={{ fontSize: 10 }}>for: {r.alert === 'all' ? 'all alerts together' : title(r.alert)}</span>}
              </div>
            </div>
          ))}
          {(result.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
          {(result.key_findings ?? []).map((f: string) => <p className="av-rec-note" key={f}>• {f}</p>)}
          {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">Could not be checked</div>}
          {(result.data_gaps ?? []).map((g: string) => <p className="av-rec-note" key={g}>• {g}</p>)}
          <p className="av-rec-note">{result.disclaimer ?? ai.data?.disclaimer}</p>
        </>
      )}
    </Panel>
  );
}

function AlertsInsights() {
  const [days, setDays] = useState(30);
  const qc = useQueryClient();
  const { q, req } = useAlertsQuery(days);
  const d = q.data;
  const hasTimeline = !!d?.timeline?.some((r: Any) => r.total > 0);
  const hasHeat = !!d?.heat?.some((r: Any) => r.cells.some((c: Any) => c.level >= 0));
  return (
    <>
      <style>{AL_CSS}</style>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} className="av-spin" /> Checking every factor against its line…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The factor alerts could not be loaded. The alerts above still work.</p>}
      {d && (
        <>
          <Section icon={<ShieldAlert size={17} />} title="Alerts by factor" sub="Raised from your own logged data, body-map reports and the model flags, one rule per factor. Each alert shows the line it crossed, how long it has lasted and how strong the evidence behind the line is." />
          <div className="al-seg">{[14, 30, 90].map((n) => <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>Last {n} days</button>)}</div>
          <div className="al-kpis">
            {d.kpis.total > 0 && <div><span>Active alerts</span><b style={{ color: PRI_COLOR[d.kpis.highest ?? 'low'] }}>{d.kpis.total}</b><small>{PRI.filter((p) => d.kpis.by_priority[p]).map((p) => `${d.kpis.by_priority[p]} ${p}`).join(' · ')}</small></div>}
            {d.kpis.domains_with_alert.length > 0 && <div><span>Areas in alert</span><b>{d.kpis.domains_with_alert.length}<small style={{ display: 'inline', fontSize: 11, color: '#8d97b4' }}> of {d.kpis.domains_checked}</small></b><small>Areas that had data to check</small></div>}
            {d.kpis.watch > 0 && <div><span>Close to a line</span><b style={{ color: C.amber }}>{d.kpis.watch}</b><small>Within 10% of a line, not over it</small></div>}
            {d.kpis.longest && <div><span>Longest lasting</span><b>{d.kpis.longest.run}</b><small>{d.kpis.longest.factor}, readings or days in a row</small></div>}
            {d.kpis.alert_days > 0 && <div><span>Days with an alert</span><b>{d.kpis.alert_days}<small style={{ display: 'inline', fontSize: 11, color: '#8d97b4' }}> of {d.kpis.logged_days}</small></b><small>Logged days in the window</small></div>}
            <div><span>Factors checked</span><b>{d.kpis.factors_checked}</b><small>Areas that had data this time</small></div>
          </div>
          <Readings cards={d.reading} />
          {d.board && d.board.length > 0 && <FactorBoard board={d.board} />}
          {d.alerts.length > 0 && <AlertList alerts={d.alerts} />}
          {d.watch && <div className="al-gap" style={{ marginTop: d.alerts.length ? 14 : 0 }}><WatchPanel watch={d.watch} /></div>}
          {d.stale && d.stale.length > 0 && <p className="al-note">Not current, so not alerted: {d.stale.map((s: Any) => `${s.factor} (last reading ${s.days_ago} days ago)`).join(', ')}.</p>}
          {(hasTimeline || hasHeat) && (
            <div className="al-grid al-g2e" style={{ marginTop: 14 }}>
              {hasTimeline && <Timeline rows={d.timeline as Any[]} />}
              {hasHeat && <HeatBoard rows={d.heat as Any[]} />}
            </div>
          )}
          {d.engine && <div className="al-gap"><EnginePanel engine={d.engine} onChanged={() => void qc.invalidateQueries({ queryKey: ['al-insight'] })} /></div>}
          {d.alerts.length > 0 && <div className="al-gap"><AlertsAdvice req={req} alerts={d.alerts} /></div>}
          {d.rules && <Rules rules={d.rules} />}
          <p className="al-note">{d.disclaimer}</p>
        </>
      )}
    </>
  );
}

export function AlertsPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="EARLY WARNING" title="Risk Alerts" intro="Every alert is a flag raised by the backend rules on the model outputs. Strong-evidence flags weigh most." />
      <DataGate>
        {(day) => {
          return (
            <>
              <WarningList day={day} />
              {day.level === 'red' && <Notice tone="warning" icon={<PhoneCall size={18} />}><b>RED: contact the mission medical officer today.</b><p>Do not do hard training until they say so.</p></Notice>}
              <AlertsInsights />
              <div className="av-gap-top"><RecToggle domains={['general', 'sleep', 'stress', 'hrv', 'blood', 'bone', 'exercise']} title="What to do about these alerts" /></div>
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
