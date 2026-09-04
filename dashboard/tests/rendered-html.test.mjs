import assert from "node:assert/strict";
import test from "node:test";

const ALLOWED_EMAIL = "owner@example.test";
process.env.WELLNESS_ALLOWED_EMAILS = ALLOWED_EMAIL;

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(workerUrl.href)).default;
}

async function render(path = "/", headers = {}) {
  const handler = await worker();
  return handler.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html", ...headers },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const authenticatedHeaders = (email) => ({
  "oai-authenticated-user-id": `user-${email}`,
  "oai-authenticated-user-email": email,
});

test("redirects an anonymous visitor to ChatGPT sign-in", async () => {
  const response = await render();
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/signin-with-chatgpt");
  assert.equal(location.search, "?return_to=%2F");
});

test("redirects an authenticated non-household visitor", async () => {
  const response = await render("/", authenticatedHeaders("stranger@example.test"));
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/access-denied");
});

test("server-renders the dashboard for an allowed household user", async () => {
  const response = await render("/", authenticatedHeaders(ALLOWED_EMAIL));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Household wellness<\/title>/i);
  assert.match(html, /Today/);
  assert.match(html, /Alex/);
  assert.match(html, /Jordan/);
  assert.match(html, /Sam/);
  assert.match(html, /Timeline/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("protects the session API with the same household boundary", async () => {
  const anonymous = await render("/api/session", { accept: "application/json" });
  assert.equal(anonymous.status, 401);

  const denied = await render(
    "/api/session",
    { ...authenticatedHeaders("stranger@example.test"), accept: "application/json" },
  );
  assert.equal(denied.status, 403);

  const allowed = await render(
    "/api/session",
    { ...authenticatedHeaders(ALLOWED_EMAIL), accept: "application/json" },
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), {
    authenticated: true,
    user: {
      id: `user-${ALLOWED_EMAIL}`,
      email: ALLOWED_EMAIL,
      displayName: ALLOWED_EMAIL,
    },
  });
});
