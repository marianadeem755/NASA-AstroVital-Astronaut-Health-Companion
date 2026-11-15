import { useState } from 'react';
import { Bone, Dumbbell, Footprints, RotateCcw } from 'lucide-react';
import { DataGate, Meter, NoData, Notice, PageHeader, Panel, RecToggle, Stat, TONE_COLOR, WarningList, boneTone, pct } from '../../../shared/components/live';
import { useRunStore } from '../../../store/useRunStore';
import type { BoneProfile } from '../../../types/ml';

const NUMBER_FIELDS: [keyof BoneProfile, string, string][] = [
  ['age', 'Age (years)', 'Model trained on 40-80'],
  ['bmi', 'BMI', ''],
  ['grip_max_kg', 'Grip strength (kg)', ''],
  ['vig_work_min_week', 'Vigorous work (min/week)', ''],
  ['mod_work_min_week', 'Moderate work (min/week)', ''],
  ['vig_rec_min_week', 'Vigorous recreation (min/week)', ''],
  ['mod_rec_min_week', 'Moderate recreation (min/week)', ''],
  ['sedentary_min_day', 'Sedentary (min/day)', ''],
  ['sleep_hours', 'Sleep (hours)', ''],
];

function BoneForm() {
  const stored = useRunStore((s) => s.selection.bone_profile);
  const setBoneProfile = useRunStore((s) => s.setBoneProfile);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    Object.entries(stored ?? {}).forEach(([k, v]) => { if (v !== null && v !== undefined) d[k] = String(v); });
    return d;
  });
  const set = (k: string, v: string) => setDraft((p) => ({ ...p, [k]: v }));
  const apply = () => {
    const out: BoneProfile = {};
    NUMBER_FIELDS.forEach(([k]) => { if (draft[k] !== undefined && draft[k] !== '') (out as Record<string, number>)[k] = Number(draft[k]); });
    if (draft.sex_female === '0' || draft.sex_female === '1') out.sex_female = Number(draft.sex_female) as 0 | 1;
    if (draft.trouble_sleeping === '0' || draft.trouble_sleeping === '1') out.trouble_sleeping = Number(draft.trouble_sleeping) as 0 | 1;
    setBoneProfile(Object.keys(out).length ? out : null);
  };
  return (
    <div>
      <div className="av-form">
        {NUMBER_FIELDS.map(([k, label, hint]) => (
          <label className="av-field" key={k}><span>{label}</span>
            <input type="number" step="any" value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={hint || 'from backend profile'} />
          </label>
        ))}
        <label className="av-field"><span>Sex</span>
          <select className="select-control" value={draft.sex_female ?? ''} onChange={(e) => set('sex_female', e.target.value)}>
            <option value="">from backend profile</option><option value="1">Female</option><option value="0">Male</option>
          </select>
        </label>
        <label className="av-field"><span>Trouble sleeping</span>
          <select className="select-control" value={draft.trouble_sleeping ?? ''} onChange={(e) => set('trouble_sleeping', e.target.value)}>
            <option value="">from backend profile</option><option value="1">Yes</option><option value="0">No</option>
          </select>
        </label>
      </div>
      <div className="av-btn-row">
        <button className="primary-button" onClick={apply}><Bone size={15} /> Calculate bone risk</button>
        <button className="av-ghost-btn" onClick={() => { setDraft({}); setBoneProfile(null); }}><RotateCcw size={14} /> Use backend profile</button>
      </div>
      <p className="muted">Empty boxes use the bone profile stored in the backend crew file. Missing values are filled by the model with the training median.</p>
    </div>
  );
}

export function BoneMusclePage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="MICROGRAVITY ADAPTATION" title="Bone & Muscle" intro="Bone-risk screening from the backend model, plus the exercise proxy. There is no human muscle-loss or in-space bone data." />
      <DataGate>
        {(day) => {
          const bone = day.bone_risk;
          const ex = day.inputs_used.exercise_minutes;
          const steps = day.inputs_used.steps;
          return (
            <>
              <WarningList day={day} />
              <Notice tone="warning"><b>Screening only, not a diagnosis.</b><p>{bone?.population ?? 'The bone model was trained on US adults aged 40-80 (NHANES), not on astronauts.'}</p></Notice>
              <div className="metric-grid four">
                <Stat icon={<Bone size={18} />} label="BONE-RISK SCREENING" value={bone?.bone_risk_label ?? '—'} tone={boneTone(bone?.bone_risk_label)} tag="screening" sub={bone ? 'Low / Medium / High' : 'No bone profile yet · fill the form below'} />
                <Stat icon={<Dumbbell size={18} />} label="EXERCISE TODAY" value={ex != null ? ex : '—'} unit={ex != null ? 'min' : ''} tone={ex != null ? (ex < 20 ? 'warn' : 'ok') : 'mute'} tag="proxy" sub="Weak flag under 20 min" />
                <Stat icon={<Footprints size={18} />} label="STEPS PER DAY" value={steps != null ? steps.toLocaleString() : '—'} tone={steps != null ? (steps < 5000 ? 'warn' : 'ok') : 'mute'} tag="proxy" sub="Used only if no exercise minutes" />
                <NoData title="MUSCLE LOSS IN SPACE" why="No human muscle data exists." icon={<Dumbbell size={18} />} />
              </div>

              <div className="dashboard-grid">
                <Panel title="Bone-risk result" subtitle="Probability of each class" icon={<Bone size={18} className="purple-icon" />}>
                  {bone ? (
                    <>
                      {Object.entries(bone.probabilities).map(([label, p]) => (
                        <div className="av-bar-row" key={label}><span>{label}</span><Meter value={p} tone={label === 'High' ? 'bad' : label === 'Medium' ? 'warn' : 'ok'} /><b>{pct(p)}</b></div>
                      ))}
                      <p className="av-summary" style={{ borderColor: TONE_COLOR[boneTone(bone.bone_risk_label)] }}>{bone.advice}</p>
                      {bone.inputs_missing.length > 0 && <p className="muted">Filled with training median: {bone.inputs_missing.join(', ')}</p>}
                    </>
                  ) : <p className="muted">No bone profile is available for this selection. Fill in the form to run the bone-risk model.</p>}
                  <RecToggle domains={['bone']} title="Recommendations · bone" />
                </Panel>
                <Panel title="Exercise & muscle" subtitle="Proxy only, no trained muscle model">
                  <p className="muted">Exercise is a stand-in: under 20 minutes (or under 5,000 steps when minutes are not logged) raises a weak flag. Enter today's minutes in Daily Check-in.</p>
                  <RecToggle domains={['exercise']} title="Recommendations · exercise" />
                </Panel>
              </div>

              <Panel title="Bone profile" subtitle="The only values this app sends to the backend for the bone model">
                <BoneForm />
              </Panel>
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
