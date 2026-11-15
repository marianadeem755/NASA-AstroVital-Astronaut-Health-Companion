import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, ArrowRight, Atom, CalendarClock, Gauge, Loader2, Orbit, PhoneCall, Radiation, RefreshCw, Rocket, ShieldHalf, Sparkles, Sun, TrendingUp, TriangleAlert,
} from 'lucide-react';
import { DataGate, EvidenceTag, Meter, Notice, PageHeader, Panel, Stat, TONE_COLOR, type Tone } from '../../../shared/components/live';
import { getRadiationAdvice, type RadiationAdviceRequest } from '../../../services/ml.service';
import { useRunStore } from '../../../store/useRunStore';

/* =====================================================================================
 * Radiation Monitor.
 * The backend has no dosimeter file, so this page does not pretend to show a measurement.
 * It runs a transparent exposure model built on published measured dose rates for each
 * environment (see ENVIRONMENTS), then adds the mission plan, the crew career limit,
 * shielding scenarios and an optional real dosimeter reading to compare against.
 * Every recommendation and the storm-shelter routine are written by the AI through the backend
 * (POST /ml/radiation-recommendations, Gemini first, Grok/Groq fallback). Nothing advisory is hardcoded here.
 * Nothing here repeats the Vitals or Overview pages (no blood, HRV, sleep, level or model cards).
 * ===================================================================================== */

// ---------- reference data -------------------------------------------------------------
type EnvKey = 'earth' | 'leo' | 'mars' | 'moon' | 'deep';

const ENVIRONMENTS: Record<EnvKey, { label: string; rate: number; color: string; source: string }> = {
  earth: { label: 'Earth (natural background)', rate: 2.4 / 365, color: '#8992b1', source: 'UNSCEAR world average, about 2.4 mSv per year' },
  leo: { label: 'Low Earth orbit (ISS)', rate: 0.52, color: '#58d8ff', source: 'ISS dosimetry, typical 0.3 to 0.8 mSv per day' },
  mars: { label: 'Mars surface', rate: 0.64, color: '#ffd37c', source: 'MSL RAD, Curiosity rover (Hassler et al. 2014)' },
  moon: { label: 'Lunar surface', rate: 1.37, color: '#b47bff', source: 'Chang’e-4 lander dosimeter (Zhang et al. 2020)' },
  deep: { label: 'Deep-space transit', rate: 1.84, color: '#ff6b8b', source: 'MSL RAD cruise to Mars (Zeitlin et al. 2013)' },
};

type Phase = { label: string; env: EnvKey; days: number };
type MissionKey = 'mars' | 'moon';

const MISSIONS: Record<MissionKey, { label: string; phases: Phase[] }> = {
  mars: {
    label: 'Mars mission (conjunction class)',
    phases: [
      { label: 'Transit out', env: 'deep', days: 180 },
      { label: 'Mars surface', env: 'mars', days: 500 },
      { label: 'Transit back', env: 'deep', days: 180 },
    ],
  },
  moon: {
    label: 'Lunar base mission (6 months)',
    phases: [
      { label: 'Transit out', env: 'deep', days: 4 },
      { label: 'Lunar surface', env: 'moon', days: 172 },
      { label: 'Transit back', env: 'deep', days: 4 },
    ],
  },
};

const SHIELDING = [
  { key: 'base', label: 'Baseline hull and habitat', factor: 1 },
  { key: 'enh', label: 'Enhanced (hydrogen-rich walls)', factor: 0.85 },
  { key: 'max', label: 'Heavy (what-if design target)', factor: 0.7 },
] as const;

const LIMITS = [
  { key: 'nasa', label: 'NASA career limit', value: 600, color: '#ffd37c' },
  { key: 'esa', label: 'ESA career limit', value: 1000, color: '#ff6b8b' },
] as const;

const UNCERTAINTY = 0.2; // measured rates move about ±20 % with solar cycle, shielding and location
const CHEST_XRAY_MSV = 0.1; // rounded everyday comparison
const EARTH_YEAR_MSV = 2.4;
const ICRP_RISK_PER_SV = 0.05; // nominal lifetime cancer risk per sievert, population average

const COLORS = { cyan: '#58d8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', grey: '#8992b1', grid: '#252d4b', axis: '#8992b1' };
const mono = { font: "9px 'DM Mono', monospace", letterSpacing: 1.2, textTransform: 'uppercase' as const, color: COLORS.grey };

const fmt = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
const toneForShare = (share: number): Tone => (share >= 0.8 ? 'bad' : share >= 0.5 ? 'warn' : 'ok');

// ---------- the exposure model ---------------------------------------------------------
type Model = ReturnType<typeof buildModel>;

function buildModel(mission: MissionKey, factor: number) {
  const phases = MISSIONS[mission].phases;
  const total = phases.reduce((s, p) => s + p.days, 0);
  const rates: number[] = []; // rate on each mission day, index 0 = day 1
  const phaseIndex: number[] = [];
  phases.forEach((p, i) => { for (let d = 0; d < p.days; d += 1) { rates.push(ENVIRONMENTS[p.env].rate * factor); phaseIndex.push(i); } });
  const cum: number[] = [0];
  rates.forEach((r, i) => cum.push(cum[i] + r));
  const starts: number[] = [];
  phases.reduce((acc, p) => { starts.push(acc); return acc + p.days; }, 0);
  const phaseDose = phases.map((p) => ENVIRONMENTS[p.env].rate * factor * p.days);
  return { phases, total, rates, phaseIndex, cum, starts, phaseDose, finalDose: cum[total] };
}

function firstDayAtOrAbove(model: Model, prior: number, limit: number): number | null {
  for (let d = 1; d <= model.total; d += 1) if (prior + model.cum[d] >= limit) return d;
  return null;
}

// ---------- hover card: same look as the Overview page ---------------------------------
type TipSpec = { title: string; sub?: string; rows: [string, ReactNode][]; tone?: Tone; note?: string };
type TipItem = { payload?: Record<string, any> };

function RichTip({ active, payload, label, spec }: { active?: boolean; payload?: TipItem[]; label?: string | number; spec: (items: TipItem[], label?: string | number) => TipSpec | null }) {
  if (!active || !payload?.length) return null;
  const t = spec(payload, label);
  if (!t) return null;
  return (
    <div className="rad-tip" style={{ ['--tip' as string]: TONE_COLOR[t.tone ?? 'mute'] === TONE_COLOR.mute ? '#b47bff' : TONE_COLOR[t.tone as Tone] }}>
      <div className="rad-tip-title">{t.title}</div>
      {t.sub && <div className="rad-tip-sub">{t.sub}</div>}
      <div className="rad-tip-rows">{t.rows.map(([k, v]) => <Fragment key={k}><span>{k}</span><span>{v}</span></Fragment>)}</div>
      {t.note && <div className="rad-tip-note">{t.note}</div>}
    </div>
  );
}

// ---------- small building blocks ------------------------------------------------------
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="rad-field">
      <span style={mono}>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Insight({ icon, title, tone, children }: { icon: ReactNode; title: string; tone: Tone; children: ReactNode }) {
  return (
    <div className={`rad-insight av-tone-${tone}`}>
      <div className="rad-insight-icon">{icon}</div>
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="section-title-row" style={{ marginTop: 30 }}>
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: COLORS.violet, display: 'inline-flex' }}>{icon}</span>{title}</h2>
        {sub && <p style={{ maxWidth: 780 }}>{sub}</p>}
      </div>
    </div>
  );
}

function RadiationStyles() {
  return (
    <style>{`
      .rad-controls { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; align-items: end; }
      .rad-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
      .rad-field small { font-size: 10px; color: #7f89a8; line-height: 1.4; }
      .rad-field input[type=number] { background: #121a37; color: #d8dcf0; border: 1px solid #343d62; border-radius: 8px; padding: 9px 12px; font-size: 11px; width: 100%; }
      .rad-field input[type=range] { width: 100%; accent-color: #b47bff; margin: 7px 0 2px; }
      .rad-two { display: grid; grid-template-columns: 1.55fr 1fr; gap: 14px; margin-bottom: 14px; }
      .rad-three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 14px; }
      .rad-stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
      .rad-insights { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .rad-insight { display: flex; gap: 12px; padding: 14px; border: 1px solid #293252; border-left-width: 3px; border-radius: 11px; background: #0f1630; }
      .rad-insight b { font-size: 12px; color: #e5e7f4; }
      .rad-insight p { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: #a9b2d0; }
      .rad-insight-icon { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: #1a2142; flex: none; }
      .rad-insight.av-tone-ok { border-left-color: #55e6b1; } .rad-insight.av-tone-ok .rad-insight-icon { color: #55e6b1; }
      .rad-insight.av-tone-warn { border-left-color: #ffd37c; } .rad-insight.av-tone-warn .rad-insight-icon { color: #ffd37c; }
      .rad-insight.av-tone-bad { border-left-color: #ff6b8b; } .rad-insight.av-tone-bad .rad-insight-icon { color: #ff6b8b; }
      .rad-insight.av-tone-mute { border-left-color: #8992b1; } .rad-insight.av-tone-mute .rad-insight-icon { color: #8992b1; }
      .rad-split { display: flex; height: 22px; border-radius: 6px; overflow: hidden; background: #252c49; }
      .rad-split i { display: block; height: 100%; }
      .rad-split-row { margin-bottom: 16px; }
      .rad-split-row > div:first-child { display: flex; justify-content: space-between; margin-bottom: 7px; }
      .rad-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 10px; font-size: 10px; color: #a9b2d0; }
      .rad-legend span { display: inline-flex; align-items: center; gap: 6px; }
      .rad-legend i { width: 9px; height: 9px; border-radius: 3px; display: inline-block; }
      .rad-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .rad-table th { text-align: left; font: 9px 'DM Mono', monospace; letter-spacing: 1px; text-transform: uppercase; color: #8992b1; padding: 8px 8px; border-bottom: 1px solid #252d4b; }
      .rad-table td { padding: 10px 8px; border-bottom: 1px solid #1d2441; color: #d2d7e9; }
      .rad-table tr.now td { background: #1a1f45; }
      .rad-link { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid #252d4b; text-decoration: none; color: inherit; }
      .rad-link b { display: block; font-size: 11px; color: #e5e7f4; }
      .rad-link small { display: block; font-size: 10px; color: #8d97b4; margin-top: 4px; line-height: 1.5; }
      .rad-link svg { color: #9a83ce; flex: none; }
      .rad-step { display: flex; gap: 12px; padding: 10px 0; border-top: 1px solid #252d4b; font-size: 11px; color: #d2d7e9; line-height: 1.55; }
      .rad-step span { font: 10px 'DM Mono', monospace; color: #b47bff; width: 18px; flex: none; }
      .rad-scroll { overflow-x: auto; }
      .rad-chart { position: relative; width: 100%; }
      .rad-tip { box-sizing: border-box; width: min(320px, calc(100vw - 32px)); min-width: 0; background: #0a1029; border: 1px solid #4a5688; border-left: 5px solid var(--tip, #b47bff); border-radius: 10px; padding: 12px 15px 13px; box-shadow: 0 14px 40px #000a; pointer-events: none; overflow-wrap: anywhere; }
      .rad-tip-title { font-size: 15px; font-weight: 700; color: #fff; line-height: 1.35; letter-spacing: -.2px; }
      .rad-tip-sub { font: 10px 'DM Mono', monospace; color: #9aa4c6; margin-top: 4px; line-height: 1.5; }
      .rad-tip-rows { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr); gap: 6px 12px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #2c3560; align-items: baseline; }
      .rad-tip-rows span:nth-child(odd) { font: 10px 'DM Mono', monospace; color: #8f99ba; text-transform: uppercase; letter-spacing: .5px; }
      .rad-tip-rows span:nth-child(even) { font-size: 13px; font-weight: 700; color: #f2f4ff; text-align: right; }
      .rad-tip-note { margin-top: 10px; font-size: 11px; color: #c3c9e4; line-height: 1.5; }
      .rad-insight { transition: border-color .15s ease, background .15s ease; }
      .rad-insight:hover { border-top-color: #7650c6; border-right-color: #7650c6; border-bottom-color: #7650c6; background: #121a3a; }
      .rad-split i { transition: opacity .15s ease, filter .15s ease; }
      .rad-split i:hover { opacity: 1 !important; filter: brightness(1.18); }
      .rad-table tbody tr { transition: background .12s ease; }
      .rad-table tbody tr:hover td { background: #151d3c; }
      .rad-link { transition: background .12s ease; }
      .rad-link:hover b { color: #e1d3ff; }
      .rad-link:hover svg { color: #e1d3ff; }
      .rad-ai-stale { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 14px; padding: 10px 13px; background: #171a3a; border: 1px solid #3d3470; border-radius: 10px; font-size: 11px; color: #cbb5ff; }
      .rad-ai-meta { font: 9px 'DM Mono', monospace; letter-spacing: .8px; text-transform: uppercase; color: #8992b1; margin-top: 12px; }
      .rad-ai-find { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid #1f2745; font-size: 12px; line-height: 1.55; color: #dfe3f3; }
      .rad-ai-find i { width: 6px; height: 6px; border-radius: 50%; background: #b47bff; margin-top: 7px; flex: none; }
      @media (max-width: 1100px) { .rad-controls { grid-template-columns: repeat(2, minmax(0, 1fr)); } .rad-two, .rad-three, .rad-insights { grid-template-columns: 1fr; } }
    `}</style>
  );
}

// ---------- page -----------------------------------------------------------------------
export function RadiationPage() {
  const [mission, setMission] = useState<MissionKey>('mars');
  const [dayInput, setDayInput] = useState(120);
  const [shield, setShield] = useState<(typeof SHIELDING)[number]['key']>('base');
  const [prior, setPrior] = useState(0);
  const [measured, setMeasured] = useState('');
  const language = useRunStore((s) => s.language);
  const [requested, setRequested] = useState<RadiationAdviceRequest | null>(null);
  const [hotEnv, setHotEnv] = useState<number | null>(null);

  const factor = SHIELDING.find((s) => s.key === shield)!.factor;
  const model = useMemo(() => buildModel(mission, factor), [mission, factor]);
  const base = useMemo(() => buildModel(mission, 1), [mission]);

  const day = Math.min(Math.max(dayInput, 1), model.total);
  const phaseNow = model.phases[model.phaseIndex[day - 1]];
  const phaseNowIdx = model.phaseIndex[day - 1];
  const rateNow = model.rates[day - 1];
  const doseToDate = model.cum[day];
  const careerNow = prior + doseToDate;
  const careerEnd = prior + model.finalDose;
  const nasaShare = careerNow / 600;
  const endShare = careerEnd / 600;
  const daysLeftInPhase = model.starts[phaseNowIdx] + phaseNow.days - day;

  const crossNasa = firstDayAtOrAbove(model, prior, 600);
  const crossEsa = firstDayAtOrAbove(model, prior, 1000);
  const remainingToNasa = Math.max(0, 600 - careerNow);
  const daysToNasaAtRate = rateNow > 0 ? remainingToNasa / rateNow : null;

  const measuredNum = measured.trim() === '' ? null : Number(measured);
  const hasMeasured = measuredNum != null && Number.isFinite(measuredNum) && measuredNum >= 0;
  const measuredDelta = hasMeasured ? (measuredNum as number) - doseToDate : null;
  const measuredRatio = hasMeasured && doseToDate > 0 ? (measuredNum as number) / doseToDate : null;

  // chart data: one point per 3 days keeps 860-day missions light
  const chartData = useMemo(() => {
    const step = model.total > 300 ? 4 : 1;
    const rows: { day: number; expected: number; low: number; high: number; career: number }[] = [];
    for (let d = 0; d <= model.total; d += step) rows.push({ day: d, expected: model.cum[d], low: model.cum[d] * (1 - UNCERTAINTY), high: model.cum[d] * (1 + UNCERTAINTY), career: prior + model.cum[d] });
    if (rows[rows.length - 1].day !== model.total) rows.push({ day: model.total, expected: model.finalDose, low: model.finalDose * (1 - UNCERTAINTY), high: model.finalDose * (1 + UNCERTAINTY), career: prior + model.finalDose });
    return rows;
  }, [model, prior]);

  const shownLimits = LIMITS.filter((l) => l.value - prior > 0 && l.value - prior < model.finalDose * 1.6 + 200);
  const yMax = Math.ceil((Math.max(model.finalDose * (1 + UNCERTAINTY), ...shownLimits.map((l) => l.value - prior)) * 1.08) / 50) * 50;

  const phaseRows = model.phases.map((p, i) => ({
    ...p,
    index: i,
    rate: ENVIRONMENTS[p.env].rate * factor,
    dose: model.phaseDose[i],
    dayShare: p.days / model.total,
    doseShare: model.phaseDose[i] / model.finalDose,
    done: Math.min(Math.max(day - model.starts[i], 0), p.days),
  }));
  const topPhase = [...phaseRows].sort((a, b) => b.doseShare - a.doseShare)[0];
  const transitRows = phaseRows.filter((p) => p.env === 'deep');
  const transitDoseShare = transitRows.reduce((s, p) => s + p.doseShare, 0);
  const transitDayShare = transitRows.reduce((s, p) => s + p.dayShare, 0);

  const envBars = (Object.keys(ENVIRONMENTS) as EnvKey[]).map((k) => ({
    key: k,
    name: ENVIRONMENTS[k].label.replace(' (natural background)', '').replace(' (ISS)', ''),
    rate: ENVIRONMENTS[k].rate * (k === 'earth' ? 1 : factor),
    times: (ENVIRONMENTS[k].rate * (k === 'earth' ? 1 : factor)) / ENVIRONMENTS.earth.rate,
    color: ENVIRONMENTS[k].color,
    here: phaseNow.env === k,
  }));

  const shieldSaving = base.finalDose - model.finalDose;
  const earthYears = doseToDate / EARTH_YEAR_MSV;
  const xrays = doseToDate / CHEST_XRAY_MSV;
  const extraRisk = (careerEnd / 1000) * ICRP_RISK_PER_SV * 100;

  const limitTone = toneForShare(nasaShare);
  const endTone = toneForShare(endShare);

  // Summary of this set-up that the backend gives to the AI. Rounded so the same set-up always gives the same cache key.
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const payload: RadiationAdviceRequest = {
    mission,
    mission_label: MISSIONS[mission].label,
    mission_day: day,
    mission_total_days: model.total,
    phase: phaseNow.label,
    phase_days_left: daysLeftInPhase,
    environment: ENVIRONMENTS[phaseNow.env].label,
    dose_rate_msv_per_day: Math.round(rateNow * 1000) / 1000,
    dose_to_date_msv: r1(doseToDate),
    prior_career_dose_msv: r1(prior),
    career_dose_now_msv: r1(careerNow),
    career_dose_end_of_plan_msv: r1(careerEnd),
    nasa_limit_msv: 600,
    esa_limit_msv: 1000,
    share_of_nasa_limit_now_pct: r1(nasaShare * 100),
    share_of_nasa_limit_end_pct: r1(endShare * 100),
    plan_crosses_nasa_limit_on_day: crossNasa,
    shielding_scenario: SHIELDING.find((x) => x.key === shield)!.label,
    shielding_factor: factor,
    shielding_saving_msv: r1(shieldSaving),
    transit_dose_share_pct: transitRows.length ? r1(transitDoseShare * 100) : null,
    uncertainty_pct: UNCERTAINTY * 100,
    measured_dose_msv: hasMeasured ? r1(measuredNum as number) : null,
    measured_vs_expected_pct: hasMeasured && measuredRatio != null ? r1((measuredRatio - 1) * 100) : null,
    phases: phaseRows.map((p) => ({ label: p.label, environment: ENVIRONMENTS[p.env].label, days: p.days, rate_msv_per_day: Math.round(p.rate * 1000) / 1000, dose_msv: r1(p.dose) })),
  };
  const payloadKey = JSON.stringify(payload);
  useEffect(() => { if (requested == null) setRequested(payload); }, [requested, payload]); // first visit: one AI call for the default set-up
  const ai = useQuery({
    queryKey: ['ml-radiation-ai', requested, language],
    queryFn: () => getRadiationAdvice({ ...(requested as RadiationAdviceRequest), language }),
    enabled: requested != null,
    retry: 0,
    staleTime: 60 * 60_000,
  });
  const setupChanged = requested != null && JSON.stringify(requested) !== payloadKey;
  const aiResult = ai.data?.ai?.result ?? null;
  const aiError = ai.data?.ai && !ai.data.ai.result ? (ai.data.ai.error ?? 'No AI provider answered') : ai.error ? (ai.error as Error).message : null;


  return (
    <section className="page-enter">
      <RadiationStyles />
      <PageHeader
        eyebrow="ENVIRONMENTAL EXPOSURE"
        title="Radiation Monitor"
        intro="Where the crew is, how much dose that place delivers, how much of the career limit is used and what changes it. Built for the radiation question only; blood, heart and sleep stay on their own pages."
        right={<div className="mission-day"><span>PHASE</span><b className="av-scenario-name">{phaseNow.label}</b><small>MISSION DAY {day} OF {model.total}</small></div>}
      />
      <DataGate>
        {() => (
          <>
            <Notice>
              <b>Reference exposure model.</b>
              <p>Dose rates come from published measurements in each environment (rover, lander and ISS dosimeters). They are estimates for planning, not a reading from this crew’s own badge. Enter a real dosimeter value below and the page compares it with the estimate.</p>
            </Notice>

            {/* ---------------- controls ---------------- */}
            <Panel title="Mission set-up" subtitle="Change anything and every number, chart and insight below updates" icon={<Rocket size={18} className="purple-icon" />}>
              <div className="rad-controls">
                <Field label="MISSION PLAN">
                  <select className="select-control" value={mission} onChange={(e) => { const m = e.target.value as MissionKey; setMission(m); setDayInput((d) => Math.min(d, MISSIONS[m].phases.reduce((s, p) => s + p.days, 0))); }}>
                    {(Object.keys(MISSIONS) as MissionKey[]).map((k) => <option key={k} value={k}>{MISSIONS[k].label}</option>)}
                  </select>
                </Field>
                <Field label={`MISSION DAY · ${day}`} hint={`${daysLeftInPhase} days left in ${phaseNow.label.toLowerCase()}`}>
                  <input type="range" min={1} max={model.total} value={day} onChange={(e) => setDayInput(Number(e.target.value))} aria-label="Mission day" />
                </Field>
                <Field label="SHIELDING SCENARIO">
                  <select className="select-control" value={shield} onChange={(e) => setShield(e.target.value as typeof shield)}>
                    {SHIELDING.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label="PRIOR CAREER DOSE (mSv)" hint="Earlier flights count toward the limit">
                  <input type="number" min={0} step={10} value={prior} onChange={(e) => setPrior(Math.max(0, Number(e.target.value) || 0))} />
                </Field>
                <Field label="CREW DOSIMETER READING (mSv)" hint="Optional · cumulative this mission">
                  <input type="number" min={0} step={1} placeholder="e.g. 85" value={measured} onChange={(e) => setMeasured(e.target.value)} />
                </Field>
              </div>
            </Panel>

            {/* ---------------- headline numbers ---------------- */}
            <SectionTitle icon={<Radiation size={18} />} title="Exposure today" sub={`${phaseNow.label}: ${ENVIRONMENTS[phaseNow.env].label.toLowerCase()}. ${ENVIRONMENTS[phaseNow.env].source}.`} />
            <div className="metric-grid four">
              <Stat icon={<Radiation size={18} />} label="DOSE THIS MISSION SO FAR" value={fmt(doseToDate, 1)} unit="mSv" tag="proxy" tone={limitTone}
                sub={`${fmt(xrays)} chest X-rays or ${fmt(earthYears, 1)} years of Earth background`} />
              <Stat icon={<Orbit size={18} />} label="DOSE RATE NOW" value={fmt(rateNow, 2)} unit="mSv/day" tag="proxy" tone="mute"
                sub={`${fmt(rateNow / ENVIRONMENTS.earth.rate)}× normal Earth background`} />
              <Stat icon={<Gauge size={18} />} label="NASA CAREER LIMIT USED" value={`${fmt(nasaShare * 100, 1)}%`} tone={limitTone}
                sub={`${fmt(careerNow)} of 600 mSv${prior > 0 ? ` (includes ${fmt(prior)} prior)` : ''}`} />
              <Stat icon={<CalendarClock size={18} />} label="DAYS TO LIMIT AT THIS RATE" value={daysToNasaAtRate == null ? '—' : fmt(daysToNasaAtRate)} unit="days" tone={daysToNasaAtRate != null && daysToNasaAtRate < daysLeftInPhase ? 'bad' : 'mute'}
                sub={crossNasa ? `Plan crosses 600 mSv on mission day ${crossNasa}` : 'The plan never reaches 600 mSv'} />
            </div>

            {/* ---------------- main chart + side ---------------- */}
            <div className="rad-two">
              <Panel title="Cumulative dose across the mission" subtitle="Solid line = expected. Dashed lines = ±20% spread in the measured rates. Shaded blocks = mission phases." icon={<TrendingUp size={18} className="icon-muted" />}>
                <div className="rad-chart" style={{ height: 300 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 12, right: 18, left: 0, bottom: 24 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      {model.phases.map((p, i) => (
                        <ReferenceArea key={p.label + i} x1={model.starts[i]} x2={model.starts[i] + p.days} fill={ENVIRONMENTS[p.env].color} fillOpacity={i === phaseNowIdx ? 0.14 : 0.05} strokeOpacity={0} />
                      ))}
                      <XAxis dataKey="day" type="number" domain={[0, model.total]} stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => `D${v}`} label={{ value: 'Mission day', position: 'insideBottom', offset: -14, fill: COLORS.grey, fontSize: 10 }} />
                      <YAxis stroke={COLORS.axis} fontSize={10} width={62} label={{ value: 'Cumulative dose (mSv)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' }, fill: COLORS.grey, fontSize: 10 }} domain={[0, yMax]} tickFormatter={(v) => `${Math.round(v)}`} allowDataOverflow />
                      {shownLimits.map((l) => (
                        <ReferenceLine key={l.key} y={l.value - prior} stroke={l.color} strokeDasharray="5 4" label={{ value: `${l.label} ${l.value}${prior ? ` (−${fmt(prior)} prior)` : ''}`, position: 'insideTopLeft', fill: l.color, fontSize: 10 }} />
                      ))}
                      <ReferenceLine x={day} stroke="#fff" strokeOpacity={0.7} label={{ value: 'today', position: 'top', fill: '#fff', fontSize: 10 }} />
                      <Tooltip content={<RichTip spec={(items) => {
                        const d = items[0]?.payload as { day: number; expected: number; low: number; high: number; career: number } | undefined;
                        if (!d) return null;
                        const ph = model.phases[model.phaseIndex[Math.max(d.day, 1) - 1]];
                        const share = d.career / 600;
                        return { title: `Mission day ${d.day}`, sub: `${ph.label} · ${ENVIRONMENTS[ph.env].label}`, tone: toneForShare(share), rows: [
                          ['Dose so far', `${fmt(d.expected, 1)} mSv`], ['Spread (±20%)', `${fmt(d.low, 1)} to ${fmt(d.high, 1)}`],
                          ['Career total', `${fmt(d.career, 1)} mSv`], ['NASA limit used', `${fmt(share * 100, 1)}%`],
                        ], note: share >= 1 ? 'Past the 600 mSv NASA career limit.' : `${fmt(Math.max(0, 600 - d.career))} mSv left before the NASA career limit.` };
                      }} />} />
                      <Line type="monotone" dataKey="high" stroke={COLORS.grey} strokeDasharray="4 4" dot={false} strokeWidth={1} />
                      <Line type="monotone" dataKey="low" stroke={COLORS.grey} strokeDasharray="4 4" dot={false} strokeWidth={1} />
                      <Line type="monotone" dataKey="expected" stroke={COLORS.violet} strokeWidth={2.4} dot={false} activeDot={{ r: 5, fill: '#fff' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="rad-legend">
                  {model.phases.map((p, i) => <span key={p.label + i}><i style={{ background: ENVIRONMENTS[p.env].color }} />{p.label} · {p.days} d</span>)}
                </div>
              </Panel>

              <div className="rad-stack">
                <Panel title="Career limit meter" subtitle="White line = the limit. Today and end of plan" icon={<Gauge size={18} className="icon-muted" />}>
                  <div style={mono}>Today · {fmt(careerNow)} mSv</div>
                  <Meter value={careerNow} max={Math.max(1000, careerEnd * 1.05)} threshold={600} tone={limitTone} />
                  <div style={{ ...mono, marginTop: 14 }}>End of plan · {fmt(careerEnd)} mSv</div>
                  <Meter value={careerEnd} max={Math.max(1000, careerEnd * 1.05)} threshold={600} tone={endTone} />
                  <div className="av-kv" style={{ marginTop: 14 }}>
                    <div><span>NASA career limit</span><b>600 mSv</b></div>
                    <div><span>ESA career limit</span><b>1,000 mSv</b></div>
                    <div><span>Plan end vs NASA limit</span><b style={{ color: endShare > 1 ? COLORS.pink : COLORS.green }}>{fmt(endShare * 100)}%</b></div>
                    <div><span>Crosses 1,000 mSv</span><b>{crossEsa ? `day ${crossEsa}` : 'never'}</b></div>
                  </div>
                </Panel>
                <Panel title="What this dose means" subtitle="Population-average risk, not an astronaut-specific prediction" icon={<Atom size={18} className="icon-muted" />}>
                  <div className="av-kv" style={{ marginTop: 0 }}>
                    <div><span>Plan-end dose (with prior)</span><b>{fmt(careerEnd)} mSv</b></div>
                    <div><span>Extra lifetime cancer risk</span><b>about {fmt(extraRisk, 1)}%</b></div>
                    <div><span>Spread of that estimate</span><b>{fmt(extraRisk * (1 - UNCERTAINTY), 1)} to {fmt(extraRisk * (1 + UNCERTAINTY), 1)}%</b></div>
                  </div>
                  <p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>Uses the ICRP nominal figure of about 5% per sievert. Space radiation is mostly heavy particles, so real uncertainty is wider than the spread shown.</p>
                </Panel>
              </div>
            </div>

            {/* ---------------- phase insight ---------------- */}
            <SectionTitle icon={<Activity size={18} />} title="Where the dose comes from" sub="Days spent and dose received are not the same thing. Some phases cost far more dose per day." />
            <div className="rad-two">
              <Panel title="Share of days against share of dose" subtitle="If the dose bar is longer for a phase than the days bar, that phase is expensive" icon={<EvidenceTag kind="proxy" />}>
                {(['days', 'dose'] as const).map((kind) => (
                  <div className="rad-split-row" key={kind}>
                    <div><span style={mono}>{kind === 'days' ? 'Mission days' : 'Mission dose'}</span><span style={mono}>{kind === 'days' ? `${model.total} days` : `${fmt(model.finalDose)} mSv`}</span></div>
                    <div className="rad-split">
                      {phaseRows.map((p) => <i key={p.label + p.index} title={`${p.label}: ${fmt((kind === 'days' ? p.dayShare : p.doseShare) * 100)}%`} style={{ width: `${(kind === 'days' ? p.dayShare : p.doseShare) * 100}%`, background: ENVIRONMENTS[p.env].color, opacity: p.index === phaseNowIdx ? 1 : 0.62, borderRight: '2px solid #0d132b' }} />)}
                    </div>
                  </div>
                ))}
                <div className="rad-scroll">
                  <table className="rad-table">
                    <thead><tr><th>Phase</th><th>Days</th><th>mSv/day</th><th>Dose</th><th>Days share</th><th>Dose share</th><th>Done</th></tr></thead>
                    <tbody>
                      {phaseRows.map((p) => (
                        <tr key={p.label + p.index} className={p.index === phaseNowIdx ? 'now' : ''}>
                          <td><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: ENVIRONMENTS[p.env].color, marginRight: 8 }} />{p.label}</td>
                          <td>{p.days}</td><td>{fmt(p.rate, 2)}</td><td>{fmt(p.dose)} mSv</td>
                          <td>{fmt(p.dayShare * 100)}%</td><td><b>{fmt(p.doseShare * 100)}%</b></td>
                          <td>{fmt((p.done / p.days) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel title="Dose rate by environment" subtitle="mSv per day, with the multiple of normal Earth background above each bar" icon={<Orbit size={18} className="icon-muted" />}>
                <div className="rad-chart" style={{ height: 270 }} onMouseLeave={() => setHotEnv(null)}>
                  <ResponsiveContainer>
                    <BarChart data={envBars} margin={{ top: 22, right: 8, left: 0, bottom: 24 }}>
                      <CartesianGrid stroke={COLORS.grid} vertical={false} />
                      <XAxis dataKey="name" stroke={COLORS.axis} fontSize={9} interval={0} tickFormatter={(v: string) => v.split(' ')[0]} label={{ value: 'Environment', position: 'insideBottom', offset: -14, fill: COLORS.grey, fontSize: 10 }} />
                      <YAxis stroke={COLORS.axis} fontSize={10} width={52} label={{ value: 'Dose rate (mSv/day)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' }, fill: COLORS.grey, fontSize: 10 }} tickFormatter={(v) => fmt(v, 1)} />
                      <Tooltip content={<RichTip spec={(items) => {
                        const d = items[0]?.payload as (typeof envBars)[number] | undefined;
                        if (!d) return null;
                        return { title: ENVIRONMENTS[d.key].label, sub: ENVIRONMENTS[d.key].source, tone: 'mute', rows: [
                          ['Dose rate', `${fmt(d.rate, 3)} mSv/day`], ['Against Earth', `${fmt(d.times)}×`], ['A 30-day stay', `${fmt(d.rate * 30, 1)} mSv`], ['Crew here today', d.here ? 'Yes' : 'No'],
                        ], note: d.key === 'earth' ? 'Normal background radiation at the surface of the Earth.' : `Shielding scenario applied: ×${factor}.` };
                      }} />} />
                      <Bar dataKey="rate" radius={[5, 5, 0, 0]} onMouseEnter={(_d: unknown, i: number) => setHotEnv(i)} onMouseLeave={() => setHotEnv(null)} label={{ position: 'top', fill: '#c9cce0', fontSize: 10, formatter: (v: any) => `${fmt(Number(v) / ENVIRONMENTS.earth.rate)}×` }}>
                        {envBars.map((e, i) => <Cell key={e.key} fill={e.color} fillOpacity={hotEnv == null ? (e.here ? 1 : 0.5) : hotEnv === i ? 1 : 0.35} stroke={hotEnv === i || (hotEnv == null && e.here) ? '#fff' : 'none'} strokeWidth={hotEnv === i ? 2 : 1} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>Hover a bar for the detail. The outlined bar is where the crew is on the selected day. The deep-space bar is the cheapest place to lose margin: no planet or atmosphere blocks any of the sky.</p>
              </Panel>
            </div>

            {/* ---------------- computed insights ---------------- */}
            <SectionTitle icon={<ShieldHalf size={18} />} title="What the numbers say" sub="Plain-language findings from the model above. They change when you change the set-up." />
            <div className="rad-insights">
              <Insight icon={<Rocket size={16} />} title={`${topPhase.label} carries ${fmt(topPhase.doseShare * 100)}% of the dose`} tone={topPhase.doseShare > topPhase.dayShare + 0.1 ? 'warn' : 'mute'}>
                It takes {fmt(topPhase.dayShare * 100)}% of the mission days and delivers {fmt(topPhase.dose)} mSv.
                {transitRows.length > 0 && ` Transit alone is ${fmt(transitDayShare * 100)}% of the days but ${fmt(transitDoseShare * 100)}% of the dose, so shortening or shielding transit pays back the most per day saved.`}
              </Insight>
              <Insight icon={<Gauge size={16} />} title={endShare > 1 ? 'The plan goes past the NASA career limit' : 'The plan fits inside the NASA career limit'} tone={endTone}>
                {endShare > 1
                  ? `The limit is crossed on mission day ${crossNasa ?? '—'} (${fmt(crossNasa ? (crossNasa / model.total) * 100 : 0)}% through the mission). By the end the crew would be ${fmt(careerEnd - 600)} mSv over, before any solar event.`
                  : `The end-of-plan dose of ${fmt(careerEnd)} mSv uses ${fmt(endShare * 100)}% of the limit, leaving ${fmt(600 - careerEnd)} mSv of margin for solar events and future flights.`}
              </Insight>
              <Insight icon={<ShieldHalf size={16} />} title={shield === 'base' ? 'What better shielding could save' : `Shielding saves ${fmt(shieldSaving)} mSv`} tone={shield === 'base' ? 'mute' : 'ok'}>
                {shield === 'base'
                  ? `Each 15% cut in dose rate would save about ${fmt(base.finalDose * 0.15)} mSv over this plan. Heavy particles are hard to stop, so this is a design goal, not a given.`
                  : `Compared with the baseline hull (${fmt(base.finalDose)} mSv), this scenario ends at ${fmt(model.finalDose)} mSv. The factor is a what-if value, not a measured one.`}
              </Insight>
              <Insight icon={<CalendarClock size={16} />} title="Time to the limit at today’s rate" tone={daysToNasaAtRate != null && daysToNasaAtRate < daysLeftInPhase ? 'bad' : 'mute'}>
                {daysToNasaAtRate == null ? 'No dose rate for this day.' : remainingToNasa <= 0
                  ? 'The career limit has already been reached for this crew member.'
                  : `If the crew stayed in ${phaseNow.label.toLowerCase()}, the 600 mSv limit would arrive in ${fmt(daysToNasaAtRate)} days. ${daysLeftInPhase} days remain in this phase.`}
              </Insight>
              {hasMeasured && measuredRatio != null && (
                <Insight icon={<Activity size={16} />} title={`Dosimeter reads ${fmt((measuredRatio - 1) * 100)}% ${measuredRatio >= 1 ? 'above' : 'below'} the estimate`}
                  tone={Math.abs(measuredRatio - 1) <= UNCERTAINTY ? 'ok' : measuredRatio > 1 ? 'bad' : 'warn'}>
                  Measured {fmt(measuredNum as number, 1)} mSv against an expected {fmt(doseToDate, 1)} mSv ({measuredDelta! >= 0 ? '+' : ''}{fmt(measuredDelta!, 1)} mSv).
                  {Math.abs(measuredRatio - 1) <= UNCERTAINTY
                    ? ' That is inside the normal ±20% spread, so the reference rates describe this crew well.'
                    : measuredRatio > 1
                      ? ' That is above the spread. A solar particle event, time outside the shelter, or a badge in a thinner-walled area could each explain it.'
                      : ' That is below the spread. Badge location and wear time could each explain it.'}
                </Insight>
              )}
              <Insight icon={<Sun size={16} />} title="Solar storms are not in this estimate" tone="warn">
                The rates are the steady background from the galaxy. A solar particle event adds dose within hours and cannot be predicted far ahead. The AI briefing below covers the shelter routine.
              </Insight>
            </div>

            {/* ---------------- biology + where to look ---------------- */}
            <SectionTitle icon={<Atom size={18} />} title="What radiation can touch, and where AstroVital shows it" sub="Radiation never shows up as one number in the body. These are the systems it can affect, each watched on its own page." />
            <div className="rad-three">
              <Panel title="Immune and blood" subtitle="Dose-sensitive cells" icon={<TriangleAlert size={18} className="icon-muted" />}>
                <p className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 0 }}>White cells, lymphocytes and platelets are among the first blood values to fall after large exposures. After landing the change has many causes, so it is a clue, never a dose.</p>
                <Link to="/vitals" className="rad-link"><div><b>Open Vitals & Physical</b><small>Blood against the astronaut’s own baseline</small></div><ArrowRight size={16} /></Link>
              </Panel>
              <Panel title="Heart and blood vessels" subtitle="Long-term concern" icon={<Activity size={18} className="icon-muted" />}>
                <p className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 0 }}>Cell studies in the project’s own dataset folder (OSD-431, human capillary cells) report that space radiation and microgravity affect vessel-lining cells through different pathways.</p>
                <Link to="/vitals" className="rad-link"><div><b>Open heart rhythm</b><small>HRV windows against the volunteer band</small></div><ArrowRight size={16} /></Link>
              </Panel>
              <Panel title="Mood, sleep and bone" subtitle="Indirect links" icon={<ShieldHalf size={18} className="icon-muted" />}>
                <p className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 0 }}>Radiation, microgravity, isolation and disrupted sleep act together. A dose rise alone should not be read as the cause of a sleep or mood change.</p>
                <Link to="/sleep" className="rad-link"><div><b>Open Sleep</b><small>Sleep quality and flags</small></div><ArrowRight size={16} /></Link>
                <Link to="/bone-muscle" className="rad-link"><div><b>Open Bone & Muscle</b><small>Bone-risk screening</small></div><ArrowRight size={16} /></Link>
              </Panel>
            </div>

            {/* ---------------- AI briefing (everything advisory comes from the backend AI) ---------------- */}
            <SectionTitle icon={<Sparkles size={18} />} title="AI radiation briefing" sub="Written by the AI from this set-up through the backend. No advice on this page is typed in; if the AI cannot answer, nothing is shown in its place." />
            <div className="rad-two">
              <Panel title="Recommendations" subtitle={ai.data?.ai?.model ? `${ai.data.ai.source} · ${ai.data.ai.model}${ai.data.ai.cached ? ' · cached' : ''}` : 'Generated for the plan, limit and dosimeter reading above'} icon={<Sparkles size={18} className="purple-icon" />}>
                <div className="rad-ai-stale">
                  <button className="av-ghost-btn" disabled={ai.isFetching} onClick={() => (setupChanged ? setRequested(payload) : ai.refetch())}>
                    {ai.isFetching ? <Loader2 size={13} className="av-spin" /> : <RefreshCw size={13} />}{setupChanged ? 'Update AI advice for this set-up' : 'Ask the AI again'}
                  </button>
                  {setupChanged && <span>The set-up changed after the last AI answer. Update to get advice for what is on screen now.</span>}
                </div>
                {ai.isFetching && !aiResult && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Asking the AI for radiation recommendations…</p>}
                {aiError && !ai.isFetching && <p className="av-rec-note warn">AI recommendations are not available right now. Tap “Ask the AI again” in a moment.</p>}
                {aiResult && (
                  <>
                    {aiResult.summary && <p className="av-summary">{aiResult.summary}</p>}
                    {aiResult.contact_medical_officer && (
                      <div className="av-callout"><PhoneCall size={17} /><div><b>Contact the mission medical officer.</b>{aiResult.contact_reason && <p>{aiResult.contact_reason}</p>}</div></div>
                    )}
                    {(aiResult.recommendations ?? []).map((r, i) => (
                      <div className="av-rec-item" key={`${r.action}-${i}`}>
                        <p>{r.action}</p>
                        <div className="av-rec-meta"><span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span>{r.evidence && <EvidenceTag kind={r.evidence} />}</div>
                      </div>
                    ))}
                    {(aiResult.key_findings ?? []).length > 0 && <div className="av-sub-head">Key findings</div>}
                    {(aiResult.key_findings ?? []).map((f) => <div className="rad-ai-find" key={f}><i /><span>{f}</span></div>)}
                    {(aiResult.data_gaps ?? []).length > 0 && <div className="av-sub-head">Could not be checked</div>}
                    {(aiResult.data_gaps ?? []).map((g) => <div className="rad-ai-find" key={g}><i style={{ background: COLORS.grey }} /><span>{g}</span></div>)}
                    <div className="rad-ai-meta">{aiResult.disclaimer ?? ai.data?.disclaimer}</div>
                  </>
                )}
              </Panel>
              <div className="rad-stack">
                <Panel title="Solar storm shelter routine" subtitle="Written by the AI for this mission phase" icon={<Sun size={18} className="icon-muted" />}>
                  {ai.isFetching && !aiResult && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Waiting for the AI…</p>}
                  {(aiResult?.storm_shelter_steps ?? []).map((st, i) => <div className="rad-step" key={st}><span>0{i + 1}</span><p style={{ margin: 0 }}>{st}</p></div>)}
                  {!ai.isFetching && !(aiResult?.storm_shelter_steps ?? []).length && <p className="av-rec-note">The AI did not return shelter steps for this set-up. Ask the AI again to retry.</p>}
                </Panel>
                <Panel title="Reference sources" subtitle="Where each rate and limit comes from" icon={<EvidenceTag kind="proxy" />}>
                  <div className="av-kv" style={{ marginTop: 0 }}>
                    {(Object.keys(ENVIRONMENTS) as EnvKey[]).map((k) => <div key={k}><span>{ENVIRONMENTS[k].label}</span><b>{ENVIRONMENTS[k].source}</b></div>)}
                    <div><span>Career limits</span><b>NASA 600 mSv · ESA 1,000 mSv</b></div>
                    <div><span>Cancer risk factor</span><b>ICRP nominal, about 5% per Sv</b></div>
                  </div>
                  <p className="muted" style={{ fontSize: 10, lineHeight: 1.6 }}>Planning aid only. Flight-surgeon limits and the crew’s own dosimetry always take priority.</p>
                </Panel>
              </div>
            </div>
          </>
        )}
      </DataGate>
    </section>
  );
}