import { Fragment, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Gauge, ListChecks, Loader2, Network, PhoneCall, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { useAI, useModels } from '../../../hooks/useAstro';
import { getInsightsAdvice, getInsightsPlan } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { useRunStore } from '../../../store/useRunStore';
import { DataGate, EvidenceTag, Notice, PageHeader, Panel, WarningList } from '../../../shared/components/live';
import type { DayRequest, DayResult, Language, Reliability } from '../../../types/ml';

/* ==========================================================================================================
   ACTION PLAN FROM THE FACTORS · own CSS (prefix "ia-"). The page below this block is unchanged. POST /ml/insights-plan builds a
   plan from the same factor alerts as the Risk Alerts page (own logs, body-map reports, the selected MMASH / HRV / blood / bone
   data and the model flags); POST /ml/insights-recommendations asks the AI (Gemini, then Groq) to write it. Every number, line
   and step arrives in the response; a section with nothing to show is left out.
   ========================================================================================================== */

const IA_CSS = `
.ia-sec { margin:32px 0 13px; } .ia-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; } .ia-sec h2 svg { color:#b47bff; }
.ia-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:820px; line-height:1.5; }
.ia-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:2px 0 14px; } .ia-kpis div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; } .ia-kpis span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; }
.ia-kpis b { display:block; font-size:19px; margin-top:6px; letter-spacing:-.5px; } .ia-kpis small { display:block; font-size:9.5px; color:#8d97b4; margin-top:3px; line-height:1.4; }
.ia-grid { display:grid; gap:14px; align-items:stretch; margin-bottom:14px; } .ia-grid > * { min-width:0; } .ia-g3 { grid-template-columns:repeat(3,minmax(0,1fr)); } .ia-g2 { grid-template-columns:1fr 1fr; } .ia-grid .panel { margin-bottom:0; height:100%; } .ia-gap { margin-bottom:14px; }
.ia-col h3 { margin:0 0 4px; font-size:13px; color:#f1f3fb; } .ia-col > small { display:block; font-size:10px; color:#818ba9; margin-bottom:10px; line-height:1.45; }
.ia-step { padding:11px 0; border-top:1px solid #1f2745; } .ia-step:first-of-type { border-top:0; padding-top:2px; } .ia-step p { margin:0; font-size:12px; color:#e2e6f6; line-height:1.55; }
.ia-meta { display:flex; flex-wrap:wrap; gap:7px; align-items:center; margin-top:7px; } .ia-why { margin-top:6px; font-size:10.5px; color:#8f99ba; line-height:1.5; } .ia-why b { color:#aab2d0; font:8.5px 'DM Mono',monospace; letter-spacing:.6px; text-transform:uppercase; margin-right:6px; }
.ia-chip { display:inline-block; font:9px 'DM Mono',monospace; letter-spacing:.5px; text-transform:uppercase; padding:3px 8px; border-radius:6px; border:1px solid; white-space:nowrap; }
.ia-read { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:11px; margin-bottom:14px; }
.ia-card { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:13px 14px; font-size:11.5px; line-height:1.6; color:#cfd4ea; display:flex; flex-direction:column; gap:9px; justify-content:space-between; } .ia-card b { color:#f1f3fb; font-size:12.5px; display:block; margin-bottom:4px; }
.ia-card.ok { border-left-color:#55e6b1; } .ia-card.warn { border-left-color:#ffd37c; } .ia-card.bad { border-left-color:#ff6b8b; } .ia-card.mute { border-left-color:#7aa8ff; }
.ia-chart { position:relative; } .ia-legend { display:flex; gap:15px; flex-wrap:wrap; font-size:10px; color:#aeb6d0; margin:8px 0 2px; } .ia-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
.ia-note { font-size:10.5px; color:#8992b1; line-height:1.55; margin:12px 0 0; } .ia-watch { margin:0; padding:0; list-style:none; } .ia-watch li { padding:8px 0; border-top:1px solid #1f2745; font-size:11.5px; color:#cfd4ea; line-height:1.5; } .ia-watch li:first-child { border-top:0; }
.ia-tip { box-sizing:border-box; width:min(320px, calc(100vw - 32px)); min-width:0; background:#0a1029; border:1px solid #4a5688; border-left:5px solid var(--tip,#b47bff); border-radius:10px; padding:12px 15px 13px; box-shadow:0 14px 40px #000a; pointer-events:none; overflow-wrap:anywhere; }
.ia-tip-title { font-size:15px; font-weight:700; color:#fff; line-height:1.35; letter-spacing:-.2px; } .ia-tip-sub { font:10px 'DM Mono',monospace; color:#9aa4c6; margin-top:4px; line-height:1.5; }
.ia-tip-rows { display:grid; grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr); gap:6px 12px; margin-top:10px; padding-top:10px; border-top:1px solid #2c3560; align-items:baseline; } .ia-tip-rows span { min-width:0; overflow-wrap:anywhere; }
.ia-tip-rows span:nth-child(odd) { font:10px 'DM Mono',monospace; color:#8f99ba; text-transform:uppercase; letter-spacing:.5px; } .ia-tip-rows span:nth-child(even) { font-size:13px; font-weight:700; color:#f2f4ff; text-align:right; }
.ia-tip-note { margin-top:10px; font-size:11px; color:#c3c9e4; line-height:1.5; }
.ia-rel { display:flex; flex-direction:column; } .ia-rel > div { padding:12px 0; border-top:1px solid #1f2745; } .ia-rel > div:first-child { border-top:0; padding-top:0; }
.ia-rel b { display:block; font-size:12.5px; color:#f1f3fb; } .ia-rel > div > span { display:block; font-size:11px; color:#aab2d0; margin-top:2px; } .ia-rel small { display:block; font:9.5px 'DM Mono',monospace; color:#7f89a8; margin-top:4px; line-height:1.5; }
.ia-fac { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; } .ia-fac i { font-style:normal; font-size:10px; color:#cfd6f3; background:#141c3d; border:1px solid #2b3560; border-radius:6px; padding:3px 8px; } .ia-fac em { font-style:normal; font-size:10px; color:#8f99ba; padding:3px 2px; }
.ia-facnote { margin-top:7px; font-size:10.5px; color:#9aa4c6; line-height:1.5; }
.ia-bl { list-style:none; margin:0; padding:0; } .ia-bl li { display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-top:1px solid #1f2745; font-size:11.5px; color:#cfd4ea; } .ia-bl li:first-child { border-top:0; } .ia-bl li b { font:600 12px 'DM Mono',monospace; }
@media (max-width:1100px) { .ia-g3, .ia-g2 { grid-template-columns:1fr; } }
`;

const C = { blue: '#7aa8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', orange: '#ff9a5c', grey: '#8992b1', grid: '#252d4b' };
const PRI_COLOR: Record<string, string> = { low: C.green, medium: C.amber, high: C.orange, critical: C.pink };
const axis = { stroke: '#8992b1', fontSize: 10 };
const xl = (value: string) => ({ value, position: 'insideBottom' as const, offset: -14, fill: C.grey, fontSize: 11 });
const yl = (value: string) => ({ value, angle: -90, position: 'insideLeft' as const, offset: -16, style: { textAnchor: 'middle' as const }, fill: C.grey, fontSize: 11 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type TipSpec = { title: string; sub?: string; rows: [string, ReactNode][]; color?: string; note?: string };

function RichTip({ active, payload, spec }: { active?: boolean; payload?: { payload?: Any }[]; spec: (p: Any) => TipSpec | null }) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const t = spec(payload[0].payload);
  if (!t) return null;
  return (
    <div className="ia-tip" style={{ ['--tip' as string]: t.color ?? '#b47bff' }}>
      <div className="ia-tip-title">{t.title}</div>
      {t.sub && <div className="ia-tip-sub">{t.sub}</div>}
      <div className="ia-tip-rows">{t.rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
      {t.note && <div className="ia-tip-note">{t.note}</div>}
    </div>
  );
}
const cursorBar = { fill: '#b47bff', fillOpacity: 0.12 };

function Chip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="ia-chip" style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>{children}</span>;
}
function Section({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="ia-sec"><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div>;
}

const COLS: { key: 'today' | 'this_week' | 'ask_medical_officer'; title: string; sub: string }[] = [
  { key: 'today', title: 'Today', sub: 'Steps for the next day' },
  { key: 'this_week', title: 'This week', sub: 'Things to put in place over the coming days' },
  { key: 'ask_medical_officer', title: 'Ask the medical officer', sub: 'What to bring to the medical conference' },
];

function PlanColumns({ plan }: { plan: Record<string, Any[]> }) {
  const cols = COLS.filter((c) => plan[c.key]?.length);
  return (
    <div className="ia-grid ia-g3" style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr))` }}>
      {cols.map((c) => (
        <Panel key={c.key} title={c.title} subtitle={c.sub} icon={<ListChecks size={18} className="purple-icon" />}>
          {plan[c.key].map((i, k) => (
            <div className="ia-step" key={`${i.action}-${k}`}>
              <p>{i.action}</p>
              <div className="ia-meta">
                <Chip color={PRI_COLOR[i.priority] ?? C.grey}>{i.priority}</Chip>
                {i.evidence && <EvidenceTag kind={i.evidence} />}
              </div>
              <div className="ia-why"><b>Because</b>{(i.because as string[]).slice(0, 3).join(' · ')}{i.because.length > 3 ? ` · +${i.because.length - 3} more` : ''}</div>
            </div>
          ))}
        </Panel>
      ))}
    </div>
  );
}

function Pressure({ rows }: { rows: Any[] }) {
  const [hot, setHot] = useState<number | null>(null);
  const data = rows.map((r) => ({ ...r, name: r.label }));
  return (
    <Panel title="Where the pressure comes from" subtitle="Alert weight per area: low 1, medium 2, high 4, critical 8. The longest bar is the place to start" icon={<BarChart3 size={18} className="purple-icon" />}>
      <div className="ia-chart" style={{ height: Math.max(220, 46 * data.length + 80) }} onMouseLeave={() => setHot(null)}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 22, bottom: 22 }} onMouseMove={(s: Any) => setHot(s?.activeTooltipIndex ?? null)}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" {...axis} allowDecimals={false} height={46} label={xl('Alert weight (low 1 · medium 2 · high 4 · critical 8)')} />
            <YAxis type="category" dataKey="name" {...axis} width={150} label={yl('Area')} />
            <Tooltip cursor={cursorBar} content={<RichTip spec={(d) => ({
              title: d.label, sub: `${d.alerts} alert${d.alerts === 1 ? '' : 's'} · worst ${d.worst}`, color: PRI_COLOR[d.worst],
              rows: [['Alert weight', String(d.score)], ['Share of all weight', `${Math.round(d.share * 100)}%`], ['Strongest alert', d.top ?? '—']],
              note: 'Weights are a design choice to show where alerts cluster, not a risk score.',
            })} />} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} onMouseEnter={(_d: unknown, i: number) => setHot(i)}>
              {data.map((r, i) => <Cell key={r.domain} fill={PRI_COLOR[r.worst]} fillOpacity={hot == null || hot === i ? 1 : 0.3} stroke={hot === i ? '#fff' : 'none'} strokeWidth={hot === i ? 2 : 0} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="ia-legend">{Object.entries(PRI_COLOR).map(([k, v]) => <span key={k}><i style={{ background: v }} />worst alert: {k}</span>)}</div>
    </Panel>
  );
}

function Links({ links }: { links: Any[] }) {
  return (
    <div className="ia-read">
      {links.map((l) => (
        <div className={`ia-card ${l.tone ?? 'mute'}`} key={l.id}>
          <div><b>{l.title}</b>{l.text}</div>
          {l.evidence && <div><EvidenceTag kind={l.evidence} /></div>}
        </div>
      ))}
    </div>
  );
}

/** The AI-written plan (Gemini first, Groq fallback), from the same alerts. */
function AiPlan({ req, titles }: { req: Any; titles: Record<string, string> }) {
  const base = useAI();   // the page's own AI call goes first; the free tiers need a gap between calls
  const run = async () => {
    let r = await getInsightsAdvice(req);
    const waits = [...(r.ai?.error ?? '').matchAll(/retry in (\d+)s/g)].map((m) => Number(m[1]));
    if (!r.ai?.result && waits.length) {
      await new Promise((res) => setTimeout(res, (Math.max(...waits) + 1) * 1000));
      r = await getInsightsAdvice(req);
    }
    return r;
  };
  const ai = useQuery({ queryKey: ['ia-ai', req], queryFn: run, enabled: !base.isFetching, retry: 0, staleTime: 60 * 60_000 });
  const result = ai.data?.ai?.result ?? null;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  const plan = result?.plan;
  const cols = COLS.filter((c) => plan?.[c.key]?.length);
  return (
    <>
      <Panel title="Your plan, written by the AI" subtitle={`From the same factor alerts${ai.data?.ai?.model ? ` · ${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : ''}`} icon={<Sparkles size={18} className="purple-icon" />}>
        <p className="av-rec-note">It only sees the alerts, never raw files or keys. It never changes a priority or the Good / Warning / Critical level, and each step above already has a rule-based version.</p>
        <div style={{ margin: '8px 0 12px' }}>
          <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>{ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again</button>
        </div>
        {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI to write the plan…</p>}
        {problem && !ai.isFetching && <p className="av-rec-note warn">The AI plan is not available right now ({problem}). The rule-based plan above still applies. Tap “Ask the AI again” in a moment.</p>}
        {result && (
          <>
            {result.summary && <p className="av-summary">{result.summary}</p>}
            {result.contact_medical_officer && <div className="av-callout"><PhoneCall size={17} /><div><b>Contact the mission medical officer.</b>{result.contact_reason && <p>{result.contact_reason}</p>}</div></div>}
            {(result.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
            {(result.key_findings ?? []).map((f) => <p className="av-rec-note" key={f}>• {f}</p>)}
            {(result.watch_next ?? []).length > 0 && <div className="av-sub-head">Keep an eye on</div>}
            {(result.watch_next ?? []).map((f) => <p className="av-rec-note" key={f}>• {f}</p>)}
            {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">Could not be checked</div>}
            {(result.data_gaps ?? []).map((g) => <p className="av-rec-note" key={g}>• {g}</p>)}
            <p className="av-rec-note">{result.disclaimer ?? ai.data?.disclaimer}</p>
          </>
        )}
      </Panel>
      {cols.length > 0 && (
        <div className="ia-grid ia-g3" style={{ marginTop: 14, gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
          {cols.map((c) => (
            <Panel key={c.key} title={`${c.title} · AI`} subtitle={c.sub} icon={<Sparkles size={18} className="purple-icon" />}>
              {plan![c.key].map((i, k) => (
                <div className="ia-step" key={`${i.action}-${k}`}>
                  <p>{i.action}</p>
                  <div className="ia-meta">
                    <Chip color={PRI_COLOR[i.priority ?? 'medium'] ?? C.grey}>{i.priority ?? 'medium'}</Chip>
                    {i.alert && <span className="muted" style={{ fontSize: 10 }}>for: {i.alert === 'all' ? 'all alerts together' : titles[i.alert] ?? i.alert}</span>}
                  </div>
                  {i.why && <div className="ia-why"><b>Because</b>{i.why}</div>}
                </div>
              ))}
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

function PlanFromFactors() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days: 30, language }), [astronautId, selection, language]);
  const q = useQuery({ queryKey: ['ia-plan', req], queryFn: () => getInsightsPlan(req), enabled: astronautId > 0, retry: 0, staleTime: 60_000 });
  const d = q.data;
  return (
    <>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} className="av-spin" /> Building the plan from every factor…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The factor plan could not be loaded. The page above still works.</p>}
      {d?.available && d.plan && d.headline && (
        <>
          <Section icon={<ListChecks size={17} />} title="Action plan from the factors" sub="Built from the same factor alerts as the Risk Alerts page: your logs, body-map reports, the selected sleep, HRV, blood and bone data, and the model flags. Steps that several alerts share are merged." />
          <div className="ia-kpis">
            {d.headline.alerts > 0 && <div><span>Alerts behind the plan</span><b>{d.headline.alerts}</b><small>Across {d.headline.areas} area{d.headline.areas === 1 ? '' : 's'}</small></div>}
            {d.headline.start_with && <div><span>Start with</span><b style={{ fontSize: 15, lineHeight: 1.3 }}>{d.headline.start_with}</b><small>{Math.round((d.headline.start_share ?? 0) * 100)}% of the alert weight</small></div>}
            {d.headline.to_medical_officer > 0 && <div><span>For the medical officer</span><b style={{ color: C.orange }}>{d.headline.to_medical_officer}</b><small>High priority or lasting</small></div>}
          </div>
          <PlanColumns plan={d.plan} />
          {(d.pressure?.length ?? 0) > 0 && d.pressure && <div className="ia-gap"><Pressure rows={d.pressure} /></div>}
          {d.links && d.links.length > 0 && (
            <>
              <Section icon={<Network size={17} />} title="How the factors connect" sub="Patterns found by rules across the alerts. They are associations, not proof of cause." />
              <Links links={d.links} />
            </>
          )}
          {d.watch && d.watch.length > 0 && (
            <div className="ia-gap">
              <Panel title="Keep an eye on" subtitle="Close to their line but not over it, so no alert yet" icon={<Network size={18} className="icon-muted" />}>
                <ul className="ia-watch">{d.watch.map((w: Any) => <li key={w.factor}>{w.text}</li>)}</ul>
              </Panel>
            </div>
          )}
          {d.alert_titles && Object.keys(d.alert_titles).length > 0 && <AiPlan req={req} titles={d.alert_titles} />}
          <p className="ia-note">{d.disclaimer}</p>
        </>
      )}
    </>
  );
}


/* ---- replaces "Could not be checked": how close each check is to its flag line, and what moved most from your own baseline ---- */

const CHECKS: { key: string; label: string; line: number; shown: (v: number) => string; lineText: string; evidence: string }[] = [
  { key: 'P_poor_sleep', label: 'Poor-sleep model', line: 0.5, shown: (v) => v.toFixed(2), lineText: 'flag above 0.50', evidence: 'weak' },
  { key: 'predicted_daily_stress', label: 'Daily stress score', line: 50, shown: (v) => v.toFixed(0), lineText: 'flag above 50', evidence: 'weak' },
  { key: 'hrv_anomaly_frac', label: 'Unusual HRV windows', line: 0.1, shown: (v) => `${(v * 100).toFixed(1)}%`, lineText: 'flag above 10%', evidence: 'strong' },
  { key: 'P_R+1_like_insp4_blood', label: 'Blood vs post-flight (Inspiration4)', line: 0.5, shown: (v) => v.toFixed(2), lineText: 'flag above 0.50', evidence: 'strong' },
  { key: 'P_R+1_like_osd571_blood', label: 'Metabolomics vs post-flight (OSD-571)', line: 0.5, shown: (v) => v.toFixed(2), lineText: 'flag above 0.50', evidence: 'strong' },
];
const reachColor = (r: number) => (r >= 100 ? C.pink : r >= 75 ? C.amber : C.green);


function levelMover(day: DayResult) {
  const strong = day.check_day.n_strong_flags, weak = day.check_day.n_weak_flags, lvl = day.level;
  const now = `Now: ${strong} strong and ${weak} weak flag${strong + weak === 1 ? '' : 's'}, level ${String(lvl).toUpperCase()}.`;
  if (lvl === 'red') return `${now} Red means tell the mission medical officer today.`;
  if (strong + weak === 0) return `${now} One flag from any check would turn it amber.`;
  if (strong >= 1) return `${now} Any second flag, weak or strong, would turn it red.`;
  return `${now} A strong-evidence flag (unusual HRV, blood that looks post-flight) would turn it red; another weak flag alone would stay amber.`;
}

function CloseToLine({ day }: { day: DayResult }) {
  const [hot, setHot] = useState<number | null>(null);
  const scores = (day.check_day.scores ?? {}) as Record<string, number | undefined>;
  const rows = CHECKS.filter((c) => typeof scores[c.key] === 'number').map((c) => {
    const v = scores[c.key] as number;
    return { ...c, value: v, reach: Math.round((v / c.line) * 100) };
  });
  const changes = (day.baseline_changes ?? []).slice(0, 4);
  if (!rows.length && !changes.length) return null;
  const closest = [...rows].sort((a, b) => b.reach - a.reach)[0];
  const over = rows.filter((r) => r.reach >= 100);
  const max = Math.ceil(Math.max(125, ...rows.map((r) => r.reach + 5)) / 25) * 25;
  const ticks = Array.from({ length: max / 25 + 1 }, (_, i) => i * 25);
  return (
    <Panel title="How close is each check to its flag line?" subtitle="100% = the line where the check raises a flag. Strong-evidence checks weigh more than weak ones" icon={<Gauge size={18} className="purple-icon" />}>
      {closest && (
        <p className="av-rec-note" style={{ marginTop: 0 }}>
          {over.length ? `${over.length} check${over.length === 1 ? ' is' : 's are'} over the line (${over.map((r) => r.label.toLowerCase()).join(', ')}). ` : 'No check is over its line. '}
          {closest.reach >= 100 ? '' : `Closest: ${closest.label.toLowerCase()} at ${closest.reach}% of its line, ${closest.evidence} evidence.`}
        </p>
      )}
      {rows.length > 0 && (
        <div className="ia-chart" style={{ height: Math.max(200, 52 * rows.length + 84) }} onMouseLeave={() => setHot(null)}>
          <ResponsiveContainer>
            <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 18, left: 22, bottom: 22 }} onMouseMove={(st: Any) => setHot(st?.activeTooltipIndex ?? null)}>
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" {...axis} domain={[0, max]} ticks={ticks} height={46} tickFormatter={(v) => `${v}%`} label={xl('Share of the flag line reached (100% = flag raised)')} />
              <YAxis type="category" dataKey="label" {...axis} width={170} label={yl('Check')} />
              <ReferenceLine x={100} stroke={C.amber} strokeDasharray="4 4" label={{ value: 'flag line', fill: C.amber, fontSize: 10, position: 'top' }} />
              <Tooltip cursor={cursorBar} content={<RichTip spec={(d) => ({
                title: d.label, sub: `${d.evidence} evidence`, color: reachColor(d.reach),
                rows: [['Value now', d.shown(d.value)], ['Flag line', d.lineText.replace('flag ', '')], ['Reached', `${d.reach}% of the line`], ['Status', d.reach >= 100 ? 'Flag raised' : `${100 - d.reach}% of room left`]],
                note: d.evidence === 'strong' ? 'A strong-evidence flag can turn the level amber or red on its own.' : 'A weak-evidence flag is a prompt, not a finding.',
              })} />} />
              <Bar dataKey="reach" radius={[0, 4, 4, 0]} onMouseEnter={(_d: unknown, i: number) => setHot(i)}>
                {rows.map((r, i) => <Cell key={r.key} fill={reachColor(r.reach)} fillOpacity={hot == null || hot === i ? 1 : 0.3} stroke={hot === i ? '#fff' : 'none'} strokeWidth={hot === i ? 2 : 0} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="av-sub-head">What would move the level</div>
      <p className="av-rec-note" style={{ marginTop: 4 }}>{levelMover(day)}</p>
      <p className="av-rec-note">Rule: one flag is amber; two flags, or one strong plus one weak, is red. Weak flags alone never reach red.</p>
      {changes.length > 0 && (
        <>
          <div className="av-sub-head">Biggest changes from your own pre-flight values</div>
          <ul className="ia-bl">{changes.map((c) => <li key={c.marker}><span>{c.marker.replace(/_/g, ' ')}</span><b style={{ color: Math.abs(c.percent_change) >= 30 ? C.amber : '#dfe3f3' }}>{c.percent_change > 0 ? '+' : c.percent_change < 0 ? '−' : ''}{Math.abs(c.percent_change).toFixed(0)}%</b></li>)}</ul>
        </>
      )}
    </Panel>
  );
}

/* ---- model list: what each model looks at, without accuracy or R² ---- */

const ACR: Record<string, string> = { hrv: 'HRV', rr: 'RR', rmssd: 'RMSSD', sdnn: 'SDNN', pnn50: 'pNN50', hr: 'HR', bpm: 'bpm', stai1: 'STAI-1', stai2: 'STAI-2', panas: 'PANAS', bmi: 'BMI', alt: 'ALT', ast: 'AST', waso: 'WASO', mmash: 'MMASH', cbc: 'CBC', cmp: 'CMP', wbc: 'WBC', rbc: 'RBC', mpv: 'MPV', crp: 'CRP', dxa: 'DXA' };
const nice = (c: string) => {
  const t = c.replace(/^(serum|cbc|ANP|RP_MTBE)__/, '').replace(/_(value|percent|ms|bpm|minutes)$/, ' ($1)').replace(/_/g, ' ').trim();
  const words = t.split(' ').map((w) => ACR[w.toLowerCase()] ?? w);
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
};
const cleanStatus = (t: string | null) => {
  if (!t) return '';
  const noParen = t.replace(/\s*\([^)]*(?:R2|R²|accuracy)[^)]*\)/gi, '');
  const keep = noParen.split(/(?<=\.)\s+/).filter((x) => !/accuracy|R2|R²/i.test(x));
  return keep.join(' ').trim();
};

function ModelFactors({ items }: { items: Reliability[] }) {
  const models = useModels();
  const info = new Map<string, Any>(((models.data ?? []) as Any[]).map((m) => [m.model, m]));
  if (!items.length) return <p className="muted">No model ran for this selection.</p>;
  return (
    <div className="ia-rel">
      {items.map((m) => {
        const f: Any = info.get(m.model) ?? {};
        const factors: string[] = f.factors ?? [];
        const total: number | null = f.factor_count ?? (factors.length || null);
        const shown = factors.slice(0, 6);
        return (
          <div key={m.model}>
            <b>{m.model}</b>
            <span>{m.predicts}</span>
            <small>Population: {m.population ?? 'unknown'}</small>
            {cleanStatus(m.status) && <small className="av-status-text">{cleanStatus(m.status)}</small>}
            {(shown.length > 0 || f.factor_note) && (
              <>
                <div className="ia-fac">
                  {shown.map((c) => <i key={c}>{nice(c)}</i>)}
                  {total && total > shown.length && <em>+{(total - shown.length).toLocaleString()} more</em>}
                </div>
                {f.factor_note && <div className="ia-facnote">{f.factor_note}</div>}
              </>
            )}
            {total != null && <small>{total.toLocaleString()} factor{total === 1 ? '' : 's'} read by this model</small>}
          </div>
        );
      })}
    </div>
  );
}

export function InsightsPage() {
  const ai = useAI();
  const language = useRunStore((s) => s.language);
  const setLanguage = useRunStore((s) => s.setLanguage);
  const block = ai.data?.ai;
  const result = block?.result;
  return (
    <section className="page-enter">
      <style>{IA_CSS}</style>
      <PageHeader eyebrow="DECISION SUPPORT" title="Insights & Actions" intro="The AI reads every model result together and explains the whole picture. It follows the rules: it never changes the level and never diagnoses."
        right={
          <div className="av-btn-row">
            <select className="select-control" value={language} onChange={(e) => setLanguage(e.target.value as Language)} aria-label="Language">
              <option value="en">English</option><option value="roman-urdu">Roman Urdu</option>
            </select>
            <button className="primary-button" onClick={() => ai.refetch()} disabled={ai.isFetching}>{ai.isFetching ? <Loader2 size={14} className="av-spin" /> : <RefreshCw size={14} />} Regenerate</button>
          </div>
        } />
      <DataGate>
        {(day) => (
          <>
            <WarningList day={day} />
            <Panel title="Summary" subtitle={block ? `Source: ${block.source}${block.model ? ` · ${block.model}` : ''}${block.cached ? ' · cached' : ''}` : 'Waiting for the AI'} icon={<Sparkles size={18} className="purple-icon" />}>
              {ai.isLoading && <p className="muted"><Loader2 size={13} className="av-spin" /> Asking the AI… this can take a few seconds.</p>}
              {ai.isError && <p className="av-rec-note warn">Could not get AI recommendations: {(ai.error as Error).message}</p>}
              {block && !result && <p className="av-rec-note warn">AI unavailable: {block.error ?? 'no provider answered'}. The rule-based recommendations below are still valid.</p>}
              {result && (
                <>
                  <p className="av-summary">{result.summary}</p>
                  {result.contact_medical_officer && <div className="av-callout"><PhoneCall size={16} /><div><b>Contact the mission medical officer.</b><p>{result.contact_reason}</p></div></div>}
                </>
              )}
            </Panel>

            {!!result?.key_findings?.length && (
              <Panel title="Key findings" subtitle="With the evidence level of each model" className="av-gap-top">
                <ul className="av-list">{result.key_findings.map((f) => <li key={f}>{f}</li>)}</ul>
              </Panel>
            )}

            <Panel title="Recommended actions" subtitle="Ordered by priority" className="av-gap-top">
              {result?.recommendations?.length ? result.recommendations.map((r, i) => (
                <div className="av-rec-item" key={`${r.action}-${i}`}>
                  <p>{r.action}</p>
                  <div className="av-rec-meta"><span className="av-tag av-tag-proxy">{r.domain}</span><span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span><EvidenceTag kind={r.evidence} /></div>
                </div>
              )) : <p className="muted">No AI actions available.</p>}
              <div className="av-rec-group">Rule-based steps (always available)</div>
              {day.check_day.recommendations.map((r) => <div className="av-rec-item" key={r}><p>{r}</p></div>)}
            </Panel>

            <PlanFromFactors />

            <div className="dashboard-grid av-gap-top">
              <CloseToLine day={day} />
              <Panel title="How reliable is each model?" subtitle="Who it was trained on and how well it works">
                <ModelFactors items={day.model_reliability} />
              </Panel>
            </div>
            {block && block.attempts.length > 0 && (
              <Notice><div><b>AI providers tried</b>{block.attempts.map((a) => <p key={a.provider}>{a.provider}: {a.ok ? 'answered' : `failed (${a.error})`}</p>)}</div></Notice>
            )}
            <Notice><p>{result?.disclaimer ?? day.disclaimer}</p></Notice>
          </>
        )}
      </DataGate>
    </section>
  );
}
