import QRCode from "qrcode";
import { newRoom, normalizeQuiz, advance, control, join, submitAnswer, publicState, ROOM_TTL_MS, MAX_BODY_BYTES } from "./game.mjs";
import { participantPage, screenPage, landingPage } from "./pages.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const err = (message, status = 400) => json({ error: message }, status);
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
const hash = async token => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
async function body(req) {
  const length = Number(req.headers.get("Content-Length") || "0");
  if (length > MAX_BODY_BYTES) throw new Error("Request is too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Request is too large");
  return JSON.parse(text);
}
function html(content) {
  return new Response(content, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  } });
}
function cors(response) {
  const h = new Headers(response.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return new Response(response.body, { status: response.status, headers: h });
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "OPTIONS" && path.startsWith("/api/")) return cors(new Response(null, { status: 204 }));
    try {
      if (req.method === "GET" && path === "/") return html(landingPage());
      let match = /^\/(join|screen)\/(\d{6})$/.exec(path);
      if (req.method === "GET" && match) return html(match[1] === "join" ? participantPage(match[2]) : screenPage(match[2]));
      match = /^\/qr\/(\d{6})$/.exec(path);
      if (req.method === "GET" && match) {
        const target = new URL("/join/" + match[1], url).toString();
        const svg = await QRCode.toString(target, { type: "svg", errorCorrectionLevel: "M", margin: 3, width: 320 });
        return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      if (req.method === "POST" && path === "/api/rooms") {
        if (!env.ADMIN_KEY || bearer(req) !== env.ADMIN_KEY) return cors(err("Host authorization required", 401));
        const draft = normalizeQuiz(await body(req));
        const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName("directory"));
        const alloc = await dir.fetch("https://internal/allocate", { method: "POST" });
        if (!alloc.ok) return cors(err("No quiz rooms are available", 503));
        const { code } = await alloc.json(), hostToken = rand();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const init = await room.fetch("https://internal/init", { method: "POST", body: JSON.stringify({ code, draft, hostHash: await hash(hostToken) }) });
        if (!init.ok) return cors(err("Unable to initialize room", 503));
        return cors(json({ code, hostToken, joinUrl: new URL("/join/" + code, url).toString(), screenUrl: new URL("/screen/" + code, url).toString() }, 201));
      }
      match = /^\/api\/rooms\/(\d{6})\/(state|join|answer|control)$/.exec(path);
      if (match && ((match[2] === "state" && req.method === "GET") || (match[2] !== "state" && req.method === "POST"))) {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
        return cors(await stub.fetch(new Request("https://internal/" + match[2], req)));
      }
      return cors(err("Not found", 404));
    } catch (e) {
      return cors(err(e instanceof SyntaxError ? "Invalid JSON" : e instanceof Error ? e.message : "Unexpected error", 400));
    }
  }
};

export class QuizDirectory {
  constructor(state) { this.state = state; }
  async fetch(req) {
    if (new URL(req.url).pathname !== "/allocate") return err("Not found", 404);
    const now = Date.now();
    // Directory DO serializes allocation so two rooms cannot receive the same live six-digit code.
    const codes = (await this.state.storage.get("codes")) || {};
    for (const [code, expires] of Object.entries(codes)) if (expires < now) delete codes[code];
    for (let i = 0; i < 60; i++) {
      const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900_000 + 100_000;
      const code = String(n);
      if (codes[code]) continue;
      codes[code] = now + ROOM_TTL_MS;
      await this.state.storage.put("codes", codes);
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
        const { code, draft, hostHash } = await body(req);
        const room = newRoom(code, draft, hostHash, now);
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json({ ok: true }, 201);
      }
      const room = await this.state.storage.get("room");
      if (!room || now >= room.expiresAt) return err("Room expired or not found", 410);
      const changed = advance(room, now);
      if (changed) { await this.state.storage.put("room", room); await this.syncAlarm(room); }
      const host = bearer(req) && (await hash(bearer(req))) === room.hostHash;
      if (path === "/state" && req.method === "GET") return json(publicState(room, now, !!host));
      if (path === "/control" && req.method === "POST") {
        if (!host) return err("Host authorization required", 403);
        const { action } = await body(req);
        control(room, action, now);
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json(publicState(room, now, true));
      }
      if (path === "/join" && req.method === "POST") {
        const { nickname } = await body(req), participantToken = rand();
        const id = join(room, await hash(participantToken), nickname, now);
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json({ participantToken, id }, 201);
      }
      if (path === "/answer" && req.method === "POST") {
        const token = bearer(req);
        if (!token) return err("Please join first", 401);
        const tokenHash = await hash(token);
        const player = Object.values(room.players).find(p => p.tokenHash === tokenHash);
        if (!player) return err("Invalid participant session", 403);
        const { choice, questionIndex } = await body(req);
        submitAnswer(room, player.id, choice, questionIndex, now);
        await this.state.storage.put("room", room); await this.syncAlarm(room);
        return json({ accepted: true, questionIndex });
      }
      return err("Not found", 404);
    } catch (e) { return err(e instanceof SyntaxError ? "Invalid JSON" : e instanceof Error ? e.message : "Invalid action", 400); }
  }
}
