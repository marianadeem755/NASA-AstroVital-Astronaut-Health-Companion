import { AlertTriangle, BellRing, CheckCircle2, PhoneCall } from 'lucide-react';
import { useAI } from '../../../hooks/useAstro';
import { DataGate, LevelBadge, Notice, PageHeader, Panel, RecToggle, Stat, WarningList } from '../../../shared/components/live';

function severity(flag: string): { label: string; cls: string } {
  if (flag.includes('strong evidence')) return { label: 'HIGH · strong evidence', cls: 'bad' };
  if (flag.includes('weak evidence')) return { label: 'LOW · weak evidence', cls: 'warn' };
  return { label: 'LOW · proxy', cls: 'warn' };
}

export function AlertsPage() {
  const ai = useAI();
  const aiResult = ai.data?.ai?.result;
  return (
    <section className="page-enter">
      <PageHeader eyebrow="EARLY WARNING" title="Risk Alerts" intro="Every alert is a flag raised by the backend rules on the model outputs. Strong-evidence flags weigh most." />
      <DataGate>
        {(day) => {
          const flags = day.check_day.flags;
          return (
            <>
              <WarningList day={day} />
              {day.level === 'red' && <Notice tone="warning" icon={<PhoneCall size={18} />}><b>RED: contact the mission medical officer today.</b><p>Do not do hard training until they say so.</p></Notice>}
              <div className="metric-grid four">
                <Stat icon={<BellRing size={18} />} label="OVERALL LEVEL" value={<LevelBadge level={day.level} />} sub="Decided by rules, not by the AI" />
                <Stat label="OPEN ALERTS" value={flags.length} tone={flags.length ? 'warn' : 'ok'} sub="Flags raised today" />
                <Stat label="STRONG-EVIDENCE FLAGS" value={day.check_day.n_strong_flags} tone={day.check_day.n_strong_flags ? 'bad' : 'ok'} sub="HRV, blood" />
                <Stat label="WEAK-EVIDENCE FLAGS" value={day.check_day.n_weak_flags} tone={day.check_day.n_weak_flags ? 'warn' : 'ok'} sub="Sleep, stress, exercise" />
              </div>
              <Panel title="Alerts" subtitle="Why the level is what it is" icon={<AlertTriangle size={18} className="icon-muted" />}>
                {flags.length === 0 ? <div className="av-flag"><CheckCircle2 size={16} color="#55e6b1" /><p>No alert. Nothing is flagged for the data that was checked.</p></div> : flags.map((f) => {
                  const sev = severity(f);
                  return <div className="av-alert" key={f}><span className={`av-dot ${sev.cls}`} /><div><p>{f}</p><small>{sev.label}</small></div></div>;
                })}
                {aiResult?.contact_medical_officer && <div className="av-callout"><PhoneCall size={16} /><div><b>AI also advises contacting the medical officer.</b><p>{aiResult.contact_reason}</p></div></div>}
                <div className="av-sub-head">Could not check</div>
                {day.check_day.missing.length ? day.check_day.missing.map((m) => <div className="av-flag" key={m}><span className="av-dot mute" /><p>{m}</p></div>) : <p className="muted">Every domain had data.</p>}
              </Panel>
              <div className="av-gap-top"><RecToggle domains={['general', 'sleep', 'stress', 'hrv', 'blood', 'bone', 'exercise']} title="What to do about these alerts" /></div>
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
