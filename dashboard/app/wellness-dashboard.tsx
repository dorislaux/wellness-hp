"use client";

import { useState } from "react";
import {
  formatDuration,
  members,
  readinessTone,
  weekDays,
  type Member,
  type SleepStage,
} from "./mock-data";

type View = "cards" | "timeline";

function SegmentedControl({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="segmented" aria-label="Dashboard view">
      {(["cards", "timeline"] as const).map((option) => (
        <button
          className={view === option ? "active" : ""}
          key={option}
          onClick={() => onChange(option)}
          aria-pressed={view === option}
        >
          {option[0].toUpperCase() + option.slice(1)}
        </button>
      ))}
    </div>
  );
}

function ProviderLabel({ member }: { member: Member }) {
  return <span>{member.sources.length === 2 ? "Oura + Whoop" : "Oura only"}</span>;
}

function HouseholdCard({ member, onOpen }: { member: Member; onOpen: () => void }) {
  return (
    <article className="household-card">
      <button className="card-open" onClick={onOpen} aria-label={`View ${member.name}'s day`}>
        <span aria-hidden="true">→</span>
      </button>
      <div className="member-heading">
        <div className={`avatar ${member.avatar}`}>{member.initials}</div>
        <div>
          <h2>{member.name}</h2>
          <ProviderLabel member={member} />
        </div>
      </div>
      <div className="card-primary">
        <div><strong>{member.readiness}</strong><span>readiness</span></div>
        {member.recovery === null ? (
          <p className="muted">No Whoop paired</p>
        ) : (
          <p>Recovery {member.recovery}%</p>
        )}
      </div>
      <div className="card-stats">
        <div><span>HRV</span><strong>{member.overnightHrv} ms</strong></div>
        <div><span>Sleep</span><strong>{formatDuration(member.sleepMinutes)}</strong></div>
        <div className={member.strain === null ? "muted" : ""}>
          <span>Strain</span><strong>{member.strain ?? "—"}</strong>
        </div>
      </div>
      <button className="detail-link" onClick={onOpen}>View day detail <span aria-hidden="true">→</span></button>
    </article>
  );
}

function CardsView({ visibleMembers, onOpen }: { visibleMembers: Member[]; onOpen: (member: Member) => void }) {
  return (
    <section className="cards-grid" aria-label="Household daily cards">
      {visibleMembers.map((member) => (
        <HouseholdCard key={member.id} member={member} onOpen={() => onOpen(member)} />
      ))}
    </section>
  );
}

function TimelineView({ visibleMembers, onOpen }: { visibleMembers: Member[]; onOpen: (member: Member) => void }) {
  return (
    <section className="timeline-wrap" aria-label="Seven day readiness timeline">
      <div className="timeline-grid">
        <div />
        {weekDays.map((day) => <div className="weekday" key={day}><span>{day}</span><b>{day[0]}</b></div>)}
        {visibleMembers.map((member) => (
          <div className="timeline-row" key={member.id}>
            <div className="timeline-name">{member.name}</div>
            {member.readinessHistory.map((score, index) => (
              <button
                key={`${member.id}-${weekDays[index]}`}
                className={`timeline-cell ${readinessTone(score)}`}
                onClick={() => onOpen(member)}
                aria-label={`${member.name}, ${weekDays[index]}, readiness ${score ?? "unavailable"}`}
                title={score === null ? "Unavailable" : `Readiness ${score}`}
              >
                <span className="sr-only">{score}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="timeline-note"><span className="desktop-copy">Cell color reflects Oura readiness. Click a cell for that person&apos;s full breakdown that day.</span><span className="mobile-copy">Tap a cell for that person&apos;s day.</span></p>
    </section>
  );
}

const stageColors: Record<SleepStage["stage"], string> = {
  REM: "rem",
  Light: "light",
  Deep: "deep",
  Awake: "awake",
};

function Delta({ value, unit, inverse = false }: { value: number; unit: string; inverse?: boolean }) {
  const favorable = inverse ? value <= 0 : value >= 0;
  return <p className={favorable ? "positive" : "negative"}>{Math.abs(value)}{unit} {value >= 0 ? "above" : "below"} baseline</p>;
}

function DayDetail({ member, onBack }: { member: Member; onBack: () => void }) {
  const readinessDelta = member.readiness - member.readinessAverage;
  const stageTotals = member.stages.reduce<Record<string, number>>((totals, item) => {
    totals[item.stage] = (totals[item.stage] ?? 0) + item.minutes;
    return totals;
  }, {});
  return (
    <main className="detail-page">
      <header className="detail-header">
        <button className="back" onClick={onBack} aria-label="Back to household dashboard">←</button>
        <div><h1>{member.name}</h1><p>Monday, August 10 · <ProviderLabel member={member} /></p></div>
      </header>

      <section className="panel readiness-panel">
        <div className={`score-ring ${readinessTone(member.readiness)}`}>{member.readiness}</div>
        <div className="readiness-copy">
          <h2>Readiness · {readinessDelta >= 0 ? "above usual" : "below usual"}</h2>
          <p>{readinessDelta >= 0 ? "Higher" : "Lower"} than {member.name}&apos;s 30-day average of {member.readinessAverage}</p>
        </div>
        <div className="contributors">
          {member.contributors.map((contributor) => (
            <div className="contributor" key={contributor.label}>
              <span>{contributor.label}</span>
              <div className="track"><i className={contributor.status} style={{ width: `${contributor.score}%` }} /></div>
              <b className={contributor.status}>{contributor.status}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="panel sleep-panel">
        <div className="sleep-heading"><h2>Sleep</h2><p>{formatDuration(member.sleepMinutes)} · {member.sleepStart} – {member.sleepEnd}</p></div>
        <div className="hypnogram" aria-label="Chronological sleep stages">
          {member.stages.map((item, index) => <span key={index} className={stageColors[item.stage]} style={{ flex: item.minutes }} title={`${item.stage}, ${item.minutes} minutes`} />)}
        </div>
        <div className="time-labels"><span>{member.sleepStart}</span><span>{member.sleepEnd}</span></div>
        <div className="stage-legend">
          {(["REM", "Light", "Deep", "Awake"] as const).map((stage) => (
            <div key={stage}><i className={stageColors[stage]} /><span>{stage} · {formatDuration(stageTotals[stage] ?? 0)}</span></div>
          ))}
        </div>
      </section>

      <section className="stat-pair">
        <article className="panel stat-card"><span>Overnight HRV</span><strong>{member.overnightHrv} ms</strong><Delta value={member.overnightHrv - member.hrvBaseline} unit="ms" /></article>
        <article className="panel stat-card"><span>Sleep average heart rate</span><strong>{member.sleepAverageHeartRate} bpm</strong><Delta value={member.sleepAverageHeartRate - member.heartRateBaseline} unit="bpm" inverse /></article>
      </section>

      {member.sources.includes("whoop") ? (
        <section className="panel whoop-row"><div><span>Whoop recovery</span><strong>{member.recovery}%</strong></div><div><span>Day strain</span><strong>{member.strain}</strong></div></section>
      ) : (
        <section className="panel missing-row"><span className="device-icon" aria-hidden="true">◇</span><div><h2>Whoop not connected</h2><p>Strain and recovery data will appear here once paired.</p></div></section>
      )}
    </main>
  );
}

export function WellnessDashboard() {
  const [view, setView] = useState<View>("cards");
  const [filter, setFilter] = useState("family");
  const [selected, setSelected] = useState<Member | null>(null);
  const visibleMembers = filter === "family" ? members : members.filter((member) => member.id === filter);

  if (selected) return <DayDetail member={selected} onBack={() => setSelected(null)} />;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div><h1>Today</h1><p>Monday, August 10</p></div>
        <label className="member-filter">View<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="family">Family</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      </header>
      <SegmentedControl view={view} onChange={setView} />
      {view === "cards" ? <CardsView visibleMembers={visibleMembers} onOpen={setSelected} /> : <TimelineView visibleMembers={visibleMembers} onOpen={setSelected} />}
    </main>
  );
}
