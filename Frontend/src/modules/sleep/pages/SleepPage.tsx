import { Footprints, HeartPulse, Moon } from 'lucide-react';
import { DataGate, Kv, Meter, Notice, PageHeader, Panel, RecToggle, Stat, WarningList, hrvTone, pct, sleepTone } from '../../../shared/components/live';

export function SleepPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="REST & RECOVERY" title="Sleep Tracker" intro="Probability of a poor sleeper, from sleep minutes, awakenings, sleep efficiency, steps and heart rate of the selected volunteer." />
      <DataGate>
        {(day) => {
          const s = day.check_day.scores ?? {};
          return (
            <>
              <WarningList day={day} />
              <Notice tone="warning"><b>Weak evidence.</b><p>The poor-sleep model has AUC 0.47 (below chance) on 21 Earth volunteers. The number is shown for the demo, do not trust it.</p></Notice>
              <div className="metric-grid three">
                <Stat icon={<Moon size={18} />} label="POOR-SLEEPER PROBABILITY" value={pct(s.P_poor_sleep)} tone={sleepTone(s.P_poor_sleep)} tag="weak" sub="Flag when over 50%" />
                <Stat icon={<Footprints size={18} />} label="STEPS PER DAY" value={day.inputs_used.steps != null ? day.inputs_used.steps.toLocaleString() : '—'} tag="proxy" sub="Model input" />
                <Stat icon={<HeartPulse size={18} />} label="UNUSUAL HRV WINDOWS" value={pct(s.hrv_anomaly_frac)} tone={hrvTone(s.hrv_anomaly_frac)} tag="strong" sub="Recovery signal" />
              </div>
              <div className="dashboard-grid">
                <Panel title="Poor-sleep probability" subtitle="Against the 50% flag line" icon={<Moon size={18} className="purple-icon" />}>
                  <Meter value={s.P_poor_sleep} threshold={0.5} tone={sleepTone(s.P_poor_sleep)} />
                  <div className="av-scale"><span>0%</span><span>50% flag line</span><span>100%</span></div>
                  <p className="muted">Target used in training: Pittsburgh sleep score above 5 (poor sleeper).</p>
                  <RecToggle domains={['sleep']} title="Recommendations · sleep" />
                </Panel>
                <Panel title="Where this comes from" subtitle="Data used for this reading">
                  <Kv rows={[
                    ['Sleep volunteer', day.inputs_used.mmash_user ?? 'none selected'],
                    ['Model inputs', 'minutes asleep, awakenings, efficiency, steps, heart rate, stress scores'],
                    ['Population', '21 healthy young men on Earth (MMASH)'],
                  ]} />
                </Panel>
              </div>
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
