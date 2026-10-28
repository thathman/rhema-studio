import type { QueueItem } from "@/types";

export const ENGAGE_PAYLOAD_KEY = "rhema_engage";

export type EngageQuestion = {
  prompt: string;
  choices: [string, string, string, string];
  correctIndex: number;
  source: "sermon" | "service";
  reference: string;
};

export type EngageQuiz = {
  version: 1;
  title: string;
  lobbySeconds: number;
  questionSeconds: number;
  leaderboardMode: "final" | "each";
  reviewed: boolean;
  questions: EngageQuestion[];
};

export function blankQuestion(): EngageQuestion {
  return { prompt: "", choices: ["", "", "", ""], correctIndex: 0, source: "sermon", reference: "" };
}
export function newEngageQuiz(): EngageQuiz {
  return {
    version: 1, title: "Sunday Sermon & Service Recall", lobbySeconds: 90, questionSeconds: 20,
    leaderboardMode: "final", reviewed: false, questions: [blankQuestion()],
  };
}
export function validateEngageQuiz(quiz: EngageQuiz): string | null {
  if (!quiz.title.trim() || quiz.title.length > 120) return "Enter a title (up to 120 characters).";
  if (!Number.isInteger(quiz.lobbySeconds) || quiz.lobbySeconds < 15 || quiz.lobbySeconds > 600) return "Lobby countdown must be 15–600 seconds.";
  if (!Number.isInteger(quiz.questionSeconds) || quiz.questionSeconds < 5 || quiz.questionSeconds > 120) return "Question countdown must be 5–120 seconds.";
  if (quiz.questions.length === 0 || quiz.questions.length > 20) return "Choose 1–20 questions.";
  for (const [index, q] of quiz.questions.entries()) {
    if (!q.prompt.trim() || q.prompt.length > 400) return `Question ${index + 1} needs text (up to 400 characters).`;
    if (q.choices.length !== 4 || q.choices.some(s => !s.trim() || s.length > 180)) return `Question ${index + 1} needs four answer options.`;
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) return `Question ${index + 1} needs one correct answer.`;
  }
  if (!quiz.reviewed) return "Review all answers and check the approval box before saving.";
  return null;
}

/** Use cue metadata, not a new unknown queue kind: existing services keep loading. */
export function engageFromItem(item: QueueItem | null | undefined): EngageQuiz | null {
  if (item?.kind !== "cue") return null;
  const value = item.payload_extra?.[ENGAGE_PAYLOAD_KEY];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const q = value as Partial<EngageQuiz>;
  if (q.version !== 1 || typeof q.title !== "string" || !Array.isArray(q.questions)) return null;
  return q as EngageQuiz;
}
export function estimatedEngageMinutes(q: EngageQuiz): number {
  // Allow ten seconds per answer explanation, not just the question clock.
  return Math.max(1, Math.ceil((q.lobbySeconds + q.questions.length * (q.questionSeconds + 10)) / 60));
}
