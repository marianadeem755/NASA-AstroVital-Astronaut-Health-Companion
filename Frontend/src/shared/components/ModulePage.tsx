import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Info, Save, Sparkles } from 'lucide-react';
import type { NavItem } from '../types/navigation';

const content: Record<string, { eyebrow: string; intro: string; metrics: [string, string, string][]; focus: string[] }> = {
  '/vitals': { eyebrow: 'PHYSICAL HEALTH', intro: 'Review cardiovascular and general physical indicators collected during the mission.', metrics: [['HEART RATE', '68', 'BPM · sample'], ['OXYGEN SATURATION', '98', '% · sample'], ['BODY TEMPERATURE', '36.7', '°C · sample']], focus: ['Heart-rate history and personal baseline', 'SpO₂ and blood-pressure observations', 'Activity and symptom context'] },
  '/radiation': { eyebrow: 'ENVIRONMENTAL EXPOSURE', intro: 'A mission-facing view for radiation exposure records and environmental context.', metrics: [['MISSION DOSE', '—', 'mSv · awaiting data'], ['DOSE RATE', '—', 'µSv/hr · awaiting data'], ['EXPOSURE TREND', '—', 'awaiting data']], focus: ['Cumulative exposure timeline', 'Dose-rate observations by mission day', 'Environmental exposure context and data quality'] },
  '/wellbeing': { eyebrow: 'MENTAL WELLBEING', intro: 'Track self-reported mood, stress, energy and cognitive check-in indicators.', metrics: [['MOOD', '8', '/10 · demo'], ['STRESS', '3', '/10 · demo'], ['ENERGY', '7', '/10 · demo']], focus: ['Mood and stress patterns over time', 'Private journal and check-in history', 'Crew-support signals with privacy controls'] },
  '/sleep': { eyebrow: 'REST & RECOVERY', intro: 'Understand sleep duration, quality and consistency across mission schedules.', metrics: [['SLEEP DURATION', '7.4', 'hrs · demo'], ['SLEEP QUALITY', '8', '/10 · demo'], ['SCHEDULE', 'Stable', 'demo status']], focus: ['Daily sleep duration and quality', 'Sleep consistency across the last 7 days', 'Relationship between rest, mood and fatigue'] },
  '/bone-muscle': { eyebrow: 'MICROGRAVITY ADAPTATION', intro: 'Review exercise adherence, musculoskeletal symptoms and body-region check-ins.', metrics: [['EXERCISE SESSIONS', '5', 'this week · demo'], ['BODY CHECK-INS', '2', 'this week · demo'], ['FOCUS REGION', 'Lower back', 'example']], focus: ['Resistance and aerobic exercise adherence', 'Spinal discomfort and fluid-shift symptom logging', 'Body-region symptom history'] },
  '/analytics': { eyebrow: 'LONGITUDINAL ANALYTICS', intro: 'Compare daily snapshots, recent windows and personal-baseline trends.', metrics: [['SHORT WINDOW', '7 days', 'recent trend'], ['LONG WINDOW', '30 days', 'baseline view'], ['DATA COVERAGE', '—', 'awaiting integration']], focus: ['Current 7-day window vs previous 7 days', '30-day trend against individual baseline', 'Cross-domain associations with evidence and caveats'] },
  '/alerts': { eyebrow: 'EARLY WARNING', intro: 'Review risk assessments and alerts that may need astronaut or medical-officer attention.', metrics: [['OPEN ALERTS', '2', 'demo only'], ['HIGH PRIORITY', '0', 'demo only'], ['LAST ASSESSMENT', '—', 'not connected']], focus: ['Alert priority and supporting factors', 'Acknowledgement and review history', 'Escalation to medical officer when appropriate'] },
  '/insights': { eyebrow: 'DECISION SUPPORT', intro: 'Present understandable explanations and countermeasure options based on recorded evidence.', metrics: [['INSIGHTS', '2', 'sample cards'], ['PROTOCOLS', '—', 'backend-managed'], ['REVIEW STATUS', 'Pending', 'demo']], focus: ['Explain which observations contributed to an insight', 'Show protocol source and review requirement', 'Keep medical decisions with qualified crew/medical staff'] },
  '/checkin': { eyebrow: 'DAILY CREW CHECK-IN', intro: 'A simple daily self-report. This local form is a UI preview and does not submit to the backend yet.', metrics: [['CHECK-IN', 'Daily', 'self-reported'], ['SCALE', '0–10', 'higher mood is better'], ['PRIVACY', 'Private', 'subject to mission policy']], focus: ['Mood, stress, fatigue and sleep quality', 'Optional notes and symptoms', 'Offline queue and sync when integrated'] },
  '/mission': { eyebrow: 'CREW & MISSION CONTEXT', intro: 'Review astronaut identity, mission details and individual reference values.', metrics: [['CREW CODE', 'CREW-001', 'demo profile'], ['MISSION DAY', '084', 'illustrative'], ['MISSION TYPE', 'Lunar', 'demo profile']], focus: ['Astronaut profile and mission metadata', 'Personal baseline values and risk factors', 'Mission day and data-source status'] },
  '/medical': { eyebrow: 'AUTHORIZED MEDICAL VIEW', intro: 'A future role-protected view for the mission medical officer. Access controls are not implemented in this frontend starter.', metrics: [['CREW STATUS', 'Demo', 'not live'], ['OPEN REVIEWS', '2', 'illustrative'], ['ACCESS CONTROL', 'Pending', 'must be implemented']], focus: ['Crew-level summary and authorized individual trends', 'Alert review and escalation history', 'Role-based access and privacy audit requirements'] },
};

export function ModulePage({ item }: { item: NavItem }) {
  const [range, setRange] = useState('7 days');
  const [mood, setMood] = useState(7);
  const [stress, setStress] = useState(3);
  const [fatigue, setFatigue] = useState(3);
  const [sleep, setSleep] = useState(7);
  const [saved, setSaved] = useState(false);
  const page = content[item.path] ?? { eyebrow: 'MISSION HEALTH', intro: 'Review this health domain.', metrics: [['STATUS', '—', 'awaiting data'], ['TREND', '—', 'awaiting data'], ['COVERAGE', '—', 'awaiting data']] as [string,string,string][], focus: [] };
  const isCheckin = item.path === '/checkin';
  const metricCards = useMemo(() => page.metrics, [page]);
  return (
    <section className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow">ASTROVITAL / {page.eyebrow}</div><h1>{item.label}</h1><p className="muted">{page.intro}</p></div>
        <select className="select-control" value={range} onChange={(event) => setRange(event.target.value)} aria-label="Trend range">
          <option>7 days</option><option>30 days</option><option>90 days</option>
        </select>
      </div>
      <div className="notice-panel"><Info size={18}/><div><b>Frontend preview · demonstration content</b><p>Values on this page are illustrative placeholders. Live observations and trained-model outputs will appear only after the corresponding data/API integration is completed.</p></div></div>
      <div className="metric-grid three">{metricCards.map(([label,value,unit]) => <div className="metric-card" key={label}><span className="metric-label">{label}</span><div className="metric-value">{value}</div><div className="metric-delta">{unit}</div></div>)}</div>
      {isCheckin && <div className="panel checkin-panel"><div className="panel-heading"><div><h3>Daily wellbeing check-in</h3><p>Local interaction preview · no data is submitted</p></div><Save size={18} className="purple-icon"/></div><div className="checkin-fields">{[['Mood',mood,setMood],['Stress',stress,setStress],['Fatigue',fatigue,setFatigue],['Sleep quality',sleep,setSleep]].map(([label,value,setter]:any) => <label className="range-field" key={label}><span>{label}<b>{value}/10</b></span><input type="range" min="0" max="10" value={value} onChange={(event)=>{setter(Number(event.target.value));setSaved(false)}}/></label>)}</div><button className="primary-button" onClick={()=>setSaved(true)}><Save size={15}/> Preview check-in</button>{saved&&<p className="success-line"><CheckCircle2 size={15}/> Check-in preview updated locally. Backend submission is not connected.</p>}</div>}
      {item.path === '/bone-muscle' && <div className="panel bodymap-preview"><div className="panel-heading"><div><h3>Microgravity body map</h3><p>Illustrative symptom regions · select a region to preview</p></div><Sparkles size={18} className="purple-icon"/></div><BodyMapPreview/></div>}
      <div className="panel focus-panel"><div className="panel-heading"><div><h3>{item.path === '/alerts' ? 'Alert review workflow' : 'What this workspace covers'}</h3><p>Planned content for this module</p></div><Activity size={18} className="icon-muted"/></div><div className="focus-list">{page.focus.map((point,index)=><div className="focus-row" key={point}><span>{String(index+1).padStart(2,'0')}</span><p>{point}</p><ArrowRight size={15}/></div>)}</div><div className="range-footnote"><AlertTriangle size={14}/> Selected analysis window: {range}. No clinical interpretation is made from demo values.</div></div>
    </section>
  );
}

function BodyMapPreview() {
  const [region,setRegion]=useState('Lower back');
  const regions=['Head / face','Chest','Upper back','Lower back','Arms','Legs'];
  return <div className="bodymap-layout"><svg viewBox="0 0 180 330" role="img" aria-label="Simplified human body silhouette with selectable symptom regions" className="body-silhouette"><circle cx="90" cy="28" r="20" fill="#25244e" stroke="#b784ff" strokeWidth="2"/><path d="M65 55 Q90 45 115 55 L126 132 L112 145 L108 205 L118 300 L94 300 L90 210 L86 300 L62 300 L72 205 L68 145 L54 132Z" fill="#1b2850" stroke="#7e8dce" strokeWidth="2"/><path d="M55 68 L28 150 L40 158 L68 102 M125 68 L152 150 L140 158 L112 102" fill="none" stroke="#7e8dce" strokeWidth="12" strokeLinecap="round"/>{[[90,28,'Head / face'],[90,100,'Chest'],[90,143,'Upper back'],[90,174,'Lower back'],[35,145,'Arms'],[90,260,'Legs']].map(([x,y,name]:any)=><circle key={name} cx={x} cy={y} r="8" onClick={()=>setRegion(name)} fill={region===name?'#ff91d5':'#a66dff'} stroke="#fff" strokeWidth="1.5" className="body-region-point"/>)}</svg><div className="bodymap-region-list"><b>Selected region: <span>{region}</span></b>{regions.map((name)=><button key={name} className={region===name?'region-chip selected':'region-chip'} onClick={()=>setRegion(name)}>{name}</button>)}<small>Selection is a UI preview only. No symptom record is saved.</small></div></div>;
}
