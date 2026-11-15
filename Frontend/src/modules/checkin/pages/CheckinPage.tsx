import { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, RotateCcw } from 'lucide-react';
import { useDay, useSubjects } from '../../../hooks/useAstro';
import { hasSelection, useRunStore, type Selection } from '../../../store/useRunStore';
import { LevelBadge, Notice, NoData, PageHeader, Panel } from '../../../shared/components/live';

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

      <div className="dashboard-grid av-gap-top">
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
        <div className="av-stack">
          <NoData title="MOOD & ENERGY CHECK-IN" why="No daily mood or energy data exists, so they cannot be checked." />
          <NoData title="SpO₂ & RADIATION" why="No data exists for these either." />
        </div>
      </div>
    </section>
  );
}
