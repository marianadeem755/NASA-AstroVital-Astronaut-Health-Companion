import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Droplets, Footprints, HeartPulse, Thermometer, Wind } from 'lucide-react';
import { DataGate, Meter, NoData, PageHeader, Panel, RecToggle, Stat, WarningList, bloodTone, hrvTone, pct } from '../../../shared/components/live';

export function VitalsPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="PHYSICAL HEALTH" title="Vitals & Physical" intro="Heart-rhythm (HRV) and blood-model results from the backend, plus the change of each blood value from the astronaut's own baseline." />
      <DataGate>
        {(day) => {
          const s = day.check_day.scores ?? {};
          const insp = s['P_R+1_like_insp4_blood'];
          const osd = s['P_R+1_like_osd571_blood'];
          const chart = day.baseline_changes.map((b) => ({ marker: b.marker, change: b.percent_change }));
          return (
            <>
              <WarningList day={day} />
              <div className="metric-grid four">
                <Stat icon={<HeartPulse size={18} />} label="UNUSUAL HRV WINDOWS" value={pct(s.hrv_anomaly_frac)} tone={hrvTone(s.hrv_anomaly_frac)} tag="strong"
                  sub={s.hrv_windows_checked != null ? `${s.hrv_windows_checked} windows of ${day.inputs_used.hrv_user ?? 'selected user'}` : 'No HRV windows for this selection'} />
                <Stat icon={<Droplets size={18} />} label="BLOOD (CMP + CBC) LOOKS POST-FLIGHT" value={pct(insp)} tone={bloodTone(insp)} tag="strong" sub="39 values · trained on 4 crew (proof of concept)" />
                <Stat icon={<Droplets size={18} />} label="METABOLOMICS LOOKS POST-FLIGHT" value={pct(osd)} tone={bloodTone(osd)} tag="strong" sub="680 metabolites · best model (AUC 0.833)" />
                <Stat icon={<Footprints size={18} />} label="STEPS PER DAY" value={day.inputs_used.steps != null ? day.inputs_used.steps.toLocaleString() : '—'} tone="mute" tag="proxy" sub="From the activity file" />
              </div>

              <div className="dashboard-grid">
                <Panel title="HRV anomaly check" subtitle="Share of heart-rhythm windows that look unusual · flag when over 10%" icon={<HeartPulse size={18} className="purple-icon" />}>
                  <Meter value={s.hrv_anomaly_frac} threshold={0.1} tone={hrvTone(s.hrv_anomaly_frac)} />
                  <div className="av-scale"><span>0%</span><span>10% flag line</span><span>100%</span></div>
                  <p className="muted">The detector was never shown the broken-sensor user during training, yet flagged almost all of that user's windows, so it works as an anomaly detector. It is trained on Earth volunteers, not astronauts.</p>
                  <RecToggle domains={['hrv']} title="Recommendations · heart rhythm" />
                </Panel>
                <Panel title="Blood samples" subtitle={day.inputs_used.blood_astronaut ? `${day.inputs_used.blood_astronaut} at ${day.inputs_used.timepoint}` : 'No blood sample selected'} icon={<Droplets size={18} className="purple-icon" />}>
                  <div className="av-bar-row"><span>CMP + CBC model</span><Meter value={insp} threshold={0.5} tone={bloodTone(insp)} /><b>{pct(insp)}</b></div>
                  <div className="av-bar-row"><span>Metabolomics model</span><Meter value={osd} threshold={0.5} tone={bloodTone(osd)} /><b>{pct(osd)}</b></div>
                  <p className="muted">The number is the probability that the blood looks like one day after landing instead of before flight. A line at 50% raises a flag.</p>
                  <RecToggle domains={['blood']} title="Recommendations · blood" />
                </Panel>
              </div>

              <Panel title="Change from own pre-flight baseline" subtitle="Percent change of the biggest blood values (for example glucose)" className="av-gap-bottom">
                {chart.length ? (
                  <>
                    <div className="chart-wrap">
                      <ResponsiveContainer>
                        <BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid stroke="#252d4b" vertical={false} />
                          <XAxis dataKey="marker" stroke="#8992b1" fontSize={10} />
                          <YAxis stroke="#8992b1" fontSize={10} unit="%" />
                          <Tooltip contentStyle={{ background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [`${v}%`, 'Change']} />
                          <Bar dataKey="change" radius={[4, 4, 0, 0]}>{chart.map((c) => <Cell key={c.marker} fill={c.change >= 0 ? '#b47bff' : '#58d8ff'} />)}</Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <table className="av-table">
                      <thead><tr><th>Marker</th><th>Baseline mean</th><th>Now</th><th>Change</th></tr></thead>
                      <tbody>{day.baseline_changes.map((b) => <tr key={b.marker}><td>{b.marker}</td><td>{b.baseline_mean}</td><td>{b.current}</td><td className={b.percent_change >= 0 ? 'up' : 'down'}>{b.percent_change > 0 ? '+' : ''}{b.percent_change}%</td></tr>)}</tbody>
                    </table>
                  </>
                ) : <p className="muted">Baseline change needs a blood sample taken after launch (for example R+1). Choose one in Daily Check-in.</p>}
              </Panel>

              <div className="metric-grid three">
                <NoData title="OXYGEN SATURATION (SpO₂)" why="No SpO₂ data exists in the project files." icon={<Wind size={18} />} />
                <NoData title="BLOOD PRESSURE" why="No blood-pressure data in the backend." icon={<HeartPulse size={18} />} />
                <NoData title="BODY TEMPERATURE" why="No temperature data in the backend." icon={<Thermometer size={18} />} />
              </div>
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
