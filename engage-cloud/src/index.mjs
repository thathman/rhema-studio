import QRCode from "qrcode";
import { newRoom, normalizeQuiz, advance, control, join, submitAnswer, publicState, ROOM_TTL_MS, ROOM_CODE_LENGTH, ROOM_CODE_PATTERN, MAX_BODY_BYTES } from "./game.mjs";
import { participantPage, screenPage, landingPage } from "./pages.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const err = (message, status = 400) => json({ error: message }, status);
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
const hash = async token => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
const roomCodeRoute = `\\d{${ROOM_CODE_LENGTH}}`;
const RATE_LIMIT_BUCKET_CAPS = { auth: 512, create: 512, "join-active": 4096, "join-invalid": 2048 };
const ACTIVE_JOIN_BUCKETS_PER_ROOM_CAP = 600;
const SESSION_ROLES = new Set(["host", "participant", "screen"]);
const encoder = new TextEncoder();
const signingKeys = new WeakMap();
class RequestBodyTooLarge extends Error {}
const signingKeyConfigured = env => typeof env.SESSION_SIGNING_KEY === "string" && encoder.encode(env.SESSION_SIGNING_KEY).byteLength >= 32;
function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function signingKeyFor(env) {
  if (!signingKeyConfigured(env)) return null;
  let pending = signingKeys.get(env);
  if (!pending) {
    pending = crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    signingKeys.set(env, pending);
  }
  return pending;
}
async function issueSessionToken(code, role, env) {
  const key = await signingKeyFor(env);
  if (!key) throw new Error("Session signing is not configured");
  const payload = toBase64Url(encoder.encode(JSON.stringify({ v: 1, code, role, nonce: rand() })));
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return payload + "." + toBase64Url(new Uint8Array(signature));
}
async function verifySessionToken(token, code, allowedRoles, env) {
  if (typeof token !== "string" || token.length > 512) return null;
  const key = await signingKeyFor(env);
  if (!key) return null;
  try {
    const [payload, encodedSignature, extra] = token.split(".");
    if (!payload || !encodedSignature || extra !== undefined) return null;
    const valid = await crypto.subtle.verify("HMAC", key, fromBase64Url(encodedSignature), encoder.encode(payload));
    if (!valid) return null;
    const claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(payload)));
    if (claims.v !== 1 || claims.code !== code || !SESSION_ROLES.has(claims.role) || !allowedRoles.includes(claims.role)) return null;
    return claims;
  } catch { return null; }
}
async function body(req) {
  const length = Number(req.headers.get("Content-Length") || "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new RequestBodyTooLarge("Request is too large");
  if (!req.body) return JSON.parse("");
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => {});
      throw new RequestBodyTooLarge("Request is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
function html(content) {
  return new Response(content, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
function cors(response) {
  // The host and participants run on separate origins. This API uses bearer tokens, not cookies.
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return new Response(response.body, { status: response.status, headers: h });
}
const directoryFor = env => env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
async function clientKeyFor(req, env) {
  const key = await signingKeyFor(env);
  if (!key) return null;
  const address = req.headers.get("CF-Connecting-IP") || "unknown";
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode("rhema-engage-client:" + address))));
}
async function allowRequest(directory, kind, clientKey, code = undefined) {
  return directory.fetch("https://internal/rate-limit", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, clientKey, code }),
  });
}
function limited(response) {
  const retryAfter = response.headers.get("Retry-After") || "60";
  return cors(new Response(JSON.stringify({ error: "Too many attempts. Wait before trying again." }), {
    status: 429,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": retryAfter },
  }));
}
async function verifyTurnstile(req, token, code, env) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY || typeof token !== "string" || !token) return false;
  const payload = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const remoteIp = req.headers.get("CF-Connecting-IP");
  if (remoteIp) payload.set("remoteip", remoteIp);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload, signal: controller.signal,
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.action === "join" && result.cdata === code && result.hostname === new URL(req.url).hostname;
  } catch { return false; }
  finally { clearTimeout(timeout); }
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "OPTIONS" && path.startsWith("/api/")) return cors(new Response(null, { status: 204 }));
    try {
      if (req.method === "GET" && path === "/") return html(landingPage());
      let match = new RegExp(`^/(join|screen)/(${roomCodeRoute})$`).exec(path);
      if (req.method === "GET" && match) return html(match[1] === "join" ? participantPage(match[2], env.TURNSTILE_SITE_KEY || "") : screenPage(match[2]));
      match = new RegExp(`^/qr/(${roomCodeRoute})$`).exec(path);
      if (req.method === "GET" && match) {
        const target = new URL("/join/" + match[1], url).toString();
        const svg = await QRCode.toString(target, { type: "svg", errorCorrectionLevel: "M", margin: 3, width: 320 });
        return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      const directory = directoryFor(env);
      if (req.method === "POST" && path === "/api/rooms") {
        if (!signingKeyConfigured(env) || typeof env.ADMIN_KEY !== "string" || encoder.encode(env.ADMIN_KEY).byteLength < 32 || env.ADMIN_KEY === env.SESSION_SIGNING_KEY) return cors(err("Host service authentication is not configured", 503));
        const clientKey = await clientKeyFor(req, env);
        const authRate = await allowRequest(directory, "auth", clientKey);
        if (authRate.status === 429) return limited(authRate);
        if (!authRate.ok) return cors(err("Quiz service is temporarily unavailable", 503));
        if (bearer(req) !== env.ADMIN_KEY) return cors(err("Host authorization required", 401));
        const rate = await allowRequest(directory, "create", clientKey);
        if (rate.status === 429) return limited(rate);
        if (!rate.ok) return cors(err("Quiz service is temporarily unavailable", 503));
        let draft;
        try { draft = normalizeQuiz(await body(req)); }
        catch (e) {
          if (e instanceof RequestBodyTooLarge || e instanceof SyntaxError) throw e;
          return cors(err(e instanceof Error ? e.message : "Invalid quiz", 400));
        }
        const alloc = await directory.fetch("https://internal/allocate", { method: "POST" });
        if (!alloc.ok) return cors(err("No quiz rooms are available", 503));
        const { code } = await alloc.json();
        const hostToken = await issueSessionToken(code, "host", env);
        const screenToken = await issueSessionToken(code, "screen", env);
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const init = await room.fetch("https://internal/init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, draft, hostHash: await hash(hostToken), screenHash: await hash(screenToken) }) });
        if (!init.ok) return cors(err("Unable to initialize room", 503));
        const screenUrl = new URL("/screen/" + code, url);
        screenUrl.hash = screenToken;
        return cors(json({ code, hostToken, joinUrl: new URL("/join/" + code, url).toString(), screenUrl: screenUrl.toString() }, 201));
      }
      match = new RegExp(`^/api/rooms/(${roomCodeRoute})(?:/(state|join|answer|control))?$`).exec(path);
      if (match) {
        const [, code, action] = match;
        if (action === "join" && req.method === "POST") {
          if (!signingKeyConfigured(env)) return cors(err("Secure quiz sessions are not configured", 503));
          const clientKey = await clientKeyFor(req, env);
          const rate = await allowRequest(directory, "join", clientKey, code);
          if (rate.status === 429) return limited(rate);
          if (!rate.ok) return cors(err("Quiz service is temporarily unavailable", 503));
          const challenge = await body(req.clone());
          if (!await verifyTurnstile(req, challenge.turnstileToken, code, env)) return cors(err("Complete the human check before joining this quiz.", 403));
          const participantToken = await issueSessionToken(code, "participant", env);
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const joined = await stub.fetch(new Request("https://internal/join", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname: challenge.nickname, participantToken }),
          }));
          if (!joined.ok) return cors(joined);
          const result = await joined.json();
          return cors(json({ participantToken, id: result.id }, joined.status));
        }
        const isDelete = !action && req.method === "DELETE";
        const allowed = isDelete || (action === "state" && req.method === "GET") || (action && action !== "state" && req.method === "POST");
        if (!allowed) return cors(err("Not found", 404));
        const requiredRoles = action === "state" ? ["host", "participant", "screen"] : isDelete || action === "control" ? ["host"] : action === "answer" ? ["participant"] : [];
        if (!requiredRoles.length || !signingKeyConfigured(env)) return cors(err("Quiz session authorization is not configured", 503));
        const session = await verifySessionToken(bearer(req), code, requiredRoles, env);
        if (!session) return cors(err("Quiz session authorization required", 401));
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await stub.fetch(new Request("https://internal/" + (action || "delete"), req));
        if (isDelete && response.ok) {
          await directory.fetch("https://internal/release", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
          });
        }
        return cors(response);
      }
      return cors(err("Not found", 404));
    } catch (e) {
      if (e instanceof RequestBodyTooLarge) return cors(err("Request is too large", 413));
      if (e instanceof SyntaxError) return cors(err("Invalid JSON", 400));
      return cors(err("Quiz service is temporarily unavailable", 503));
    }
  }
};

export class QuizDirectory {
  constructor(state) { this.state = state; }
  async scheduleAlarm(buckets, codes) {
    const deadlines = [
      ...Object.values(buckets).map(bucket => bucket.resetAt),
      ...Object.values(codes).map(expiry => expiry),
    ].filter(deadline => Number.isFinite(deadline) && deadline > Date.now());
    if (deadlines.length) await this.state.storage.setAlarm(Math.max(Date.now() + 100, Math.min(...deadlines)));
    else await this.state.storage.deleteAlarm();
  }
  async alarm() {
    const now = Date.now();
    const buckets = (await this.state.storage.get("rateLimits")) || {};
    const codes = (await this.state.storage.get("codes")) || {};
    for (const [key, bucket] of Object.entries(buckets)) if (bucket.resetAt <= now) delete buckets[key];
    for (const [code, expiry] of Object.entries(codes)) if (expiry <= now) delete codes[code];
    if (Object.keys(buckets).length) await this.state.storage.put("rateLimits", buckets);
    else await this.state.storage.delete("rateLimits");
    if (Object.keys(codes).length) await this.state.storage.put("codes", codes);
    else await this.state.storage.delete("codes");
    await this.scheduleAlarm(buckets, codes);
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/rate-limit" && req.method === "POST") {
      const { kind, clientKey, code } = await body(req);
      if (typeof clientKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(clientKey) || !["auth", "create", "join"].includes(kind)) return err("Invalid rate-limit request", 400);
      const now = Date.now();
      const codes = (await this.state.storage.get("codes")) || {};
      const activeCode = kind === "join" && typeof code === "string" && codes[code] > now;
      const windowMs = kind === "create" ? 60 * 60 * 1000 : 15 * 60 * 1000;
      const limit = kind === "create" ? 10 : kind === "auth" ? 30 : activeCode ? 600 : 15;
      const category = kind === "create" ? "create" : kind === "auth" ? "auth" : activeCode ? "join-active" : "join-invalid";
      const prefix = category === "join-active" ? "active:" : category === "join-invalid" ? "invalid:" : category + ":";
      const buckets = (await this.state.storage.get("rateLimits")) || {};
      for (const [bucketKey, bucket] of Object.entries(buckets)) if (bucket.resetAt <= now) delete buckets[bucketKey];
      const categorySize = Object.keys(buckets).filter(bucketKey => bucketKey.startsWith(prefix)).length;
      const roomPrefix = category === "join-active" ? `active:${code}:` : null;
      const roomCategorySize = roomPrefix ? Object.keys(buckets).filter(bucketKey => bucketKey.startsWith(roomPrefix)).length : 0;
      const bucketKey = (roomPrefix || prefix) + clientKey;
      if (!buckets[bucketKey] && (categorySize >= RATE_LIMIT_BUCKET_CAPS[category] || (roomPrefix && roomCategorySize >= ACTIVE_JOIN_BUCKETS_PER_ROOM_CAP))) {
        await this.scheduleAlarm(buckets, codes);
        return err("Quiz service rate-limit category capacity reached", 503);
      }
      const bucket = buckets[bucketKey] && buckets[bucketKey].resetAt > now ? buckets[bucketKey] : { count: 0, resetAt: now + windowMs };
      if (bucket.count >= limit) {
        if (Object.keys(buckets).length) await this.state.storage.put("rateLimits", buckets);
        else await this.state.storage.delete("rateLimits");
        await this.scheduleAlarm(buckets, codes);
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))) },
        });
      }
      bucket.count += 1;
      buckets[bucketKey] = bucket;
      await this.state.storage.put("rateLimits", buckets);
      await this.scheduleAlarm(buckets, codes);
      return json({ allowed: true });
    }
    if (path === "/release" && req.method === "POST") {
      const { code } = await body(req);
      if (typeof code !== "string" || !ROOM_CODE_PATTERN.test(code)) return err("Invalid room code", 400);
      const codes = (await this.state.storage.get("codes")) || {};
      delete codes[code];
      const buckets = (await this.state.storage.get("rateLimits")) || {};
      for (const key of Object.keys(buckets)) if (key.startsWith(`active:${code}:`)) delete buckets[key];
      if (Object.keys(codes).length) await this.state.storage.put("codes", codes);
      else await this.state.storage.delete("codes");
      if (Object.keys(buckets).length) await this.state.storage.put("rateLimits", buckets);
      else await this.state.storage.delete("rateLimits");
      await this.scheduleAlarm(buckets, codes);
      return json({ released: true });
    }
    if (path !== "/allocate" || req.method !== "POST") return err("Not found", 404);
    const now = Date.now();
    // Directory DO serializes allocation so two rooms cannot receive the same live eight-digit code.
    const codes = (await this.state.storage.get("codes")) || {};
    for (const [code, expires] of Object.entries(codes)) if (expires < now) delete codes[code];
    const minimum = 10 ** (ROOM_CODE_LENGTH - 1);
    const range = 9 * minimum;
    for (let i = 0; i < 60; i++) {
      const n = crypto.getRandomValues(new Uint32Array(1))[0] % range + minimum;
      const code = String(n);
      if (codes[code]) continue;
      codes[code] = now + ROOM_TTL_MS;
      await this.state.storage.put("codes", codes);
      await this.scheduleAlarm((await this.state.storage.get("rateLimits")) || {}, codes);
      return json({ code });
    }
    return err("Try again", 503);
  }
}
export class QuizRoom {
  constructor(state) { this.state = state; }
  async syncAlarm(room) {
    const target = room.deadline === null ? room.expiresAt : Math.min(room.deadline, room.expiresAt);
    await this.state.storage.setAlarm(Math.max(Date.now() + 100, target));
  }
  async alarm() {
    const room = await this.state.storage.get("room");
    if (!room) return;
    if (Date.now() >= room.expiresAt) { await this.state.storage.deleteAll(); return; }
    advance(room, Date.now());
    await this.state.storage.put("room", room);
    await this.syncAlarm(room);
  }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const now = Date.now();
    try {
      if (path === "/init" && req.method === "POST") {
        if (await this.state.storage.get("room")) return err("Room already exists", 409);
        const { code, draft, hostHash, screenHash } = await body(req);
        const room = newRoom(code, draft, hostHash, now, screenHash);
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json({ ok: true }, 201);
      }
      const room = await this.state.storage.get("room");
      if (!room || now >= room.expiresAt) return err("Room expired or not found", 410);
      if (path === "/delete" && req.method === "DELETE") {
        if (!bearer(req) || (await hash(bearer(req))) !== room.hostHash) return err("Host authorization required", 403);
        await this.state.storage.deleteAlarm();
        await this.state.storage.deleteAll();
        return json({ deleted: true });
      }
      const changed = advance(room, now);
      if (changed) { await this.state.storage.put("room", room); await this.syncAlarm(room); }
      const token = bearer(req);
      const tokenHash = token && await hash(token);
      const host = !!tokenHash && tokenHash === room.hostHash;
      if (path === "/state" && req.method === "GET") {
        const participant = !!tokenHash && Object.values(room.players).some(player => player.tokenHash === tokenHash);
        const screen = !!tokenHash && tokenHash === room.screenHash;
        if (!host && !participant && !screen) return err("Quiz session authorization required", 403);
        return json(publicState(room, now, host));
      }
      if (path === "/control" && req.method === "POST") {
        if (!host) return err("Host authorization required", 403);
        const { action } = await body(req);
        try { control(room, action, now); }
        catch (e) { return err(e instanceof Error ? e.message : "Invalid action", 400); }
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json(publicState(room, now, true));
      }
      if (path === "/join" && req.method === "POST") {
        const { nickname, participantToken } = await body(req);
        if (typeof participantToken !== "string") return err("Participant session is invalid", 400);
        let id;
        try { id = join(room, await hash(participantToken), nickname, now); }
        catch (e) { return err(e instanceof Error ? e.message : "Invalid participant", 400); }
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json({ id }, 201);
      }
      if (path === "/answer" && req.method === "POST") {
        const token = bearer(req);
        if (!token) return err("Please join first", 401);
        const tokenHash = await hash(token);
        const player = Object.values(room.players).find(p => p.tokenHash === tokenHash);
        if (!player) return err("Invalid participant session", 403);
        const { choice, questionIndex } = await body(req);
        try { submitAnswer(room, player.id, choice, questionIndex, now); }
        catch (e) { return err(e instanceof Error ? e.message : "Invalid answer", 400); }
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json({ accepted: true, questionIndex });
      }
      return err("Not found", 404);
    } catch (e) {
      if (e instanceof RequestBodyTooLarge) return err("Request is too large", 413);
      if (e instanceof SyntaxError) return err("Invalid JSON", 400);
      return err("Quiz service is temporarily unavailable", 503);
    }
  }
}
