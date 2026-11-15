import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Droplets } from 'lucide-react';
import { useDay, useModels, useSubjects } from '../../../hooks/useAstro';
import { checkDay } from '../../../services/ml.service';
import { DataGate, Notice, PageHeader, Panel, RecToggle } from '../../../shared/components/live';

const TOOLTIP = { contentStyle: { background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 } };

function BloodTimeline() {
  const subjects = useSubjects();
  const day = useDay();
  const astronauts = Object.keys(subjects.data?.blood_astronauts ?? {});
  const [picked, setPicked] = useState<string>('');
  const astronaut = picked || day.data?.inputs_used.blood_astronaut || astronauts[0] || '';
  const timepoints = subjects.data?.blood_astronauts?.[astronaut] ?? [];

  const results = useQueries({
    queries: timepoints.map((tp) => ({
      queryKey: ['ml-timeline', astronaut, tp],
      queryFn: () => checkDay({ blood_astronaut: astronaut, timepoint: tp }),
      staleTime: 10 * 60_000,
      retry: 0,
    })),
  });
  const data = useMemo(() => timepoints.map((tp, i) => {
    const sc = results[i]?.data?.check_day.scores ?? {};
    return { timepoint: tp, cmp: sc['P_R+1_like_insp4_blood'] ?? null, metabolomics: sc['P_R+1_like_osd571_blood'] ?? null };
  }), [timepoints, results]);
  const loading = results.some((r) => r.isLoading);

  return (
    <Panel title="Blood trend across the mission" subtitle="How post-flight-like the blood looks at every sample time of one astronaut" icon={<Droplets size={18} className="purple-icon" />}>
      {astronauts.length === 0 ? <p className="muted">The backend lists no blood astronauts (Inspiration4 file not found).</p> : (
        <>
          <div className="av-btn-row">
            <label className="av-inline">Astronaut
              <select className="select-control" value={astronaut} onChange={(e) => setPicked(e.target.value)}>{astronauts.map((a) => <option key={a}>{a}</option>)}</select>
            </label>
            {loading && <span className="muted">Running models for each timepoint…</span>}
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <LineChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#252d4b" vertical={false} />
                <XAxis dataKey="timepoint" stroke="#8992b1" fontSize={10} />
                <YAxis stroke="#8992b1" fontSize={10} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                <Tooltip {...TOOLTIP} formatter={(v: number) => `${Math.round(v * 100)}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0.5} stroke="#ffd37c" strokeDasharray="4 4" label={{ value: 'flag line', fill: '#ffd37c', fontSize: 10, position: 'insideTopRight' }} />
                <Line type="monotone" dataKey="cmp" name="CMP + CBC model" stroke="#b47bff" strokeWidth={2} dot connectNulls />
                <Line type="monotone" dataKey="metabolomics" name="Metabolomics model" stroke="#58d8ff" strokeWidth={2} dot connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="muted">L- = before launch, R+ = days after return. A good model stays low before flight and rises right after landing.</p>
        </>
      )}
    </Panel>
  );
}

function ModelQuality() {
  const models = useModels();
  const rows = (models.data ?? []).map((m) => {
    const x = (m.metrics ?? {}) as Record<string, unknown>;
    const score = [x.roc_auc, x.macro_auc_ovr].find((v) => typeof v === 'number') as number | undefined;
    return { model: m.model.replace('_logreg', '').replace('_isoforest', '').replace('_pca', ''), score: score ?? null };
  }).filter((r) => r.score !== null);
  return (
    <Panel title="How good is each model?" subtitle="AUC from the backend model files · 0.5 is a coin flip" icon={<BarChart3 size={18} className="icon-muted" />}>
      {models.isLoading ? <p className="muted">Loading…</p> : (
        <div className="chart-wrap">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#252d4b" vertical={false} />
              <XAxis dataKey="model" stroke="#8992b1" fontSize={9} interval={0} />
              <YAxis stroke="#8992b1" fontSize={10} domain={[0, 1]} />
              <Tooltip {...TOOLTIP} />
              <ReferenceLine y={0.5} stroke="#ffd37c" strokeDasharray="4 4" />
              <Bar dataKey="score" name="AUC" radius={[4, 4, 0, 0]}>{rows.map((r) => <Cell key={r.model} fill={(r.score ?? 0) >= 0.7 ? '#55e6b1' : '#b47bff'} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export function AnalyticsPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="LONGITUDINAL ANALYTICS" title="Trends & Analytics" intro="Real trends the backend data supports: blood across mission timepoints, baseline changes, and model quality." />
      <Notice tone="warning"><b>No 7-day or 30-day series.</b><p>The sleep and stress data are 2-day averages per volunteer, so the backend cannot draw daily trends for them. The blood data has real timepoints (before launch and after return), so that is what is plotted.</p></Notice>
      <BloodTimeline />
      <div className="av-gap-top"><ModelQuality /></div>
      <DataGate>{() => <div className="av-gap-top"><RecToggle domains={['blood', 'hrv', 'general']} title="Recommendations · trends" /></div>}</DataGate>
    </section>
  );
}
