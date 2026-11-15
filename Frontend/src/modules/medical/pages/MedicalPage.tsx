import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, ClipboardCopy, EyeOff, FileText, Loader2, PhoneCall, RefreshCw, ShieldAlert, Sparkles, Stethoscope, TrendingUp, WifiOff } from 'lucide-react';
import { useAI, useModels, useSubjects } from '../../../hooks/useAstro';
import { checkDay, getMedicalAdvice, getMedicalInsight } from '../../../services/ml.service';
import { EvidenceTag, Notice, PageHeader, Panel, Stat } from '../../../shared/components/live';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { useRunStore } from '../../../store/useRunStore';
import { AL_CSS, C, Chip, PRI_COLOR, RichTip, Section, axis, cursorBar, xl, yl } from '../../alerts/pages/AlertsPage';
import type { DayRequest } from '../../../types/ml';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const LEVEL_TXT: Record<string, string> = { green: 'Good', amber: 'Warning', red: 'Critical', unknown: 'Not enough data' };
function LevelChip({ level }: { level: string }) {
  return <span className={`av-level av-level-${level}`}>{LEVEL_TXT[level] ?? level}</span>;
}
const TREND_HEX: Record<string, string> = { worse: C.orange, steady: C.blue, better: C.green };
const TONE: Record<string, string> = { ok: C.green, warn: C.amber, bad: C.pink, mute: C.blue };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dlab = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };

/* ==========================================================================================================
   MEDICAL OFFICER BRIEFING · reuses the Risk Alerts engine. POST /ml/medical-insight gives the patient summary, alert queue, trends against
   the astronaut's OWN earlier days, a follow-up plan, an SBAR handover note and the data this review cannot see; POST
   /ml/medical-recommendations is the AI brief (Gemini, then Groq). The scenarios table and model register below are the page as it was.
   ========================================================================================================== */
function TrendChart({ trends }: { trends: Any[] }) {
  const [hot, setHot] = useState<string | null>(null);
  const tip = (p: Any) => ({ title: p.label, sub: `Last ${p.days_recent} logged days against ${p.days_earlier} earlier days`, color: TREND_HEX[p.status],
    rows: [['Recent average', `${p.recent} ${p.unit}`], ['Earlier average', `${p.earlier} ${p.unit}`], ['Change', `${p.pct > 0 ? '+' : ''}${p.pct}%`], ['Against own spread', `${p.z > 0 ? '+' : ''}${p.z}`]] as [string, string][],
    note: p.status === 'worse' ? 'Moved the unhealthy way by more than one of the astronaut\'s own spreads.' : p.status === 'better' ? 'Moved the healthy way by more than one of the astronaut\'s own spreads.' : 'Inside the astronaut\'s usual day-to-day spread.' });
  const LIM = 60;   // bars are capped at +/-60% so one large swing does not flatten the rest; the hover card shows the true change
  const data = trends.map((t) => ({ ...t, plot: Math.max(-LIM, Math.min(LIM, t.pct)) }));
  return (
    <Panel title="Trends against the astronaut's own baseline" subtitle="Last logged days against the earlier days. Orange moved the unhealthy way, green the healthy way, blue is steady" icon={<TrendingUp size={18} className="icon-muted" />}>
      <div className="al-chart" style={{ height: Math.max(260, trends.length * 34 + 70) }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 22, left: 22, bottom: 30 }} onMouseMove={(e: Any) => setHot(e?.activePayload?.[0]?.payload?.key ?? null)} onMouseLeave={() => setHot(null)}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" domain={[-LIM, LIM]} ticks={[-60, -30, 0, 30, 60]} tick={axis} unit="%" label={xl('Change against own earlier days (%, capped at 60)')} />
            <YAxis type="category" dataKey="label" tick={axis} width={150} label={yl('Measure')} />
            <Tooltip cursor={cursorBar} wrapperStyle={{ outline: 'none', zIndex: 20 }} content={<RichTip spec={tip} />} />
            <ReferenceLine x={0} stroke="#8992b1" />
            <Bar dataKey="plot" radius={3} maxBarSize={22} isAnimationActive={false}>
              {data.map((t) => <Cell key={t.key} fill={TREND_HEX[t.status]} fillOpacity={hot && hot !== t.key ? 0.3 : 1} stroke={hot === t.key ? '#fff' : 'none'} strokeWidth={hot === t.key ? 1.5 : 0} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function Handover({ note }: { note: Any[] }) {
  const [copied, setCopied] = useState(false);
  const text = note.map((n) => `${n.label}: ${n.text}`).join('\n');
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  return (
    <Panel title="Handover note (SBAR)" subtitle="Situation, background, assessment, recommendation. Written from the alerts, trends and data coverage, ready to copy" icon={<FileText size={18} className="icon-muted" />}>
      {note.map((n) => <div className="al-do" style={{ marginTop: 8 }} key={n.k}><b>{n.label}</b>{n.text}</div>)}
      <div style={{ marginTop: 12 }}><button className="av-ghost-btn" onClick={copy}><ClipboardCopy size={13} /> {copied ? 'Copied' : 'Copy note'}</button></div>
    </Panel>
  );
}

function MedicalAdvice({ req, ready }: { req: Any; ready: Any }) {
  const base = useAI();   // the page's own AI call goes first; the free tiers need a gap between calls
  const run = async () => {
    let r = await getMedicalAdvice(req);
    const waits = [...(r.ai?.error ?? '').matchAll(/retry in (\d+)s/g)].map((m) => Number(m[1]));
    if (!r.ai?.result && waits.length) {   // "called too recently": wait the time the backend asked for, then ask once more
      await new Promise((res) => setTimeout(res, (Math.max(...waits) + 1) * 1000));
      r = await getMedicalAdvice(req);
    }
    return r;
  };
  const ai = useQuery({ queryKey: ['md-ai', req], queryFn: run, enabled: !base.isFetching, retry: 0, staleTime: 60 * 60_000 });
  const result = (ai.data?.ai?.result ?? null) as Any;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  const dom: Record<string, string> = { follow_up: 'follow up', ask_crew: 'ask the crew', review: 'review', data: 'data' };
  return (
    <Panel title="Medical officer brief · AI" subtitle={`Written by the AI from the alerts, trends and data coverage above${ai.data?.ai?.model ? ` · ${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : ''}`} icon={<Sparkles size={18} className="purple-icon" />}>
      <p className="av-rec-note">It only sees the alerts, trends and coverage, never raw files or keys, and it never changes the verdict ({ready.label}) or a priority. A clinician decides.</p>
      <div style={{ margin: '8px 0 12px' }}>
        <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>{ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again</button>
      </div>
      {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for the brief…</p>}
      {problem && !ai.isFetching && <p className="av-rec-note warn">AI recommendations are not available right now ({problem}). The rule-based queue, follow-up plan and handover note above still apply. Tap “Ask the AI again” in a moment.</p>}
      {result && (
        <>
          {result.summary && <p className="av-summary">{result.summary}</p>}
          {result.contact_medical_officer && <div className="av-callout"><PhoneCall size={17} /><div><b>Escalate to the mission medical officer.</b>{result.contact_reason && <p>{result.contact_reason}</p>}</div></div>}
          {(result.recommendations ?? []).map((r: Any, i: number) => (
            <div className="av-rec-item" key={`${r.action}-${i}`}>
              <p>{r.action}</p>
              <div className="av-rec-meta">
                <span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span>
                {r.evidence && <EvidenceTag kind={r.evidence} />}
                <span className="muted" style={{ fontSize: 10 }}>{dom[r.domain] ?? r.domain}{r.alert && r.alert !== 'all' ? ` · alert ${r.alert}` : ''}</span>
              </div>
            </div>
          ))}
          {(result.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
          {(result.key_findings ?? []).map((f: string) => <p className="av-rec-note" key={f}>• {f}</p>)}
          {(result.watch_next ?? []).length > 0 && <div className="av-sub-head">Look at again</div>}
          {(result.watch_next ?? []).map((f: string) => <p className="av-rec-note" key={f}>• {f}</p>)}
          {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">What would sharpen the review</div>}
          {(result.data_gaps ?? []).map((g: string) => <p className="av-rec-note" key={g}>• {g}</p>)}
          <p className="av-rec-note">{result.disclaimer ?? ai.data?.disclaimer}</p>
        </>
      )}
    </Panel>
  );
}

function MedicalBrief() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days: 30, language }), [astronautId, selection, language]);
  const q = useQuery({ queryKey: ['md-insight', req], queryFn: () => getMedicalInsight(req), enabled: astronautId > 0, retry: 0, staleTime: 60_000 });
  const d = q.data;
  const r = d?.readiness;
  const m = d?.mission;
  const k = d?.kpis;
  return (
    <>
      <style>{AL_CSS + '.md-col{display:flex;flex-direction:column;gap:14px;min-width:0}.md-col .panel{flex:1 1 auto;height:auto;margin-bottom:0}'}</style>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} className="av-spin" /> Preparing the medical briefing…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The medical briefing could not be loaded. The tables below still work.</p>}
      {d && r && (
        <>
          <Section icon={<Stethoscope size={17} />} title="Medical officer briefing" sub="One astronaut, built from the same factor alerts as the Risk Alerts page: who they are, what is wrong first, how they compare with their own earlier days, when to look again and a note ready to hand over." />
          <div className="al-card" style={{ borderLeftColor: TONE[r.tone], marginBottom: 14 }}>
            <div>
              <b style={{ color: TONE[r.tone], fontSize: 16 }}>{r.label}</b>
              {[m?.name, m?.age != null ? `${m.age} years` : null, m?.sex, m?.bmi != null ? `BMI ${m.bmi} (${m.bmi_class})` : null, d.journey ? `${d.journey.headline.split(' · ')[0]} · ${d.journey.phase_label}` : null, m?.destination].filter(Boolean).join(' · ')}
              <div style={{ marginTop: 6, color: '#cfd4ea' }}>{r.text}</div>
            </div>
          </div>
          {m?.data_issues && m.data_issues.map((x: string) => <p className="av-rec-note warn" key={x}>{x}</p>)}
          <div className="al-kpis">
            {k.alerts > 0 && <div><span>Alerts</span><b style={{ color: PRI_COLOR[k.highest ?? 'low'] }}>{k.alerts}</b><small>Highest {k.highest}</small></div>}
            {k.watch > 0 && <div><span>Close to a line</span><b style={{ color: C.amber }}>{k.watch}</b><small>Within 10% of a line</small></div>}
            {d.trends && k.worse > 0 && <div><span>Worse than own baseline</span><b style={{ color: C.orange }}>{k.worse}</b><small>{k.better} better · {d.trends.length - k.worse - k.better} steady</small></div>}
            <div><span>Data sources</span><b>{k.coverage}</b><small>Feeding this review</small></div>
            <div><span>Escalate</span><b style={{ color: k.contact ? C.pink : C.green }}>{k.contact ? 'Yes' : 'No'}</b><small>{k.contact ? 'Rules say contact the medical officer' : 'Not required by the rules'}</small></div>
          </div>
          <div className="al-grid al-g2e">
            {d.queue ? (
              <Panel title="Alert queue" subtitle="Highest priority first. What was measured, the line, how long it has lasted and the step to take" icon={<ShieldAlert size={18} className="icon-muted" />}>
                {d.queue.map((a: Any) => (
                  <div className="al-item" key={a.id}>
                    <div><Chip color={PRI_COLOR[a.priority]}>{a.priority}</Chip></div>
                    <div>
                      <h4>{a.title}</h4>
                      <div className="al-meta">
                        <span>area <i>{a.domain}</i></span>
                        {a.observed != null && a.kind !== 'compound' && <span>measured <i>{a.observed}{a.unit ? ` ${a.unit}` : ''}</i></span>}
                        <span>line <i>{a.line}</i></span>
                        {a.run > 1 && a.kind === 'reading' && <span>lasted <i>{a.run} readings</i></span>}
                        {a.since && <span>since <i>{dlab(a.since)}</i></span>}
                        <EvidenceTag kind={a.evidence} />
                      </div>
                      <div className="al-do"><b>Step</b>{a.action}</div>
                    </div>
                  </div>
                ))}
              </Panel>
            ) : <div />}
            <div className="md-col">
              {d.trends && <TrendChart trends={d.trends} />}
              <Handover note={d.handover} />
            </div>
          </div>
          {d.follow_up && (
            <div className="al-gap">
              <Panel title="Follow-up plan" subtitle="When each alert and each close-to-the-line factor should be looked at again, and by whom. The step for each is in the alert queue above" icon={<CalendarClock size={18} className="icon-muted" />}>
                <div className="al-wrap">
                  <table className="al-tbl">
                    <thead><tr><th>When</th><th>Look at</th><th>Priority</th><th>Who</th></tr></thead>
                    <tbody>
                      {d.follow_up.map((f: Any, i: number) => (
                        <tr key={`${f.title}-${i}`}>
                          <td>{f.when}</td>
                          <td>{f.title}</td>
                          <td><Chip color={f.priority === 'watch' ? C.amber : PRI_COLOR[f.priority]}>{f.priority}</Chip></td>
                          <td>{f.who}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
          {d.blind_spots && (
            <Panel title="What this review cannot see" subtitle="Data sources that are missing, what each would add and how to add it" icon={<EyeOff size={18} className="icon-muted" />}>
              {d.blind_spots.map((b: Any) => <div className="al-do" style={{ marginTop: 8 }} key={b.label}><b>{b.label}</b>{b.how} Adds: {b.unlocks}.</div>)}
            </Panel>
          )}
          <div className="al-gap" style={{ marginTop: 14 }}><MedicalAdvice req={req} ready={r} /></div>
          <p className="al-note">{d.disclaimer}</p>
          <div className="av-gap-top" />
        </>
      )}
    </>
  );
}


export function MedicalPage() {
  const subjects = useSubjects();
  const models = useModels();
  const chooseScenario = useRunStore((s) => s.chooseScenario);
  const navigate = useNavigate();
  const scenarios = subjects.data?.scenarios ?? [];
  const runs = useQueries({
    queries: scenarios.map((s) => ({ queryKey: ['ml-day', { scenario_id: s.scenario_id, subject_id: null, mmash_user: null, hrv_user: null, blood_astronaut: null, timepoint: null, exercise_minutes: null, steps: null, bone_profile: null }], queryFn: () => checkDay({ scenario_id: s.scenario_id }), staleTime: 5 * 60_000, retry: 0 })),
  });
  const rows = scenarios.map((s, i) => ({ s, r: runs[i]?.data, loading: runs[i]?.isLoading, err: runs[i]?.error as Error | null }));
  const red = rows.filter((x) => x.r?.level === 'red').length;
  const amber = rows.filter((x) => x.r?.level === 'amber').length;
  return (
    <section className="page-enter">
      <PageHeader eyebrow="AUTHORIZED MEDICAL VIEW" title="Medical View" intro="Every scenario in the backend crew file at a glance, plus the honest status of every model." />
      <MedicalBrief />
      <div className="metric-grid four">
        {scenarios.length > 0 && <Stat icon={<Stethoscope size={18} />} label="SCENARIOS REVIEWED" value={scenarios.length} sub="From the crew file" />}
        {red > 0 && <Stat icon={<ShieldAlert size={18} />} label="CRITICAL" value={red} tone="bad" sub="Medical officer needed today" />}
        {amber > 0 && <Stat label="WARNING" value={amber} tone="warn" sub="Check again tomorrow" />}
        {models.data && models.data.some((m) => m.loaded) && <Stat label="MODELS LOADED" value={models.data.filter((m) => m.loaded).length} unit={`of ${models.data.length}`} sub="Saved .pkl files" />}
      </div>
      <Panel title="Crew scenarios" subtitle="Select a row to open it in every page">
        {scenarios.length === 0 && <p className="muted">The backend lists no scenarios. Add data/profiles/crew_map.json to the backend.</p>}
        {scenarios.length > 0 && (
          <div className="av-table-wrap">
            <table className="av-table">
              <thead><tr><th>Scenario</th><th>Level</th><th>Strong</th><th>Weak</th><th>No data</th><th>Reasons</th></tr></thead>
              <tbody>
                {rows.map(({ s, r, loading, err }) => (
                  <tr key={s.scenario_id} className="av-row-click" onClick={() => { chooseScenario(s.scenario_id); navigate('/'); }}>
                    <td>{s.scenario_id}</td>
                    <td>{loading ? 'Checking' : err ? 'Could not run' : r ? <LevelChip level={r.level} /> : 'Not run'}</td>
                    <td>{r?.check_day.n_strong_flags ?? 0}</td>
                    <td>{r?.check_day.n_weak_flags ?? 0}</td>
                    <td>{r?.check_day.missing.length ?? 0}</td>
                    <td>{err ? err.message : r?.check_day.flags.join(' · ') || (r?.level === 'unknown' ? 'Nothing to check: this scenario has no data selected.' : loading ? 'Running the models' : 'Every checked area is inside its line.')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <div className="av-gap-top" />
      <Panel title="Model register" subtitle="What each model predicts, who it was trained on, and how honest the result is">
        <div className="av-table-wrap">
          <table className="av-table">
            <thead><tr><th>Model</th><th>Predicts</th><th>Trained on</th><th>Status</th></tr></thead>
            <tbody>{(models.data ?? []).map((m) => <tr key={m.model}><td>{m.model}{!m.loaded && <span className="av-tag av-tag-weak">not loaded</span>}</td><td>{m.predicts}</td><td>{m.population}</td><td>{m.status}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
    </section>
  );
}
