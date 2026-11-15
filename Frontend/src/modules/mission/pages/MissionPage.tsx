import { Database, Rocket, Server } from 'lucide-react';
import { useDay, useMlStatus, useSubjects } from '../../../hooks/useAstro';
import { useRunStore } from '../../../store/useRunStore';
import { Kv, Notice, PageHeader, Panel } from '../../../shared/components/live';

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
      <div className="dashboard-grid">
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
        <Panel title="Backend status" subtitle="Models, data files and AI providers" icon={<Server size={18} className="icon-muted" />}>
          {status.data && (
            <>
              <Kv rows={[
                ['Models loaded', status.data.models_loaded.length],
                ['Models missing', status.data.models_missing.join(', ') || 'none'],
              ]} />
              <div className="av-sub-head"><Database size={13} /> Data files</div>
              {Object.entries(status.data.data_files).map(([k, v]) => <div className="av-flag" key={k}><span className={`av-dot ${v ? 'ok' : 'bad'}`} /><p>{k}: {v ?? 'NOT FOUND'}</p></div>)}
              <div className="av-sub-head">AI providers</div>
              {status.data.ai_providers.map((p) => <div className="av-flag" key={show(p.provider)}><span className={`av-dot ${p.configured ? 'ok' : 'mute'}`} /><p>{show(p.provider)} ({show(p.role)}) · {show(p.model)} · {show(p.calls_today)}/{show(p.daily_limit)} calls today</p></div>)}
            </>
          )}
        </Panel>
      </div>
    </section>
  );
}
