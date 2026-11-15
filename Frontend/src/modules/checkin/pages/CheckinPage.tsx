import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, ClipboardCheck, Loader2, RotateCcw, ShieldAlert, WifiOff } from 'lucide-react';
import { useDay, useSubjects } from '../../../hooks/useAstro';
import { getAlertsInsight } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { hasSelection, useRunStore, type Selection } from '../../../store/useRunStore';
import { AL_CSS, AlertList, AlertsAdvice, C, Chip, FactorBoard, PRI_COLOR, RichTip, Section, WatchPanel, axis, cursorBar, xl, yl } from '../../alerts/pages/AlertsPage';
import type { DayRequest } from '../../../types/ml';
import { EvidenceTag, LevelBadge, Notice, PageHeader, Panel } from '../../../shared/components/live';


/* ==========================================================================================================
   FACTOR ALERTS FOR TODAY'S CHECK · reuses the Risk Alerts engine (POST /ml/alerts-insight) for the data chosen above plus the
   astronaut's own logs, and the AI panel (POST /ml/alerts-recommendations, Gemini then Groq). The form and the result
   panel above are unchanged.
   ========================================================================================================== */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const STATUS_HEX: Record<string, string> = { over: C.orange, near: C.amber, ok: C.green };
const statusOf = (s: string) => (s === 'ok' ? 'ok' : s === 'watch' ? 'near' : 'over');
const STATUS_TXT: Record<string, string> = { over: 'over the line', near: 'close to the line', ok: 'inside the line' };

function FactorsCheck({ board, readings }: { board: Any[]; readings: Any[] }) {
  const [hot, setHot] = useState<string | null>(null);
  const label = (dom: string) => board.find((b) => b.domain === dom)?.label ?? dom.charAt(0).toUpperCase() + dom.slice(1);
  const rows = useMemo(() => {
    const m = new Map<string, Any>();
    readings.forEach((r) => {
      const row = m.get(r.domain) ?? { domain: r.domain, label: label(r.domain), over: 0, near: 0, ok: 0, total: 0, names: [] as string[] };
      row[statusOf(r.status)] += 1; row.total += 1;
      if (statusOf(r.status) === 'over') row.names.push(r.factor);
      m.set(r.domain, row);
    });
    return [...m.values()].sort((a, b) => b.over - a.over || b.near - a.near || b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings, board]);
  const n = (k: string) => readings.filter((r) => statusOf(r.status) === k).length;
  const tip = (p: Any) => ({
    title: p.label, sub: `${p.total} factor${p.total > 1 ? 's' : ''} checked in this area`, color: p.over ? C.orange : p.near ? C.amber : C.green,
    rows: [['Over the line', String(p.over)], ['Close to the line', String(p.near)], ['Inside the line', String(p.ok)]] as [string, string][],
    note: p.names.length ? `Over the line: ${p.names.join(', ')}.` : p.near ? 'Nothing over a line here, but something is within 10% of one.' : 'Every factor here is inside its healthy line.',
  });
  const bar = (key: string) => (
    <Bar dataKey={key} name={STATUS_TXT[key]} stackId="s" fill={STATUS_HEX[key]} maxBarSize={46} isAnimationActive={false}>
      {rows.map((r) => <Cell key={r.domain} fill={STATUS_HEX[key]} fillOpacity={hot && hot !== r.domain ? 0.3 : 1} stroke={hot === r.domain ? '#fff' : 'none'} strokeWidth={hot === r.domain ? 1.5 : 0} />)}
    </Bar>
  );
  return (
    <>
      <div className="al-kpis">
        <div><span>Factors checked</span><b>{readings.length}</b><small>Every factor that had a reading today</small></div>
        <div><span>Over the line</span><b style={{ color: n('over') ? C.orange : C.green }}>{n('over')}</b><small>{n('over') ? 'Each has a step below' : 'Nothing crossed a healthy line'}</small></div>
        <div><span>Close to the line</span><b style={{ color: C.amber }}>{n('near')}</b><small>Within 10% of a line, not over it</small></div>
        <div><span>Inside their lines</span><b style={{ color: C.green }}>{n('ok')}</b><small>Healthy on today's reading</small></div>
      </div>
      <div className="al-grid al-g2e">
        <Panel title="Today's check by area" subtitle="Hover an area to see which factors are over, close to or inside their line" icon={<ShieldAlert size={18} className="icon-muted" />}>
          <div className="al-chart" style={{ height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 42, left: 8 }} onMouseMove={(e: Any) => setHot(e?.activePayload?.[0]?.payload?.domain ?? null)} onMouseLeave={() => setHot(null)}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={axis} interval={0} angle={-20} textAnchor="end" height={70} label={xl('Area checked')} />
                <YAxis tick={axis} allowDecimals={false} label={yl('Factors checked')} />
                <Tooltip cursor={cursorBar} wrapperStyle={{ outline: 'none', zIndex: 20 }} content={<RichTip spec={tip} />} />
                <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 10 }} />
                {bar('over')}{bar('near')}{bar('ok')}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Every factor checked today" subtitle="What was measured, the healthy line and where it came from" icon={<ClipboardCheck size={18} className="icon-muted" />}>
          <div className="al-wrap" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="al-tbl">
              <thead><tr><th>Factor</th><th>Measured</th><th>Healthy line</th><th>Status</th></tr></thead>
              <tbody>
                {readings.map((r) => {
                  const k = statusOf(r.status);
                  return (
                    <tr key={`${r.id}-${r.source}`}>
                      <td>{r.factor}<small>{r.source}</small></td>
                      <td>{r.shown}</td>
                      <td>{r.line}<small><EvidenceTag kind={r.evidence} /></small></td>
                      <td><Chip color={k === 'over' ? PRI_COLOR[r.status] : STATUS_HEX[k]}>{k === 'over' ? r.status : k === 'near' ? 'close' : 'ok'}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function CheckinFactors() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days: 30, language }), [astronautId, selection, language]);
  const q = useQuery({ queryKey: ['ck-insight', req], queryFn: () => getAlertsInsight(req), enabled: astronautId > 0, retry: 0, staleTime: 60_000 });
  const d = q.data;
  return (
    <>
      <style>{AL_CSS}</style>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} className="av-spin" /> Checking every factor against its line…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The factor alerts could not be loaded. The check above still works.</p>}
      {d && (
        <>
          <Section icon={<ShieldAlert size={17} />} title="Alerts for today's check, by factor" sub="Built from the data chosen above and your own logged readings, one rule per factor. Each alert shows the line it crossed and the step to take." />
          {d.readings && d.readings.length > 0 && <FactorsCheck board={d.board ?? []} readings={d.readings} />}
          {d.board && d.board.length > 0 && <FactorBoard board={d.board} />}
          {d.alerts.length > 0 && <AlertList alerts={d.alerts} />}
          {d.watch && <div className="al-gap" style={{ marginTop: d.alerts.length ? 14 : 0 }}><WatchPanel watch={d.watch} /></div>}
          {d.alerts.length > 0 && <div className="al-gap"><AlertsAdvice req={req} alerts={d.alerts} /></div>}
          <p className="al-note">{d.disclaimer}</p>
        </>
      )}
    </>
  );
}

const text = (v: unknown) => (v == null ? '' : String(v));

export function CheckinPage() {
  const subjects = useSubjects();
  const selection = useRunStore((s) => s.selection);
  const setSelection = useRunStore((s) => s.setSelection);
  const chooseScenario = useRunStore((s) => s.chooseScenario);
  const clear = useRunStore((s) => s.clear);
  const day = useDay();
  const [draft, setDraft] = useState<Selection>(selection);
  const [applied, setApplied] = useState(false);
  useEffect(() => setDraft(selection), [selection]);

  const d = subjects.data;
  const timepoints = draft.blood_astronaut ? d?.blood_astronauts?.[draft.blood_astronaut] ?? [] : [];
  const patch = (p: Selection) => { setDraft((x) => ({ ...x, ...p })); setApplied(false); };
  const num = (v: string) => (v === '' ? null : Number(v));

  const apply = () => {
    const next: Selection = { ...draft, timepoint: draft.blood_astronaut ? draft.timepoint : null };
    setSelection(next);
    setApplied(true);
  };

  return (
    <section className="page-enter">
      <PageHeader eyebrow="DAILY CREW CHECK-IN" title="Daily Check-in" intro="Choose which backend data to check today. Sleep, stress, HRV and blood values are read from the data files, not typed in." />
      {subjects.isError && <Notice tone="warning"><b>Backend not reachable.</b><p>{(subjects.error as Error).message}</p></Notice>}
      <Panel title="Choose the data for today's check" subtitle="Leave a box empty to use what the scenario or subject already defines" icon={<ClipboardCheck size={18} className="purple-icon" />}>
        <div className="av-form">
          <label className="av-field"><span>Ready-made scenario</span>
            <select className="select-control" value={text(draft.scenario_id)} onChange={(e) => e.target.value ? chooseScenario(e.target.value) : patch({ scenario_id: null })}>
              <option value="">none</option>
              {d?.scenarios.map((s) => <option key={s.scenario_id} value={s.scenario_id}>{s.scenario_id}</option>)}
            </select>
          </label>
          <label className="av-field"><span>Crew member</span>
            <select className="select-control" value={text(draft.subject_id)} onChange={(e) => patch({ subject_id: e.target.value || null })}>
              <option value="">none</option>
              {d?.subjects.map((s) => <option key={s.subject_id} value={s.subject_id}>{s.display_name ?? s.subject_id}</option>)}
            </select>
          </label>
          <label className="av-field"><span>Sleep / stress volunteer (MMASH)</span>
            <select className="select-control" value={text(draft.mmash_user)} onChange={(e) => patch({ mmash_user: e.target.value || null })}>
              <option value="">from scenario / none</option>
              {d?.selectors.mmash_user.map((u) => <option key={u} value={u}>{u}</option>)}
              {d?.mmash_users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="av-field"><span>HRV volunteer</span>
            <select className="select-control" value={text(draft.hrv_user)} onChange={(e) => patch({ hrv_user: e.target.value || null })}>
              <option value="">from scenario / none</option>
              {d?.selectors.hrv_user.map((u) => <option key={u} value={u}>{u}</option>)}
              {d?.hrv_users.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="av-field"><span>Blood astronaut</span>
            <select className="select-control" value={text(draft.blood_astronaut)} onChange={(e) => patch({ blood_astronaut: e.target.value || null, timepoint: null })}>
              <option value="">from scenario / none</option>
              {Object.keys(d?.blood_astronauts ?? {}).map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="av-field"><span>Blood sample time</span>
            <select className="select-control" value={text(draft.timepoint)} onChange={(e) => patch({ timepoint: e.target.value || null })} disabled={!draft.blood_astronaut}>
              <option value="">{draft.blood_astronaut ? 'choose a timepoint' : 'pick an astronaut first'}</option>
              {timepoints.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="av-field"><span>Exercise today (minutes)</span>
            <input type="number" min={0} max={1440} value={text(draft.exercise_minutes)} onChange={(e) => patch({ exercise_minutes: num(e.target.value) })} placeholder="optional" />
          </label>
          <label className="av-field"><span>Steps today</span>
            <input type="number" min={0} max={200000} value={text(draft.steps)} onChange={(e) => patch({ steps: num(e.target.value) })} placeholder="optional · else from data" />
          </label>
        </div>
        <div className="av-btn-row">
          <button className="primary-button" onClick={apply} disabled={!hasSelection(draft)}><CheckCircle2 size={15} /> Run today's check</button>
          <button className="av-ghost-btn" onClick={() => { clear(); setApplied(false); }}><RotateCcw size={14} /> Clear selection</button>
        </div>
        {applied && <p className="success-line"><CheckCircle2 size={15} /> Check updated. Every page now shows this selection.</p>}
      </Panel>

      <div className="av-gap-top">
        <Panel title="Result of the current selection">
          {day.isLoading && <p className="muted">Running the models…</p>}
          {day.isError && <p className="av-rec-note warn">{(day.error as Error).message}</p>}
          {day.data && (
            <>
              <div className="av-btn-row"><LevelBadge level={day.data.level} /><span className="muted">{day.data.check_day.flags.length} flag(s) · {day.data.check_day.missing.length} area(s) with no data</span></div>
              {day.data.check_day.flags.map((f) => <div className="av-flag" key={f}><span className={`av-dot ${f.includes('strong') ? 'bad' : 'warn'}`} /><p>{f}</p></div>)}
            </>
          )}
          {!day.data && !day.isLoading && !day.isError && <p className="muted">Choose data above and press “Run today's check”.</p>}
        </Panel>
      </div>
      <CheckinFactors />
    </section>
  );
}
