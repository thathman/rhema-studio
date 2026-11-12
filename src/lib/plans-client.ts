import { invoke } from "@tauri-apps/api/core"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * The host's plans API for a joined Editor desk (#847, `docs/contracts/plan-drafts-v1.md`): read a
 * service plan, save this desk's draft at the revision it opened, and submit that revision for the
 * main desk's review. Every call goes through the join crate's Tauri commands with this desk's key;
 * the host checks the role, the pause and the revision. Nothing here approves a plan or changes Live.
 */

/** A service plan in use on the host (`Program`, snake_case as the services store keeps it). */
export interface HostPlanSummary {
  id: string
  title: string
  service_date: string | null
  revision: number
  item_count: number
  approved_revision: number | null
}

/** One item of a plan (`ProgramItem`). */
export interface HostPlanItem {
  id: string
  position: number
  kind: string
  reference: string
  book_number: number | null
  chapter: number | null
  verse: number | null
  translation: string | null
  secondary_translation: string | null
  notes: string | null
  payload: string | null
}

export interface HostPlan {
  program: HostPlanSummary
  items: HostPlanItem[]
}

/** An item as a save sends it (`ItemInput`): an `id` keeps an existing item; new ones have none. */
export interface PlanItemInput {
  id?: string
  kind: string
  reference: string
  book_number?: number | null
  chapter?: number | null
  verse?: number | null
  translation?: string | null
  secondary_translation?: string | null
  notes?: string | null
  payload?: string | null
}

/** The approval request a submit creates on the host. */
export interface PlanReviewRequest {
  id: string
  kind: string
  baseRevision: number | null
  state: string
}

/**
 * Why the host refused, so the desk can say it plainly and offer the right next step:
 * `conflict` (someone saved since this desk opened the plan; `actual` is the host's revision now),
 * `forbidden` (this desk's role does not work on the plan), `paused`, `missing`, `refused`, `error`.
 */
export type PlanFailure =
  | { kind: "conflict"; actual: number; message: string }
  | { kind: "forbidden" | "paused" | "missing" | "refused" | "error"; message: string }

export type PlanResult<T> = { ok: true; value: T } | { ok: false; failure: PlanFailure }

export const FORBIDDEN_WORDS = "This desk is not allowed to work on the service plan. Ask the main desk to pair this computer as an Editor."
export const PAUSED_WORDS = "The main desk has paused this desk. Your draft stays here; save it when control comes back."
export const CONFLICT_WORDS = "The plan changed on the host since you opened it."

/** The join crate's refusal (`rhema_join::host::plan_failure`) as a typed failure. */
export function readPlanFailure(error: unknown): PlanFailure {
  const said = error instanceof Error ? error.message : String(error)
  const conflict = /^conflict:(\d+):\s*(.*)$/s.exec(said)
  if (conflict) return { kind: "conflict", actual: Number(conflict[1]), message: CONFLICT_WORDS }
  const prefixed = /^(forbidden|paused|missing|refused):\s*(.*)$/s.exec(said)
  if (!prefixed) return { kind: "error", message: said }
  const kind = prefixed[1] as "forbidden" | "paused" | "missing" | "refused"
  const message = kind === "forbidden" ? FORBIDDEN_WORDS : kind === "paused" ? PAUSED_WORDS : prefixed[2] || said
  return { kind, message }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v)

function readSummary(v: unknown): HostPlanSummary {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.title !== "string" || !isInt(v.revision)) throw new Error("The host returned a malformed service plan.")
  return {
    id: v.id,
    title: v.title,
    service_date: typeof v.service_date === "string" ? v.service_date : null,
    revision: v.revision,
    item_count: isInt(v.item_count) ? v.item_count : 0,
    approved_revision: isInt(v.approved_revision) ? v.approved_revision : null,
  }
}

const text = (v: unknown) => (typeof v === "string" ? v : null)
const int = (v: unknown) => (isInt(v) ? v : null)

function readPlan(v: unknown): HostPlan {
  if (!isRecord(v) || !Array.isArray(v.items)) throw new Error("The host returned a malformed service plan.")
  const items = v.items.map((item, i): HostPlanItem => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.reference !== "string") throw new Error("The host returned a malformed plan item.")
    return {
      id: item.id, position: int(item.position) ?? i, kind: typeof item.kind === "string" ? item.kind : "verse", reference: item.reference,
      book_number: int(item.book_number), chapter: int(item.chapter), verse: int(item.verse),
      translation: text(item.translation), secondary_translation: text(item.secondary_translation), notes: text(item.notes), payload: text(item.payload),
    }
  })
  return { program: readSummary(v.program), items }
}

function readRequest(v: unknown): PlanReviewRequest {
  if (!isRecord(v) || typeof v.id !== "string" || typeof v.state !== "string") throw new Error("The host did not confirm the review request.")
  return { id: v.id, kind: typeof v.kind === "string" ? v.kind : "plan_approve", baseRevision: int(v.baseRevision), state: v.state }
}

async function call<T>(command: string, args: Record<string, unknown>, read: (v: unknown) => T): Promise<PlanResult<T>> {
  const { joinAddress: address, joinToken: token } = useSettingsStore.getState()
  try {
    return { ok: true, value: read(await invoke<unknown>(command, { address, token, ...args })) }
  } catch (error) {
    return { ok: false, failure: readPlanFailure(error) }
  }
}

/** An item of a loaded plan, as a save sends it back (keeping its id). */
export function toItemInput(item: HostPlanItem | PlanItemInput): PlanItemInput {
  return {
    ...(item.id ? { id: item.id } : {}),
    kind: item.kind, reference: item.reference,
    book_number: item.book_number ?? null, chapter: item.chapter ?? null, verse: item.verse ?? null,
    translation: item.translation ?? null, secondary_translation: item.secondary_translation ?? null,
    notes: item.notes ?? null, payload: item.payload ?? null,
  }
}

/** The service plans in use on the host. */
export function listHostPlans(): Promise<PlanResult<HostPlanSummary[]>> {
  return call("join_plans", {}, (v) => {
    if (!Array.isArray(v)) throw new Error("The host returned an invalid plan list.")
    return v.map(readSummary)
  })
}

/** One plan with its items and the revision a draft is saved against. */
export function getHostPlan(id: string): Promise<PlanResult<HostPlan>> {
  return call("join_plan", { id }, readPlan)
}

/** Save this desk's draft, only if the host still has the plan at `expectedRevision`. */
export function saveHostPlanDraft(id: string, expectedRevision: number, items: readonly PlanItemInput[]): Promise<PlanResult<HostPlan>> {
  return call("join_save_plan", { id, expectedRevision, items: items.map(toItemInput) }, readPlan)
}

/** Ask the main desk to approve exactly `revision`: it shows as an approval request on the host. */
export function submitHostPlan(id: string, revision: number, note?: string): Promise<PlanResult<PlanReviewRequest>> {
  const trimmed = note?.trim()
  return call("join_submit_plan", { id, revision, note: trimmed ? trimmed : null }, readRequest)
}
