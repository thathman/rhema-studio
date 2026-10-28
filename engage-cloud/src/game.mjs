// Rhema Engage v1: pure, server-authoritative quiz rules; no participant answers leave this module early.
export const ROOM_TTL_MS = 8 * 60 * 60 * 1000;
export const ROOM_CODE_LENGTH = 8;
export const ROOM_CODE_PATTERN = new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`);
export const MAX_PLAYERS = 500;
export const MAX_QUESTIONS = 20;
export const MAX_BODY_BYTES = 32_000;

export function normalizeQuiz(raw) {
  if (!raw || typeof raw !== "object") throw new Error("A quiz is required");
  const title = String(raw.title || "").trim();
  if (!title || title.length > 120) throw new Error("Quiz title must contain 1–120 characters");
  const lobbySeconds = Number(raw.lobbySeconds);
  const questionSeconds = Number(raw.questionSeconds);
  if (!Number.isInteger(lobbySeconds) || lobbySeconds < 15 || lobbySeconds > 600) throw new Error("Lobby duration must be 15–600 seconds");
  if (!Number.isInteger(questionSeconds) || questionSeconds < 5 || questionSeconds > 120) throw new Error("Question duration must be 5–120 seconds");
  if (raw.reviewed !== true) throw new Error("A person must review and approve quiz answers before publishing");
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > MAX_QUESTIONS) throw new Error("Provide 1–20 questions");
  const questions = raw.questions.map((q, i) => {
    if (!q || typeof q !== "object") throw new Error(`Question ${i + 1} is invalid`);
    const prompt = String(q.prompt || "").trim();
    const choices = q.choices;
    if (!prompt || prompt.length > 400 || !Array.isArray(choices) || choices.length !== 4) throw new Error(`Question ${i + 1} needs text and four choices`);
    if (!choices.every(c => typeof c === "string" && c.trim().length > 0 && c.trim().length <= 180)) throw new Error(`Question ${i + 1} has an invalid choice`);
    const correctIndex = Number(q.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) throw new Error(`Question ${i + 1} needs a correct option`);
    return { prompt, choices: choices.map(c => c.trim()), correctIndex,
      source: q.source === "service" ? "service" : "sermon",
      reference: String(q.reference || "").slice(0, 120) };
  });
  return { version: 1, title, lobbySeconds, questionSeconds, reviewed: true,
    questions, leaderboardMode: raw.leaderboardMode === "each" ? "each" : "final" };
}

export function newRoom(code, draft, hostHash, now, screenHash = null) {
  if (!ROOM_CODE_PATTERN.test(code)) throw new Error("Invalid room code");
  return { code, ...normalizeQuiz(draft), hostHash, screenHash, createdAt: now, expiresAt: now + ROOM_TTL_MS,
    phase: "lobby", deadline: now + draft.lobbySeconds * 1000, remainingMs: null, pausedFrom: null,
    index: -1, players: {}, answerCount: 0 };
}
export function advance(room, now) {
  if (now >= room.expiresAt) { room.phase = "expired"; room.deadline = null; return true; }
  if (room.phase !== "paused" && room.deadline !== null && now >= room.deadline) {
    if (room.phase === "lobby") {
      room.phase = "question"; room.index = 0; room.deadline = now + room.questionSeconds * 1000; room.answerCount = 0;
      return true;
    }
    if (room.phase === "question") { room.phase = "reveal"; room.deadline = null; return true; }
  }
  return false;
}
export function control(room, action, now) {
  advance(room, now);
  if (action === "start" && room.phase === "lobby") {
    room.phase = "question"; room.index = 0; room.deadline = now + room.questionSeconds * 1000; room.answerCount = 0;
  } else if (action === "extend" && room.phase === "lobby") {
    room.deadline = Math.max(room.deadline, now) + 30_000;
  } else if (action === "reveal" && room.phase === "question") {
    room.phase = "reveal"; room.deadline = null;
  } else if (action === "next" && room.phase === "reveal") {
    if (room.index + 1 >= room.questions.length) { room.phase = "finished"; room.deadline = null; }
    else { room.index += 1; room.phase = "question"; room.deadline = now + room.questionSeconds * 1000; room.answerCount = 0; }
  } else if (action === "finish" && ["reveal", "question", "lobby", "paused"].includes(room.phase)) {
    room.phase = "finished"; room.deadline = null;
  } else if (action === "pause" && ["lobby", "question"].includes(room.phase)) {
    room.pausedFrom = room.phase; room.remainingMs = Math.max(0, room.deadline - now); room.phase = "paused"; room.deadline = null;
  } else if (action === "resume" && room.phase === "paused") {
    room.phase = room.pausedFrom; room.deadline = now + room.remainingMs; room.pausedFrom = null; room.remainingMs = null;
  } else throw new Error("This action is not available in the current game phase");
}
export function cleanNickname(value) {
  return String(value || "").normalize("NFC").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 24);
}
export function join(room, tokenHash, nickname, now) {
  advance(room, now);
  if (!["lobby", "question", "reveal", "paused"].includes(room.phase)) throw new Error("This room is not accepting players");
  if (Object.keys(room.players).length >= MAX_PLAYERS) throw new Error("This room has reached its player limit");
  const name = cleanNickname(nickname);
  if (name.length < 2) throw new Error("Use a nickname with at least two letters");
  const id = String(Object.keys(room.players).length + 1);
  room.players[id] = { id, tokenHash, nickname: name, joinedAt: now, answers: {} };
  return id;
}
export function submitAnswer(room, playerId, choice, questionIndex, now) {
  advance(room, now);
  if (room.phase !== "question" || room.deadline === null || now >= room.deadline) throw new Error("Answering is closed");
  const p = room.players[playerId];
  if (!p) throw new Error("Unknown participant");
  if (questionIndex !== room.index) throw new Error("This is not the active question");
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) throw new Error("Invalid option");
  if (p.answers[room.index] !== undefined) throw new Error("Answer already submitted");
  const started = room.deadline - room.questionSeconds * 1000;
  p.answers[room.index] = { choice, elapsedMs: Math.max(0, now - started) };
  room.answerCount += 1;
}
export function board(room) {
  return Object.values(room.players).map(p => {
    let correct = 0, correctMs = 0;
    for (const [q, a] of Object.entries(p.answers)) {
      if (room.questions[Number(q)]?.correctIndex === a.choice) { correct += 1; correctMs += a.elapsedMs; }
    }
    return { nickname: p.nickname, correct, points: correct * 100, correctMs, id: p.id };
  }).sort((a, b) => b.correct - a.correct || a.correctMs - b.correctMs || Number(a.id) - Number(b.id))
    .map(({id, ...entry}, index) => ({ rank: index + 1, ...entry }));
}
export function publicState(room, now, host = false) {
  advance(room, now);
  const isQuestion = room.phase === "question" || room.phase === "reveal" || (room.phase === "paused" && room.pausedFrom === "question");
  const q = isQuestion ? room.questions[room.index] : null;
  const revealed = room.phase === "reveal" || room.phase === "finished";
  return {
    code: room.code, title: room.title, phase: room.phase, pausedFrom: room.phase === "paused" ? room.pausedFrom : null,
    serverNow: now, deadline: room.deadline, remainingMs: room.phase === "paused" ? room.remainingMs : null,
    playerCount: Object.keys(room.players).length, answerCount: room.answerCount,
    questionIndex: room.index, questionCount: room.questions.length, leaderboardMode: room.leaderboardMode,
    question: q ? { prompt: q.prompt, choices: q.choices, source: q.source,
      ...(revealed ? { correctIndex: q.correctIndex, reference: q.reference } : {}) } : null,
    leaderboard: host || room.phase === "finished" || (room.leaderboardMode === "each" && room.phase === "reveal") ? board(room).slice(0, 20) : null,
  };
}
