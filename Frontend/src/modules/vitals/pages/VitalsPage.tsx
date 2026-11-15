import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Droplets, Footprints, HeartPulse, Info, Rocket, TrendingUp, Users } from 'lucide-react';
import { DataGate, EvidenceTag, NoData, Panel, PageHeader, RecToggle, Stat } from '../../../shared/components/live';
import { getVitalsInsight } from '../../../services/ml.service';
import { useRunStore } from '../../../store/useRunStore';

/* =====================================================================================
 * Vitals & Physical.
 * Every number on this page comes from the backend data folder, the saved models
 * (/ml/vitals-insight).
 * Nothing is typed in here: thresholds, reference limits, bands and flag lines arrive in the response.
 * ===================================================================================== */

// ---------- formatting ----------------------------------------------------------------
const fmt = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits });
const pctOf = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${fmt(v * 100, digits)}%`);
const signed = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), digits)}`);
const signedPct = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${signed(v, digits)}%`);
const available = (v: any) => Boolean(v?.available);

const COLORS = {
  cyan: '#58d8ff', violet: '#b47bff', pink: '#ff6b8b', green: '#55e6b1', amber: '#ffd37c', grey: '#8992b1',
  grid: '#252d4b', axis: '#8992b1', bandGreen: '#55e6b1',
};
const TOOLTIP = { background: '#111832', border: '1px solid #343d62', borderRadius: 8, fontSize: 11 };
const PANEL_NAME: Record<string, string> = { chemistry: 'chemistry (CMP)', cbc: 'blood count (CBC)' };
const PANEL_SHORT: Record<string, string> = { chemistry: 'CMP', cbc: 'CBC' };
const PANEL_PLAIN: Record<string, string> = { chemistry: 'chemistry', cbc: 'blood count' };

// Makes every card in a grid row the same height (cards stretch to the tallest one in the row).
function EqualStyles() {
  return (
    <style>{`
      .eq-cell { display: flex; flex-direction: column; min-width: 0; }
      .eq-cell > * { flex: 1 1 auto; margin-bottom: 0; }
      .eq-stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
      .eq-stack > * { flex: 1 1 auto; }
    `}</style>
  );
}

function Empty({ reason }: { reason?: string }) {
  return <p className="muted">{reason || 'This measure is not available in the selected source data.'}</p>;
}

function SectionTitle({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="section-title-row" style={{ marginTop: 30 }}>
      <div>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: COLORS.violet, display: 'inline-flex' }}>{icon}</span>{title}</h2>
        {sub && <p style={{ maxWidth: 760 }}>{sub}</p>}
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const c = tone === 'bad' ? { bg: '#3a1c2a', bd: '#8c3753', fg: '#ffb4c4' } : tone === 'ok' ? { bg: '#123329', bd: '#2f8c70', fg: '#9ff0d0' } : { bg: '#35291b', bd: '#8c6737', fg: '#ffd38b' };
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 10, padding: '12px 14px', fontSize: 12, lineHeight: 1.55, margin: '0 0 14px' }}>
      <Info size={16} style={{ flex: '0 0 auto', marginTop: 2 }} /><div>{children}</div>
    </div>
  );
}

function Chip({ tone, children }: { tone: 'grey' | 'violet' | 'cyan' | 'green' | 'pink' | 'amber'; children: ReactNode }) {
  const c = COLORS[tone === 'grey' ? 'grey' : tone];
  return <span style={{ display: 'inline-block', font: "9px 'DM Mono', monospace", letterSpacing: .5, textTransform: 'uppercase', padding: '4px 8px', borderRadius: 6, border: `1px solid ${c}66`, color: c, background: `${c}1f`, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Legend({ items }: { items: { color: string; label: string; shape?: 'dot' | 'band' }[] }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: '#aeb6d0', margin: '10px 0 4px' }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <span style={{ display: 'inline-block', width: i.shape === 'band' ? 12 : 8, height: i.shape === 'band' ? 9 : 8, borderRadius: i.shape === 'band' ? 2 : 8, background: i.color, opacity: i.shape === 'band' ? .45 : 1, marginRight: 6 }} />{i.label}
        </span>
      ))}
    </div>
  );
}

const mono = { font: "9px 'DM Mono', monospace", letterSpacing: .8, color: COLORS.grey, textTransform: 'uppercase' as const };

// =====================================================================================
// 1. Summary stats
// =====================================================================================
function SummaryStats({ ins }: { ins: any }) {
  const hrv = ins.hrv, blood = ins.blood, act = ins.activity;
  const stepsRow = available(act) ? act.metrics.find((m: any) => m.unit === 'steps/day') : null;
  const hrvFlag = ins.flag_lines?.hrv_unusual_share, stepsFlag = ins.flag_lines?.steps_per_day;
  return (
    <div className="metric-grid four">
      {available(hrv) ? (
        <Stat icon={<HeartPulse size={18} />} label="RHYTHM INSIDE VOLUNTEER BAND" value={pctOf(hrv.normal_fraction)} tag="strong"
          tone={hrv.anomaly_fraction > hrvFlag ? 'bad' : 'ok'}
          sub={`${hrv.windows_checked} windows · longest unusual run ${hrv.longest_unusual_run} · more unusual than ${pctOf(hrv.volunteer_sits.more_unusual_than)} of volunteers`} />
      ) : <NoData title="HEART RHYTHM" why={hrv?.reason ?? 'No HRV data'} icon={<HeartPulse size={18} />} />}
      {available(blood) ? (
        <Stat icon={<Droplets size={18} />} label="BLOOD VALUES OUTSIDE OWN RANGE" value={`${blood.peak.outside}/${blood.peak.measured}`} tag="strong" tone="warn"
          sub={`at ${blood.peak.timepoint} · biggest ${blood.peak.biggest.label} ${signedPct(blood.peak.biggest.pct)}`} />
      ) : <NoData title="BLOOD VALUES" why={blood?.reason ?? 'No blood data'} icon={<Droplets size={18} />} />}
      {available(blood) ? (
        <Stat icon={<Rocket size={18} />} label={`BACK IN RANGE BY ${blood.recovery.last_timepoint}`} value={`${blood.recovery.back_in_range_by_last}/${blood.recovery.left_range_at_peak}`} tag="strong" tone="warn"
          sub={`values that left their own range at ${blood.peak.timepoint}`} />
      ) : <NoData title="BLOOD RECOVERY" why={blood?.reason ?? 'No blood data'} icon={<Rocket size={18} />} />}
      {stepsRow ? (
        <Stat icon={<Footprints size={18} />} label="STEPS PER DAY" value={fmt(stepsRow.value, 0)} tag="proxy"
          tone={stepsRow.value < stepsFlag ? 'warn' : 'ok'}
          sub={`ahead of ${pctOf(stepsRow.higher_than)} of ${stepsRow.cohort_n} volunteers · flag under ${fmt(stepsFlag, 0)}`} />
      ) : <NoData title="STEPS PER DAY" why={act?.reason ?? 'No activity data'} icon={<Footprints size={18} />} />}
    </div>
  );
}

// =====================================================================================
// 2. Heart rhythm
// =====================================================================================
const HRV_TABS = ['rmssd', 'sdnn', 'pnn50', 'hr'];
const HRV_TAB_LABEL: Record<string, string> = { rmssd: 'RMSSD', sdnn: 'SDNN', pnn50: 'pNN50', hr: 'Heart rate' };

function HeartRhythm({ data, flagLines, reason }: { data: any; flagLines: any; reason?: string }) {
  const [tab, setTab] = useState<string>(HRV_TABS[0]);
  if (!available(data)) return <Panel title="Heart rhythm" icon={<HeartPulse size={18} />}><Empty reason={data?.reason} /></Panel>;
  const m = data.measures.find((x: any) => x.key === tab) ?? data.measures[0];
  const windows = data.windows as any[];
  const sits = data.volunteer_sits;
  const flagged = sits.selected_fraction != null && sits.selected_fraction > flagLines.hrv_unusual_share;
  const volunteerBars = sits.volunteers.map((v: any) => ({ ...v, pct: v.unusual_fraction * 100 }));
  const ref = data.reference;

  const dot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g />;
    return <circle cx={cx} cy={cy} r={4} fill={payload.unusual ? COLORS.pink : COLORS.cyan} stroke="#0d1330" strokeWidth={1} />;
  };

  return (
    <>
      <div className="dashboard-grid" style={{ alignItems: 'stretch' }}>
        <div className="eq-cell">
        <Panel title="Window by window" subtitle={`${data.participant} · ${data.windows_checked} of ${data.windows_eligible_total} eligible windows (the same ones behind today's status)`}
          icon={<EvidenceTag kind="strong" />}>
          <div role="tablist" style={{ display: 'inline-flex', border: '1px solid #343d62', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
            {HRV_TABS.map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                style={{ padding: '7px 12px', fontSize: 10, border: 0, color: tab === k ? '#f1e6ff' : COLORS.grey, background: tab === k ? '#3a2a63' : '#111832', fontWeight: 700 }}>
                {HRV_TAB_LABEL[k]}
              </button>
            ))}
          </div>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={windows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                {m.reference_low != null && <ReferenceArea y1={m.reference_low} y2={m.reference_high} fill={COLORS.bandGreen} fillOpacity={0.16} strokeOpacity={0} ifOverflow="extendDomain" />}
                {m.reference_middle != null && <ReferenceLine y={m.reference_middle} stroke={COLORS.green} strokeDasharray="4 3" label={{ value: 'volunteer band', position: 'insideBottomRight', fill: COLORS.green, fontSize: 10 }} />}
                <XAxis dataKey="window" stroke={COLORS.axis} fontSize={10} />
                <YAxis stroke={COLORS.axis} fontSize={10} width={46} domain={[0, 'auto']} tickFormatter={(v) => fmt(v, 0)} />
                <Tooltip contentStyle={TOOLTIP} labelFormatter={(v) => `Window ${v}`}
                  formatter={(v: any) => [`${fmt(v, 2)} ${m.unit}`, HRV_TAB_LABEL[tab]]} />
                <Line type="monotone" dataKey={m.column} stroke={COLORS.cyan} strokeWidth={1.8} dot={dot} activeDot={{ r: 5, fill: '#fff' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...mono, margin: '14px 0 4px' }}>Model score per window · below 0 = unusual</div>
          <div style={{ height: 150 }}>
            <ResponsiveContainer>
              <BarChart data={windows} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="window" stroke={COLORS.axis} fontSize={10} />
                <YAxis stroke={COLORS.axis} fontSize={10} width={46} domain={[(lo: number) => Math.min(lo, 0), (hi: number) => Math.max(hi, 0)]} tickFormatter={(v) => fmt(v, 3)} />
                <ReferenceLine y={0} stroke={COLORS.grey} />
                <Tooltip contentStyle={TOOLTIP} labelFormatter={(v) => `Window ${v}`} formatter={(v: any) => [fmt(v, 4), 'Model score']} />
                <Bar dataKey="score" radius={[2, 2, 2, 2]}>
                  {windows.map((w: any) => <Cell key={w.window} fill={w.unusual ? COLORS.pink : COLORS.cyan} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ color: COLORS.cyan, label: 'normal window' }, { color: COLORS.pink, label: 'unusual window' }, { color: COLORS.green, label: `volunteer ${Math.round(ref.low_quantile * 100)}–${Math.round(ref.high_quantile * 100)}% band`, shape: 'band' }]} />
          <p className="muted" style={{ fontSize: 11 }}>
            Reference = the other volunteers' eligible windows ({Math.round(ref.low_quantile * 100)}th to {Math.round(ref.high_quantile * 100)}th percentile). {fmt(ref.windows, 0)} windows
            {ref.left_out_for_sensor?.length ? `, ${ref.left_out_for_sensor.length === 1 ? 'broken-sensor volunteer' : 'broken-sensor volunteers'} left out` : ''}.
            {' '}{data.model_note} {reason ? reason.split('. ')[0] + '.' : ''}
          </p>
        </Panel>
        </div>

        <div className="eq-stack">
          <Panel title="What is driving it" subtitle="This recording against the other volunteers, measure by measure" icon={<HeartPulse size={18} />}>
            <div className="av-table-wrap">
              <table className="av-table" style={{ minWidth: 0 }}>
                <thead><tr><th>Measure</th><th>This recording</th><th>Volunteer middle</th><th>Difference</th></tr></thead>
                <tbody>
                  {data.measures.map((x: any) => (
                    <tr key={x.key}>
                      <td><b style={{ color: '#e8ebf7', fontWeight: 600 }}>{x.label}</b>
                        <div style={{ fontSize: 9, color: COLORS.grey }}>{pctOf(x.share_windows_outside_band)} of windows outside the band</div></td>
                      <td><b style={{ color: '#e8ebf7' }}>{fmt(x.median)} {x.unit}</b></td>
                      <td><b style={{ color: '#e8ebf7' }}>{fmt(x.reference_middle)} {x.unit}</b>
                        <div style={{ fontSize: 9, color: COLORS.grey }}>band {fmt(x.reference_low)}–{fmt(x.reference_high)}</div></td>
                      <td>{x.verdict ? <Chip tone={x.verdict === 'higher' ? 'violet' : x.verdict === 'lower' ? 'cyan' : 'grey'}>{signedPct(x.difference_pct)} {x.verdict}</Chip> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ ...mono, margin: '16px 0 8px', color: COLORS.violet }}>Reading</div>
            {data.reading.map((r: any) => (
              <div key={r.title} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid #252d4b', fontSize: 11.5, lineHeight: 1.55, color: '#c5cce4' }}>
                <span style={{ width: 8, height: 8, borderRadius: 8, marginTop: 5, flex: '0 0 auto', background: r.tone === 'bad' ? COLORS.pink : r.tone === 'warn' ? COLORS.amber : COLORS.green }} />
                <div><b style={{ color: '#f1f3fb' }}>{r.title}</b> {r.text}</div>
              </div>
            ))}
          </Panel>

          <Panel title="Where this volunteer sits" subtitle={`Unusual-window share over the whole recording · ${sits.n_volunteers} volunteers`} icon={<Users size={18} />}>
            <div style={{ height: 170 }}>
              <ResponsiveContainer>
                <BarChart data={volunteerBars} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={COLORS.grid} vertical={false} />
                  <XAxis dataKey="participant" hide />
                  <YAxis domain={[0, 100]} ticks={[25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} stroke={COLORS.axis} fontSize={10} width={40} />
                  <ReferenceLine y={flagLines.hrv_unusual_share * 100} stroke={COLORS.pink} strokeDasharray="4 3" />
                  <Tooltip contentStyle={TOOLTIP} formatter={(v: any) => [`${fmt(v, 1)}%`, 'Unusual windows']} labelFormatter={(l) => String(l)} />
                  <Bar dataKey="pct" radius={[2, 2, 0, 0]}>
                    {volunteerBars.map((v: any) => <Cell key={v.participant} fill={v.selected ? COLORS.violet : '#3b4672'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 10 }}>
              <Banner tone={flagged ? 'bad' : 'ok'}>
                Over the whole recording {pctOf(sits.selected_fraction)} of windows are unusual, against a volunteer middle of {pctOf(sits.volunteer_middle)}.{' '}
                {data.participant} is more unusual than {pctOf(sits.more_unusual_than)} of volunteers. Red dashed line = the {pctOf(flagLines.hrv_unusual_share)} flag line.
              </Banner>
            </div>
            <RecToggle domains={['hrv']} title="Recommendations · heart rhythm" />
          </Panel>
        </div>
      </div>
    </>
  );
}

// =====================================================================================
// 3. Blood against the astronaut's own baseline
// =====================================================================================
const STATUS_TEXT: Record<string, string> = { below: 'below own range', above: 'above own range', inside: 'inside own range', missing: 'not measured', baseline: '—' };
const TREND_CHIP: Record<string, { tone: any; text: string }> = {
  first_sample: { tone: 'grey', text: '— first sample' }, improving: { tone: 'green', text: 'improving' },
  steady: { tone: 'amber', text: 'steady' }, moving_away: { tone: 'pink', text: 'moving away' },
};

function Blood({ data }: { data: any }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!available(data)) return <Panel title="Blood against the astronaut's own baseline" icon={<Droplets size={18} />}><Empty reason={data?.reason} /></Panel>;

  const values: any[] = data.values;
  const post: string[] = data.post_timepoints;
  const selected = values.find((v) => v.column === picked) ?? values[0];
  const peakRow = data.per_timepoint.find((r: any) => r.timepoint === data.peak_timepoint);
  const lastRow = data.per_timepoint.find((r: any) => r.timepoint === data.last_timepoint);
  const panelBreak = Object.entries(peakRow.by_panel).map(([p, c]: any) => `${PANEL_PLAIN[p] ?? p} ${c.outside} of ${c.measured}`).join(', ');

  const lineData = selected.samples.map((s: any) => ({ ...s, label: s.timepoint }));
  const dotFor = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || payload.value == null) return <g />;
    const color = payload.status === 'below' ? COLORS.cyan : payload.status === 'inside' ? COLORS.green : COLORS.violet;
    return <circle cx={cx} cy={cy} r={4.5} fill={color} stroke="#0d1330" strokeWidth={1} />;
  };

  const stackData = data.per_timepoint.map((r: any) => ({ timepoint: r.timepoint, measured: r.measured, ...Object.fromEntries(Object.entries(r.by_panel).map(([p, c]: any) => [p, c.outside])) }));
  const yMax = Math.max(...data.per_timepoint.map((r: any) => r.measured));
  const outlook = data.outlook;
  const rows = showAll ? outlook.rows : outlook.rows.slice(0, 8);
  const nWords = outlook.counts.needs_second_sample;
  const cellColor = (s: any) => {
    if (s.status !== 'below' && s.status !== 'above') return undefined;
    const a = Math.min(0.95, 0.3 + Math.abs(s.pct ?? 0) / 45);
    return s.status === 'above' ? `rgba(168,85,247,${a})` : `rgba(88,216,255,${a * 0.85})`;
  };
  const sample = (v: any, tp: string) => v.samples.find((s: any) => s.timepoint === tp);
  const crew = data.crew;
  const positionText = crew.position === 'typical' ? 'That is typical for this crew.' : crew.position === 'higher' ? 'That is higher than every other crew member.' : crew.position === 'lower' ? 'That is lower than every other crew member.' : '';
  const shape = lastRow.outside < peakRow.outside ? 'The curve is coming back down, the expected shape after landing.' : 'The count has not come back down yet; the next sample shows whether it will.';

  return (
    <>
      <Banner tone="warn">
        At <b>{data.peak.timepoint}</b> ({data.peak.when}) <b>{data.peak.outside} of {data.peak.measured}</b> blood values are outside this astronaut's own pre-flight range: {panelBreak}. This measures size of change against the person's own baseline, not a diagnosis.
      </Banner>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, alignItems: 'stretch' }}>
        <div className="eq-cell">
        <Panel title="One value across the mission" subtitle="Shaded band = this astronaut's own pre-flight range. Samples are evenly spaced, not to time scale." icon={<EvidenceTag kind="strong" />}>
          <select className="select-control" style={{ width: '100%', marginBottom: 6 }} value={selected.column} onChange={(e) => setPicked(e.target.value)} aria-label="Blood value">
            {values.map((v) => <option key={v.column} value={v.column}>{v.label} ({v.unit}) {signedPct(v.peak_pct)}</option>)}
          </select>
          <div className="muted" style={{ fontSize: 10, margin: '0 0 8px' }}>Listed with the biggest move at {data.peak.timepoint} first.</div>
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <LineChart data={lineData} margin={{ top: 16, right: 14, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <ReferenceArea y1={selected.own_low} y2={selected.own_high} fill={COLORS.violet} fillOpacity={0.22} strokeOpacity={0} ifOverflow="extendDomain" />
                <ReferenceLine y={selected.own_mean} stroke={COLORS.violet} strokeDasharray="4 3" label={{ value: 'own pre-flight range', position: 'insideTopLeft', fill: '#d8c2ff', fontSize: 9 }} />
                <ReferenceLine x={data.peak_timepoint} stroke="#cfd6ee" strokeDasharray="3 3" label={{ value: 'selected', position: 'top', fill: '#cfd6ee', fontSize: 9 }} />
                <XAxis dataKey="label" stroke={COLORS.axis} fontSize={10} />
                <YAxis stroke={COLORS.axis} fontSize={10} width={44} domain={['auto', 'auto']} tickFormatter={(v) => fmt(v, 2)} />
                <Tooltip contentStyle={TOOLTIP} formatter={(v: any) => [`${fmt(v, 2)} ${selected.unit}`, selected.label]} />
                <Line type="monotone" dataKey="value" stroke="#f1f3fb" strokeWidth={1.6} dot={dotFor} activeDot={{ r: 6, fill: '#fff' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ color: COLORS.violet, label: 'pre-flight sample / above range' }, { color: COLORS.cyan, label: 'below range' }, { color: COLORS.green, label: 'inside range' }]} />
          <div className="av-table-wrap">
            <table className="av-table" style={{ minWidth: 0 }}>
              <thead><tr><th>Sample</th><th>Value</th><th>vs own mean</th><th>Status</th><th>Other crew median</th></tr></thead>
              <tbody>
                {selected.samples.map((s: any) => {
                  // Pre-flight rows: % vs own mean and status are computed from the response (own_mean / own_low / own_high), not typed in.
                  const pctVal = s.pct != null ? s.pct
                    : (s.value != null && selected.own_mean ? ((s.value - selected.own_mean) / Math.abs(selected.own_mean)) * 100 : null);
                  const statusKey = s.status !== 'baseline' ? s.status
                    : s.value == null ? 'missing'
                    : selected.own_low != null && s.value < selected.own_low ? 'below'
                    : selected.own_high != null && s.value > selected.own_high ? 'above' : 'inside';
                  return (
                    <tr key={s.timepoint} style={s.timepoint === data.peak_timepoint ? { background: '#1b1840' } : undefined}>
                      <td><b style={{ color: '#e8ebf7' }}>{s.timepoint}</b><div style={{ fontSize: 9, color: COLORS.grey }}>{s.when}</div></td>
                      <td>{fmt(s.value, 2)} {selected.unit}</td>
                      <td style={{ color: pctVal != null && pctVal < 0 ? COLORS.cyan : COLORS.violet }}>{signedPct(pctVal, 1)}</td>
                      <td>{STATUS_TEXT[statusKey]}</td>
                      <td>{signedPct(s.crew_median_pct, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
        </div>

        <div className="eq-cell">
        <Panel title="Values outside own range, by sample" subtitle="How many of the blood values are outside this astronaut's own pre-flight range" icon={<TrendingUp size={18} />}>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={stackData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="timepoint" stroke={COLORS.axis} fontSize={10} />
                <YAxis stroke={COLORS.axis} fontSize={10} width={34} domain={[0, yMax]} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP} />
                {data.panels.map((p: string, i: number) => (
                  <Bar key={p} dataKey={p} stackId="a" name={PANEL_NAME[p] ?? p} fill={p === 'chemistry' ? COLORS.violet : COLORS.cyan} radius={i === data.panels.length - 1 ? [3, 3, 0, 0] : 0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={data.panels.map((p: string) => ({ color: p === 'chemistry' ? COLORS.violet : COLORS.cyan, label: PANEL_NAME[p] ?? p }))} />
          <div style={{ border: '1px solid #4a3f8a', background: '#17163a', borderRadius: 10, padding: '11px 13px', fontSize: 11.5, lineHeight: 1.55, color: '#cbb5ff', display: 'flex', gap: 9 }}>
            <Info size={15} style={{ flex: '0 0 auto', marginTop: 2 }} />
            <span>Most values are outside their own range at {peakRow.timepoint} ({peakRow.outside} of {peakRow.measured}); at {lastRow.timepoint} it is {lastRow.outside} of {lastRow.measured}. {shape}</span>
          </div>
          <p className="muted" style={{ fontSize: 10.5, marginTop: 12 }}>{data.rule.text}</p>
        </Panel>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <Panel title="Every blood value, every post-flight sample" subtitle="Percent change from the astronaut's own pre-flight mean. Coloured = outside own range; grey = inside. Click a cell to inspect that value and sample." icon={<Droplets size={18} />}>
          <div style={{ maxHeight: 560, overflow: 'auto', border: '1px solid #252d4b', borderRadius: 10 }}>
            <table className="av-table" style={{ margin: 0, minWidth: 560 }}>
              <thead style={{ position: 'sticky', top: 0, background: '#10172f', zIndex: 1 }}>
                <tr>
                  <th>Value</th>
                  {post.map((tp) => {
                    const r = data.per_timepoint.find((x: any) => x.timepoint === tp);
                    return <th key={tp} style={{ textAlign: 'center', background: tp === data.peak_timepoint ? '#241a45' : undefined }}>
                      <div style={{ color: '#f1f3fb', fontSize: 11 }}>{tp}</div><div>{r.outside}/{r.measured} out</div></th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {data.panels.map((p: string) => {
                  const group = values.filter((v) => v.panel === p);
                  return [
                    <tr key={`h-${p}`}><td colSpan={post.length + 1} style={{ ...mono, color: COLORS.violet, background: '#0f1531' }}>{PANEL_NAME[p] ?? p} · {group.length} values</td></tr>,
                    ...group.map((v) => (
                      <tr key={v.column} style={v.column === selected.column ? { outline: '1px solid #8062b7' } : undefined}>
                        <td style={{ cursor: 'pointer' }} onClick={() => setPicked(v.column)}>
                          <b style={{ color: '#e8ebf7', fontWeight: 600 }}>{v.label}</b><div style={{ fontSize: 9, color: COLORS.grey }}>{v.unit}</div></td>
                        {post.map((tp) => {
                          const s = sample(v, tp);
                          const out = s.status === 'below' || s.status === 'above';
                          return (
                            <td key={tp} onClick={() => setPicked(v.column)} title={`${v.label} · ${tp}: ${fmt(s.value, 2)} ${v.unit} (${signedPct(s.pct, 1)} vs own mean)`}
                              style={{ textAlign: 'center', cursor: 'pointer', background: cellColor(s), color: out ? '#fff' : COLORS.grey, fontWeight: out ? 700 : 400 }}>
                              {s.status === 'missing' ? 'n/a' : signed(s.pct)}
                            </td>
                          );
                        })}
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
          <Legend items={[{ color: COLORS.violet, label: 'above own range', shape: 'band' }, { color: COLORS.cyan, label: 'below own range', shape: 'band' }, { color: '#3b4672', label: 'stronger colour = further outside', shape: 'band' }]} />
        </Panel>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, marginTop: 14, alignItems: 'stretch' }}>
        <div className="eq-cell">
        <Panel title="Recovery outlook" subtitle={`Values outside own range at ${data.peak.timepoint} · straight-line estimate from the samples up to it, no hindsight`} icon={<TrendingUp size={18} />}>
          <Legend items={[
            { color: COLORS.green, label: `${outlook.counts.improving} improving` }, { color: COLORS.amber, label: `${outlook.counts.steady} steady` },
            { color: COLORS.pink, label: `${outlook.counts.moving_away} moving away` }, { color: COLORS.grey, label: `${nWords} need a 2nd post-flight sample` },
          ]} />
          <div className="av-table-wrap">
            <table className="av-table" style={{ minWidth: 0 }}>
              <thead><tr><th>Value</th><th>Now</th><th>Trend</th><th>Back in range (est.)</th><th>Next sample check</th></tr></thead>
              <tbody>
                {rows.map((o: any) => {
                  const chip = TREND_CHIP[o.trend];
                  const back = o.trend === 'first_sample' ? 'needs 2nd sample' : o.trend === 'improving' ? (typeof o.back_in_range_days === 'number' ? `≈ ${fmt(o.back_in_range_days, 0)} days after ${data.peak.timepoint}` : String(o.back_in_range_days)) : o.trend === 'steady' ? 'not moving' : 'not heading back';
                  const nx = o.next_sample;
                  return (
                    <tr key={`${o.panel}-${o.label}`}>
                      <td><b style={{ color: '#e8ebf7', fontWeight: 600 }}>{o.label}</b><div style={{ fontSize: 9, color: COLORS.grey }}>{o.unit} · {PANEL_SHORT[o.panel] ?? o.panel}</div></td>
                      <td style={{ color: (o.now_pct ?? 0) < 0 ? COLORS.cyan : COLORS.violet, fontWeight: 700 }}>{signedPct(o.now_pct)}</td>
                      <td><Chip tone={chip.tone}>{chip.text}</Chip></td>
                      <td>{back}</td>
                      <td>{nx ? <>{nx.timepoint}: {signedPct(nx.pct)}<div style={{ fontSize: 9, color: COLORS.grey }}>{nx.projected_pct != null ? `projected ${signedPct(nx.projected_pct)}` : 'no projection'}</div></> : <span style={{ color: COLORS.grey }}>no later sample</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {outlook.rows.length > 8 && (
            <button className="av-ghost-btn" style={{ marginTop: 10, font: "9px 'DM Mono', monospace", letterSpacing: .8, textTransform: 'uppercase' }} onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${outlook.rows.length}`}
            </button>
          )}
          <p style={{ color: COLORS.amber, fontSize: 11, lineHeight: 1.5, margin: '12px 0' }}>An estimate from two or three samples per value, not a trained model. {outlook.method}</p>
          <RecToggle domains={['blood']} title="Recommendations · blood" />
        </Panel>
        </div>

        <div className="eq-cell">
        <Panel title="Crew context" subtitle={`Same sample (${crew.peak_timepoint}) for every Inspiration4 crew member · ${crew.rows.length} crew`} icon={<Users size={18} />}>
          <div style={{ display: 'grid', gap: 12 }}>
            {crew.rows.map((c: any) => (
              <div key={c.astronaut} style={{ display: 'grid', gridTemplateColumns: '46px minmax(0,1fr) auto', gap: 12, alignItems: 'center' }}>
                <b style={{ font: "11px 'DM Mono', monospace", color: c.selected ? '#e4d5ff' : '#c5cce4' }}>{c.astronaut}</b>
                <div>
                  <div style={{ height: 8, borderRadius: 8, background: '#252c49', overflow: 'hidden' }}>
                    <i style={{ display: 'block', height: '100%', width: `${c.measured ? (c.outside / c.measured) * 100 : 0}%`, background: c.selected ? COLORS.violet : '#4a5686', borderRadius: 8 }} />
                  </div>
                  <div style={{ fontSize: 9.5, color: COLORS.grey, marginTop: 4 }}>{c.outside} of {c.measured} values outside own range</div>
                </div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: '#c5cce4', textAlign: 'right', lineHeight: 1.7 }}>
                  <div>CBC model {pctOf(c.cbc_model_probability)}</div><div>Metabolite model {pctOf(c.metabolite_model_probability)}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ border: '1px solid #4a3f8a', background: '#17163a', borderRadius: 10, padding: '11px 13px', fontSize: 11.5, lineHeight: 1.55, color: '#cbb5ff', margin: '16px 0 10px' }}>
            {data.astronaut} has {crew.rows.find((c: any) => c.selected)?.outside} values outside own range at {crew.peak_timepoint}; the middle of the other crew is {fmt(crew.others_middle, 0)}. {positionText}
          </div>
          <p className="muted" style={{ fontSize: 10.5 }}>The percentages are the two blood models (probability the sample looks like one day after landing). {crew.note}</p>
        </Panel>
        </div>
      </div>
    </>
  );
}

// =====================================================================================
// 5. Activity load
// =====================================================================================
function ActivityLoad({ data }: { data: any }) {
  if (!available(data)) return <Panel title="Activity load" icon={<Footprints size={18} />}><Empty reason={data?.reason} /></Panel>;
  const steps = data.metrics.find((m: any) => m.unit === 'steps/day');
  const rest = data.metrics.filter((m: any) => m.unit !== 'steps/day');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 14, alignItems: 'stretch' }}>
      <div className="eq-cell">
      <Panel title="Steps against the volunteers" subtitle={`${data.participant} · average steps per recorded day · ${data.cohort_size} volunteers`} icon={<EvidenceTag kind="proxy" />}>
        <div style={{ height: 230 }}>
          <ResponsiveContainer>
            <BarChart data={data.steps_by_volunteer} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="participant" hide />
              <YAxis stroke={COLORS.axis} fontSize={10} width={46} tickFormatter={(v) => fmt(v, 0)} />
              <ReferenceLine y={data.steps_flag} stroke={COLORS.pink} strokeDasharray="4 3" ifOverflow="extendDomain" />
              <Tooltip contentStyle={TOOLTIP} formatter={(v: any) => [`${fmt(v, 0)} steps/day`, 'Steps']} />
              <Bar dataKey="steps_per_day" radius={[2, 2, 0, 0]}>
                {data.steps_by_volunteer.map((v: any) => <Cell key={v.participant} fill={v.selected ? COLORS.violet : '#3b4672'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted" style={{ fontSize: 10.5 }}>
          {steps ? `${data.participant} averages ${fmt(steps.value, 0)} steps per recorded day (volunteer middle ${fmt(steps.cohort_middle, 0)}). ` : ''}Red dashed line = the {fmt(data.steps_flag, 0)} steps flag line. Steps are a proxy for bone and muscle loading, not a trained model.
        </p>
      </Panel>
      </div>
      <div className="eq-cell">
      <Panel title="Heart rate and movement" subtitle="Whole-recording averages from the activity file" icon={<Footprints size={18} />}>
        <div className="av-table-wrap">
          <table className="av-table" style={{ minWidth: 0 }}>
            <thead><tr><th>Measure</th><th>This volunteer</th><th>Rank</th></tr></thead>
            <tbody>
              {rest.map((m: any) => (
                <tr key={m.label}>
                  <td><b style={{ color: '#e8ebf7', fontWeight: 600 }}>{m.label}</b><div style={{ fontSize: 9, color: COLORS.grey }}>middle {fmt(m.cohort_middle)} {m.unit}</div></td>
                  <td><b style={{ color: '#e8ebf7' }}>{fmt(m.value)} {m.unit}</b></td>
                  <td>{m.higher_than != null ? `higher than ${pctOf(m.higher_than)} of volunteers` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <RecToggle domains={['exercise']} title="Recommendations · activity" />
      </Panel>
      </div>
    </div>
  );
}

// =====================================================================================
// Page
// =====================================================================================
function VitalsBody() {
  const selection = useRunStore((s) => s.selection);
  const query = useQuery({
    queryKey: ['vitals-insight', selection],
    queryFn: () => getVitalsInsight(selection),
    retry: 0, staleTime: 5 * 60_000,
  });
  const ins: any = query.data;
  return (
    <>
      {query.isLoading && <Panel title="Loading measured data"><p className="muted">Reading the selected datasets and running the saved models…</p></Panel>}
      {query.isError && <Panel title="Vitals insight unavailable"><p className="muted">{(query.error as Error).message}</p></Panel>}
      {ins && (
        <>
          <SummaryStats ins={ins} />

          <SectionTitle icon={<HeartPulse size={18} />} title="Heart rhythm, window by window"
            sub="Every HRV window of today's check, its own model score, the volunteer band for each measure, and what is pushing a window out of the normal range." />
          <HeartRhythm data={ins.hrv} flagLines={ins.flag_lines} reason={ins.time_ranges?.reason} />

          <SectionTitle icon={<Droplets size={18} />} title="Blood against the astronaut's own baseline"
            sub={available(ins.blood)
              ? `All ${ins.blood.values.length} chemistry and blood-count values compared with this astronaut's own pre-flight range: where the change is, whether it is recovering, and how the rest of the crew moved.`
              : undefined} />
          <Blood data={ins.blood} />

          <SectionTitle icon={<Footprints size={18} />} title="Activity load" sub="Where this volunteer's movement sits among all volunteers" />
          <ActivityLoad data={ins.activity} />

          <p className="muted" style={{ marginTop: 22 }}>{ins.disclaimer}</p>
        </>
      )}
    </>
  );
}

export function VitalsPage() {
  return (
    <section className="page-enter">
      <EqualStyles />
      <PageHeader eyebrow="PHYSICAL HEALTH" title="Vitals & Physical"
        intro="A focused physical-health investigation: beat-to-beat rhythm patterns, blood recovery against personal pre-flight ranges, and activity compared with the volunteer cohort." />
      <DataGate>{() => <VitalsBody />}</DataGate>
    </section>
  );
}