import { Orbit, Radiation, Rocket } from 'lucide-react';
import { DataGate, NoData, Notice, PageHeader, Panel, RecToggle } from '../../../shared/components/live';

export function RadiationPage() {
  return (
    <section className="page-enter">
      <PageHeader eyebrow="ENVIRONMENTAL EXPOSURE" title="Radiation Monitor" intro="Radiation is one of the five spaceflight hazards. This page tells the truth about what the backend can and cannot show." />
      <DataGate>
        {(day) => (
          <>
            <Notice tone="warning"><b>No radiation data in the backend.</b><p>No dosimeter file and no radiation model exist in the project, so AstroVital shows no dose number. A missing value is never treated as “safe”.</p></Notice>
            <div className="metric-grid three">
              <NoData title="MISSION DOSE" why="Not measured · no data file" icon={<Radiation size={18} />} />
              <NoData title="DOSE RATE" why="Not measured · no data file" icon={<Orbit size={18} />} />
              <NoData title="EXPOSURE TREND" why="Needs daily dose records" icon={<Rocket size={18} />} />
            </div>
            <Panel title="What the backend does list as not measurable" subtitle="Straight from the API response">
              <div className="av-flags">{day.not_measurable.map((n) => <div className="av-flag" key={n}><span className="av-dot mute" /><p>{n}</p></div>)}</div>
            </Panel>
            <Panel title="Indirect context only" subtitle="Not radiation measurements" className="av-gap-top">
              <p className="muted">The blood and metabolomics models describe how blood looks after landing compared with before flight. That change has many causes, so it must not be read as a radiation dose.</p>
              <RecToggle domains={[]} title="Recommendations · radiation" staticItems={[
                'Radiation dose cannot be checked here. Ask the mission medical officer or ground team for the crew dose record.',
                'Do not read the missing value as safe. Add dosimeter data to the backend to enable this page.',
              ]} />
            </Panel>
          </>
        )}
      </DataGate>
    </section>
  );
}
