import type { Metadata } from "next";
import { requireHouseholdUser } from "./household-auth";
import { WellnessDashboard } from "./wellness-dashboard";
import { getWellnessSnapshot } from "./wellness-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Household wellness",
  description: "A calm daily view of household sleep and recovery.",
};

async function ProtectedDashboard({ selection, memberId }: { selection?: string; memberId?: string }) {
  const user = await requireHouseholdUser("/");
  const snapshot = await getWellnessSnapshot(user, selection);
  return <WellnessDashboard members={snapshot.members} title={snapshot.title} dateLabel={snapshot.dateLabel}
    dateOptions={snapshot.dateOptions} selection={snapshot.selection} historyDates={snapshot.historyDates}
    isAverage={snapshot.isAverage} emptyMessage={snapshot.emptyMessage} initialMemberId={memberId}
    mode={snapshot.mode} issues={snapshot.issues} />;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ date?: string; member?: string }> }) {
  const { date, member } = await searchParams;
  return <ProtectedDashboard selection={date} memberId={member} />;
}
