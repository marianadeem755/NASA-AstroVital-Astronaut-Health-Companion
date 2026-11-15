import { Loader2, PhoneCall, RefreshCw, Sparkles } from 'lucide-react';
import { useAI } from '../../../hooks/useAstro';
import { useRunStore } from '../../../store/useRunStore';
import { DataGate, EvidenceTag, Notice, PageHeader, Panel, ReliabilityList, WarningList } from '../../../shared/components/live';
import type { Language } from '../../../types/ml';

export function InsightsPage() {
  const ai = useAI();
  const language = useRunStore((s) => s.language);
  const setLanguage = useRunStore((s) => s.setLanguage);
  const block = ai.data?.ai;
  const result = block?.result;
  return (
    <section className="page-enter">
      <PageHeader eyebrow="DECISION SUPPORT" title="Insights & Actions" intro="The AI reads every model result together and explains the whole picture. It follows the rules: it never changes the level and never diagnoses."
        right={
          <div className="av-btn-row">
            <select className="select-control" value={language} onChange={(e) => setLanguage(e.target.value as Language)} aria-label="Language">
              <option value="en">English</option><option value="roman-urdu">Roman Urdu</option>
            </select>
            <button className="primary-button" onClick={() => ai.refetch()} disabled={ai.isFetching}>{ai.isFetching ? <Loader2 size={14} className="av-spin" /> : <RefreshCw size={14} />} Regenerate</button>
          </div>
        } />
      <DataGate>
        {(day) => (
          <>
            <WarningList day={day} />
            <Panel title="Summary" subtitle={block ? `Source: ${block.source}${block.model ? ` · ${block.model}` : ''}${block.cached ? ' · cached' : ''}` : 'Waiting for the AI'} icon={<Sparkles size={18} className="purple-icon" />}>
              {ai.isLoading && <p className="muted"><Loader2 size={13} className="av-spin" /> Asking the AI… this can take a few seconds.</p>}
              {ai.isError && <p className="av-rec-note warn">Could not get AI recommendations: {(ai.error as Error).message}</p>}
              {block && !result && <p className="av-rec-note warn">AI unavailable: {block.error ?? 'no provider answered'}. The rule-based recommendations below are still valid.</p>}
              {result && (
                <>
                  <p className="av-summary">{result.summary}</p>
                  {result.contact_medical_officer && <div className="av-callout"><PhoneCall size={16} /><div><b>Contact the mission medical officer.</b><p>{result.contact_reason}</p></div></div>}
                </>
              )}
            </Panel>

            {!!result?.key_findings?.length && (
              <Panel title="Key findings" subtitle="With the evidence level of each model" className="av-gap-top">
                <ul className="av-list">{result.key_findings.map((f) => <li key={f}>{f}</li>)}</ul>
              </Panel>
            )}

            <Panel title="Recommended actions" subtitle="Ordered by priority" className="av-gap-top">
              {result?.recommendations?.length ? result.recommendations.map((r, i) => (
                <div className="av-rec-item" key={`${r.action}-${i}`}>
                  <p>{r.action}</p>
                  <div className="av-rec-meta"><span className="av-tag av-tag-proxy">{r.domain}</span><span className={`av-prio av-prio-${r.priority}`}>{r.priority} priority</span><EvidenceTag kind={r.evidence} /></div>
                </div>
              )) : <p className="muted">No AI actions available.</p>}
              <div className="av-rec-group">Rule-based steps (always available)</div>
              {day.check_day.recommendations.map((r) => <div className="av-rec-item" key={r}><p>{r}</p></div>)}
            </Panel>

            <div className="dashboard-grid av-gap-top">
              <Panel title="Could not be checked" subtitle="AI data gaps plus backend missing list">
                {[...(result?.data_gaps ?? []), ...day.check_day.missing].filter((v, i, a) => a.indexOf(v) === i).map((g) => <div className="av-flag" key={g}><span className="av-dot mute" /><p>{g}</p></div>)}
              </Panel>
              <Panel title="How reliable is each model?" subtitle="Who it was trained on and how well it works">
                <ReliabilityList items={day.model_reliability} />
              </Panel>
            </div>
            {block && block.attempts.length > 0 && (
              <Notice><div><b>AI providers tried</b>{block.attempts.map((a) => <p key={a.provider}>{a.provider}: {a.ok ? 'answered' : `failed (${a.error})`}</p>)}</div></Notice>
            )}
            <Notice><p>{result?.disclaimer ?? day.disclaimer}</p></Notice>
          </>
        )}
      </DataGate>
    </section>
  );
}
