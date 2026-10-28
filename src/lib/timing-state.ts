/**
 * The service's run state (#196 R3.7): one explicit machine, so every view says the same thing and
 * a command that makes no sense now is refused with a reason instead of doing something odd.
 *
 *   idle ──start──▶ running ──finish──▶ finished
 *    │  ▲            │   ▲                 │
 *   hold └─resume─  hold resume          start (opens it again)
 *    ▼               ▼   │
 *   held ◀───────────┘───┘
 *   untrusted (after a restart) ──confirm / start──▶ running
 *
 * Items have their own states from the timing engine: upcoming, live, done or skipped, and a live
 * or done item may be overrun. The state is worked out from what happened (the service log, the
 * hold, the restart), never kept beside it, so it cannot disagree with the times.
 */
export type RunState = "idle" | "running" | "held" | "untrusted" | "finished"
export type RunCommand = "start" | "hold" | "resume" | "finish" | "confirm"

export interface RunFacts {
  /** An item of the main service has started (the event clock). */
  begun: boolean
  /** A hold is on. */
  held: boolean
  /** The item running is the one Rhema was running when it closed unexpectedly, and nobody has confirmed its time. */
  untrusted: boolean
  /** The operator finished the service, and nothing has started since. */
  finished: boolean
}

export function runState(f: RunFacts): RunState {
  if (f.finished) return "finished"
  if (f.held) return "held"
  if (f.untrusted) return "untrusted"
  return f.begun ? "running" : "idle"
}

/**
 * What each command does in each state. Starting an item while held keeps the hold (the hold says
 * why the service waits; only Resume ends it). Resuming before anything has started is idle again.
 */
const MOVES: Record<RunState, Partial<Record<RunCommand, RunState>>> = {
  idle: { start: "running", hold: "held" },
  running: { start: "running", hold: "held", finish: "finished" },
  held: { start: "held", resume: "running" },
  untrusted: { start: "running", hold: "held", confirm: "running", finish: "finished" },
  finished: { start: "running" },
}

/** Why a command is refused, in words for the operator. */
const REFUSED: Record<RunCommand, Partial<Record<RunState, string>>> = {
  start: {},
  hold: { held: "Already on hold.", finished: "The service has finished." },
  resume: { idle: "Nothing is on hold.", running: "Nothing is on hold.", untrusted: "Nothing is on hold.", finished: "Nothing is on hold." },
  finish: { idle: "Nothing has started yet.", held: "Resume first: the service is on hold.", finished: "The service has already finished." },
  confirm: { idle: "Nothing to confirm.", running: "Nothing to confirm.", held: "Resume first: the service is on hold.", finished: "Nothing to confirm." },
}

export type Transition = { ok: true; to: RunState } | { ok: false; reason: string }

export function transition(from: RunState, command: RunCommand, begun = true): Transition {
  const to = MOVES[from][command]
  if (!to) return { ok: false, reason: REFUSED[command][from] ?? "Not now." }
  return { ok: true, to: from === "held" && command === "resume" && !begun ? "idle" : to }
}

/** The state in a word or two, for a badge. */
export const RUN_STATE_WORDS: Record<RunState, string> = {
  idle: "Not started",
  running: "Running",
  held: "On hold",
  untrusted: "Time not trusted",
  finished: "Finished",
}
