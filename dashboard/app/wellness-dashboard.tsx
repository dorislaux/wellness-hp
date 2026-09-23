"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  formatDuration,
  formatCalories,
  formatMetric,
  formatStrain,
  readinessTone,
  timelineTone,
  type Member,
} from "./mock-data";
import type { DataIssue, RangeKey, WellnessSnapshot } from "./wellness-data";

type View = "cards" | "timeline" | "analysis";
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
      {(["cards", "timeline", "analysis"] as const).map((option) => (
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
  const compactLabels: Record<RangeKey, string> = { today: "Today", last7: "7D", last14: "14D", last28: "28D" };
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
        <div><strong>{formatMetric(member.primaryScore)}</strong><span>{member.primaryScoreLabel}</span></div>
      </div>
      <div className="card-stats oura-stats">
        <div><span>HRV</span><strong>{member.overnightHrv === null ? "—" : `${formatMetric(member.overnightHrv)} ms`}</strong></div>
        <div><span>Sleep</span><strong>{formatDuration(member.sleepMinutes)}</strong></div>
        <div className={member.dailyCalories === null ? "muted" : ""}><span>Calories</span><strong>{formatCalories(member.dailyCalories)}</strong></div>
      </div>
      <div className="whoop-stats">
        {member.recovery === null && member.strain === null ? <p className="muted">{member.sources.includes("whoop") ? "WHOOP needs refresh" : "No WHOOP paired"}</p> : <>
          {member.primaryScoreLabel !== "recovery" && <div><span>Recovery</span><strong>{member.recovery === null ? "—" : `${formatMetric(member.recovery)}%`}</strong></div>}
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

function householdWeekAverage(members: Member[], start: number, end: number): number | null {
  const memberAverages = members.map((member) => metricAverage(member.scoreHistory.slice(start, end)))
    .filter((value): value is number => value !== null);
  return memberAverages.length ? memberAverages.reduce((sum, value) => sum + value, 0) / memberAverages.length : null;
}

function TimelineView({ visibleMembers, historyDates, scopeLabel }: { visibleMembers: Member[]; historyDates: string[]; scopeLabel: string }) {
  const weeks: Array<{ dates: string[]; startIndex: number; label: string; average: number | null }> = [];
  const dateText = (date: string) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00.000Z`));
  const weekLabel = (start: string, end: string) => start.slice(0, 7) === end.slice(0, 7)
    ? `${new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(`${start}T12:00:00.000Z`))} ${Number(start.slice(-2))}–${Number(end.slice(-2))}`
    : `${dateText(start)}–${dateText(end)}`;
  for (let end = historyDates.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    const pageDates = historyDates.slice(start, end);
    weeks.push({ dates: pageDates, startIndex: start,
      label: weekLabel(pageDates[0], pageDates.at(-1) ?? pageDates[0]),
      average: householdWeekAverage(visibleMembers, start, end) });
  }
  return (
    <section className="timeline-wrap" aria-label={`${historyDates.length}-day wellness score timeline`}>
      <div className="timeline-week-list">
          {weeks.map((week) => <article className="timeline-week" key={week.label}>
            <header><strong>{week.label}</strong><span>{scopeLabel} average <b>{formatMetric(week.average)}</b></span></header>
            <div className="timeline-week-grid">
              <div />
              {week.dates.map((date) => <div className="mobile-weekday" key={date}>
                <span>{new Intl.DateTimeFormat("en", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${date}T12:00:00.000Z`))}</span>
                <b>{new Date(`${date}T12:00:00.000Z`).getUTCDate()}</b>
              </div>)}
              {visibleMembers.map((member) => <div className="timeline-mobile-row" key={member.id}>
                <div className="timeline-mobile-name">{member.name}</div>
                {week.dates.map((date, index) => {
                  const score = member.scoreHistory[week.startIndex + index] ?? null;
                  const source = member.scoreSourceHistory[week.startIndex + index] ?? null;
                  const scoreName = source === "whoop" ? "WHOOP recovery" : "Oura readiness";
                  return <div key={`${member.id}-${date}`} className={`timeline-mobile-cell ${timelineTone(score, source)}`}
                    role="img" aria-label={`${member.name}, ${date}, ${scoreName} ${formatMetric(score)}`}>
                    <span>{score === null ? "—" : formatMetric(score)}</span>
                  </div>;
                })}
              </div>)}
            </div>
          </article>)}
      </div>
      <p className="timeline-note">Colors follow each score’s device: Oura readiness uses Oura zones; WHOOP recovery uses WHOOP zones.</p>
    </section>
  );
}

type MetricKey = keyof NonNullable<Member["metricHistory"]>;
const ANALYSIS_METRICS: Array<{ key: MetricKey; label: string; short: string; unit: string }> = [
  { key: "heartRate", label: "Resting heart rate", short: "RHR", unit: "bpm" },
  { key: "hrv", label: "Heart rate variability", short: "HRV", unit: "ms" },
  { key: "temperature", label: "Body temperature", short: "Temp", unit: "°C from baseline" },
  { key: "sleep", label: "Sleep duration", short: "Sleep", unit: "h" },
  { key: "activeCalories", label: "Active calories", short: "Calories", unit: "kcal" },
];

function metricValue(value: number | null, key: MetricKey) {
  if (value === null) return "—";
  if (key === "sleep") return `${formatMetric(value / 60)} h`;
  if (key === "temperature") return `${value >= 0 ? "+" : ""}${formatMetric(value)} °C`;
  return `${formatMetric(value)} ${key === "heartRate" ? "bpm" : key === "hrv" ? "ms" : "kcal"}`;
}

function metricAverage(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function TrendChart({ series, dates, label, compact = false }: {
  series: Array<{ name: string; values: Array<number | null>; color: number }>;
  dates: string[];
  label: string;
  compact?: boolean;
}) {
  const values = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  if (!values.length) return <p className="analysis-unavailable">No data for this period</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.2, Math.abs(max) * 0.02, 0.1);
  const low = min - pad;
  const high = max + pad;
  const x = (index: number) => 10 + index / Math.max(1, dates.length - 1) * 300;
  const y = (value: number) => 100 - (value - low) / (high - low) * 80;
  const path = (items: Array<number | null>) => items.map((value, index) =>
    value === null ? "" : `${index === 0 || items[index - 1] === null ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const baseline = compact ? metricAverage(series[0]?.values ?? []) : null;
  return <svg className={`analysis-chart ${compact ? "compact" : ""}`} viewBox="0 0 320 120" role="img" aria-label={label}>
    <path className="analysis-guide" d="M10 100H310" fill="none" />
    {baseline !== null && <path className="analysis-baseline" d={`M10 ${y(baseline)}H310`} fill="none" />}
    {series.map((item) => <g key={item.name}><path className={`analysis-line series-${item.color}`} d={path(item.values)} fill="none" />
      {item.values.map((value, index) => value === null ? null : <circle key={index} className={`analysis-dot series-${item.color}`}
        cx={x(index)} cy={y(value)} r="2.5" />)}</g>)}
    {!compact && <><text x="10" y="117">{dates[0]?.slice(5)}</text><text x="310" y="117" textAnchor="end">{dates.at(-1)?.slice(5)}</text></>}
  </svg>;
}

function AnalysisView({ visibleMembers, historyDates, isFamily }: { visibleMembers: Member[]; historyDates: string[]; isFamily: boolean }) {
  const [metric, setMetric] = useState<MetricKey>("hrv");
  if (!visibleMembers.length) return <p className="analysis-unavailable">No household members yet.</p>;
  if (!isFamily) {
    const member = visibleMembers[0];
    return <section className="analysis-view" aria-label={`${member.name} health trends`}>
      <h2>{member.name}&apos;s trends</h2>
      <div className="analysis-metric-list">{ANALYSIS_METRICS.map((definition) => {
        const values = member.metricHistory?.[definition.key] ?? [];
        const average = metricAverage(values);
        return <article className="analysis-metric" key={definition.key}>
          <div className="analysis-metric-heading"><h3>{definition.label}</h3><strong>{metricValue(average, definition.key)}</strong></div>
          <TrendChart compact series={[{ name: member.name, values, color: 1 }]} dates={historyDates}
            label={`${member.name} ${definition.label} trend over ${historyDates.length} days`} />
        </article>;
      })}</div>
      <p className="analysis-source-note">Oura data is preferred; WHOOP fills missing heart rate, HRV, temperature and sleep. Active calories currently require Oura.</p>
    </section>;
  }
  const definition = ANALYSIS_METRICS.find((item) => item.key === metric) ?? ANALYSIS_METRICS[1];
  return <section className="analysis-view" aria-label="Household metric comparison">
    <div className="analysis-metric-picker" aria-label="Metric to compare">
      {ANALYSIS_METRICS.map((item) => <button type="button" key={item.key} className={metric === item.key ? "active" : ""}
        aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.short}</button>)}
    </div>
    <h2>{definition.label}</h2>
    <p className="analysis-unit">Daily values · {definition.unit}</p>
    <div className="analysis-family-chart">
      <TrendChart dates={historyDates} label={`${definition.label} trends for ${visibleMembers.map((member) => member.name).join(", ")}`}
        series={visibleMembers.map((member, index) => ({ name: member.name, values: member.metricHistory?.[metric] ?? [], color: index % 4 + 1 }))} />
    </div>
    <div className="analysis-member-list">{visibleMembers.map((member, index) => {
      const average = metricAverage(member.metricHistory?.[metric] ?? []);
      return <div className="analysis-member-row" key={member.id}>
        <span><i className={`analysis-key series-${index % 4 + 1}`} aria-hidden="true" />{member.name}</span>
        <strong>{metricValue(average, metric)}</strong>
      </div>;
    })}</div>
    <p className="analysis-source-note">Averages use available days. Oura is preferred; WHOOP fills comparable gaps. Active calories currently require Oura.</p>
  </section>;
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
      last28: { ...existing.ranges.last28, members: existing.ranges.last28.members.map((member) => member.id === updated.id ? { ...member, ...updated } : member) },
      today: { ...existing.ranges.today, members: existing.ranges.today.members.map((member) => member.id === updated.id ? { ...member, ...updated } : member) },
    } }));
  }

  function changeView(next: View) {
    setView(next);
    if (next === "timeline") setRange("last7");
    if (next === "analysis") {
      if (range === "today") setRange("last28");
      if (filter === "family" && members.length) setFilter(members[0].id);
    }
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
        <RangeControl range={range} options={snapshot.rangeOptions.filter((option) => view === "cards" || option.value !== "today")} onChange={setRange} />
      </div>
      <SegmentedControl view={view} onChange={changeView} />
      {current.emptyMessage && <section className="empty-state" role="status"><h2>Data not ready</h2><p>{current.emptyMessage}</p></section>}
      {view === "cards" ? <CardsView visibleMembers={visibleMembers} issues={current.issues} isToday={range === "today"} onOpen={(member) => setSelectedId(member.id)} />
        : view === "timeline" ? <TimelineView visibleMembers={visibleMembers} historyDates={current.historyDates}
          scopeLabel={filter === "family" ? "Household" : visibleMembers[0]?.name ?? "Member"} />
          : <AnalysisView visibleMembers={visibleMembers} historyDates={current.historyDates} isFamily={filter === "family"} />}
      {settingsOpen && <SettingsPanel members={members} canManageHousehold={snapshot.canManageHousehold}
        connectionMemberIds={snapshot.connectionMemberIds} theme={theme}
        householdAccessEnabled={snapshot.mode === "sites"}
        onThemeChange={changeTheme} onMemberUpdated={updateMember} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}
