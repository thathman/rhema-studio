import test from "node:test";
import assert from "node:assert/strict";
import worker, { QuizDirectory, QuizRoom } from "./index.mjs";

class MemoryStorage {
  values = new Map();
  alarmAt = null;
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { this.values.delete(key); }
  async setAlarm(at) { this.alarmAt = at; }
  async deleteAlarm() { this.alarmAt = null; }
  async deleteAll() { this.values.clear(); this.alarmAt = null; }
}

class Namespace {
  constructor(Factory) { this.Factory = Factory; this.objects = new Map(); }
  idFromName(name) { return name; }
  get(id) {
    if (!this.objects.has(id)) this.objects.set(id, new this.Factory({ storage: new MemoryStorage() }));
    const object = this.objects.get(id);
    return { fetch: (input, init) => object.fetch(input instanceof Request ? input : new Request(input, init)) };
  }
}

function environment(extra = {}) {
  return {
    ADMIN_KEY: "test-admin-key-that-is-long-enough-for-tests-0123456789",
    SESSION_SIGNING_KEY: "test-session-signing-key-0123456789abcdef",
    TURNSTILE_SITE_KEY: "site-key-for-tests",
    TURNSTILE_SECRET: "test-turnstile-secret",
    DIRECTORY: new Namespace(QuizDirectory),
    ROOMS: new Namespace(QuizRoom),
    ...extra,
  };
}

function request(env, path, { method = "GET", token, body, ip = "192.0.2.1" } = {}) {
  const headers = new Headers({ "CF-Connecting-IP": ip });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return worker.fetch(new Request(`https://quiz.example${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  }), env);
}

const quiz = {
  title: "Sunday Recall",
  lobbySeconds: 90,
  questionSeconds: 20,
  reviewed: true,
  questions: [{ prompt: "Which book was read?", choices: ["Romans", "Mark", "Luke", "Acts"], correctIndex: 0 }],
};

async function createRoom(env) {
  const response = await request(env, "/api/rooms", { method: "POST", token: env.ADMIN_KEY, body: quiz });
  assert.equal(response.status, 201);
  return response.json();
}

test("the join page uses eight-digit codes and requires configured Turnstile", async () => {
  const env = environment();
  const landing = await request(env, "/");
  assert.match(await landing.text(), /eight-digit code/);
  const join = await request(env, "/join/12345678");
  const html = await join.text();
  assert.match(html, /data-action="join" data-cdata="12345678"/);
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/);
  assert.match(join.headers.get("Content-Security-Policy"), /frame-src https:\/\/challenges\.cloudflare\.com/);
  const screen = await request(env, "/screen/12345678");
  const screenHtml = await screen.text();
  assert.match(screenHtml, /location\.hash\.slice\(1\)/);
  assert.match(screenHtml, /secure link in Rhema Studio/);
  const notConfigured = await request(environment({ TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET: "" }), "/join/12345678");
  assert.match(await notConfigured.text(), /Secure quiz joining is not configured/);
});

test("host creation is authorized and oversized streaming bodies are rejected before parsing", async () => {
  const env = environment();
  const denied = await request(env, "/api/rooms", { method: "POST", body: quiz });
  assert.equal(denied.status, 401);
  const tooLarge = await request(env, "/api/rooms", { method: "POST", token: env.ADMIN_KEY, body: "x".repeat(32_001) });
  assert.equal(tooLarge.status, 413);
  const created = await createRoom(env);
  assert.match(created.code, /^\d{8}$/);
  assert.ok(created.hostToken);
  const tooLargeControl = await request(env, `/api/rooms/${created.code}/control`, {
    method: "POST", token: created.hostToken, body: "x".repeat(32_001),
  });
  assert.equal(tooLargeControl.status, 413);
});

test("failed host-key guesses are rate-limited without blocking a different host", async () => {
  const env = environment();
  for (let i = 0; i < 30; i++) {
    const response = await request(env, "/api/rooms", { method: "POST", token: "wrong-key", body: quiz });
    assert.equal(response.status, 401);
  }
  const limited = await request(env, "/api/rooms", { method: "POST", token: "wrong-key", body: quiz });
  assert.equal(limited.status, 429);
  const legitimate = await request(env, "/api/rooms", { method: "POST", token: env.ADMIN_KEY, body: quiz, ip: "192.0.2.2" });
  assert.equal(legitimate.status, 201);
});

test("rate-limit caps are isolated and recover after expiry", async () => {
  const directory = new QuizDirectory({ storage: new MemoryStorage() });
  const buckets = Object.fromEntries(Array.from({ length: 512 }, (_, index) => [`auth:${index.toString(16).padStart(4, "0")}${"a".repeat(39)}`, { count: 1, resetAt: Date.now() + 60_000 }]));
  await directory.state.storage.put("rateLimits", buckets);
  await directory.state.storage.put("codes", { "12345678": Date.now() + 60_000 });
  const deniedAuth = await directory.fetch(new Request("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "auth", clientKey: "z".repeat(43) }),
  }));
  assert.equal(deniedAuth.status, 503);
  const allowedJoin = await directory.fetch(new Request("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "join", code: "12345678", clientKey: "b".repeat(43) }),
  }));
  assert.equal(allowedJoin.status, 200);
  const expired = Object.fromEntries(Object.entries(await directory.state.storage.get("rateLimits"))
    .map(([key, bucket]) => [key, { ...bucket, resetAt: Date.now() - 1 }]));
  await directory.state.storage.put("rateLimits", expired);
  await directory.alarm();
  const recoveredAuth = await directory.fetch(new Request("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "auth", clientKey: "z".repeat(43) }),
  }));
  assert.equal(recoveredAuth.status, 200);
});

test("active join buckets have both global and per-room capacity bounds", async () => {
  const now = Date.now();
  const activeRoom = "12345678";
  const activeRooms = Array.from({ length: 7 }, (_, index) => String(12345678 + index));
  const otherRoom = "87654321";
  const clientKey = index => index.toString(16).padStart(4, "0") + "a".repeat(39);
  const requestJoin = (directory, code, key) => directory.fetch(new Request("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "join", code, clientKey: key }),
  }));

  const globalDirectory = new QuizDirectory({ storage: new MemoryStorage() });
  await globalDirectory.state.storage.put("codes", Object.fromEntries([...activeRooms, otherRoom].map(code => [code, now + 60_000])));
  const globalBuckets = Object.fromEntries(Array.from({ length: 4096 }, (_, index) => [
    `active:${activeRooms[Math.floor(index / 600)]}:${clientKey(index)}`, { count: 1, resetAt: now + 60_000 },
  ]));
  await globalDirectory.state.storage.put("rateLimits", globalBuckets);
  assert.equal((await requestJoin(globalDirectory, activeRoom, clientKey(0))).status, 200, "existing keys remain usable at capacity");
  assert.equal((await requestJoin(globalDirectory, otherRoom, clientKey(5000))).status, 503, "a different room cannot grow the global category past its cap");

  const roomDirectory = new QuizDirectory({ storage: new MemoryStorage() });
  await roomDirectory.state.storage.put("codes", { [activeRoom]: now + 60_000, [otherRoom]: now + 60_000 });
  const roomBuckets = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [
    `active:${activeRoom}:${clientKey(index)}`, { count: 1, resetAt: now + 60_000 },
  ]));
  await roomDirectory.state.storage.put("rateLimits", roomBuckets);
  assert.equal((await requestJoin(roomDirectory, activeRoom, clientKey(0))).status, 200, "existing keys remain usable at the per-room cap");
  assert.equal((await requestJoin(roomDirectory, activeRoom, clientKey(600))).status, 503, "a room cannot exceed its local limiter cap");
  assert.equal((await requestJoin(roomDirectory, otherRoom, clientKey(600))).status, 200, "one full room does not starve another under the global cap");
});

test("expired room alarms delete quiz data and the scheduled alarm", async () => {
  const env = environment();
  const created = await createRoom(env);
  const room = env.ROOMS.objects.get(created.code);
  const stored = await room.state.storage.get("room");
  await room.state.storage.put("room", { ...stored, expiresAt: Date.now() - 1 });
  await room.alarm();
  assert.equal(await room.state.storage.get("room"), undefined);
  assert.equal(room.state.storage.alarmAt, null);
});

test("pre-challenge join attempts are rate-limited separately from verified room joins", async () => {
  const env = environment();
  for (let i = 0; i < 20; i++) {
    const response = await request(env, "/api/rooms/99999999/join", { method: "POST", body: { nickname: "Grace" } });
    assert.equal(response.status, 403);
  }
  const limited = await request(env, "/api/rooms/88888888/join", { method: "POST", body: { nickname: "Grace" } });
  assert.equal(limited.status, 403, "more than fifteen retries from a shared network address still reach challenge validation");
  const directory = env.DIRECTORY.objects.get("directory");
  const buckets = await directory.state.storage.get("rateLimits");
  assert.ok(Object.keys(buckets).some((key) => key.startsWith("probe:")));
  assert.equal(Object.keys(buckets).some((key) => key.startsWith("active:")), false);
  assert.equal(Object.keys(buckets).some((key) => key.startsWith("invalid:")), false, "unverified codes never consume the verified invalid-code category");
  assert.equal(JSON.stringify(buckets).includes("192.0.2.1"), false);
  const expired = Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, { ...bucket, resetAt: Date.now() - 1 }]));
  await directory.state.storage.put("rateLimits", expired);
  await directory.alarm();
  assert.equal(await directory.state.storage.get("rateLimits"), undefined);
});

test("the pre-challenge per-address ceiling allows 1,000 requests before throttling", async () => {
  const directory = new QuizDirectory({ storage: new MemoryStorage() });
  const requestProbe = () => directory.fetch(new Request("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "join-probe", clientKey: "p".repeat(43) }),
  }));
  for (let i = 0; i < 1000; i++) assert.equal((await requestProbe()).status, 200);
  const limited = await requestProbe();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
});

test("failed Turnstile attempts cannot consume active join capacity", async () => {
  const env = environment();
  const created = await createRoom(env);
  const originalFetch = globalThis.fetch;
  let challengePasses = false;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: challengePasses, action: "join", cdata: created.code, hostname: "quiz.example",
  }), { headers: { "Content-Type": "application/json" } });
  try {
    for (let index = 0; index < 600; index++) {
      const ip = `198.51.${Math.floor(index / 254)}.${index % 254 + 1}`;
      const rejected = await request(env, `/api/rooms/${created.code}/join`, {
        method: "POST", ip, body: { nickname: "Grace", turnstileToken: "failed-challenge" },
      });
      assert.equal(rejected.status, 403);
    }
    const directory = env.DIRECTORY.objects.get("directory");
    const buckets = await directory.state.storage.get("rateLimits");
    assert.equal(Object.keys(buckets).some(key => key.startsWith(`active:${created.code}:`)), false);

    challengePasses = true;
    const validJoin = await request(env, `/api/rooms/${created.code}/join`, {
      method: "POST", ip: "203.0.113.70", body: { nickname: "Grace", turnstileToken: "valid-challenge" },
    });
    assert.equal(validJoin.status, 201);
    assert.equal(Object.keys(await directory.state.storage.get("rateLimits")).filter(key => key.startsWith(`active:${created.code}:`)).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("500 verified participants sharing one network address are not preflight-throttled", async () => {
  const env = environment();
  const created = await createRoom(env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true, action: "join", cdata: created.code, hostname: "quiz.example",
  }), { headers: { "Content-Type": "application/json" } });
  try {
    for (let index = 0; index < 500; index++) {
      const joined = await request(env, `/api/rooms/${created.code}/join`, {
        method: "POST", ip: "198.51.100.42",
        body: { nickname: `Guest ${index + 1}`, turnstileToken: `unique-challenge-${index}` },
      });
      assert.equal(joined.status, 201, `shared-address participant ${index + 1} can join`);
    }
    const full = await request(env, `/api/rooms/${created.code}/join`, {
      method: "POST", ip: "198.51.100.42", body: { nickname: "Guest 501", turnstileToken: "one-more-challenge" },
    });
    assert.equal(full.status, 400);
    assert.match((await full.json()).error, /player limit/i);
    const directory = env.DIRECTORY.objects.get("directory");
    const buckets = await directory.state.storage.get("rateLimits");
    const probe = Object.entries(buckets).find(([key]) => key.startsWith("probe:"))?.[1];
    assert.ok(probe);
    assert.equal(probe.count, 501);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("verified invalid room codes use their own pseudonymous address bucket", async () => {
  const directory = new QuizDirectory({ storage: new MemoryStorage() });
  const clientKey = "q".repeat(43);
  const attempt = code => directory.fetch(new Request("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "join", code, clientKey }),
  }));
  for (let i = 0; i < 15; i++) assert.equal((await attempt("99999999")).status, 200);
  const limited = await attempt("88888888");
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("Retry-After")) > 0);
  assert.ok(Object.keys(await directory.state.storage.get("rateLimits")).some(key => key.startsWith("invalid:")));
});

test("participant joins require a room-bound Turnstile result and host deletion removes data immediately", async () => {
  const env = environment();
  const created = await createRoom(env);
  const stateWithoutToken = await request(env, `/api/rooms/${created.code}/state`);
  assert.equal(stateWithoutToken.status, 401);
  const stateWithForgedToken = await request(env, `/api/rooms/${created.code}/state`, { token: "a".repeat(64) });
  assert.equal(stateWithForgedToken.status, 401);
  const displayToken = new URL(created.screenUrl).hash.slice(1);
  assert.ok(displayToken.length > 100);
  const displayCannotControl = await request(env, `/api/rooms/${created.code}/control`, {
    method: "POST", token: displayToken, body: { action: "start" },
  });
  assert.equal(displayCannotControl.status, 401);
  const displayCannotAnswer = await request(env, `/api/rooms/${created.code}/answer`, {
    method: "POST", token: displayToken, body: { choice: 0, questionIndex: 0 },
  });
  assert.equal(displayCannotAnswer.status, 401);
  const crossRoom = await request(env, "/api/rooms/11111111/state", { token: created.hostToken });
  assert.equal(crossRoom.status, 401);
  const hostCannotAnswer = await request(env, `/api/rooms/${created.code}/answer`, {
    method: "POST", token: created.hostToken, body: { choice: 0, questionIndex: 0 },
  });
  assert.equal(hostCannotAnswer.status, 401);
  const displayCannotDelete = await request(env, `/api/rooms/${created.code}`, { method: "DELETE", token: displayToken });
  assert.equal(displayCannotDelete.status, 401);
  let verifyResult = { success: true, action: "join", cdata: created.code, hostname: "quiz.example" };
  for (let i = 0; i < 600; i++) {
    const displayPoll = await request(env, `/api/rooms/${created.code}/state`, { token: displayToken });
    assert.equal(displayPoll.status, 200);
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const sent = new URLSearchParams(init.body);
    assert.equal(sent.get("secret"), env.TURNSTILE_SECRET);
    assert.equal(sent.get("remoteip"), "192.0.2.1");
    return new Response(JSON.stringify(verifyResult), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const missingToken = await request(env, `/api/rooms/${created.code}/join`, { method: "POST", body: { nickname: "Grace" } });
    assert.equal(missingToken.status, 403);
    assert.match((await missingToken.json()).error, /human check/i);

    const validResult = { success: true, action: "join", cdata: created.code, hostname: "quiz.example" };
    for (const mismatch of [
      { ...validResult, action: "control" },
      { ...validResult, cdata: "11111111" },
      { ...validResult, hostname: "attacker.example" },
    ]) {
      verifyResult = mismatch;
      const rejected = await request(env, `/api/rooms/${created.code}/join`, {
        method: "POST", body: { nickname: "Grace", turnstileToken: "mismatched-token" },
      });
      assert.equal(rejected.status, 403);
    }
    verifyResult = validResult;

    const joined = await request(env, `/api/rooms/${created.code}/join`, {
      method: "POST", body: { nickname: "Grace", turnstileToken: "one-time-token" },
    });
    assert.equal(joined.status, 201);
    const participant = await joined.json();
    assert.ok(participant.participantToken);
    const playerState = await request(env, `/api/rooms/${created.code}/state`, { token: participant.participantToken });
    assert.equal(playerState.status, 200);
    const playerCannotControl = await request(env, `/api/rooms/${created.code}/control`, {
      method: "POST", token: participant.participantToken, body: { action: "start" },
    });
    assert.equal(playerCannotControl.status, 401);

    const deniedDelete = await request(env, `/api/rooms/${created.code}`, { method: "DELETE", token: "wrong-host-token" });
    assert.equal(deniedDelete.status, 401);
    const deleted = await request(env, `/api/rooms/${created.code}`, { method: "DELETE", token: created.hostToken });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true });
    assert.match(deleted.headers.get("Access-Control-Allow-Methods"), /DELETE/);
    const directory = env.DIRECTORY.objects.get("directory");
    const buckets = await directory.state.storage.get("rateLimits");
    assert.equal(Object.keys(buckets).some((key) => key.startsWith(`active:${created.code}:`)), false);
    const state = await request(env, `/api/rooms/${created.code}/state`, { token: created.hostToken });
    assert.equal(state.status, 410);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
