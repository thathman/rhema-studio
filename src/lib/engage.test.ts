import { describe, expect, it } from "vitest";
import { engageFromItem, estimatedEngageMinutes, newEngageQuiz, validateEngageQuiz } from "@/lib/engage";
import type { CueQueueItem } from "@/types";

const reviewed = () => {
  const q = newEngageQuiz();
  q.reviewed = true;
  q.questions[0] = { prompt: "Which Bible book was read?", choices: ["Romans", "Mark", "Luke", "Acts"], correctIndex: 0, source: "service", reference: "Romans 8:28" };
  return q;
};
describe("Rhema Engage service integration", () => {
  it("requires human review before an internet quiz can be saved", () => {
    expect(validateEngageQuiz(newEngageQuiz())).toMatch(/question/i);
    const q=reviewed();
    expect(validateEngageQuiz(q)).toBeNull();
    expect(validateEngageQuiz({ ...q, reviewed: false })).toMatch(/review/i);
  });
  it("bounds lobby and question timing, no silent invalid values", () => {
    const q=reviewed();
    expect(validateEngageQuiz({ ...q, lobbySeconds: 10 })).toMatch(/lobby/i);
    expect(validateEngageQuiz({ ...q, questionSeconds: 500 })).toMatch(/question countdown/i);
  });
  it("keeps quiz as a backward-compatible cue payload", () => {
    const q=reviewed();
    const item: CueQueueItem={ id:"quiz-1",kind:"cue",reference:q.title,confidence:1,source:"manual",added_at:0,payload_extra:{rhema_engage:q} };
    expect(engageFromItem(item)).toEqual(q);
    expect(estimatedEngageMinutes(q)).toBe(2);
    expect(engageFromItem({ ...item, payload_extra:{} })).toBeNull();
  });
});
