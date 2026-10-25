import { create } from "zustand"
import type { PresentOutcome } from "@/hooks/use-broadcast"

export type TakeAttemptStatus = "pending" | "awaiting_approval" | "succeeded" | "failed" | "superseded"
export type TakeAttemptOutcome = PresentOutcome | "error"

/** The latest requests and their results, kept apart from the actual program and event clock. */
export interface TakeAttempt {
  id: number
  itemId: string | null
  reference: string
  status: TakeAttemptStatus
  startedAt: number
  finishedAt?: number
  outcome?: TakeAttemptOutcome
  error?: string
  by?: string
}

interface TakeAttemptState {
  attempts: TakeAttempt[]
  begin: (attempt: Omit<TakeAttempt, "id" | "status" | "startedAt" | "finishedAt" | "outcome" | "error">) => number
  finish: (id: number, outcome: TakeAttemptOutcome, error?: string) => void
}

let nextId = 0
const MAX_ATTEMPTS = 20

function statusFor(outcome: TakeAttemptOutcome): TakeAttemptStatus {
  if (outcome === "presented") return "succeeded"
  if (outcome === "superseded") return "superseded"
  if (outcome === "held_for_approval") return "awaiting_approval"
  return "failed"
}

export const useTakeAttemptStore = create<TakeAttemptState>((set) => ({
  attempts: [],
  begin: (attempt) => {
    const id = ++nextId
    const created: TakeAttempt = { ...attempt, id, status: "pending", startedAt: Date.now() }
    set((state) => ({
      attempts: [...state.attempts, created].slice(-MAX_ATTEMPTS),
    }))
    return id
  },
  finish: (id, outcome, error) => set((state) => ({
    attempts: state.attempts.map((attempt) => attempt.id === id
      ? { ...attempt, status: statusFor(outcome), finishedAt: Date.now(), outcome, ...(error ? { error } : {}) }
      : attempt),
  })),
}))
