"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  formatDuration,
  formatStrain,
  readinessTone,
  weekDays,
  type Member,
  type SleepStage,
} from "./mock-data";
import type { DataIssue } from "./wellness-data";

type View = "cards" | "timeline";
type Authorization = { id: string; memberId: string; provider: "oura" | "whoop";
  status: "pending" | "authorized" | "denied" | "expired" | "failed";
  authorizationUrl: string; qrCodeDataUrl: string; expiresAt: number };

function ConnectionPanel({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");

  useEffect(() => {
    if (!authorization || authorization.status !== "pending") return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/members/${encodeURIComponent(authorization.memberId)}/connections/${authorization.provider}/authorizations/${encodeURIComponent(authorization.id)}`,
        { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json() as Pick<Authorization, "status">;
      if (result.status === "authorized") window.location.reload();
      else if (result.status !== "pending") setAuthorization((current) => current ? { ...current, status: result.status } : current);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [authorization]);

  async function start(memberId: string, provider: "oura" | "whoop") {
    setBusy(`${memberId}:${provider}`);
    setError(null);
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(memberId)}/connections/${provider}/authorizations`,
        { method: "POST", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Pairing could not be started.");
      const result = await response.json() as Omit<Authorization, "memberId">;
      setAuthorization({ ...result, memberId });
    } catch {
      setError("Pairing is unavailable. Check the provider setup and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newMemberName.trim();
    if (!name) return;
    setBusy("new-member");
    setError(null);
    try {
      const response = await fetch("/api/members", { method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error("Member could not be added.");
      window.location.reload();
    } catch {
      setError("The household member could not be added. Try again.");
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="connection-panel" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <button className="modal-close" onClick={onClose} aria-label="Close connection settings">×</button>
        <h2 id="connection-title">Connect devices</h2>
        <p className="connection-intro">Choose the person first. Each provider account stays attached to that household member.</p>
        {authorization ? (
          <div className="authorization-step">
            <Image src={authorization.qrCodeDataUrl} width={256} height={256} unoptimized alt={`QR code to authorize ${authorization.provider}`} />
            <h3>{authorization.status === "pending" ? `Scan to connect ${authorization.provider === "whoop" ? "WHOOP" : "Oura"}` : "Authorization did not complete"}</h3>
            <p>{authorization.status === "pending" ? "Open the camera on the provider owner's phone. This code expires in 10 minutes." : "Close this step and start a new authorization."}</p>
            <a className="provider-link" href={authorization.authorizationUrl} target="_blank" rel="noreferrer">Open on this device</a>
            <button className="quiet-button" onClick={() => setAuthorization(null)}>Back to members</button>
          </div>
        ) : (
          <div className="connection-list">
            {members.map((member) => (
              <div className="connection-member" key={member.id}>
                <div><strong>{member.name}</strong><span>{member.sources.length ? member.sources.map((source) => source === "whoop" ? "WHOOP" : "Oura").join(" + ") : "No devices connected"}</span></div>
                <div>
                  {(["oura", "whoop"] as const).map((provider) => (
                    <button key={provider} disabled={busy !== null} onClick={() => start(member.id, provider)}>
                      {busy === `${member.id}:${provider}` ? "Starting…" : `${member.sources.includes(provider) ? "Reconnect" : "Connect"} ${provider === "whoop" ? "WHOOP" : "Oura"}`}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <form className="add-member" onSubmit={addMember}>
              <label htmlFor="new-member-name">Add household member</label>
              <div><input id="new-member-name" value={newMemberName} maxLength={80}
                onChange={(event) => setNewMemberName(event.target.value)} placeholder="Name" />
                <button disabled={busy !== null || !newMemberName.trim()} type="submit">
                  {busy === "new-member" ? "Adding…" : "Add"}
                </button></div>
            </form>
          </div>
        )}
        {error && <p className="connection-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}

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
  const hasOura = member.sources.includes("oura");
  const hasWhoop = member.sources.includes("whoop");
  return <span>{hasOura && hasWhoop ? "Oura + Whoop" : hasOura ? "Oura only" : hasWhoop ? "Whoop only" : "No devices connected"}</span>;
}

function HouseholdCard({ member, issues, isAverage, onOpen }: { member: Member; issues: DataIssue[]; isAverage: boolean; onOpen: () => void }) {
  const ouraIssue = issues.find((issue) => issue.memberId === member.id && issue.source === "oura" && issue.code !== "not_connected");
  return (
    <article className="household-card">
      <button className="card-open" onClick={onOpen} aria-label={`View ${member.name}'s ${isAverage ? "seven-day summary" : "day"}`}>
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
        <div><strong>{member.readiness ?? "—"}</strong><span>readiness</span></div>
        {member.recovery === null ? (
          <p className="muted">{member.sources.includes("whoop") ? "Whoop needs refresh" : "No Whoop paired"}</p>
        ) : (
          <p>Recovery {member.recovery}%</p>
        )}
      </div>
      <div className="card-stats">
        <div><span>HRV</span><strong>{member.overnightHrv === null ? "—" : `${member.overnightHrv} ms`}</strong></div>
        <div><span>Sleep</span><strong>{formatDuration(member.sleepMinutes)}</strong></div>
        <div className={member.strain === null ? "muted" : ""}>
          <span>Strain</span><strong>{formatStrain(member.strain)}</strong>
        </div>
      </div>
      {ouraIssue && <p className="muted">{ouraIssue.message}</p>}
      <button className="detail-link" onClick={onOpen}>View {isAverage ? "7-day summary" : "day detail"} <span aria-hidden="true">→</span></button>
    </article>
  );
}

function CardsView({ visibleMembers, issues, isAverage, onOpen }: { visibleMembers: Member[]; issues: DataIssue[]; isAverage: boolean; onOpen: (member: Member) => void }) {
  return (
    <section className="cards-grid" aria-label="Household daily cards">
      {visibleMembers.map((member) => (
        <HouseholdCard key={member.id} member={member} issues={issues} isAverage={isAverage} onOpen={() => onOpen(member)} />
      ))}
    </section>
  );
}

function TimelineView({ visibleMembers, historyDates, onOpen }: { visibleMembers: Member[]; historyDates: string[]; onOpen: (member: Member, date: string) => void }) {
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
                onClick={() => onOpen(member, historyDates[index])}
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

function Delta({ value, unit, inverse = false }: { value: number | null; unit: string; inverse?: boolean }) {
  if (value === null) return <p className="muted">Baseline unavailable</p>;
  const favorable = inverse ? value <= 0 : value >= 0;
  return <p className={favorable ? "positive" : "negative"}>{Math.abs(value)}{unit} {value >= 0 ? "above" : "below"} baseline</p>;
}

function DayDetail({ member, dateLabel, issues, isAverage, onBack }: { member: Member; dateLabel: string; issues: DataIssue[]; isAverage: boolean; onBack: () => void }) {
  const readinessDelta = member.readiness === null || member.readinessAverage === null
    ? null : member.readiness - member.readinessAverage;
  const stageTotals = member.stages.reduce<Record<string, number>>((totals, item) => {
    totals[item.stage] = (totals[item.stage] ?? 0) + item.minutes;
    return totals;
  }, {});
  return (
    <main className="detail-page">
      <header className="detail-header">
        <button className="back" onClick={onBack} aria-label="Back to household dashboard">←</button>
        <div><h1>{member.name}</h1><p>{dateLabel} · <ProviderLabel member={member} /></p></div>
      </header>

      <section className="panel readiness-panel">
        <div className={`score-ring ${readinessTone(member.readiness)}`}>{member.readiness ?? "—"}</div>
        <div className="readiness-copy">
          <h2>{isAverage ? "Average readiness" : "Readiness"}{readinessDelta === null ? "" : ` · ${readinessDelta >= 0 ? "above usual" : "below usual"}`}</h2>
          <p>{readinessDelta === null ? "Readiness or baseline is unavailable." : `${readinessDelta >= 0 ? "Higher" : "Lower"} than ${member.name}'s 30-day average of ${member.readinessAverage}`}</p>
        </div>
        <div className="contributors">
          {member.contributors.map((contributor) => (
            <div className="contributor" key={contributor.label}>
              <span>{contributor.label}</span>
              <div className="track"><i className={contributor.status} style={{ width: `${contributor.score ?? 0}%` }} /></div>
              <b className={contributor.score === null ? "muted" : contributor.status}>{contributor.score === null ? "unavailable" : contributor.status}</b>
            </div>
          ))}
        </div>
      </section>

      {issues.filter((issue) => issue.memberId === member.id && issue.code !== "not_connected").map((issue) => (
        <section className="panel missing-row" key={`${issue.source}:${issue.code}`}>
          <span className="device-icon" aria-hidden="true">◇</span><div><h2>{issue.source === "whoop" ? "WHOOP" : "Oura"} needs refresh</h2><p>{issue.message}</p></div>
        </section>
      ))}

      <section className="panel sleep-panel">
        <div className="sleep-heading"><h2>{isAverage ? "Average sleep" : "Sleep"}</h2><p>{formatDuration(member.sleepMinutes)}{isAverage ? " per night" : ` · ${member.sleepStart} – ${member.sleepEnd}`}</p></div>
        {isAverage ? (
          <p className="period-note">Choose a single date to see sleep stages and bedtime details.</p>
        ) : (
          <>
            <div className="hypnogram" aria-label="Chronological sleep stages">
              {member.stages.map((item, index) => <span key={index} className={stageColors[item.stage]} style={{ flex: item.minutes }} title={`${item.stage}, ${item.minutes} minutes`} />)}
            </div>
            <div className="time-labels"><span>{member.sleepStart}</span><span>{member.sleepEnd}</span></div>
            <div className="stage-legend">
              {(["REM", "Light", "Deep", "Awake"] as const).map((stage) => (
                <div key={stage}><i className={stageColors[stage]} /><span>{stage} · {formatDuration(stageTotals[stage] ?? 0)}</span></div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="stat-pair">
        <article className="panel stat-card"><span>{isAverage ? "Average overnight HRV" : "Overnight HRV"}</span><strong>{member.overnightHrv === null ? "—" : `${member.overnightHrv} ms`}</strong><Delta value={member.overnightHrv === null || member.hrvBaseline === null ? null : member.overnightHrv - member.hrvBaseline} unit="ms" /></article>
        <article className="panel stat-card"><span>{isAverage ? "Average sleep heart rate" : "Sleep average heart rate"}</span><strong>{member.sleepAverageHeartRate === null ? "—" : `${member.sleepAverageHeartRate} bpm`}</strong><Delta value={member.sleepAverageHeartRate === null || member.heartRateBaseline === null ? null : member.sleepAverageHeartRate - member.heartRateBaseline} unit="bpm" inverse /></article>
      </section>

      {member.sources.includes("whoop") && member.recovery !== null ? (
        <section className="panel whoop-row"><div><span>{isAverage ? "Average Whoop recovery" : "Whoop recovery"}</span><strong>{member.recovery}%</strong></div><div><span>{isAverage ? "Average day strain" : "Day strain"}</span><strong>{formatStrain(member.strain)}</strong></div></section>
      ) : !member.sources.includes("whoop") ? (
        <section className="panel missing-row"><span className="device-icon" aria-hidden="true">◇</span><div><h2>Whoop not connected</h2><p>Strain and recovery data will appear here once paired.</p></div></section>
      ) : null}
    </main>
  );
}

export function WellnessDashboard({ members, title, dateLabel, dateOptions, selection, historyDates,
  isAverage, emptyMessage, initialMemberId, mode = "mock", issues = [] }: {
  members: Member[];
  title: string;
  dateLabel: string;
  dateOptions: Array<{ value: string; label: string }>;
  selection: string;
  historyDates: string[];
  isAverage: boolean;
  emptyMessage: string | null;
  initialMemberId?: string;
  mode?: "mock" | "sites";
  issues?: DataIssue[];
}) {
  const [view, setView] = useState<View>("cards");
  const [filter, setFilter] = useState("family");
  const [selected, setSelected] = useState<Member | null>(() => members.find((member) => member.id === initialMemberId) ?? null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const visibleMembers = filter === "family" ? members : members.filter((member) => member.id === filter);

  function navigateToDate(value: string, member?: Member) {
    const params = new URLSearchParams(window.location.search);
    if (value === "last7") params.delete("date");
    else params.set("date", value);
    if (member) params.set("member", member.id);
    else params.delete("member");
    window.location.assign(`${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }

  if (selected) return <DayDetail member={selected} dateLabel={dateLabel} issues={issues} isAverage={isAverage} onBack={() => setSelected(null)} />;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div><h1>{title}</h1><p>{dateLabel}</p></div>
        <div className="header-actions">
          {mode === "sites" && <button className="manage-connections" onClick={() => setConnectionsOpen(true)}>Connect devices</button>}
          <label className="date-filter">Date<select value={selection} onChange={(event) => navigateToDate(event.target.value)}>{dateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="member-filter">View<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="family">Family</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        </div>
      </header>
      <SegmentedControl view={view} onChange={setView} />
      {emptyMessage && <section className="empty-state" role="status"><h2>Data not ready</h2><p>{emptyMessage}</p></section>}
      {view === "cards" ? <CardsView visibleMembers={visibleMembers} issues={issues} isAverage={isAverage} onOpen={setSelected} />
        : <TimelineView visibleMembers={visibleMembers} historyDates={historyDates} onOpen={(member, date) => navigateToDate(date, member)} />}
      {connectionsOpen && <ConnectionPanel members={members} onClose={() => setConnectionsOpen(false)} />}
    </main>
  );
}
