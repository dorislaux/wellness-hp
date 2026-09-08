import type { Metadata } from "next";
import { requireHouseholdUser } from "./household-auth";
import { WellnessDashboard } from "./wellness-dashboard";
import { getWellnessSnapshot } from "./wellness-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Household wellness",
  description: "A calm daily view of household sleep and recovery.",
};

async function ProtectedDashboard() {
  const user = await requireHouseholdUser("/");
  const snapshot = await getWellnessSnapshot(user);
  return <WellnessDashboard initialSnapshot={snapshot} />;
}

export default function Home() {
  return <ProtectedDashboard />;
}
