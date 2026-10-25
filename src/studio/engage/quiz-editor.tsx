import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueueStore } from "@/stores/queue-store";
import { useAddDialog } from "@/studio/prepare/add-target";
import { presentActions } from "@/studio/present-actions";
import type { CueQueueItem } from "@/types";
import {
  ENGAGE_PAYLOAD_KEY, blankQuestion, engageFromItem, estimatedEngageMinutes,
  newEngageQuiz, validateEngageQuiz, type EngageQuiz, type EngageQuestion,
} from "@/lib/engage";

function QuizForm({ initial, onSave, saveLabel }: {
  initial: EngageQuiz;
  onSave: (draft: EngageQuiz) => void;
  saveLabel: string;
}) {
  const [quiz, setQuiz] = useState<EngageQuiz>(initial);
  const [error, setError] = useState<string | null>(null);
  const change = (patch: Partial<EngageQuiz>) => {
    setQuiz(prev => ({ ...prev, ...patch, reviewed: false }));
    setError(null);
  };
  const updateQuestion = (index: number, patch: Partial<EngageQuestion>) => {
    change({ questions: quiz.questions.map((q, i) => i === index ? { ...q, ...patch } : q) });
  };
  const submit = () => {
    const problem = validateEngageQuiz(quiz);
    if (problem) { setError(problem); return; }
    onSave(quiz);
    setError(null);
  };
  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 text-sm">
      <p className="text-xs text-muted-foreground">This quiz is prepared here but hosted on the internet when an operator launches it in Present. Nothing is published by saving.</p>
      <label className="flex flex-col gap-1 font-medium">
        Quiz title
        <Input value={quiz.title} maxLength={120} onChange={e => change({ title: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          Lobby countdown (seconds)
          <Input type="number" min={15} max={600} value={quiz.lobbySeconds} onChange={e => change({ lobbySeconds: Number(e.target.value) })} />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Seconds per question
          <Input type="number" min={5} max={120} value={quiz.questionSeconds} onChange={e => change({ questionSeconds: Number(e.target.value) })} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs">
        Leaderboard
        <select value={quiz.leaderboardMode} onChange={e => change({ leaderboardMode: e.target.value as "final" | "each" })} className="h-9 rounded-md border border-input bg-background px-2">
          <option value="final">Final reveal only</option>
          <option value="each">After each question</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">Scoring: 100 points per correct answer. Most correct wins; total time on correct answers breaks ties. Mobile-network delay can affect close finishes.</p>
      {quiz.questions.map((q, index) => (
        <fieldset key={index} className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <legend className="font-semibold">Question {index + 1}</legend>
            <Button size="xs" variant="ghost" type="button" disabled={quiz.questions.length === 1} onClick={() => change({ questions: quiz.questions.filter((_, i) => i !== index) })}>Remove</Button>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            Prompt
            <textarea className="min-h-18 w-full rounded-md border border-input bg-background p-2" maxLength={400} value={q.prompt} onChange={e => updateQuestion(index, { prompt: e.target.value })} placeholder="What did we learn from today's sermon?" />
          </label>
          <div className="my-2 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              Source
              <select className="h-9 rounded-md border border-input bg-background px-2" value={q.source} onChange={e => updateQuestion(index, { source: e.target.value as "sermon" | "service" })}>
                <option value="sermon">Sermon Recall</option>
                <option value="service">Service Recall</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Scripture / source reference (optional)
              <Input maxLength={120} value={q.reference} onChange={e => updateQuestion(index, { reference: e.target.value })} placeholder="Romans 8:28" />
            </label>
          </div>
          {q.choices.map((choice, choiceIndex) => (
            <div className="mb-1.5 flex items-center gap-2" key={choiceIndex}>
              <input aria-label={`Mark option ${choiceIndex + 1} correct for question ${index + 1}`} type="radio" name={`correct-${index}`} checked={q.correctIndex === choiceIndex} onChange={() => updateQuestion(index, { correctIndex: choiceIndex })} />
              <Input aria-label={`Question ${index + 1} answer ${choiceIndex + 1}`} maxLength={180} value={choice}
                onChange={e => updateQuestion(index, { choices: q.choices.map((s, i) => i === choiceIndex ? e.target.value : s) as [string, string, string, string] })}
                placeholder={`Answer ${String.fromCharCode(65 + choiceIndex)}`} />
            </div>
          ))}
          <p className="text-[0.6875rem] text-muted-foreground">Select the radio button beside the correct answer. Participants won't see it before the reveal.</p>
        </fieldset>
      ))}
      <Button type="button" variant="outline" disabled={quiz.questions.length >= 20} onClick={() => change({ questions: [...quiz.questions, blankQuestion()] })}>Add question</Button>
      <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-xs">
        <input type="checkbox" checked={quiz.reviewed} onChange={e => setQuiz(prev => ({ ...prev, reviewed: e.target.checked }))} />
        I have checked every correct answer and approved these questions for congregation use. Editing a question resets this approval.
      </label>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="button" onClick={submit}>{saveLabel}</Button>
    </div>
  );
}

export function EngageAddPanel() {
  return <QuizForm initial={newEngageQuiz()} saveLabel="Add quiz to service" onSave={(draft) => {
    const item: CueQueueItem = {
      id: crypto.randomUUID(), kind: "cue", reference: draft.title, confidence: 1,
      source: "manual", added_at: Date.now(), planned_minutes: estimatedEngageMinutes(draft),
      payload_extra: { [ENGAGE_PAYLOAD_KEY]: draft },
    };
    useQueueStore.getState().addItem(item);
    presentActions.previewItem(item);
    useAddDialog.getState().close();
    toast.success("Quiz added — launch it from Present when ready");
  }} />;
}

export function EngageItemEditor({ item }: { item: CueQueueItem }) {
  const quiz = engageFromItem(item);
  if (!quiz) return null;
  return <QuizForm key={item.id} initial={quiz} saveLabel="Save quiz in service" onSave={(draft) => {
    useQueueStore.getState().updateItem(item.id, current => ({
      ...current, reference: draft.title,
      planned_minutes: estimatedEngageMinutes(draft),
      payload_extra: { ...current.payload_extra, [ENGAGE_PAYLOAD_KEY]: draft },
    }));
    toast.success("Quiz saved locally; not sent to the internet");
  }} />;
}
