import { clockAt } from "@/lib/church-time"
import type { VerseRenderData } from "@/types"

/** The quiz room's public state, as the Engage service reports it to the host. */
export interface EngagePublicState {
  title: string
  code: string
  phase: string
  deadline: number | null
  questionIndex: number
  questionCount: number
  answerCount: number
  playerCount: number
  question: { prompt: string; choices: string[]; correctIndex?: number; reference?: string } | null
  leaderboard: Array<{ rank: number; nickname: string; points: number }> | null
}

const LETTERS = ["A", "B", "C", "D"]
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

/**
 * The quiz on Rhema's own screens (#425 stage 2): one slide for where the game is, drawn by the
 * screens' own look like any slide. Times are clock times (the screens are not redrawn each second);
 * the correct answer is shown only once revealed. `offsetMs` turns the service's clock into this
 * computer's; `zone` is the church's time zone.
 */
export function engageSlide(s: EngagePublicState, joinUrl: string, offsetMs = 0, zone = ""): VerseRenderData {
  const at = (ms: number | null) => (ms === null ? null : clockAt(ms - offsetMs, zone))
  const slide = (title: string, lines: string[]): VerseRenderData => ({ kind: "slide", reference: `Quiz · ${title}`, segments: [{ text: lines.join(" ") }], lines, quick: true })
  const title = clip(s.title || "Quiz", 60)
  switch (s.phase) {
    case "lobby":
    case "paused":
      return slide(title, [
        `Join on your phone: ${joinUrl}`,
        `Code ${s.code}`,
        `${s.playerCount} ${s.playerCount === 1 ? "player" : "players"} in`,
        s.phase === "paused" ? "Paused" : at(s.deadline) ? `Starts at ${at(s.deadline)}` : "Starting soon",
      ])
    case "question":
      return slide(`Question ${s.questionIndex + 1} of ${s.questionCount}`, [
        clip(s.question?.prompt ?? "", 160),
        ...(s.question?.choices ?? []).slice(0, 4).map((c, i) => `${LETTERS[i]}. ${clip(c, 80)}`),
        at(s.deadline) ? `Answers close at ${at(s.deadline)}` : "",
      ].filter(Boolean))
    case "reveal": {
      const q = s.question
      const right = q && typeof q.correctIndex === "number" ? q.choices[q.correctIndex] : null
      return slide(`Question ${s.questionIndex + 1} of ${s.questionCount}`, [
        clip(q?.prompt ?? "", 160),
        right !== null ? `Answer: ${LETTERS[q!.correctIndex!]}. ${clip(right, 80)}` : "Answer coming",
        ...(q?.reference ? [clip(q.reference, 80)] : []),
        `${s.answerCount} answered`,
      ])
    }
    default:
      return slide(s.phase === "finished" ? "Final scores" : title, (s.leaderboard ?? []).slice(0, 5).map((p) => `${p.rank}. ${clip(p.nickname, 24)} · ${p.points} points`).concat(s.leaderboard?.length ? [] : ["Thank you for playing"]))
  }
}
