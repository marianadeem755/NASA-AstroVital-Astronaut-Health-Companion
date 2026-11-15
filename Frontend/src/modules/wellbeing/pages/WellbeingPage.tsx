import { Brain, HeartPulse, Smile, Zap } from 'lucide-react';
import { DataGate, Meter, NoData, Notice, PageHeader, Panel, RecToggle, Stat, WarningList, hrvTone, num, pct, stressTone } from '../../../shared/components/live';

export function WellbeingPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="MENTAL WELLBEING" title="Mental Wellbeing" intro="Stress from the backend stress model. Mood and energy have no daily data, so they are shown as missing." />
      <DataGate>
        {(day) => {
          const s = day.check_day.scores ?? {};
          return (
            <>
              <WarningList day={day} />
              <Notice tone="warning"><b>Weak evidence.</b><p>The stress model has R² −1.00 (n = 21 Earth volunteers). It gives a number but guessing the average would be just as good. Use it only as a demo prompt to check in, never to decide anything.</p></Notice>
              <div className="metric-grid three">
                <Stat icon={<Brain size={18} />} label="PREDICTED DAILY STRESS" value={num(s.predicted_daily_stress, 1)} tone={stressTone(s.predicted_daily_stress)} tag="weak" sub="Flag when over 50" />
                <NoData title="MOOD" why="No daily mood data exists." icon={<Smile size={18} />} />
                <NoData title="ENERGY" why="No daily energy data exists." icon={<Zap size={18} />} />
              </div>
              <div className="dashboard-grid">
                <Panel title="Stress level" subtitle="Model output against the backend flag line (50)" icon={<Brain size={18} className="purple-icon" />}>
                  <Meter value={s.predicted_daily_stress} max={100} threshold={50} tone={stressTone(s.predicted_daily_stress)} />
                  <div className="av-scale"><span>0</span><span>50 flag line</span><span>100</span></div>
                  <RecToggle domains={['stress']} title="Recommendations · stress" />
                </Panel>
                <Panel title="Physical stress signal" subtitle="HRV is the strongest model that relates to recovery" icon={<HeartPulse size={18} className="purple-icon" />}>
                  <div className="av-bar-row"><span>Unusual HRV windows</span><Meter value={s.hrv_anomaly_frac} threshold={0.1} tone={hrvTone(s.hrv_anomaly_frac)} /><b>{pct(s.hrv_anomaly_frac)}</b></div>
                  <p className="muted">Unusual HRV can come from stress, illness or poor recovery. It does not tell which one.</p>
                  <RecToggle domains={['hrv']} title="Recommendations · HRV" />
                </Panel>
              </div>
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
