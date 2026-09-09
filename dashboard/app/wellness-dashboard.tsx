"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  formatDuration,
  formatCalories,
  formatMetric,
  formatStrain,
  readinessTone,
  type Member,
} from "./mock-data";
import type { DataIssue, RangeKey, WellnessSnapshot } from "./wellness-data";

type View = "cards" | "timeline";
type ThemePreference = "system" | "light" | "dark";
type Authorization = { id: string; memberId: string; provider: "oura" | "whoop";
  status: "pending" | "authorized" | "denied" | "expired" | "failed";
  authorizationUrl: string; qrCodeDataUrl: string; expiresAt: number };
const AVATAR_COLORS: Member["avatar"][] = ["green", "amber", "blue", "plum", "coral", "teal"];

type HouseholdAccessState = {
  householdName: string;
  viewers: Array<{ userId: string; email: string | null; displayName: string | null; joinedAt: number }>;
  requests: Array<{ id: string; email: string; displayName: string; requestedAt: number }>;
};

function HouseholdAccessManager() {
  const [access, setAccess] = useState<HouseholdAccessState | null>(null);
  const [email, setEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAccess() {
    const response = await fetch("/api/household/access", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error("Household access could not be loaded.");
    setAccess(await response.json() as HouseholdAccessState);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/household/access", { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Household access could not be loaded.");
        return response.json() as Promise<HouseholdAccessState>;
      })
      .then((result) => setAccess(result))
      .catch((cause) => {
        if (!(cause instanceof Error) || cause.name !== "AbortError") setError("Household access could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  async function createInvitation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy("invite");
    setError(null);
    try {
      const response = await fetch("/api/household/invitations", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json() as { invitation?: { token: string }; error?: string };
      if (!response.ok || !result.invitation) throw new Error(result.error ?? "invitation_unavailable");
      setInviteLink(`${window.location.origin}/onboarding?invite=${encodeURIComponent(result.invitation.token)}`);
      setEmail("");
    } catch {
      setError("The invitation could not be created. Check the email and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setBusy(`request:${requestId}`);
    setError(null);
    try {
      const response = await fetch(`/api/household/join-requests/${encodeURIComponent(requestId)}`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) throw new Error("Request could not be updated.");
      await loadAccess();
    } catch {
      setError("The join request could not be updated.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(viewerId: string) {
    setBusy(`viewer:${viewerId}`);
    setError(null);
    try {
      const response = await fetch(`/api/household/viewers/${encodeURIComponent(viewerId)}`, { method: "DELETE", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Viewer could not be removed.");
      await loadAccess();
    } catch {
      setError("The household member could not be removed.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="settings-section household-access">
    <h3>Household access</h3>
    <p>Invite a member to {access?.householdName ?? "this household"}. The Site administrator must also grant this email access to the private Site.</p>
    <form className="access-invite-form" onSubmit={createInvitation}>
      <label htmlFor="household-viewer-email">Member email</label>
      <div><input id="household-viewer-email" type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="friend@example.com" />
        <button disabled={busy !== null || !email.trim()}>{busy === "invite" ? "Creating…" : "Create invite"}</button></div>
    </form>
    {inviteLink && <div className="invite-result" role="status"><strong>Invitation ready</strong><p>Send this private link to the invited email. It expires in seven days and still requires your approval.</p>
      <div><input readOnly aria-label="Household invitation link" value={inviteLink} /><button type="button" onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy</button></div></div>}
    {access && <>
      <div className="access-list"><h4>Requests awaiting approval</h4>
        {access.requests.length ? access.requests.map((request) => <div className="access-person" key={request.id}>
          <div><strong>{request.displayName}</strong><span>{request.email}</span></div>
          <div><button disabled={busy !== null} onClick={() => decide(request.id, "approved")}>Approve</button><button className="quiet-access" disabled={busy !== null} onClick={() => decide(request.id, "rejected")}>Reject</button></div>
        </div>) : <p className="access-empty">No pending requests.</p>}
      </div>
      <div className="access-list"><h4>Current household members</h4>
        {access.viewers.length ? access.viewers.map((viewer) => <div className="access-person" key={viewer.userId}>
          <div><strong>{viewer.displayName ?? viewer.email ?? "Household member"}</strong>{viewer.email && <span>{viewer.email}</span>}</div>
          <button className="quiet-access" disabled={busy !== null} onClick={() => revoke(viewer.userId)}>Remove</button>
        </div>) : <p className="access-empty">No additional members have joined this household.</p>}
      </div>
    </>}
    {error && <p className="connection-error" role="alert">{error}</p>}
  </div>;
}

function SettingsPanel({ members, canManageHousehold, connectionMemberIds, householdAccessEnabled, theme, onThemeChange, onMemberUpdated, onClose }: {
  members: Member[];
  canManageHousehold: boolean;
  connectionMemberIds: string[];
  householdAccessEnabled: boolean;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onMemberUpdated: (member: Pick<Member, "id" | "name" | "initials" | "avatar">) => void;
  onClose: () => void;
}) {
  const [authorization, setAuthorization] = useState<Authorization | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newMemberName, setNewMemberName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { name: string; avatar: Member["avatar"] }>>(() =>
    Object.fromEntries(members.map((member) => [member.id, { name: member.name, avatar: member.avatar }])));
  const connectionMembers = members.filter((member) => connectionMemberIds.includes(member.id));

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

  async function saveMember(memberId: string) {
    const draft = drafts[memberId];
    if (!draft?.name.trim()) return;
    setBusy(`edit:${memberId}`);
    setError(null);
    try {
      const response = await fetch(`/api/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error("Member could not be updated.");
      const result = await response.json() as { member: Pick<Member, "id" | "name" | "initials" | "avatar"> };
      onMemberUpdated(result.member);
    } catch {
      setError("The household member could not be updated. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="connection-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <button className="modal-close" onClick={onClose} aria-label="Close settings">×</button>
        <h2 id="settings-title">Settings</h2>
        <div className="settings-section theme-setting">
          <div><h3>Appearance</h3><p>Follow this device or choose a fixed theme.</p></div>
          <select aria-label="Color theme" value={theme} onChange={(event) => onThemeChange(event.target.value as ThemePreference)}>
            <option value="system">System setting</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </div>
        {canManageHousehold && <div className="settings-section"><h3>Household members</h3><div className="member-edit-list">
          {members.map((member) => {
            const draft = drafts[member.id] ?? { name: member.name, avatar: member.avatar };
            return <div className="member-editor" key={member.id}>
              <div className={`avatar ${draft.avatar}`}>{member.initials}</div>
              <div className="member-editor-fields"><input aria-label={`${member.name} name`} maxLength={80} value={draft.name}
                onChange={(event) => setDrafts((current) => ({ ...current, [member.id]: { ...draft, name: event.target.value } }))} />
                <div className="color-options" aria-label={`${member.name} profile color`}>
                  {AVATAR_COLORS.map((color) => <button type="button" key={color} className={`color-choice ${color} ${draft.avatar === color ? "selected" : ""}`}
                    aria-label={`${color} profile color`} aria-pressed={draft.avatar === color}
                    onClick={() => setDrafts((current) => ({ ...current, [member.id]: { ...draft, avatar: color } }))} />)}
                </div></div>
              <button className="save-member" disabled={busy !== null} onClick={() => saveMember(member.id)}>
                {busy === `edit:${member.id}` ? "Saving…" : "Save"}
              </button>
            </div>;
          })}
        </div></div>}
        {canManageHousehold && householdAccessEnabled && <HouseholdAccessManager />}
        {connectionMembers.length > 0 && <><div className="settings-section"><h3>Device connections</h3><p className="connection-intro">{canManageHousehold ? "Choose the person first. Each provider account stays attached to that household member." : "Connect your own Oura or WHOOP account to your personal card."}</p></div>
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
            {connectionMembers.map((member) => (
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
            {canManageHousehold && <form className="add-member" onSubmit={addMember}>
              <label htmlFor="new-member-name">Add household member</label>
              <div><input id="new-member-name" value={newMemberName} maxLength={80}
                onChange={(event) => setNewMemberName(event.target.value)} placeholder="Name" />
                <button disabled={busy !== null || !newMemberName.trim()} type="submit">
                  {busy === "new-member" ? "Adding…" : "Add"}
                </button></div>
            </form>}
          </div>
        )}</>}
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

function RangeControl({ range, options, onChange }: {
  range: RangeKey;
  options: WellnessSnapshot["rangeOptions"];
  onChange: (range: RangeKey) => void;
}) {
  const compactLabels: Record<RangeKey, string> = { today: "Today", last7: "7D", last14: "14D", last30: "30D" };
  return <div className="range-control" aria-label="Dashboard date range">
    {options.map((option) => <button key={option.value} className={range === option.value ? "active" : ""}
      aria-pressed={range === option.value} onClick={() => onChange(option.value)}>{compactLabels[option.value]}</button>)}
  </div>;
}

function ProviderLabel({ member }: { member: Member }) {
  const hasOura = member.sources.includes("oura");
  const hasWhoop = member.sources.includes("whoop");
  return <span>{hasOura && hasWhoop ? "Oura + Whoop" : hasOura ? "Oura only" : hasWhoop ? "Whoop only" : "No devices connected"}</span>;
}

function HouseholdCard({ member, issues, isToday, onOpen }: { member: Member; issues: DataIssue[]; isToday: boolean; onOpen: () => void }) {
  const ouraIssue = issues.find((issue) => issue.memberId === member.id && issue.source === "oura" && issue.code !== "not_connected");
  return (
    <article className="household-card">
      <button className="card-open" onClick={onOpen} aria-label={`View ${member.name}'s ${isToday ? "day details" : "range summary"}`}>
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
        <div><strong>{formatMetric(member.readiness)}</strong><span>readiness</span></div>
      </div>
      <div className="card-stats oura-stats">
        <div><span>HRV</span><strong>{member.overnightHrv === null ? "—" : `${formatMetric(member.overnightHrv)} ms`}</strong></div>
        <div><span>Sleep</span><strong>{formatDuration(member.sleepMinutes)}</strong></div>
        <div className={member.dailyCalories === null ? "muted" : ""}><span>Calories</span><strong>{formatCalories(member.dailyCalories)}</strong></div>
      </div>
      <div className="whoop-stats">
        {member.recovery === null && member.strain === null ? <p className="muted">{member.sources.includes("whoop") ? "WHOOP needs refresh" : "No WHOOP paired"}</p> : <>
          <div><span>Recovery</span><strong>{member.recovery === null ? "—" : `${formatMetric(member.recovery)}%`}</strong></div>
          <div><span>Strain</span><strong>{formatStrain(member.strain)}</strong></div>
        </>}
      </div>
      {ouraIssue && <p className="muted">{ouraIssue.message}</p>}
      <button className="detail-link" onClick={onOpen}>View {isToday ? "day details" : "range summary"} <span aria-hidden="true">→</span></button>
    </article>
  );
}

function CardsView({ visibleMembers, issues, isToday, onOpen }: { visibleMembers: Member[]; issues: DataIssue[]; isToday: boolean; onOpen: (member: Member) => void }) {
  return (
    <section className="cards-grid" aria-label={isToday ? "Household daily summaries" : "Household range summaries"}>
      {visibleMembers.map((member) => (
        <HouseholdCard key={member.id} member={member} issues={issues} isToday={isToday} onOpen={() => onOpen(member)} />
      ))}
    </section>
  );
}

function TimelineView({ visibleMembers, historyDates }: { visibleMembers: Member[]; historyDates: string[] }) {
  const weeks: Array<{ dates: Array<string | null>; startIndex: number; label: string }> = [];
  const dateText = (date: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));
  const weekLabel = (start: string, end: string) => start.slice(0, 7) === end.slice(0, 7)
    ? `${new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${start}T12:00:00.000Z`))} ${Number(start.slice(-2))}–${Number(end.slice(-2))}`
    : `${dateText(start)}–${dateText(end)}`;
  for (let end = historyDates.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    const pageDates = historyDates.slice(start, end);
    weeks.push({ dates: [...Array<string | null>(7 - pageDates.length).fill(null), ...pageDates], startIndex: start,
      label: weekLabel(pageDates[0], pageDates.at(-1) ?? pageDates[0]) });
  }
  return (
    <section className="timeline-wrap" aria-label={`${historyDates.length}-day readiness timeline`}>
      <div className="timeline-grid timeline-desktop" style={{ gridTemplateColumns: `130px repeat(${historyDates.length}, minmax(52px, 1fr))`,
        minWidth: `${130 + historyDates.length * 66}px` }}>
        <div />
        {historyDates.map((date) => {
          const parsed = new Date(`${date}T12:00:00.000Z`);
          const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(parsed);
          const compact = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(parsed);
          return <div className="weekday" key={date}><span>{compact}</span><b>{weekday[0]}</b></div>;
        })}
        {visibleMembers.map((member) => (
          <div className="timeline-row" key={member.id}>
            <div className="timeline-name">{member.name}</div>
            {member.readinessHistory.map((score, index) => (
              <div
                key={`${member.id}-${historyDates[index]}`}
                className={`timeline-cell ${readinessTone(score)}`}
                role="img"
                aria-label={`${member.name}, ${historyDates[index]}, readiness ${formatMetric(score)}`}
                title={score === null ? "Unavailable" : `Readiness ${formatMetric(score)}`}
              >
                <span className="sr-only">{formatMetric(score)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="timeline-mobile">
        <div className="timeline-week-strip">
          {weeks.map((week, pageIndex) => <article className="timeline-week" key={week.label}>
            <header><strong>{week.label}</strong><span>{pageIndex === 0 ? "Latest" : `${pageIndex + 1} of ${weeks.length}`}</span></header>
            <div className="timeline-week-grid">
              <div />
              {week.dates.map((date, index) => date ? <div className="mobile-weekday" key={date}>
                <span>{new Intl.DateTimeFormat("en", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${date}T12:00:00.000Z`))}</span>
                <b>{new Date(`${date}T12:00:00.000Z`).getUTCDate()}</b>
              </div> : <div key={`empty-heading-${index}`} />)}
              {visibleMembers.map((member) => <div className="timeline-mobile-row" key={member.id}>
                <div className="timeline-mobile-name">{member.name}</div>
                {week.dates.map((date, index) => {
                  if (!date) return <div className="timeline-mobile-empty" key={`empty-${member.id}-${index}`} aria-hidden="true" />;
                  const historyIndex = week.startIndex + index - (7 - week.dates.filter(Boolean).length);
                  const score = member.readinessHistory[historyIndex] ?? null;
                  return <div key={`${member.id}-${date}`} className={`timeline-mobile-cell ${readinessTone(score)}`}
                    role="img" aria-label={`${member.name}, ${date}, readiness ${formatMetric(score)}`}>
                    <span>{score === null ? "—" : Math.round(score)}</span>
                  </div>;
                })}
              </div>)}
            </div>
          </article>)}
        </div>
        <p className="timeline-swipe-note">{weeks.length > 1 ? "Swipe for earlier weeks · " : ""}Red 0–69 · Yellow 70–84 · Green 85–100</p>
      </div>
      <p className="timeline-note timeline-desktop-note">Cell color reflects daily Oura readiness: red 0–69, yellow 70–84, green 85–100.</p>
    </section>
  );
}

function Delta({ value, unit, inverse = false }: { value: number | null; unit: string; inverse?: boolean }) {
  if (value === null) return <p className="muted">Baseline unavailable</p>;
  const favorable = inverse ? value <= 0 : value >= 0;
  return <p className={favorable ? "positive" : "negative"}>{formatMetric(Math.abs(value))}{unit} {value >= 0 ? "above" : "below"} baseline</p>;
}

function stageDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
}

function signedTemperature(value: number | null): string {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${formatMetric(value)} °C`;
}

function DayDetail({ member, dateLabel, issues, isToday, onBack }: { member: Member; dateLabel: string; issues: DataIssue[]; isToday: boolean; onBack: () => void }) {
  const readinessDelta = member.readiness === null || member.readinessAverage === null
    ? null : member.readiness - member.readinessAverage;
  const stageTotals = member.stages.reduce<Record<"REM" | "Light" | "Deep" | "Awake", number>>(
    (totals, stage) => ({ ...totals, [stage.stage]: totals[stage.stage] + stage.minutes }),
    { REM: 0, Light: 0, Deep: 0, Awake: 0 },
  );
  const stageTotal = member.stages.reduce((sum, stage) => sum + stage.minutes, 0);
  return (
    <main className="detail-page">
      <header className="detail-header">
        <button className="back" onClick={onBack} aria-label="Back to household dashboard">←</button>
        <div><h1>{member.name}</h1><p>{dateLabel} · <ProviderLabel member={member} /></p></div>
      </header>

      {member.sources.includes("oura") && member.readiness !== null && (
        <section className="panel readiness-panel">
          <div className={`score-ring ${readinessTone(member.readiness)}`}>{formatMetric(member.readiness)}</div>
          <div className="readiness-copy">
            <h2>{isToday ? "Readiness" : "Average readiness"}{readinessDelta === null ? "" : ` · ${readinessDelta >= 0 ? "above usual" : "below usual"}`}</h2>
            <p>{readinessDelta === null ? "Readiness baseline is unavailable." : `${readinessDelta >= 0 ? "Higher" : "Lower"} than ${member.name}'s 30-day average of ${formatMetric(member.readinessAverage)}`}</p>
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
      )}

      {issues.filter((issue) => issue.memberId === member.id && issue.code !== "not_connected").map((issue) => (
        <section className="panel missing-row" key={`${issue.source}:${issue.code}`}>
          <span className="device-icon" aria-hidden="true">◇</span><div><h2>{issue.source === "whoop" ? "WHOOP" : "Oura"} needs refresh</h2><p>{issue.message}</p></div>
        </section>
      ))}

      <section className="panel sleep-panel">
        <div className="sleep-heading"><h2>{isToday ? "Sleep" : "Average sleep"}</h2><p>{formatDuration(member.sleepMinutes)}{isToday && member.sleepStart !== "—" && member.sleepEnd !== "—" ? ` · ${member.sleepStart} – ${member.sleepEnd}` : " per night"}</p></div>
        {isToday ? member.stages.length > 0 ? <>
          <div className="hypnogram" role="img" aria-label={`Sleep stages from ${member.sleepStart} to ${member.sleepEnd}`}>
            {member.stages.map((stage, index) => <span key={`${stage.stage}-${index}`} className={stage.stage.toLowerCase()}
              style={{ flexGrow: stage.minutes, flexBasis: `${stageTotal ? stage.minutes / stageTotal * 100 : 0}%` }} />)}
          </div>
          <div className="time-labels"><span>{member.sleepStart}</span><span>{member.sleepEnd}</span></div>
          <div className="stage-legend">
            {(["REM", "Light", "Deep", "Awake"] as const).map((stage) => <div key={stage}><i className={stage.toLowerCase()} />
              <span>{stage} · {stageDuration(stageTotals[stage])}</span></div>)}
          </div>
        </> : <p className="period-note">{member.sources.includes("whoop") && !member.sources.includes("oura")
          ? "WHOOP provides sleep duration and stage totals, but not the detailed stage sequence required for this timeline."
          : "Detailed sleep stages are not available for today yet."}</p>
          : <p className="period-note">Daily sleep stages are available from the Today view and are not combined into a range average.</p>}
      </section>

      <section className="stat-pair">
        <article className="panel stat-card"><span>{isToday ? "Overnight HRV" : "Average overnight HRV"}</span><strong>{member.overnightHrv === null ? "—" : `${formatMetric(member.overnightHrv)} ms`}</strong><Delta value={member.overnightHrv === null || member.hrvBaseline === null ? null : member.overnightHrv - member.hrvBaseline} unit="ms" /></article>
        <article className="panel stat-card"><span>{isToday ? "Resting heart rate" : "Average sleep heart rate"}</span><strong>{member.sleepAverageHeartRate === null ? "—" : `${formatMetric(member.sleepAverageHeartRate)} bpm`}</strong><Delta value={member.sleepAverageHeartRate === null || member.heartRateBaseline === null ? null : member.sleepAverageHeartRate - member.heartRateBaseline} unit="bpm" inverse /></article>
      </section>

      <section className="stat-pair secondary-stat-pair">
        <article className="panel stat-card"><span>{isToday ? "Body temperature" : "Average body temperature"}</span>
          <strong>{signedTemperature(member.bodyTemperatureDeviationC)}</strong><p className="muted">{member.bodyTemperatureDeviationC === null ? "Unavailable" : "from baseline"}</p></article>
        <article className="panel stat-card"><span>{isToday ? "Respiratory rate" : "Average respiratory rate"}</span>
          <strong>{member.respiratoryRate === null ? "—" : formatMetric(member.respiratoryRate)}{member.respiratoryRate !== null && <small> breaths/min</small>}</strong>
          {member.respiratoryRate === null && <p className="muted">Unavailable</p>}</article>
      </section>

      {member.sources.includes("whoop") && member.recovery !== null ? (
        <section className="panel whoop-row"><div><span>Average Whoop recovery</span><strong>{formatMetric(member.recovery)}%</strong></div><div><span>Average day strain</span><strong>{formatStrain(member.strain)}</strong></div></section>
      ) : !member.sources.includes("whoop") ? (
        <section className="panel missing-row"><span className="device-icon" aria-hidden="true">◇</span><div><h2>Whoop not connected</h2><p>Strain and recovery data will appear here once paired.</p></div></section>
      ) : null}
    </main>
  );
}

function applyTheme(theme: ThemePreference) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function WellnessDashboard({ initialSnapshot }: { initialSnapshot: WellnessSnapshot }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [range, setRange] = useState<RangeKey>("today");
  const [view, setView] = useState<View>("cards");
  const [filter, setFilter] = useState("family");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [syncing, setSyncing] = useState(initialSnapshot.mode === "sites");
  const [syncFailed, setSyncFailed] = useState(false);
  const current = snapshot.ranges[range];
  const members = current.members;
  const visibleMembers = filter === "family" ? members : members.filter((member) => member.id === filter);
  const selected = members.find((member) => member.id === selectedId) ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("wellness-theme");
      const preference: ThemePreference = saved === "light" || saved === "dark" ? saved : "system";
      setTheme(preference);
      applyTheme(preference);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (initialSnapshot.mode !== "sites") return;
    const controller = new AbortController();
    const refresh = () => fetch("/api/wellness", {
      headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Sync failed");
      return response.json() as Promise<WellnessSnapshot>;
    }).then((fresh) => setSnapshot(fresh))
      .catch((error) => { if (error instanceof Error && error.name !== "AbortError") setSyncFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setSyncing(false); });
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleId = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(refresh, { timeout: 1200 })
      : window.setTimeout(refresh, 250);
    return () => {
      controller.abort();
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, [initialSnapshot.mode]);

  function changeTheme(preference: ThemePreference) {
    setTheme(preference);
    applyTheme(preference);
    if (preference === "system") window.localStorage.removeItem("wellness-theme");
    else window.localStorage.setItem("wellness-theme", preference);
  }

  function updateMember(updated: Pick<Member, "id" | "name" | "initials" | "avatar">) {
    setSnapshot((existing) => ({ ...existing, ranges: {
      last7: { ...existing.ranges.last7, members: existing.ranges.last7.members.map((member) => member.id === updated.id ? { ...member, ...updated } : member) },
      last14: { ...existing.ranges.last14, members: existing.ranges.last14.members.map((member) => member.id === updated.id ? { ...member, ...updated } : member) },
      last30: { ...existing.ranges.last30, members: existing.ranges.last30.members.map((member) => member.id === updated.id ? { ...member, ...updated } : member) },
      today: { ...existing.ranges.today, members: existing.ranges.today.members.map((member) => member.id === updated.id ? { ...member, ...updated } : member) },
    } }));
  }

  if (selected) return <DayDetail member={selected} dateLabel={current.dateLabel} issues={current.issues} isToday={range === "today"} onBack={() => setSelectedId(null)} />;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div><h1>{current.title}</h1><p>{current.dateLabel}</p></div>
        <div className="header-actions">
          {snapshot.mode === "sites" && <span className={`sync-status ${syncing ? "syncing" : ""} ${syncFailed ? "failed" : ""}`}
            role="status" aria-label={syncing ? "Data is syncing" : syncFailed ? "Data sync did not complete" : "Data is up to date"}
            title={syncing ? "Syncing data" : syncFailed ? "Sync needs attention" : "Data is up to date"}>↻</span>}
          <button className="manage-connections" onClick={() => setSettingsOpen(true)} aria-label="Settings"><span className="settings-icon" aria-hidden="true">⚙</span><span className="settings-label">Settings</span></button>
        </div>
      </header>
      <div className="dashboard-controls">
        <label className="member-filter">View<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="family">Family</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <RangeControl range={range} options={snapshot.rangeOptions} onChange={setRange} />
      </div>
      <SegmentedControl view={view} onChange={setView} />
      {current.emptyMessage && <section className="empty-state" role="status"><h2>Data not ready</h2><p>{current.emptyMessage}</p></section>}
      {view === "cards" ? <CardsView visibleMembers={visibleMembers} issues={current.issues} isToday={range === "today"} onOpen={(member) => setSelectedId(member.id)} />
        : <TimelineView visibleMembers={visibleMembers} historyDates={current.historyDates} />}
      {settingsOpen && <SettingsPanel members={members} canManageHousehold={snapshot.canManageHousehold}
        connectionMemberIds={snapshot.connectionMemberIds} theme={theme}
        householdAccessEnabled={snapshot.mode === "sites"}
        onThemeChange={changeTheme} onMemberUpdated={updateMember} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
