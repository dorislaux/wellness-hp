"use client";

import { useState } from "react";

type PendingRequest = { id: string; householdName: string; createdAt: number } | null;

function messageFor(code: string): string {
  if (code === "invitation_email_mismatch") return "This invitation was issued to a different email address.";
  if (code === "invitation_invalid") return "This invitation is invalid, expired, or already used.";
  if (code === "join_request_pending") return "You already have a household request awaiting approval.";
  if (code === "already_member") return "Your account already belongs to a household.";
  return "That could not be completed. Please try again.";
}

export function HouseholdOnboarding({ displayName, initialInvite, pending: initialPending }: {
  displayName: string;
  initialInvite: string;
  pending: PendingRequest;
}) {
  const [mode, setMode] = useState<"choose" | "create" | "join">(initialInvite ? "join" : "choose");
  const [householdName, setHouseholdName] = useState(`${displayName}'s household`.slice(0, 80));
  const [invite, setInvite] = useState(initialInvite);
  const [pending, setPending] = useState(initialPending);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createHousehold(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!householdName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/households", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          name: householdName,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "household_creation_unavailable");
      window.location.assign("/");
    } catch (cause) {
      setError(messageFor(cause instanceof Error ? cause.message : ""));
      setBusy(false);
    }
  }

  async function requestToJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/household/join-requests", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ token: invite.trim() }),
      });
      const result = await response.json() as { error?: string; joinRequest?: NonNullable<PendingRequest> };
      if (!response.ok || !result.joinRequest) throw new Error(result.error ?? "join_request_unavailable");
      setPending({ ...result.joinRequest, createdAt: Date.now() });
    } catch (cause) {
      setError(messageFor(cause instanceof Error ? cause.message : ""));
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return <main className="access-page onboarding-page"><section className="panel access-card onboarding-card">
      <p className="eyebrow">Household request sent</p>
      <h1>Waiting for approval</h1>
      <p>The owner of <strong>{pending.householdName}</strong> must confirm your request before any household data becomes visible.</p>
      <div className="pending-actions">
        <button className="primary-action" onClick={() => window.location.reload()}>Check approval</button>
        <a href="/signout-with-chatgpt?return_to=%2F">Sign in with a different account</a>
      </div>
    </section></main>;
  }

  return <main className="access-page onboarding-page"><section className="panel access-card onboarding-card">
    <p className="eyebrow">Welcome, {displayName}</p>
    <h1>{mode === "create" ? "Create your household" : mode === "join" ? "Join a household" : "Choose your household"}</h1>
    {mode === "choose" ? <>
      <p>Your health data stays separate from every other household.</p>
      <div className="onboarding-options">
        <button onClick={() => setMode("create")}><strong>Create a new household</strong><span>Start a private dashboard and become its owner.</span></button>
        <button onClick={() => setMode("join")}><strong>Join an existing household</strong><span>Use an invitation and wait for its owner to approve you.</span></button>
      </div>
    </> : mode === "create" ? <form className="onboarding-form" onSubmit={createHousehold}>
      <p>You will be the owner and can add members, connect devices, and approve viewers. Dates will follow this device&apos;s current time zone.</p>
      <label htmlFor="household-name">Household name</label>
      <input id="household-name" maxLength={80} value={householdName} onChange={(event) => setHouseholdName(event.target.value)} />
      <button className="primary-action" disabled={busy || !householdName.trim()}>{busy ? "Creating…" : "Create household"}</button>
      <button type="button" className="quiet-button" onClick={() => setMode("choose")}>Back</button>
    </form> : <form className="onboarding-form" onSubmit={requestToJoin}>
      <p>Paste the invitation code or the code from the end of your invitation link. The household owner will still need to approve your request.</p>
      <label htmlFor="household-invite">Invitation code</label>
      <input id="household-invite" autoComplete="off" maxLength={128} value={invite} onChange={(event) => setInvite(event.target.value)} />
      <button className="primary-action" disabled={busy || !invite.trim()}>{busy ? "Sending…" : "Request to join"}</button>
      <button type="button" className="quiet-button" onClick={() => setMode("choose")}>Back</button>
    </form>}
    {error && <p className="connection-error" role="alert">{error}</p>}
  </section></main>;
}
