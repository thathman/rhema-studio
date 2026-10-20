import type { StagePayload } from "@/types"

/**
 * Stage display: plain DOM, high contrast, no theme. What the team needs at
 * a glance — the live words, what is next, the operator's note, the timer.
 */
export function StageView({ stage }: { stage: StagePayload }) {
  const timerColor = stage.timer?.tone === "over" ? "#ff5a5a" : stage.timer?.tone === "warn" ? "#ffc547" : "#9be37a"
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", color: "#fff", fontFamily: "system-ui, sans-serif", display: "grid", gridTemplateRows: stage.message ? "auto auto 1fr auto" : "auto 1fr auto", padding: "3vh 4vw", gap: "2vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "3.2vh", color: "#9aa0a6" }}>
        <span>{stage.current?.title ?? "Nothing live"}</span>
        {stage.timer && <span style={{ color: timerColor, fontVariantNumeric: "tabular-nums", fontSize: "5vh", fontWeight: 700 }}>{stage.timer.label}{stage.timer.tone === "over" ? " OVER" : ""}</span>}
      </div>
      {stage.message && (
        <div role="alert" style={{ border: "0.6vh solid #ffd166", background: "#2a2000", color: "#ffd166", borderRadius: "1.5vh", padding: "1.5vh 2vw", fontSize: "5vh", fontWeight: 700, textAlign: "center" }}>
          {stage.message}
        </div>
      )}
      <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "center", gap: "1vh" }}>
        {stage.current ? (
          stage.current.lines.map((line, i) => (
            <div key={i} style={{ fontSize: `${Math.max(4, Math.min(9, 60 / Math.max(stage.current!.lines.length, 1)))}vh`, lineHeight: 1.25, fontWeight: 600 }}>{line}</div>
          ))
        ) : (
          <div style={{ fontSize: "6vh", color: "#555" }}>—</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "4vw", fontSize: "3.6vh" }}>
        <span style={{ color: "#ffd166", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage.note ? `Note: ${stage.note}` : ""}</span>
        <span style={{ color: "#9aa0a6", whiteSpace: "nowrap" }}>{stage.next ? `NEXT: ${stage.next}` : "End of service"}</span>
      </div>
    </div>
  )
}
