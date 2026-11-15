import { useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Stethoscope } from 'lucide-react';
import { useModels, useSubjects } from '../../../hooks/useAstro';
import { checkDay } from '../../../services/ml.service';
import { LevelBadge, Notice, PageHeader, Panel, Stat } from '../../../shared/components/live';
import { useRunStore } from '../../../store/useRunStore';

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
      <Notice tone="warning"><b>No access control yet.</b><p>This view is not protected by login or roles. A real mission needs role-based access and privacy audit before showing individual data to a medical officer.</p></Notice>
      <div className="metric-grid four">
        <Stat icon={<Stethoscope size={18} />} label="SCENARIOS REVIEWED" value={scenarios.length} sub="From the crew file" />
        <Stat icon={<ShieldAlert size={18} />} label="RED" value={red} tone={red ? 'bad' : 'ok'} sub="Medical officer needed today" />
        <Stat label="AMBER" value={amber} tone={amber ? 'warn' : 'ok'} sub="Check again tomorrow" />
        <Stat label="MODELS LOADED" value={models.data ? models.data.filter((m) => m.loaded).length : '—'} unit={models.data ? `of ${models.data.length}` : ''} sub="Saved .pkl files" />
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
                    <td>{loading ? '…' : err ? 'error' : r ? <LevelBadge level={r.level} /> : '—'}</td>
                    <td>{r?.check_day.n_strong_flags ?? '—'}</td>
                    <td>{r?.check_day.n_weak_flags ?? '—'}</td>
                    <td>{r?.check_day.missing.length ?? '—'}</td>
                    <td>{err ? err.message : r?.check_day.flags.join(' · ') || '—'}</td>
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
