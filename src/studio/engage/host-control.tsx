import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueueStore } from "@/stores/queue-store";
import { engageFromItem } from "@/lib/engage";
import { qrDataUrl } from "@/lib/qr-bulletin";
import { useEngageHost } from "@/studio/engage/host-store";

type PublicState = {
  title: string; code: string; phase: string; deadline: number | null; remainingMs: number | null;
  questionIndex: number; questionCount: number; answerCount: number; playerCount: number;
  serverNow: number; question: { prompt: string; choices: string[]; correctIndex?: number; reference?: string } | null;
  leaderboard: Array<{rank: number; nickname: string; correct: number; points: number; correctMs: number}> | null;
};
type CreatedRoom = { code: string; hostToken: string; joinUrl: string; screenUrl: string };

async function call(endpoint: string, path: string, method = "GET", token?: string, data?: unknown) {
  const response = await fetch(endpoint + path, {
    method, cache: "no-store",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error((result as { error?: string }).error || "The quiz service is unavailable");
  return result;
}

function endpointOf(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export function EngageHostControl() {
  const quizzes = useQueueStore(s => s.items.filter(i => !!engageFromItem(i)));
  const session = useEngageHost(s => s.session);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [key, setKey] = useState("");
  const [state, setState] = useState<PublicState | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const selected = quizzes.find(q => q.id === selectedId) ?? quizzes[0];
  const quiz = engageFromItem(selected);
  const disabled = pending || !session;

  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;
    const poll = async () => {
      const start = Date.now();
      try {
        const next = await call(session.endpoint, "/api/rooms/" + session.code + "/state", "GET", session.hostToken) as PublicState;
        if (!cancelled) {
          setState(next);
          setOffsetMs(next.serverNow - (start + Math.floor((Date.now() - start) / 2)));
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const pollId = window.setInterval(() => void poll(), 1700);
    return () => { cancelled = true; window.clearInterval(pollId); };
  }, [open, session]);

  useEffect(() => {
    if (!open) return;
    const tick = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(tick);
  }, [open]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void qrDataUrl(session.joinUrl).then(data => { if (!cancelled) setQr(data); }).catch(() => setQr(null));
    return () => { cancelled = true; };
  }, [session]);

  const launch = async () => {
    const origin = endpointOf(endpoint);
    if (!origin) { setError("Enter the HTTPS origin of your deployed Rhema Engage service (localhost permitted for development)."); return; }
    if (!key.trim()) { setError("Enter the host's private service key. It is never saved with the service."); return; }
    if (!selected || !quiz || !quiz.reviewed) { setError("Select a reviewed quiz from the current service."); return; }
    setPending(true); setError(null);
    try {
      const created = await call(origin, "/api/rooms", "POST", key.trim(), quiz) as CreatedRoom;
      useEngageHost.getState().setSession({
        endpoint: origin, code: created.code, hostToken: created.hostToken, joinUrl: created.joinUrl,
        screenUrl: created.screenUrl, quizItemId: selected.id,
      });
      setKey(""); // Do not retain the account-level creation key after the room opens.
      toast.success("Quiz lobby created on the internet");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };
  const command = async (action: string) => {
    if (!session) return;
    setPending(true); setError(null);
    try {
      const next = await call(session.endpoint, "/api/rooms/" + session.code + "/control", "POST", session.hostToken, { action }) as PublicState;
      setState(next);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setPending(false); }
  };
  const remaining = state?.phase === "paused" ? state.remainingMs : state?.deadline ? Math.max(0, state.deadline - (clock + offsetMs)) : null;
  const time = remaining === null ? "—" : Math.floor(remaining / 60000).toString().padStart(2, "0") + ":" + Math.ceil(remaining / 1000 % 60).toString().padStart(2, "0");

  if (!quizzes.length && !session) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Engage Quiz{session ? " · " + session.code : ""}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] w-[min(680px,94vw)] flex-col overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rhema Engage — Sermon & Service Recall</DialogTitle>
            <DialogDescription>Congregants join on mobile data over the public internet. Launching a room does not change any congregation/OBS output.</DialogDescription>
          </DialogHeader>
          {!session ? (
            <div className="flex flex-col gap-3 text-sm">
              <label className="flex flex-col gap-1">Quiz in this service
                <select className="h-9 rounded-md border border-input bg-background px-2" value={selected?.id ?? ""} onChange={e => setSelectedId(e.target.value)}>
                  {quizzes.map(item => <option key={item.id} value={item.id}>{item.reference}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">{quiz ? `${quiz.questions.length} questions · ${quiz.lobbySeconds}s lobby · ${quiz.questionSeconds}s per question` : "Create an approved Quiz event in Prepare first."}</p>
              <label className="flex flex-col gap-1">Public quiz service HTTPS address
                <Input type="url" autoComplete="url" placeholder="https://engage.yourchurch.org" value={endpoint} onChange={e => setEndpoint(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1">Host creation key
                <Input type="password" autoComplete="off" placeholder="Private secret configured on cloud worker" value={key} onChange={e => setKey(e.target.value)} />
              </label>
              <p className="text-xs text-muted-foreground">Never add the host key to a saved service, slide, public URL or shared event. The Cloudflare deployment and ADMIN_KEY must already exist.</p>
              <Button disabled={pending || !quiz?.reviewed} onClick={() => void launch()}>Create internet quiz lobby</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div><p className="text-xs text-muted-foreground">Join code</p><p className="font-mono text-2xl font-bold tracking-wider">{session.code}</p>
                  <p className="break-all text-xs">{session.joinUrl}</p></div>
                {qr && <img src={qr} className="size-28 rounded-md bg-white p-1" alt="QR code for the public internet quiz join page" />}
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-3 text-center">
                <div><p className="text-xs">Status</p><p className="font-semibold capitalize">{state?.phase ?? "Connecting"}</p></div>
                <div><p className="text-xs">Countdown</p><p className="font-mono text-xl font-bold">{time}</p></div>
                <div><p className="text-xs">Players</p><p className="text-xl font-semibold">{state?.playerCount ?? "—"}</p></div>
              </div>
              {state?.question && <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Question {state.questionIndex + 1}/{state.questionCount} · {state.answerCount} submitted</p>
                <p className="mt-1 font-semibold">{state.question.prompt}</p>
                {state.phase === "reveal" && typeof state.question.correctIndex === "number" &&
                  <p className="mt-2 text-xs text-confidence-high">Correct: {state.question.choices[state.question.correctIndex]} {state.question.reference || ""}</p>}
              </div>}
              <div className="flex flex-wrap gap-2">
                {state?.phase === "lobby" && <>
                  <Button size="sm" disabled={disabled} onClick={() => void command("start")}>Start now</Button>
                  <Button size="sm" variant="outline" disabled={disabled} onClick={() => void command("extend")}>+30 seconds</Button>
                </>}
                {["lobby", "question"].includes(state?.phase ?? "") && <Button size="sm" variant="outline" disabled={disabled} onClick={() => void command("pause")}>Pause</Button>}
                {state?.phase === "paused" && <Button size="sm" disabled={disabled} onClick={() => void command("resume")}>Resume</Button>}
                {state?.phase === "question" && <Button size="sm" disabled={disabled} onClick={() => void command("reveal")}>Reveal answer</Button>}
                {state?.phase === "reveal" && <Button size="sm" disabled={disabled} onClick={() => void command("next")}>Next / Finish</Button>}
                {!["finished", "expired"].includes(state?.phase ?? "") && <Button size="sm" variant="outline" disabled={disabled} onClick={() => void command("finish")}>Finish game</Button>}
                <Button size="sm" variant="outline" onClick={() => window.open(session.screenUrl, "_blank", "noopener,noreferrer")}>Open TV / OBS browser display</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Forget this host token? You will not be able to control this session again.")) useEngageHost.getState().setSession(null); }}>Forget session</Button>
              </div>
              <p className="text-xs text-muted-foreground">To put the quiz on the TV, open the screen URL on a designated display or add it as an OBS Browser Source. This V1 does not yet auto-Take a Rhema congregation scene.</p>
              {!!state?.leaderboard?.length && <div className="rounded-lg border border-border p-3"><p className="font-semibold">Leaderboard</p>
                {state.leaderboard.slice(0, 10).map(p => <p key={p.rank} className="text-xs">{p.rank}. {p.nickname} — {p.points} pts · {Math.round(p.correctMs / 100) / 10}s correct-response time</p>)}
              </div>}
            </div>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
