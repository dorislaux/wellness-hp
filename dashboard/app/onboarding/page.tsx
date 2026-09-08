import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPendingJoinRequest } from "../../db/household-access-store";
import { getHouseholdContext } from "../../db/household-store";
import { requireChatGPTUser } from "../chatgpt-auth";
import { HouseholdOnboarding } from "./household-onboarding";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Set up your household · Household wellness",
  description: "Create a private household or request to join one.",
};

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const user = await requireChatGPTUser("/onboarding");
  if ((process.env.WELLNESS_DATA_MODE ?? "mock") === "mock") redirect("/");
  if (await getHouseholdContext(user)) redirect("/");

  const pending = await getPendingJoinRequest(user.userId);
  const params = await searchParams;
  const invite = typeof params.invite === "string" && params.invite.length <= 128 ? params.invite : "";
  return <HouseholdOnboarding
    displayName={user.fullName ?? user.email.split("@")[0] ?? "there"}
    initialInvite={invite}
    pending={pending}
  />;
}
