import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Info, Loader2, ServerCrash, Sparkles, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { aiRecsFor, ruleRecsFor, useAI, useBootstrapSelection, useDay, useSubjects, type Domain } from '../../hooks/useAstro';
import { hasSelection, useRunStore } from '../../store/useRunStore';
import type { DayResult, Level, Reliability } from '../../types/ml';

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
export const LEVEL_LABEL: Record<Level, string> = { green: 'GREEN', amber: 'AMBER', red: 'RED', unknown: 'UNKNOWN' };
export const pct = (v: number | undefined | null, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);
export const num = (v: number | undefined | null, digits = 2) => (v == null ? '—' : Number(v).toFixed(digits));

export type Tone = 'ok' | 'warn' | 'bad' | 'mute';

export function PageHeader({ eyebrow, title, intro, right }: { eyebrow: string; title: string; intro: string; right?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">ASTROVITAL / {eyebrow}</div>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
      </div>
      {right}
    </div>
  );
}

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`av-level av-level-${level}`}>{LEVEL_LABEL[level]}</span>;
}

export function EvidenceTag({ kind }: { kind: string }) {
  const k = kind.toLowerCase();
  const cls = k === 'strong' ? 'strong' : k === 'weak' ? 'weak' : k === 'screening' ? 'screening' : 'proxy';
  return <span className={`av-tag av-tag-${cls}`}>{k} evidence</span>;
}

export function Stat({ icon, label, value, unit, sub, tone = 'mute', tag }: {
  icon?: ReactNode; label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: Tone; tag?: string;
}) {
  return (
    <div className={`metric-card av-stat av-tone-${tone}`}>
      <div className="metric-top">
        {icon && <span className="av-stat-icon">{icon}</span>}
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{value}{unit && <small>{unit}</small>}</div>
      <div className="metric-delta">{sub}</div>
      {tag && <div className="av-stat-tag"><EvidenceTag kind={tag} /></div>}
    </div>
  );
}

/** Horizontal bar. `threshold` draws the line where the backend rules raise a flag. */
export function Meter({ value, max = 1, threshold, tone = 'ok' }: { value: number | undefined | null; max?: number; threshold?: number; tone?: Tone }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="av-meter" role="img" aria-label={value == null ? 'no data' : `value ${value}`}>
      <i className={`av-fill av-fill-${tone}`} style={{ width: `${width}%` }} />
      {threshold != null && <b className="av-threshold" style={{ left: `${Math.min(100, (threshold / max) * 100)}%` }} />}
    </div>
  );
}

export function NoData({ title, why, icon }: { title: string; why: string; icon?: ReactNode }) {
  return (
    <div className="metric-card av-nodata">
      <div className="metric-top">{icon && <span className="av-stat-icon">{icon}</span>}<span className="metric-label">{title}</span></div>
      <div className="metric-value av-dash">No data</div>
      <div className="metric-delta">{why}</div>
    </div>
  );
}

export function Notice({ children, tone = 'info', icon }: { children: ReactNode; tone?: 'info' | 'warning'; icon?: ReactNode }) {
  return (
    <div className={`notice-panel ${tone === 'warning' ? 'warning' : ''}`}>
      {icon ?? (tone === 'warning' ? <AlertTriangle size={18} /> : <Info size={18} />)}
      <div>{children}</div>
    </div>
  );
}

export function Panel({ title, subtitle, icon, children, className = '' }: { title: string; subtitle?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`panel ${className}`}>
      <div className="panel-heading">
        <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
        {icon}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendation toggle: sits under every section, closed by default
// ---------------------------------------------------------------------------
export function RecToggle({ domains, title = 'Recommendations', staticItems = [], emptyText }: {
  domains: Domain[]; title?: string; staticItems?: string[]; emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const day = useDay();
  const ai = useAI();
  const base: DayResult | undefined = ai.data ?? day.data;
  const rules = ruleRecsFor(base, domains);
  const aiRecs = aiRecsFor(ai.data, domains);
  const count = rules.length + aiRecs.length + staticItems.length;
  const aiProblem = ai.data?.ai?.source === 'rules_only' ? ai.data.ai.error : ai.error ? (ai.error as Error).message : null;

  return (
    <div className={`av-rec ${open ? 'open' : ''}`}>
      <button className="av-rec-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Sparkles size={15} />
        <span>{title}</span>
        <i className="av-rec-count">{count}</i>
        {ai.isFetching && <Loader2 size={13} className="av-spin" />}
        <ChevronDown size={16} className="av-chevron" />
      </button>
      {open && (
        <div className="av-rec-body">
          {staticItems.map((t) => <div className="av-rec-item" key={t}><p>{t}</p></div>)}
          {rules.length > 0 && <div className="av-rec-group">Rule-based steps</div>}
          {rules.map((t) => <div className="av-rec-item" key={t}><p>{t}</p></div>)}
          {aiRecs.length > 0 && <div className="av-rec-group">AI-written steps {ai.data?.ai?.model ? `· ${ai.data.ai.model}` : ''}</div>}
          {aiRecs.map((r, i) => (
            <div className="av-rec-item" key={`${r.action}-${i}`}>
              <p>{r.action}</p>
              <div className="av-rec-meta"><span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span><EvidenceTag kind={r.evidence} /></div>
            </div>
          ))}
          {ai.isLoading && <p className="av-rec-note"><Loader2 size={13} className="av-spin" /> Generating AI recommendations…</p>}
          {aiProblem && <p className="av-rec-note warn">AI recommendations unavailable ({aiProblem}). Rule-based steps are shown above.</p>}
          {count === 0 && !ai.isLoading && <p className="av-rec-note">{emptyText ?? 'No flag was raised for this area, so there is no specific action. Keep the normal routine.'}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Model reliability list (what each model is, who it was trained on, how good it is)
// ---------------------------------------------------------------------------
export function ReliabilityList({ items }: { items: Reliability[] }) {
  if (!items.length) return <p className="muted">No model ran for this selection.</p>;
  return (
    <div className="av-reliab">
      {items.map((m) => (
        <div className="av-reliab-row" key={m.model}>
          <b>{m.model}</b>
          <span>{m.predicts}</span>
          <small>Population: {m.population ?? 'unknown'}</small>
          <small className="av-status-text">{m.status}</small>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataGate: shows loading / backend-offline / empty states, then gives the page the day result
// ---------------------------------------------------------------------------
export function DataGate({ children }: { children: (day: DayResult) => ReactNode }) {
  useBootstrapSelection(); // app khulte hi pehla scenario khud select karo
  const subjects = useSubjects();
  const selection = useRunStore((s) => s.selection);
  const day = useDay();

  if (subjects.isError) {
    return (
      <div className="panel av-state">
        <WifiOff size={26} />
        <h3>Cannot reach the backend</h3>
        <p>{(subjects.error as Error).message}</p>
        <p className="muted">Start the backend (uvicorn on port 8000) and make sure Vite's /api proxy points to it. Then refresh this page.</p>
        <button className="primary-button" onClick={() => subjects.refetch()}>Try again</button>
      </div>
    );
  }
  if (subjects.isLoading) return <div className="panel av-state"><Loader2 className="av-spin" size={26} /><h3>Loading backend data…</h3></div>;
  if (!hasSelection(selection)) {
    return (
      <div className="panel av-state">
        <Info size={26} />
        <h3>No data source selected</h3>
        <p>The backend did not list any scenario or subject (crew_map.json), so choose data sources by hand.</p>
        <Link to="/checkin" className="primary-button">Open Daily Check-in</Link>
      </div>
    );
  }
  if (day.isLoading) return <div className="panel av-state"><Loader2 className="av-spin" size={26} /><h3>Running the models…</h3></div>;
  if (day.isError || !day.data) {
    return (
      <div className="panel av-state">
        <ServerCrash size={26} />
        <h3>The backend could not run this check</h3>
        <p>{(day.error as Error | null)?.message ?? 'Unknown error'}</p>
        <Link to="/checkin" className="primary-button">Change data sources</Link>
      </div>
    );
  }
  return <>{children(day.data)}</>;
}

/** Warning lines that every health page should show (model population, composite data, etc.). */
export function WarningList({ day }: { day: DayResult }) {
  if (!day.warnings.length) return null;
  return <Notice tone="warning">{day.warnings.map((w) => <p key={w}>{w}</p>)}</Notice>;
}

// ---------------------------------------------------------------------------
// Colour rules. They copy the thresholds written in the backend (app/ml/predict.py).
// ---------------------------------------------------------------------------
export const sleepTone = (p?: number): Tone => (p == null ? 'mute' : p > 0.5 ? 'warn' : 'ok'); // weak evidence: never red
export const stressTone = (v?: number): Tone => (v == null ? 'mute' : v > 50 ? 'warn' : 'ok'); // weak evidence
export const hrvTone = (v?: number): Tone => (v == null ? 'mute' : v > 0.1 ? 'bad' : 'ok'); // strong evidence
export const bloodTone = (v?: number): Tone => (v == null ? 'mute' : v > 0.5 ? 'bad' : 'ok'); // strong evidence
export const boneTone = (label?: string): Tone => (!label ? 'mute' : label === 'High' ? 'bad' : label === 'Medium' ? 'warn' : 'ok');
export const levelTone = (level: Level): Tone => (level === 'green' ? 'ok' : level === 'amber' ? 'warn' : level === 'red' ? 'bad' : 'mute');
export const TONE_COLOR: Record<Tone, string> = { ok: '#55e6b1', warn: '#ffd37c', bad: '#ff6b8b', mute: '#8992b1' };

export function bloodMax(day: DayResult): number | undefined {
  const s = day.check_day.scores ?? {};
  const v = [s['P_R+1_like_insp4_blood'], s['P_R+1_like_osd571_blood']].filter((x): x is number => x != null);
  return v.length ? Math.max(...v) : undefined;
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="av-kv">
      {rows.map(([k, v]) => (<div key={k}><span>{k}</span><b>{v ?? '—'}</b></div>))}
    </div>
  );
}
