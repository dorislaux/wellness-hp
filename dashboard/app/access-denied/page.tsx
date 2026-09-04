import { chatGPTSignOutPath } from "../chatgpt-auth";

export default function AccessDenied() {
  return (
    <main className="access-page">
      <section className="panel access-card">
        <p className="eyebrow">Household wellness</p>
        <h1>Access isn&apos;t enabled for this account</h1>
        <p>
          Sign in with a household account that has been invited to this private
          dashboard.
        </p>
        <a href={chatGPTSignOutPath("/")}>Use another account</a>
      </section>
    </main>
  );
}
