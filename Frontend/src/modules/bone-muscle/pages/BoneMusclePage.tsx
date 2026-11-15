import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, BarChart3, Bone, BookOpen, ClipboardList, Dumbbell, Footprints, Gauge, Layers, Loader2, PhoneCall, RefreshCw, RotateCcw, ShieldAlert, Sparkles, Timer, TrendingDown, WifiOff } from 'lucide-react';
import { DataGate, EvidenceTag, Meter, NoData, Notice, PageHeader, Panel, RecToggle, Stat, TONE_COLOR, WarningList, boneTone, pct, type Tone } from '../../../shared/components/live';
import { getBoneAdvice, getBoneMuscleInsight, logExercise } from '../../../services/ml.service';
import { useAstronautStore } from '../../../store/useAstronautStore';
import { useRunStore } from '../../../store/useRunStore';
import type { BoneProfile, DayRequest } from '../../../types/ml';

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
  const backend = (useBoneInsightQuery().q.data?.backend_profile ?? null) as Record<string, number> | null;
  const bv = (k: string) => (backend && backend[k] !== undefined && backend[k] !== null ? Number(backend[k]) : null);
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
            <input type="number" step="any" value={draft[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={bv(k) !== null ? `backend: ${bv(k)}` : hint || 'from backend profile'} />
          </label>
        ))}
        <label className="av-field"><span>Sex</span>
          <select className="select-control" value={draft.sex_female ?? ''} onChange={(e) => set('sex_female', e.target.value)}>
            <option value="">{bv('sex_female') !== null ? `backend: ${bv('sex_female') === 1 ? 'Female' : 'Male'}` : 'from backend profile'}</option><option value="1">Female</option><option value="0">Male</option>
          </select>
        </label>
        <label className="av-field"><span>Trouble sleeping</span>
          <select className="select-control" value={draft.trouble_sleeping ?? ''} onChange={(e) => set('trouble_sleeping', e.target.value)}>
            <option value="">{bv('trouble_sleeping') !== null ? `backend: ${bv('trouble_sleeping') === 1 ? 'Yes' : 'No'}` : 'from backend profile'}</option><option value="1">Yes</option><option value="0">No</option>
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

/* ==========================================================================================================
   BONE & MUSCLE · deep dive (own CSS, prefix "bm-"). The calculator, stat row, result panel and recommendations above
   are unchanged. This block reads POST /ml/bone-muscle-insight; every target, source, range and number arrives in the
   response and a section with nothing to show is left out. Other pages keep: sleep, HRV, mood, radiation.
   ========================================================================================================== */

const BM_CSS = `
.bm-sec { margin:32px 0 13px; } .bm-sec h2 { margin:0; font-size:16px; letter-spacing:-.2px; display:flex; align-items:center; gap:9px; } .bm-sec h2 svg { color:#b47bff; }
.bm-sec p { margin:5px 0 0; font-size:10px; color:#818ba9; max-width:820px; line-height:1.5; }
.bm-grid { display:grid; gap:14px; align-items:stretch; margin-bottom:14px; } .bm-grid > * { min-width:0; } .bm-g2 { grid-template-columns:1.4fr 1fr; } .bm-g2e { grid-template-columns:1fr 1fr; } .bm-g12 { grid-template-columns:1fr 1.5fr; }
.bm-grid .panel { margin-bottom:0; height:100%; }
.bm-chip { display:inline-block; font:9px 'DM Mono',monospace; letter-spacing:.5px; text-transform:uppercase; padding:3px 8px; border-radius:6px; border:1px solid; white-space:nowrap; }
.bm-seg { display:inline-flex; flex-wrap:wrap; border:1px solid #343d62; border-radius:8px; overflow:hidden; margin-bottom:10px; }
.bm-seg button { padding:7px 12px; font-size:10px; border:0; background:#111832; color:#8992b1; font-weight:700; cursor:pointer; } .bm-seg button.on { background:#22346b; color:#e4eeff; }
.bm-read { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:11px; margin-bottom:14px; }
.bm-card { background:#0f1630; border:1px solid #293252; border-left:3px solid #5a6385; border-radius:10px; padding:13px 14px; font-size:11.5px; line-height:1.6; color:#cfd4ea; display:flex; flex-direction:column; gap:9px; justify-content:space-between; }
.bm-card b { color:#f1f3fb; font-size:12.5px; display:block; margin-bottom:4px; }
.bm-card.ok { border-left-color:#55e6b1; } .bm-card.warn { border-left-color:#ffd37c; } .bm-card.bad { border-left-color:#ff6b8b; } .bm-card.mute { border-left-color:#7aa8ff; }
.bm-tbl { width:100%; border-collapse:collapse; font-size:11.5px; } .bm-tbl th { text-align:left; font:8.5px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; padding:8px 10px; border-bottom:1px solid #2a3355; white-space:nowrap; }
.bm-tbl td { padding:11px 10px; border-top:1px solid #1f2745; color:#dfe3f3; vertical-align:top; line-height:1.45; } .bm-tbl tr:first-child td { border-top:0; }
.bm-tbl td small { display:block; font:9px 'DM Mono',monospace; color:#7f89a8; margin-top:3px; letter-spacing:.2px; line-height:1.45; }
.bm-tbl td.n { font:600 12.5px 'DM Mono',monospace; color:#fff; white-space:nowrap; } .bm-tbl td.n small { font-weight:400; }
.bm-wrap { overflow-x:auto; }
.bm-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:2px 0 12px; }
.bm-kpis div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; } .bm-kpis span { display:block; font:8px 'DM Mono',monospace; letter-spacing:.7px; color:#8992b1; text-transform:uppercase; }
.bm-kpis b { display:block; font-size:19px; margin-top:6px; letter-spacing:-.5px; } .bm-kpis small { display:block; font-size:9.5px; color:#8d97b4; margin-top:3px; line-height:1.4; }
.bm-drv { display:grid; grid-template-columns:minmax(120px,.9fr) 2fr 74px; gap:12px; align-items:center; padding:8px 0; border-top:1px solid #1f2745; font-size:11px; color:#d2d7e9; } .bm-drv:first-of-type { border-top:0; }
.bm-div { position:relative; height:10px; background:#252c49; border-radius:6px; } .bm-div i { position:absolute; top:0; bottom:0; border-radius:6px; } .bm-div b { position:absolute; left:50%; top:-3px; bottom:-3px; width:1px; background:#fff; opacity:.5; }
.bm-drv .r { font:600 11px 'DM Mono',monospace; text-align:right; }
.bm-legend { display:flex; gap:15px; flex-wrap:wrap; font-size:10px; color:#aeb6d0; margin:6px 0 2px; } .bm-legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:6px; vertical-align:-1px; }
.bm-stack { display:flex; height:22px; border-radius:7px; overflow:hidden; border:1px solid #ffffff1a; margin:6px 0 8px; } .bm-stack i { display:block; height:100%; }
.bm-note { font-size:10.5px; color:#8992b1; line-height:1.55; margin:12px 0 0; }
.bm-days { display:flex; align-items:flex-end; gap:3px; height:74px; margin:10px 0 4px; } .bm-days i { flex:1; min-width:3px; border-radius:3px 3px 0 0; background:#252c49; position:relative; }
.bm-days-scale { display:flex; justify-content:space-between; font:8px 'DM Mono',monospace; color:#6f799a; }
.bm-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; align-items:end; margin-top:6px; }
.bm-form input, .bm-form select { width:100%; background:#121a37; color:#e8ebf7; border:1px solid #343d62; border-radius:8px; padding:9px 11px; font-size:12px; font-family:inherit; } .bm-form input:focus, .bm-form select:focus { outline:none; border-color:#b47bff; }
.bm-form label > span { display:block; font:9px 'DM Mono',monospace; letter-spacing:.8px; color:#8992b1; text-transform:uppercase; margin-bottom:6px; }
.bm-ref { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:8px 0 2px; } .bm-ref div { background:#0f1630; border:1px solid #293252; border-radius:10px; padding:10px 12px; font-size:10.5px; color:#aeb6d0; line-height:1.45; } .bm-ref b { display:block; font:600 17px 'DM Mono',monospace; color:#fff; margin-bottom:3px; }
.bm-reg { display:grid; grid-template-columns:minmax(120px,1fr) 2fr 110px; gap:12px; align-items:center; padding:9px 0; border-top:1px solid #1f2745; font-size:11.5px; color:#d2d7e9; } .bm-reg:first-of-type { border-top:0; }
.bm-reg small { display:block; font:9px 'DM Mono',monospace; color:#7f89a8; margin-top:3px; }
.bm-meter { height:9px; background:#252c49; border-radius:6px; overflow:hidden; } .bm-meter i { display:block; height:100%; border-radius:6px; }
@media (max-width:1100px) { .bm-g2, .bm-g2e, .bm-g12 { grid-template-columns:1fr; } }
@media (max-width:760px) { .bm-drv { grid-template-columns:1fr 70px; } .bm-drv .bm-div { grid-column:1 / -1; order:3; } .bm-reg { grid-template-columns:1fr 90px; } .bm-reg .bm-meter { grid-column:1 / -1; order:3; } }
`;

const BC = { blue: '#7aa8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', grey: '#8992b1', grid: '#252d4b' };
const BTIP = { background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 };
const BTONE: Record<string, string> = { ok: BC.green, warn: BC.amber, bad: BC.pink, mute: BC.blue };
const STATUS_TONE: Record<string, Tone> = { in_range: 'ok', below: 'warn', above: 'warn', missing: 'mute' };
const STATUS_TEXT: Record<string, string> = { in_range: 'in range', below: 'below', above: 'above', missing: 'not entered' };
const KIND_COLOR: Record<string, string> = { aerobic: BC.blue, resistive: BC.violet, mixed: BC.green, other: BC.grey };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const bf = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }));
const bsigned = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${bf(Math.abs(v), d)}`);
const bpct = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const bday = (iso: string) => { const [, m, d] = iso.slice(0, 10).split('-'); return `${MONTHS[Number(m) - 1]} ${Number(d)}`; };
const buid = () => globalThis.crypto?.randomUUID?.() ?? `bm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function BSection({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return <div className="bm-sec"><h2>{icon}{title}</h2>{sub && <p>{sub}</p>}</div>;
}
function BChip({ color, children }: { color: string; children: ReactNode }) {
  return <span className="bm-chip" style={{ color, borderColor: `${color}66`, background: `${color}1f` }}>{children}</span>;
}
function BReadings({ cards }: { cards?: any[] }) {
  if (!cards?.length) return null;
  return (
    <div className="bm-read">
      {cards.map((c, i) => (
        <div className={`bm-card ${c.tone ?? 'mute'}`} key={i}>
          <div><b>{c.title}</b>{c.text}</div>
          {c.evidence && <div><EvidenceTag kind={c.evidence} /></div>}
        </div>
      ))}
    </div>
  );
}

/* ---- bone model, opened up ---------------------------------------------------------------------------------------------- */

const CODED: Record<string, (v: number) => string> = { sex_female: (v) => (v >= 0.5 ? 'Female' : 'Male'), trouble_sleeping: (v) => (v >= 0.5 ? 'Yes' : 'No') };
const shownValue = (r: any, v: number | null | undefined) => (r.key === 'sex_female' && !r.entered ? 'Not entered' : v == null ? '—' : CODED[r.key] ? CODED[r.key](v) : `${bf(v, 1)} ${r.unit}`);
const shownTraining = (r: any) => (r.training?.mean == null ? '—' : r.key === 'sex_female' ? `${bpct(r.training.mean)} female` : r.key === 'trouble_sleeping' ? `${bpct(r.training.mean)} yes` : `${bf(r.training.mean, 1)} ${r.unit}`);

function ReferenceTable({ bone }: { bone: any }) {
  return (
    <Panel title="Your values against what they should be" subtitle={`Source of the profile: ${bone.source}. Target ranges are published references; the training average is the 3,127 NHANES adults the model learned from`} icon={<ClipboardList size={18} className="purple-icon" />}>
      <div className="bm-wrap">
        <table className="bm-tbl">
          <thead><tr><th>Input</th><th>Your value</th><th>Target / healthy range</th><th>Status</th><th>Training average</th><th>Push on risk</th></tr></thead>
          <tbody>
            {bone.table.map((r: any) => (
              <tr key={r.key}>
                <td><b>{r.label}</b>{r.modifiable ? '' : ' · fixed'}<small>{r.source}</small>{r.note && <small>{r.note}</small>}</td>
                <td className="n">{shownValue(r, r.entered ? r.value : r.used_value)}{r.imputed && <small>{r.key === 'activity' ? 'not entered · model used training medians' : 'not entered · model used training median'}</small>}</td>
                <td>{r.target ?? (r.modifiable ? '—' : 'Fixed, cannot be changed')}</td>
                <td>{r.key === 'sex_female' ? <BChip color={BC.grey}>fixed</BChip> : <BChip color={BTONE[STATUS_TONE[r.status]]}>{STATUS_TEXT[r.status]}</BChip>}</td>
                <td className="n">{shownTraining(r)}{r.training?.sd != null && !CODED[r.key] && <small>spread ±{bf(r.training.sd, 1)}</small>}</td>
                <td className="n" style={{ color: r.push == null ? undefined : r.push > 0 ? BC.pink : r.push < 0 ? BC.green : undefined }}>{bsigned(r.push, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bm-note">{bone.table_note}</p>
    </Panel>
  );
}

function Drivers({ bone }: { bone: any }) {
  const d = bone.drivers;
  const max = Math.max(...d.items.map((i: any) => Math.abs(i.push)), 0.01);
  return (
    <Panel title="What is pushing this answer" subtitle="Each input's push on higher bone risk" icon={<Layers size={18} className="purple-icon" />}>
      <div className="bm-kpis">
        <div><span>Cannot change</span><b>{bpct(d.fixed_share)}</b><small>age and sex</small></div>
        <div><span>Can change</span><b>{bpct(d.changeable_share)}</b><small>everything else</small></div>
      </div>
      {d.items.map((i: any) => {
        const w = (Math.abs(i.push) / max) * 50;
        const color = i.push > 0 ? BC.pink : BC.green;
        return (
          <div className="bm-drv" key={i.key}>
            <span>{i.label}{!i.modifiable && <small style={{ color: '#7f89a8', marginLeft: 6 }}>fixed</small>}</span>
            <div className="bm-div"><b /><i style={{ background: color, left: i.push > 0 ? '50%' : `${50 - w}%`, width: `${w}%` }} /></div>
            <span className="r" style={{ color }}>{bsigned(i.push, 2)}</span>
          </div>
        );
      })}
      <div className="bm-legend"><span><i style={{ background: BC.pink }} />pushes towards higher risk</span><span><i style={{ background: BC.green }} />pushes towards lower risk</span></div>
      <p className="bm-note">{d.note}</p>
    </Panel>
  );
}

function Levers({ bone }: { bone: any }) {
  const l = bone.levers;
  return (
    <Panel title="What would change it" subtitle="One input at a time, moved to its target" icon={<TrendingDown size={18} className="purple-icon" />}>
      {l.items.length > 0 ? (
        <div className="bm-wrap">
          <table className="bm-tbl">
            <thead><tr><th>Change</th><th>From → to</th><th>High risk</th><th>Medium or High</th></tr></thead>
            <tbody>
              {l.items.map((i: any) => (
                <tr key={i.key}>
                  <td><b>{i.label}</b><small>{i.change}</small></td>
                  <td className="n">{bf(i.from)} → {bf(i.to)}</td>
                  <td className="n">{bpct(i.high_before, 1)} → {bpct(i.high_after, 1)}<small style={{ color: i.delta_high_points < 0 ? BC.green : BC.pink }}>{bsigned(i.delta_high_points)} pts</small></td>
                  <td className="n">{bpct(i.not_low_before, 1)} → {bpct(i.not_low_after, 1)}<small style={{ color: i.delta_not_low_points < 0 ? BC.green : BC.pink }}>{bsigned(i.delta_not_low_points)} pts</small></td>
                </tr>
              ))}
              {l.together && (
                <tr>
                  <td><b>All of the above together</b></td><td />
                  <td className="n">→ {bpct(l.together.high_after, 1)}<small style={{ color: BC.green }}>{bsigned(l.together.delta_high_points)} pts</small></td>
                  <td className="n">→ {bpct(l.together.not_low_after, 1)}<small style={{ color: BC.green }}>{bsigned(l.together.delta_not_low_points)} pts</small></td>
                </tr>
              )}
              <tr>
                <td><b>For scale: {l.for_scale.label}</b></td><td />
                <td className="n"><small style={{ color: BC.pink }}>{bsigned(l.for_scale.delta_high_points)} pts</small></td>
                <td className="n"><small style={{ color: BC.pink }}>{bsigned(l.for_scale.delta_not_low_points)} pts</small></td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : <p className="muted">Nothing to move for the inputs entered.</p>}
      <p className="bm-note">{l.note}</p>
    </Panel>
  );
}

function Curves({ bone }: { bone: any }) {
  const keys = Object.keys(bone.curves);
  const [k, setK] = useState(keys[0]);
  const c = bone.curves[k] ?? bone.curves[keys[0]];
  return (
    <Panel title="How the answer moves" subtitle="Everything else held at this profile" icon={<Gauge size={18} className="purple-icon" />}>
      <div className="bm-seg">{keys.map((key) => <button key={key} className={k === key ? 'on' : ''} onClick={() => setK(key)}>{bone.curves[key].label}</button>)}</div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={c.points} margin={{ left: 0, right: 10, top: 24, bottom: 16 }}>
            <CartesianGrid stroke={BC.grid} vertical={false} />
            <XAxis dataKey="x" tick={{ fill: BC.grey, fontSize: 10 }} stroke={BC.grid} label={{ value: c.label, position: 'insideBottom', offset: -14, fill: BC.grey, fontSize: 11 }} height={50} />
            <YAxis tick={{ fill: BC.grey, fontSize: 10 }} stroke={BC.grid} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, 1]} label={{ value: 'Probability of each class', angle: -90, position: 'insideLeft', offset: 14, style: { textAnchor: 'middle' }, fill: BC.grey, fontSize: 11 }} width={56} />
            <Tooltip contentStyle={BTIP} formatter={(v: number, n: string) => [bpct(v, 1), n]} labelFormatter={(x) => `${c.label}: ${x}`} />
            <ReferenceLine x={c.points.reduce((b: any, p: any) => (Math.abs(p.x - c.current) < Math.abs(b.x - c.current) ? p : b), c.points[0]).x} stroke="#fff" strokeDasharray="4 3" label={{ value: 'this profile', fill: '#fff', fontSize: 9, position: 'top' }} />
            <Line type="monotone" dataKey="low" name="Low" stroke={BC.green} dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="medium" name="Medium" stroke={BC.amber} dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="high" name="High" stroke={BC.pink} dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="bm-note">The model is a plain logistic regression, so these curves are smooth by construction. They show what the model learned from US adults aged 40 to 80, not what would happen to one person.</p>
    </Panel>
  );
}

function Reliability({ bone }: { bone: any }) {
  const r = bone.reliability;
  const colors: Record<string, string> = { Low: BC.green, Medium: BC.amber, High: BC.pink };
  return (
    <Panel title="How far to trust it" subtitle={r.population ?? 'Training population'} icon={<ShieldAlert size={18} className="purple-icon" />}>
      {r.base_rates && (
        <>
          <div className="bm-kpis" style={{ marginBottom: 6 }}><div><span>Training adults</span><b>{r.n?.toLocaleString()}</b><small>NHANES, cross-validated</small></div>
            {r.macro_auc != null && <div><span>Macro AUC</span><b>{bf(r.macro_auc, 2)}</b><small>0.5 = coin flip, 1 = perfect</small></div>}
            {r.balanced_accuracy != null && <div><span>Balanced accuracy</span><b>{bpct(r.balanced_accuracy)}</b><small>3 classes, chance = 33%</small></div>}</div>
          <div className="bm-note" style={{ margin: '4px 0' }}>Share of each class among the training adults</div>
          <div className="bm-stack">{Object.entries(r.base_rates).map(([k, v]: any) => <i key={k} style={{ width: `${v * 100}%`, background: colors[k] }} title={`${k} ${bpct(v, 1)}`} />)}</div>
          <div className="bm-legend">{Object.entries(r.base_rates).map(([k, v]: any) => <span key={k}><i style={{ background: colors[k] }} />{k} {bpct(v, 1)}</span>)}</div>
        </>
      )}
      {r.per_class && (
        <div className="bm-wrap" style={{ marginTop: 10 }}>
          <table className="bm-tbl">
            <thead><tr><th>Model said</th><th>Right when it said so</th><th>Caught of the real ones</th><th>Adults</th></tr></thead>
            <tbody>{['Low', 'Medium', 'High'].filter((k) => r.per_class[k]).map((k) => (
              <tr key={k}><td><b style={{ color: colors[k] }}>{k}</b></td><td className="n">{bpct(r.per_class[k].precision)}</td><td className="n">{bpct(r.per_class[k].recall)}</td><td className="n">{r.per_class[k].support.toLocaleString()}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="bm-note">High is rare, so most High answers are false alarms even though most truly High adults are caught. Use it to decide who to look at more closely, not to label anyone.</p>
    </Panel>
  );
}

/* ---- exercise log ------------------------------------------------------------------------------------------------------- */

function ExerciseLog({ astronautId, ex }: { astronautId: number; ex: any }) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState('');
  const [kind, setKind] = useState<'aerobic' | 'resistive' | 'mixed' | 'other'>('resistive');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => logExercise({ astronaut_id: astronautId, minutes: Math.round(Number(minutes)), kind, performed_at: new Date(`${date}T12:00:00`).toISOString(), client_uuid: buid() }),
    onSuccess: () => { setMsg('Session saved.'); setMinutes(''); void qc.invalidateQueries({ queryKey: ['bm-insight'] }); },
    onError: (e: any) => {
      const m = String(e?.message ?? '');
      const why = /^Not Found$/i.test(m) ? 'The running backend has no /exercise route. Copy the new backend files (exercise endpoint, model, router) and restart it.'
        : /astronaut not found/i.test(m) ? `Astronaut ${astronautId} does not exist in the database. Create it or pick another astronaut.`
        : /timeout|network/i.test(m) ? 'The backend is not reachable. Check it is running.'
        : m || 'Unknown error.';
      setMsg(`Could not save the session. ${why}`);
    },
  });
  const ok = Number(minutes) >= 1 && Number(minutes) <= 600 && astronautId > 0;
  return (
    <Panel title="Log an exercise session" subtitle="Builds the weekly view above. Kept separate from Daily Check-in, so nothing else changes" icon={<Dumbbell size={18} className="purple-icon" />}>
      <div className="bm-form">
        <label><span>Date</span><input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span>Minutes</span><input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 45" /></label>
        <label><span>Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="resistive">Resistive (strength)</option><option value="aerobic">Aerobic</option><option value="mixed">Mixed</option><option value="other">Other</option>
          </select>
        </label>
        <button className="primary-button" disabled={!ok || save.isPending} onClick={() => { setMsg(null); save.mutate(); }}>{save.isPending ? <Loader2 size={14} /> : <Dumbbell size={14} />} Save session</button>
      </div>
      {msg && <p className="bm-note">{msg}</p>}
      {ex && !ex.available && <p className="bm-note">{ex.reason} The weekly view appears once there are enough sessions.</p>}
      {!ex && <p className="bm-note">Log a few sessions and the weekly view, streaks and adherence appear here.</p>}
    </Panel>
  );
}

function ExerciseView({ ex }: { ex: any }) {
  const s = ex.summary;
  const r = ex.rules;
  const a = ex.adherence;
  const max = Math.max(...ex.daily.map((d: any) => d.minutes), 1);
  const weekData = ex.weeks.map((w: any) => ({ week: `${bday(w.start)}`, minutes: w.minutes, strength: w.strength_days, active: w.active_days }));
  const kindTotal = Object.entries(s.kinds) as [string, any][];
  return (
    <>
      <BSection icon={<Dumbbell size={17} />} title="Your exercise, week by week" sub={`Logged sessions from ${bday(ex.window.start)} to ${bday(ex.window.end)}. Ground minimum and in-flight routine are published references, not targets set by this app.`} />
      <BReadings cards={ex.reading} />
      <div className="bm-grid bm-g2">
        <Panel title="Minutes per week" subtitle="Against the ground minimum and the in-flight routine" icon={<Activity size={18} className="purple-icon" />}>
          <div style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={weekData} margin={{ left: 0, right: 10, top: 8, bottom: 16 }}>
                <CartesianGrid stroke={BC.grid} vertical={false} />
                <XAxis dataKey="week" tick={{ fill: BC.grey, fontSize: 10 }} stroke={BC.grid} label={{ value: 'Week starting', position: 'insideBottom', offset: -14, fill: BC.grey, fontSize: 11 }} height={50} />
                <YAxis tick={{ fill: BC.grey, fontSize: 10 }} stroke={BC.grid} width={56} label={{ value: 'Exercise minutes per week', angle: -90, position: 'insideLeft', offset: 14, style: { textAnchor: 'middle' }, fill: BC.grey, fontSize: 11 }} domain={[0, (m: number) => Math.max(m, r.flight_week_min)]} />
                <Tooltip contentStyle={BTIP} formatter={(v: number, n: string) => [`${v}${n === 'minutes' ? ' min' : ' days'}`, n]} labelFormatter={(l) => `Week to ${l}`} />
                <ReferenceLine y={r.who_week_min} stroke={BC.green} strokeDasharray="4 3" label={{ value: `${r.who_week_min} min · WHO minimum`, fill: BC.green, fontSize: 9, position: 'insideTopLeft' }} />
                <ReferenceLine y={r.flight_week_min} stroke={BC.violet} strokeDasharray="4 3" label={{ value: `${r.flight_week_min} min · ISS routine`, fill: BC.violet, fontSize: 9, position: 'insideTopLeft' }} />
                <Bar dataKey="minutes" fill={BC.blue} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="At a glance" subtitle={`${s.sessions} sessions · ${s.days_in_span} days`} icon={<Timer size={18} className="purple-icon" />}>
          <div className="bm-kpis">
            <div><span>Active days</span><b>{s.active_days}/{s.days_in_span}</b><small>{bpct(s.active_share)} of days</small></div>
            <div><span>Avg per active day</span><b>{bf(s.avg_minutes_per_active_day, 0)} min</b><small>flag line {r.flag_min_day} min</small></div>
            <div><span>Streak</span><b>{s.current_streak} d</b><small>longest {s.longest_streak} d</small></div>
            <div><span>Longest gap</span><b>{s.longest_gap_days} d</b><small>days with no session</small></div>
          </div>
          <div className="bm-note" style={{ margin: '4px 0' }}>Split by type (minutes)</div>
          <div className="bm-stack">{kindTotal.map(([k, v]) => <i key={k} style={{ width: `${v.share * 100}%`, background: KIND_COLOR[k] ?? BC.grey }} title={`${k} ${v.minutes} min`} />)}</div>
          <div className="bm-legend">{kindTotal.map(([k, v]) => <span key={k}><i style={{ background: KIND_COLOR[k] ?? BC.grey }} />{k} {bpct(v.share)}</span>)}</div>
          <div className="bm-ref">
            <div><b>{a.weeks_meeting_who}/{a.full_weeks}</b>weeks at or above {r.who_week_min} min</div>
            <div><b>{a.weeks_meeting_strength}/{a.full_weeks}</b>weeks with {r.strength_days_week}+ strength days</div>
            <div><b>{a.weeks_meeting_flight}/{a.full_weeks}</b>weeks matching the ISS routine</div>
          </div>
        </Panel>
      </div>
      <Panel title="Day by day" subtitle="Minutes per day, coloured by the main type of session" icon={<BarChart3 size={18} className="purple-icon" />}>
        <div className="bm-days">
          {ex.daily.map((d: any) => (
            <i key={d.date} title={`${bday(d.date)} · ${d.minutes} min${d.kinds.length ? ` · ${d.kinds.join(', ')}` : ' · rest'}`}
              style={{ height: `${Math.max(4, (d.minutes / max) * 100)}%`, background: d.minutes ? (KIND_COLOR[d.kinds.includes('resistive') ? 'resistive' : d.kinds[0]] ?? BC.blue) : '#252c49' }} />
          ))}
        </div>
        <div className="bm-days-scale"><span>{bday(ex.daily[0].date)}</span><span>{bday(ex.daily[ex.daily.length - 1].date)}</span></div>
        <div className="bm-legend">{Object.entries(KIND_COLOR).map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)}<span><i style={{ background: '#252c49' }} />rest day</span></div>
      </Panel>
    </>
  );
}

function TodayRefs({ today }: { today: any }) {
  const rows = [
    { label: 'Weak-flag line', value: today.flag_min, note: 'below this, the app raises its exercise flag' },
    { label: 'Ground, per day', value: today.who_daily, note: 'WHO 150 min a week spread over 7 days' },
    { label: 'ISS routine, per day', value: today.flight_daily, note: 'about 2 hours, 6 days a week (NASA)' },
  ];
  return (
    <Panel title="Today's minutes against the references" subtitle={`${bf(today.minutes, 0)} min entered${today.steps != null ? ` · ${today.steps.toLocaleString()} steps` : ''}`} icon={<Footprints size={18} className="purple-icon" />}>
      {rows.map((r) => {
        const frac = Math.min(1, today.minutes / r.value);
        const color = today.minutes >= r.value ? BC.green : frac >= 0.5 ? BC.amber : BC.pink;
        return (
          <div className="bm-reg" key={r.label}>
            <span>{r.label}<small>{r.note}</small></span>
            <div className="bm-meter"><i style={{ width: `${frac * 100}%`, background: color }} /></div>
            <span style={{ textAlign: 'right', font: "600 12px 'DM Mono',monospace" }}>{bf(today.minutes, 0)} / {bf(r.value, 0)}</span>
          </div>
        );
      })}
      <p className="bm-note">One day does not describe a week; the weekly view above uses the sessions you log.</p>
    </Panel>
  );
}

/* ---- musculoskeletal reports -------------------------------------------------------------------------------------------- */

function Msk({ msk }: { msk: any }) {
  const sevColor = (v: number) => (v >= 7 ? BC.pink : v >= 4 ? BC.amber : BC.green);
  return (
    <>
      <BSection icon={<AlertTriangle size={17} />} title="Musculoskeletal reports" sub={`${msk.total_reports} body-map reports in ${msk.days} days for the spine, load-bearing and limb regions. Head, chest and abdomen are left to the Body Map page.`} />
      <BReadings cards={msk.reading} />
      <Panel title="By region" subtitle="Latest severity, out of 10" icon={<Bone size={18} className="purple-icon" />}>
        {msk.regions.map((r: any) => (
          <div className="bm-reg" key={r.code}>
            <span>{r.name}{r.load_bearing && <BChip color={BC.violet}>load-bearing</BChip>}<small>{r.group} · {r.count} report{r.count !== 1 ? 's' : ''} · mean {bf(r.mean_severity)} · max {r.max_severity}{r.types?.length ? ` · ${r.types.map((t: any) => t[0]).join(', ')}` : ''}</small></span>
            <div className="bm-meter"><i style={{ width: `${r.latest_severity * 10}%`, background: sevColor(r.latest_severity) }} /></div>
            <span style={{ textAlign: 'right', font: "600 12px 'DM Mono',monospace", color: sevColor(r.latest_severity) }}>{r.latest_severity}/10{r.trend !== 'insufficient_data' && <small style={{ display: 'block', color: '#8992b1' }}>{r.trend}</small>}</span>
          </div>
        ))}
        <p className="bm-note">{msk.note}</p>
      </Panel>
    </>
  );
}

/* ---- published references ----------------------------------------------------------------------------------------------- */

function References({ ref_ }: { ref_: any }) {
  return (
    <>
      <BSection icon={<BookOpen size={17} />} title="What the published numbers say" sub="Reference values from NASA and WHO. These are published averages for other people, not measurements of this crew." />
      <div className="bm-grid bm-g2">
        <Panel title="Reference table" subtitle="What spaceflight does, and what the exercise prescription is" icon={<ClipboardList size={18} className="purple-icon" />}>
          <div className="bm-wrap">
            <table className="bm-tbl">
              <thead><tr><th>Area</th><th style={{ minWidth: 240 }}>What</th><th>Value</th><th style={{ minWidth: 150 }}>Applies to</th></tr></thead>
              <tbody>{ref_.rows.map((r: any, i: number) => (
                <tr key={i}><td><b>{r.area}</b></td><td>{r.what}<small>{r.source}</small></td><td className="n" style={{ whiteSpace: 'normal' }}>{r.value}</td><td>{r.applies}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Bone loss, as arithmetic" subtitle="Hip and spine, no countermeasures" icon={<Bone size={18} className="purple-icon" />}>
          <div className="bm-ref">
            {ref_.illustration.map((i: any) => <div key={i.days}><b>{bf(i.low)}–{bf(i.high)}%</b>after {i.days} days</div>)}
          </div>
          <p className="bm-note">{ref_.illustration_note}</p>
        </Panel>
      </div>
    </>
  );
}

/* ---- the whole block ---------------------------------------------------------------------------------------------------- */

/** One shared query for the deep dive; the calculator reads the backend profile from it for its placeholders. */
function useBoneInsightQuery() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days: 30 }), [astronautId, selection]);
  const q = useQuery({ queryKey: ['bm-insight', req], queryFn: () => getBoneMuscleInsight(req), enabled: astronautId > 0, retry: 0, staleTime: 30_000 });
  return { q, astronautId };
}

/** AI recommendations under the calculator: written by the backend (Gemini first, Groq fallback) from the calculated values. */
function BoneAdvice() {
  const astronautId = useAstronautStore((s) => s.astronautId);
  const selection = useRunStore((s) => s.selection);
  const language = useRunStore((s) => s.language);
  const typed = Object.values(selection.bone_profile ?? {}).some((v) => v !== null && v !== undefined);
  const req = useMemo(() => ({ ...(selection as DayRequest), astronaut_id: astronautId, days: 30, language }), [astronautId, selection, language]);
  const ai = useQuery({ queryKey: ['bm-ai', req], queryFn: () => getBoneAdvice(req), enabled: typed && astronautId > 0, retry: 0, staleTime: 60 * 60_000 });
  if (!typed) return null;
  const result = ai.data?.ai?.result ?? null;
  const problem = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;
  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid #1f2745' }}>
      <div className="av-sub-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={15} /> What to do with these values · AI{ai.data?.ai?.model ? ` · ${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : ''}</div>
      <p className="av-rec-note">Written by the AI from the values you calculated, your exercise log and body-map reports. It never changes the screening result.</p>
      <div style={{ margin: '8px 0 12px' }}>
        <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => ai.refetch()}>
          {ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />} Ask the AI again
        </button>
      </div>
      {ai.isFetching && !result && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for recommendations…</p>}
      {problem && !ai.isFetching && <p className="av-rec-note warn">AI recommendations are not available right now ({problem}). Tap “Ask the AI again” in a moment.</p>}
      {result && (
        <>
          {result.summary && <p className="av-summary">{result.summary}</p>}
          {result.contact_medical_officer && (
            <div className="av-callout"><PhoneCall size={17} /><div><b>Contact the mission medical officer.</b>{result.contact_reason && <p>{result.contact_reason}</p>}</div></div>
          )}
          {(result.recommendations ?? []).map((r, i) => (
            <div className="av-rec-item" key={`${r.action}-${i}`}>
              <p>{r.action}</p>
              <div className="av-rec-meta"><span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span>{r.evidence && <EvidenceTag kind={r.evidence} />}</div>
            </div>
          ))}
          {(result.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
          {(result.key_findings ?? []).map((f) => <p className="av-rec-note" key={f}>• {f}</p>)}
          {(result.data_gaps ?? []).length > 0 && <div className="av-sub-head">Could not be checked</div>}
          {(result.data_gaps ?? []).map((g) => <p className="av-rec-note" key={g}>• {g}</p>)}
          <p className="av-rec-note">{result.disclaimer ?? ai.data?.disclaimer}</p>
        </>
      )}
    </div>
  );
}

function BoneInsights() {
  const { q, astronautId } = useBoneInsightQuery();
  const d = q.data;
  const bone = d?.bone?.available ? d.bone : null;
  const ex = d?.exercise?.available ? d.exercise : null;
  return (
    <>
      <style>{BM_CSS}</style>
      {q.isLoading && <p className="muted" style={{ marginTop: 28 }}><Loader2 size={13} /> Reading the bone model and your logs…</p>}
      {q.isError && <p className="muted" style={{ marginTop: 28 }}><WifiOff size={13} /> The deep dive could not be loaded. The calculator above still works.</p>}
      {d && (
        <>
          {bone && (
            <>
              <BSection icon={<Bone size={17} />} title="Inside the bone-risk result" sub="The same saved model, opened up: which inputs are in range, what pushes the answer, what would change it and how far to trust it." />
              <BReadings cards={bone.reading} />
              <ReferenceTable bone={bone} />
              <div className="bm-grid bm-g12" style={{ marginTop: 14 }}><Drivers bone={bone} /><Levers bone={bone} /></div>
              <div className="bm-grid bm-g2e"><Curves bone={bone} /><Reliability bone={bone} /></div>
            </>
          )}
          {ex && <ExerciseView ex={ex} />}
          <div className="bm-grid bm-g2e" style={{ marginTop: 14 }}>
            <ExerciseLog astronautId={astronautId} ex={d.exercise} />
            {d.today ? <TodayRefs today={d.today} /> : <div />}
          </div>
          {d.msk && <Msk msk={d.msk} />}
          {d.reference && <References ref_={d.reference} />}
          <p className="bm-note">{d.disclaimer}</p>
        </>
      )}
    </>
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
                <BoneAdvice />
              </Panel>

              <BoneInsights />
            </>
          );
        }}
      </DataGate>
    </section>
  );
}
