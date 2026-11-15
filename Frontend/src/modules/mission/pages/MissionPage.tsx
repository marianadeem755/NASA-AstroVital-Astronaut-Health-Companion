import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, CheckCircle2, Cpu, Database, Gauge, Globe2, Rocket as RocketIcon, ListChecks, Loader2, PhoneCall, RefreshCw, Rocket, ShieldAlert, Sparkles, UserRound, WifiOff } from 'lucide-react';
import { useDay, useMlStatus, useSubjects, useAI } from '../../../hooks/useAstro';
import { getMissionAdvice, getMissionInsight, saveMissionProfile } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { useRunStore } from '../../../store/useRunStore';
import { EvidenceTag, Kv, Notice, PageHeader, Panel } from '../../../shared/components/live';
import { AL_CSS, C, Chip, PRI_COLOR, RichTip, Section, axis, cursorBar, xl, yl } from '../../alerts/pages/AlertsPage';
import type { DayRequest } from '../../../types/ml';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const TONE: Record<string, string> = { ok: C.green, warn: C.amber, bad: C.pink, mute: C.blue };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dlab = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };

/* ==========================================================================================================
   MISSION READINESS · reuses the Risk Alerts engine. POST /ml/mission-insight gives the verdict, data coverage, logging rhythm,
   astronaut record, models and AI providers; POST /ml/mission-recommendations is the AI brief (Gemini, then Groq). The panels
   from the page as it was stay above, unchanged.
   ========================================================================================================== */
const OVER = { over: C.orange, near: C.amber, ok: C.green };
const OVER_TXT: Record<string, string> = { over: 'over the line', near: 'close to the line', ok: 'inside the line' };

function MissionCharts({ areas, pressure }: { areas: Any[] | null; pressure: Any[] | null }) {
  const [hotA, setHotA] = useState<string | null>(null);
  const [hotP, setHotP] = useState<string | null>(null);
  const aTip = (p: Any) => ({ title: p.label, sub: `${p.total} factor${p.total > 1 ? 's' : ''} checked in this area`, color: p.over ? C.orange : p.near ? C.amber : C.green,
    rows: [['Over the line', String(p.over)], ['Close to the line', String(p.near)], ['Inside the line', String(p.ok)]] as [string, string][],
    note: p.names.length ? `Over the line: ${p.names.join(', ')}.` : p.near ? 'Nothing over a line here, but something is within 10% of one.' : 'Every factor here is inside its healthy line.' });
  const pTip = (p: Any) => ({ title: p.label, sub: `${p.alerts} alert${p.alerts > 1 ? 's' : ''} · weight ${p.score}`, color: PRI_COLOR[p.worst] ?? C.violet,
    rows: [['Share of all pressure', `${Math.round(p.share * 100)}%`], ['Worst priority', p.worst]] as [string, string][],
    note: p.top ? `Most serious: ${p.top}.` : undefined });
  const bar = (key: 'over' | 'near' | 'ok') => (
    <Bar dataKey={key} name={OVER_TXT[key]} stackId="s" fill={OVER[key]} maxBarSize={46} isAnimationActive={false}>
      {(areas ?? []).map((r) => <Cell key={r.domain} fill={OVER[key]} fillOpacity={hotA && hotA !== r.domain ? 0.3 : 1} stroke={hotA === r.domain ? '#fff' : 'none'} strokeWidth={hotA === r.domain ? 1.5 : 0} />)}
    </Bar>
  );
  if (!areas && !pressure) return null;
  return (
    <div className="al-grid al-g2e">
      {areas && (
        <Panel title="What the verdict rests on" subtitle="Every factor checked, by area: over its line, close to it or inside it. Hover an area for the factors" icon={<Gauge size={18} className="icon-muted" />}>
          <div className="al-chart" style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={areas} margin={{ top: 8, right: 12, bottom: 42, left: 8 }} onMouseMove={(e: Any) => setHotA(e?.activePayload?.[0]?.payload?.domain ?? null)} onMouseLeave={() => setHotA(null)}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} interval={0} angle={-20} textAnchor="end" height={70} label={xl('Area checked')} />
                <YAxis tick={axis} allowDecimals={false} label={yl('Factors checked')} />
                <Tooltip cursor={cursorBar} wrapperStyle={{ outline: 'none', zIndex: 20 }} content={<RichTip spec={aTip} />} />
                <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 10 }} />
                {bar('over')}{bar('near')}{bar('ok')}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
      {pressure && (
        <Panel title="Where the pressure comes from" subtitle="Alert weight per area (low 1, medium 2, high 4, critical 8). The longest bar is where the suggestions start" icon={<ShieldAlert size={18} className="icon-muted" />}>
          <div className="al-chart" style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={pressure} layout="vertical" margin={{ top: 8, right: 16, left: 22, bottom: 30 }} onMouseMove={(e: Any) => setHotP(e?.activePayload?.[0]?.payload?.domain ?? null)} onMouseLeave={() => setHotP(null)}>
                <CartesianGrid stroke={C.grid} horizontal={false} />
                <XAxis type="number" tick={axis} allowDecimals={false} label={xl('Alert weight')} />
                <YAxis type="category" dataKey="label" tick={axis} width={150} label={yl('Area')} />
                <Tooltip cursor={cursorBar} wrapperStyle={{ outline: 'none', zIndex: 20 }} content={<RichTip spec={pTip} />} />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} maxBarSize={30} isAnimationActive={false}>
                  {pressure.map((r) => <Cell key={r.domain} fill={PRI_COLOR[r.worst] ?? C.violet} fillOpacity={hotP && hotP !== r.domain ? 0.3 : 1} stroke={hotP === r.domain ? '#fff' : 'none'} strokeWidth={hotP === r.domain ? 1.5 : 0} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </div>
  );
}


const DESTINATIONS = ['Low Earth orbit (ISS)', 'Moon (surface)', 'Lunar orbit (Gateway)', 'Mars transit', 'Mars (surface)', 'Ground simulation'];
const ROLES = ['Commander', 'Pilot', 'Mission specialist', 'Flight engineer', 'Medical officer', 'Other'];
const PHASE_HEX: Record<string, string> = { early: C.blue, mid: C.violet, return: C.green };
const STATE_HEX = (s: string) => (PRI_COLOR[s] ?? (s === 'near' ? C.amber : s === 'ok' ? C.green : C.grey));
const STATE_TXT = (s: string) => (['low', 'medium', 'high', 'critical'].includes(s) ? `${s} alert` : s === 'near' ? 'close to a line' : s === 'ok' ? 'inside its line' : 'not checked');

function MissionForm({ astronautId, profile, open }: { astronautId: number; profile: Any; open: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Any>({ ...profile });
  const set = (k: string, v: string) => setF((x: Any) => ({ ...x, [k]: v }));
  const num = (v: Any) => (v === '' || v == null ? null : Number(v));
  const txt = (v: Any) => (v == null ? '' : String(v));
  const save = useMutation({
    mutationFn: () => saveMissionProfile({ astronaut_id: astronautId, mission_name: txt(f.mission_name) || null, destination: txt(f.destination) || null, launch_date: txt(f.launch_date) || null,
      planned_days: num(f.planned_days), crew_role: txt(f.crew_role) || null, crew_size: num(f.crew_size), objective: txt(f.objective) || null, date_of_birth: txt(f.date_of_birth) || null,
      sex: txt(f.sex) || null, height_cm: num(f.height_cm), weight_kg: num(f.weight_kg) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ms-insight'] }); void qc.invalidateQueries({ queryKey: ['ms-ai'] }); },
  });
  const dests = f.destination && !DESTINATIONS.includes(f.destination) ? [f.destination, ...DESTINATIONS] : DESTINATIONS;
  return (
    <details className="al-details" open={open} style={{ margin: '4px 0 14px' }}>
      <summary>Edit mission details</summary>
      <Panel title="Mission details" subtitle="Where the mission goes, when it starts and who is flying. Everything on this section is worked out from these" icon={<RocketIcon size={18} className="purple-icon" />}>
        <div className="av-form">
          <label className="av-field"><span>Mission name</span><input value={txt(f.mission_name)} onChange={(e) => set('mission_name', e.target.value)} placeholder="e.g. Artemis Deep Space Simulation" /></label>
          <label className="av-field"><span>Destination</span>
            <select className="select-control" value={txt(f.destination)} onChange={(e) => set('destination', e.target.value)}><option value="">choose a destination</option>{dests.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label className="av-field"><span>Launch date</span><input type="date" value={txt(f.launch_date)} onChange={(e) => set('launch_date', e.target.value)} /></label>
          <label className="av-field"><span>Planned duration (days)</span><input type="number" min={1} max={1500} value={txt(f.planned_days)} onChange={(e) => set('planned_days', e.target.value)} placeholder="e.g. 180" /></label>
          <label className="av-field"><span>Crew role</span>
            <select className="select-control" value={txt(f.crew_role)} onChange={(e) => set('crew_role', e.target.value)}><option value="">choose a role</option>{ROLES.map((x) => <option key={x}>{x}</option>)}</select>
          </label>
          <label className="av-field"><span>Crew size</span><input type="number" min={1} max={12} value={txt(f.crew_size)} onChange={(e) => set('crew_size', e.target.value)} placeholder="e.g. 4" /></label>
          <label className="av-field"><span>Mission objective</span><input value={txt(f.objective)} onChange={(e) => set('objective', e.target.value)} placeholder="e.g. Lunar south pole survey" maxLength={200} /></label>
          <label className="av-field"><span>Date of birth</span><input type="date" value={txt(f.date_of_birth)} onChange={(e) => set('date_of_birth', e.target.value)} /></label>
          <label className="av-field"><span>Sex</span>
            <select className="select-control" value={txt(f.sex)} onChange={(e) => set('sex', e.target.value)}><option value="">not entered</option><option>Female</option><option>Male</option></select>
          </label>
          <label className="av-field"><span>Height (cm)</span><input type="number" min={50} max={250} value={txt(f.height_cm)} onChange={(e) => set('height_cm', e.target.value)} /></label>
          <label className="av-field"><span>Weight (kg)</span><input type="number" min={20} max={300} value={txt(f.weight_kg)} onChange={(e) => set('weight_kg', e.target.value)} /></label>
        </div>
        <div className="av-btn-row">
          <button className="primary-button" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 size={15} className="av-spin" /> : <CheckCircle2 size={15} />} Save mission details</button>
        </div>
        {save.isSuccess && <p className="success-line"><CheckCircle2 size={15} /> Saved. The mission day, phase and suggestions below now use these details.</p>}
        {save.isError && <p className="av-rec-note warn">Could not save: {(save.error as Error).message}</p>}
      </Panel>
    </details>
  );
}

function MissionGlance({ d }: { d: Any }) {
  const j = d.journey; const p = d.profile; const m = d.mission;
  const rows = ([
    ['Mission', p.mission_name], ['Destination', p.destination], ['Launch date', p.launch_date ? dlab(p.launch_date) + ` ${p.launch_date.slice(0, 4)}` : null],
    ['Planned duration', p.planned_days ? `${p.planned_days} days` : null], ['Today', j?.headline], ['Phase', j?.phase_label], ['Crew role', p.crew_role],
    ['Crew size', p.crew_size ? `${p.crew_size} astronauts` : null], ['Objective', p.objective], ['Age', m?.age != null ? `${m.age} years` : null],
    ['BMI', m?.bmi != null ? `${m.bmi} · ${m.bmi_class}` : null],
  ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([k, v]) => [k, v as string] as [string, string]);
  return (
    <Panel title="Mission at a glance" subtitle="Which mission, where it goes, how far along it is and who is flying" icon={<RocketIcon size={18} className="purple-icon" />}>
      {rows.length > 0 ? <Kv rows={rows} /> : <p className="muted">No mission details entered yet. Open “Edit mission details” below and enter the destination, launch date and duration.</p>}
      {j && j.day >= 1 && j.day <= j.planned_days && (
        <div style={{ marginTop: 12 }}>
          <div style={{ height: 8, borderRadius: 6, background: '#1b2342', overflow: 'hidden' }}><div style={{ width: `${j.pct}%`, height: '100%', background: PHASE_HEX[j.phase] ?? C.violet }} /></div>
          <p className="al-note" style={{ marginTop: 6 }}>{j.pct}% of the mission is behind them.</p>
        </div>
      )}
      {!j && rows.length > 0 && <p className="al-note">Add the launch date and duration to see the mission day and phase.</p>}
    </Panel>
  );
}

function MissionTimeline({ j }: { j: Any }) {
  const [hot, setHot] = useState<string | null>(null);
  const cur = Math.min(Math.max(j.day, 0), j.planned_days);
  const tip = (p: Any) => ({ title: p.label, sub: `Day ${p.start} to ${p.end} · ${p.days} days`, color: PHASE_HEX[p.key] ?? C.violet,
    rows: [['Where we are', j.phase === p.key ? 'Today is in this phase' : j.day < p.start ? `starts in ${p.start - Math.max(j.day, 0)} day(s)` : 'finished'], ['Weight on', p.focus.slice(0, 3).join(', ')]] as [string, string][], note: p.note });
  return (
    <Panel title="Mission timeline" subtitle={`${j.planned_days} planned days in three phases. The dashed line is today. Hover a phase to see what it puts the weight on`} icon={<CalendarDays size={18} className="icon-muted" />}>
      <div className="al-chart" style={{ height: 250 }}>
        <ResponsiveContainer>
          <BarChart data={j.phases} layout="vertical" margin={{ top: 24, right: 22, left: 16, bottom: 30 }} onMouseMove={(e: Any) => setHot(e?.activePayload?.[0]?.payload?.key ?? null)} onMouseLeave={() => setHot(null)}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" domain={[0, j.planned_days]} tick={axis} label={xl('Mission day')} />
            <YAxis type="category" dataKey="label" tick={axis} width={110} label={yl('Phase')} />
            <Tooltip cursor={cursorBar} wrapperStyle={{ outline: 'none', zIndex: 20 }} content={<RichTip spec={tip} />} />
            <Bar dataKey={(r: Any) => [r.start - 1, r.end]} radius={4} maxBarSize={38} isAnimationActive={false}>
              {j.phases.map((r: Any) => <Cell key={r.key} fill={PHASE_HEX[r.key]} fillOpacity={hot ? (hot === r.key ? 1 : 0.3) : j.phase === r.key ? 1 : 0.6} stroke={hot === r.key ? '#fff' : 'none'} strokeWidth={hot === r.key ? 1.5 : 0} />)}
            </Bar>
            {j.day >= 1 && <ReferenceLine x={cur} stroke="#fff" strokeDasharray="4 3" label={{ value: j.day > j.planned_days ? 'Landed' : `Day ${j.day}`, fill: '#fff', fontSize: 10, position: 'top' }} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function PhaseFocus({ j }: { j: Any }) {
  const ref = j.reference;
  return (
    <div className="al-grid al-g2e">
      <Panel title={`${j.phase_label}: what to watch`} subtitle={j.phase_note} icon={<ListChecks size={18} className="icon-muted" />}>
        {j.focus.map((x: Any) => (
          <div className="al-item" key={x.domain}>
            <div><Chip color={STATE_HEX(x.state)}>{STATE_TXT(x.state)}</Chip></div>
            <div><h4>{x.area}</h4></div>
          </div>
        ))}
        {j.links.map((l: Any) => <div className="al-do" style={{ marginTop: 10 }} key={l.title}><b>Why it matters here</b>{l.text}</div>)}
      </Panel>
      {ref ? (
        <Panel title={`${ref.name}: the environment`} subtitle="General reference for this destination. These are not measurements of this astronaut" icon={<Globe2 size={18} className="icon-muted" />}>
          <Kv rows={[['Gravity', ref.gravity], ['Radio delay', ref.comms_delay]]} />
          <p className="al-note">{ref.note}</p>
        </Panel>
      ) : <div />}
    </div>
  );
}

function MissionAdvice({ req, ready }: { req: Any; ready: Any }) {
  const base = useAI();   // the page's own AI call goes first; the free tiers need a gap between calls
  const run = async () => {
    let r = await getMissionAdvice(req);
    const waits = [...(r.ai?.error ?? '').matchAll(/retry in (\d+)s/g)].map((m) => Number(m[1]));
    if (!r.ai?.result && waits.length) {   // "called too recently": wait the time the backend asked for, then ask once more
      await new Promise((res) => setTimeout(res, (Math.max(...waits) + 1) * 1000));
      r = await getMissionAdvice(req);
    }
    return r;
  };
  const ai = useQuery({ queryKey: ['ms-ai', req], queryFn: run, enabled: !base.isFetching, retry: 0, staleTime: 60 * 60_000 });
  const result = (ai.data?.ai?.result ?? null) as Any;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  return (
    <Panel title="Mission readiness brief · AI" subtitle={`Written by the AI from the verdict, alerts and data coverage above${ai.data?.ai?.model ? ` · ${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : ''}`} icon={<Sparkles size={18} className="purple-icon" />}>
      <p className="av-rec-note">It only sees the verdict, alerts and coverage, never raw files or keys, and it never changes the verdict ({ready.label}) or a priority.</p>
      <div style={{ margin: '8px 0 12px' }}>
        <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>{ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again</button>
      </div>
      {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for the readiness brief…</p>}
      {problem && !ai.isFetching && <p className="av-rec-note warn">AI recommendations are not available right now .</p>}
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
                <span className="muted" style={{ fontSize: 10 }}>{r.alert === 'all' || !r.alert ? `area: ${r.domain}` : `for alert: ${r.alert}`}</span>
              </div>
            </div>
          ))}
          {(result.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
          {(result.key_findings ?? []).map((f: string) => <p className="av-rec-note" key={f}>• {f}</p>)}
          {(result.watch_next ?? []).length > 0 && <div className="av-sub-head">Watch next</div>}
          {(result.watch_next ?? []).map((f: string) => <p className="av-rec-note" key={f}>• {f}</p>)}
          {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">What would sharpen the check</div>}
          {(result.data_gaps ?? []).map((g: string) => <p className="av-rec-note" key={g}>• {g}</p>)}
          <p className="av-rec-note">{result.disclaimer ?? ai.data?.disclaimer}</p>
        </>
      )}
    </Panel>
  );
}

function MissionInsights() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days: 30, language }), [astronautId, selection, language]);
  const q = useQuery({ queryKey: ['ms-insight', req], queryFn: () => getMissionInsight(req), enabled: astronautId > 0, retry: 0, staleTime: 60_000 });
  const d = q.data;
  const r = d?.readiness;
  return (
    <>
      <style>{AL_CSS + '.ms-col{display:flex;flex-direction:column;gap:14px;min-width:0}.ms-col .panel{flex:1 1 auto;height:auto;margin-bottom:0}'}</style>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} className="av-spin" /> Building the mission readiness view…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The readiness view could not be loaded. The panels above still work.</p>}
      {d && r && (
        <>
          <Section icon={<Gauge size={17} />} title="Mission readiness" sub="One verdict from the same factor alerts as the Risk Alerts page, how complete the data behind it is, and what to add next." />
          <div className="al-card" style={{ borderLeftColor: TONE[r.tone], marginBottom: 14 }}><div><b style={{ color: TONE[r.tone], fontSize: 16 }}>{r.label}</b>{r.text}</div></div>
          <div className="al-kpis">
            <div><span>Data coverage</span><b style={{ color: d.coverage.pct >= 70 ? C.green : d.coverage.pct >= 40 ? C.amber : C.orange }}>{d.coverage.ready}<small style={{ display: 'inline', fontSize: 11, color: '#8d97b4' }}> of {d.coverage.total}</small></b><small>Data sources feeding this check</small></div>
            <div><span>Factors checked</span><b>{r.factors_checked}</b><small>Areas that had data to judge</small></div>
            <div><span>Alerts</span><b style={{ color: r.highest ? PRI_COLOR[r.highest] : C.green }}>{r.alerts}</b><small>{r.alerts ? `${r.areas} area(s), highest ${r.highest}` : 'Nothing over a line'}</small></div>
            <div><span>Close to a line</span><b style={{ color: C.amber }}>{r.watch}</b><small>Within 10% of a line, not over it</small></div>
            {d.logs && <div><span>Logging streak</span><b>{d.logs.streak}<small style={{ display: 'inline', fontSize: 11, color: '#8d97b4' }}> day(s)</small></b><small>{d.logs.days_logged} day(s) logged, longest gap {d.logs.longest_gap}</small></div>}
            {d.logs && <div><span>Log coverage</span><b>{d.logs.coverage_pct}%</b><small>Days with a log in the last {d.logs.window_days}</small></div>}
          </div>
          <div className="al-grid al-g2e"><MissionGlance d={d} />{d.journey ? <MissionTimeline j={d.journey} /> : <div />}</div>
          <MissionForm key={JSON.stringify(d.profile)} astronautId={astronautId} profile={d.profile} open={!d.journey} />
          {d.journey && <PhaseFocus j={d.journey} />}
          <div className="al-grid al-g2e">
            <Panel title="Data coverage" subtitle="What feeds the check, what each source unlocks and how to add the missing ones" icon={<Database size={18} className="icon-muted" />}>
              {d.coverage.items.map((c: Any) => (
                <div className="al-item" key={c.id}>
                  <div><Chip color={c.state === 'ready' ? C.green : C.amber}>{c.state === 'ready' ? 'in use' : 'not yet'}</Chip></div>
                  <div>
                    <h4>{c.label}</h4>
                    <p>{c.detail}</p>
                    <div className="al-meta"><span>unlocks <i>{c.unlocks}</i></span></div>
                    {c.how && <div className="al-do"><b>How to add</b>{c.how}</div>}
                  </div>
                </div>
              ))}
            </Panel>
            <div className="ms-col">
              {d.top_alerts && (
                <Panel title="Needs attention first" subtitle="The highest-priority alerts behind the verdict" icon={<ShieldAlert size={18} className="icon-muted" />}>
                  {d.top_alerts.map((a: Any) => (
                    <div className="al-item" key={a.id}>
                      <div><Chip color={PRI_COLOR[a.priority]}>{a.priority}</Chip></div>
                      <div><h4>{a.title}</h4><p>{a.domain}</p><div className="al-do"><b>What to do</b>{a.action}</div></div>
                    </div>
                  ))}
                </Panel>
              )}
              {d.watch && (
                <Panel title="Close to the line" subtitle="Not alerts yet, the first to watch" icon={<ShieldAlert size={18} className="icon-muted" />}>
                  {d.watch.map((w: Any) => (
                    <div className="al-item" key={w.factor}>
                      <div><Chip color={C.amber}>{w.distance_pct}% away</Chip></div>
                      <div><h4>{w.factor}</h4><p>{w.text}</p></div>
                    </div>
                  ))}
                </Panel>
              )}
              {d.complete_the_picture && (
                <Panel title="Complete the picture" subtitle="The next additions that would widen this check" icon={<ListChecks size={18} className="icon-muted" />}>
                  {d.complete_the_picture.map((c: Any) => <div className="al-do" style={{ marginTop: 8 }} key={c.label}><b>{c.label}</b>{c.how} Unlocks: {c.unlocks}.</div>)}
                </Panel>
              )}
            </div>
          </div>
          <MissionCharts areas={d.areas} pressure={d.pressure} />
          <div className="al-grid al-g2e">
            {d.mission && (
              <Panel title="Astronaut record" subtitle="From the crew database, used for BMI and the bone-risk inputs" icon={<UserRound size={18} className="icon-muted" />}>
                <Kv rows={([
                  ['Name', d.mission.name], ['Crew code', d.mission.crew_code], ['Mission', d.mission.mission],
                  ['Age', d.mission.age != null ? `${d.mission.age} years` : null], ['Sex', d.mission.sex],
                  ['Height', d.mission.height_cm != null ? `${d.mission.height_cm} cm` : null], ['Weight', d.mission.weight_kg != null ? `${d.mission.weight_kg} kg` : null],
                  ['BMI', d.mission.bmi != null ? `${d.mission.bmi} · ${d.mission.bmi_class}` : null],
                  ['Logging since', d.mission.logging_since ? `${dlab(d.mission.logging_since)} (${d.mission.days_in_logs} days)` : null],
                ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => [k, v as string] as [string, string])} />
              </Panel>
            )}
            <Panel title="Models and AI providers" subtitle="Which saved models ran for this selection, and which AI will answer" icon={<Cpu size={18} className="icon-muted" />}>
              <div className="al-wrap">
                <table className="al-tbl">
                  <thead><tr><th>Model</th><th>Built on</th><th>Factors</th><th>This check</th></tr></thead>
                  <tbody>
                    {d.models.map((m: Any) => (
                      <tr key={m.model}>
                        <td>{m.model}<small>{m.predicts ?? ''}</small></td>
                        <td>{m.population ?? 'not stated'}</td>
                        <td>{m.factors ?? 'n/a'}</td>
                        <td><Chip color={m.ran ? C.green : m.loaded ? C.blue : C.pink}>{m.ran ? 'ran' : m.loaded ? 'loaded' : 'missing'}</Chip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="av-sub-head">AI providers</div>
              {d.providers.map((p: Any) => (
                <div className="av-flag" key={p.provider}><span className={`av-dot ${p.configured ? 'ok' : 'mute'}`} /><p>{p.provider} ({p.role}) · {p.configured ? `${p.left_today ?? 'n/a'} call(s) left today` : 'no key set'}{p.model ? ` · ${p.model}` : ''}</p></div>
              ))}
            </Panel>
          </div>
          <div className="al-gap"><MissionAdvice req={req} ready={r} /></div>
          <p className="al-note">{d.disclaimer}</p>
        </>
      )}
    </>
  );
}

const show = (v: unknown): string => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function MissionPage() {
  const subjects = useSubjects();
  const status = useMlStatus();
  const day = useDay();
  const selection = useRunStore((s) => s.selection);
  const d = subjects.data;
  const subject = d?.subjects.find((s) => s.subject_id === (day.data?.subject.subject_id ?? selection.subject_id));
  const scenario = d?.scenarios.find((s) => s.scenario_id === (day.data?.subject.scenario_id ?? selection.scenario_id));
  const entries = (o?: Record<string, unknown>) => Object.entries(o ?? {}).filter(([k]) => k !== 'bone_profile').map(([k, v]) => [k, show(v)] as [string, string]);
  return (
    <section className="page-enter">
      <PageHeader eyebrow="CREW & MISSION CONTEXT" title="Mission Profile" intro="Who and what the backend is looking at: crew file, data sources, loaded models and AI providers." />
      {(subjects.isError || status.isError) && <Notice tone="warning"><b>Backend not reachable.</b><p>{((subjects.error ?? status.error) as Error).message}</p></Notice>}
      <div className="dashboard-grid">
        <Panel title="Selected crew member" subtitle="From the backend crew file" icon={<Rocket size={18} className="purple-icon" />}>
          {subject ? <Kv rows={entries(subject)} /> : <p className="muted">No crew member is linked to this selection (it is built from separate datasets).</p>}
          {subject && typeof subject.bone_profile === 'object' && subject.bone_profile && <><div className="av-sub-head">Bone profile</div><Kv rows={entries(subject.bone_profile as Record<string, unknown>)} /></>}
        </Panel>
        <Panel title="Selected scenario" subtitle="Ready-made day">
          {scenario ? <Kv rows={entries(scenario)} /> : <p className="muted">No scenario selected.</p>}
        </Panel>
      </div>
      <div>
        <Panel title="Data used" subtitle="Provenance reported by the backend">
          {day.data?.data_provenance.length ? day.data.data_provenance.map((p) => <div className="av-flag" key={p}><span className="av-dot ok" /><p>{p}</p></div>) : <p className="muted">Nothing selected yet.</p>}
          <Kv rows={[
            ['Crew members in file', d?.subjects.length ?? '—'],
            ['Scenarios in file', d?.scenarios.length ?? '—'],
            ['Blood astronauts', Object.keys(d?.blood_astronauts ?? {}).join(', ') || '—'],
            ['MMASH volunteers', d?.mmash_users.length ?? '—'],
            ['HRV volunteers', d?.hrv_users.length ?? '—'],
          ]} />
        </Panel>
      </div>
      <MissionInsights />
    </section>
  );
}
