import type { StagePayload } from "@/types"
import { stageFontVh } from "@/lib/stage"
import { stageFinishText } from "@/lib/stage-finish-text"

/**
 * Stage display: plain DOM, high contrast, no theme. What the team needs at
 * a glance — the live words, what is next, the operator's note, the timer.
 */
export function StageView({ stage }: { stage: StagePayload }) {
  const style = stage.style
  const showNext = style?.showNext !== false
  const timerColor = stage.timer?.tone === "over" ? "#ff5a5a" : stage.timer?.tone === "warn" ? "#ffc547" : "#9be37a"
  const rows = ["auto", ...(stage.aux?.length ? ["auto"] : []), ...(stage.message ? ["auto"] : []), ...(stage.languageNotice ? ["auto"] : []), "1fr", "auto"]
  return (
    <div style={{ position: "fixed", inset: 0, background: style?.background ?? "#000", color: style?.words ?? "#fff", fontFamily: "system-ui, sans-serif", display: "grid", gridTemplateRows: rows.join(" "), padding: "3vh 4vw", gap: "2vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "3.2vh", color: "#9aa0a6" }}>
        <span>{stage.current?.title ?? "Nothing live"}</span>
        {stage.band && <span style={{ color: "#9be37a", fontWeight: 700 }}>{stage.band}</span>}
        {stage.finish && <span style={{ color: stage.finish.lateMin > 0 ? "#ffc547" : "#9aa0a6", marginLeft: "auto", marginRight: "2vw", fontVariantNumeric: "tabular-nums" }}>{stageFinishText(stage.finish)}</span>}
        {stage.timer && <span style={{ color: timerColor, fontVariantNumeric: "tabular-nums", fontSize: "5vh", fontWeight: 700 }}>{stage.timer.label}{stage.timer.tone === "over" ? " OVER" : ""}</span>}
      </div>
      {stage.aux && stage.aux.length > 0 && (
        <div style={{ display: "flex", gap: "3vw", fontSize: "3.2vh", fontVariantNumeric: "tabular-nums" }}>
          {stage.aux.map((t, i) => <span key={i} style={{ color: t.tone === "over" ? "#ff5a5a" : t.tone === "warn" ? "#ffc547" : "#9aa0a6" }}>{t.label} <b>{t.text}</b></span>)}
        </div>
      )}
      {stage.message && (
        <div role="alert" style={{ border: "0.6vh solid #ffd166", background: "#2a2000", color: "#ffd166", borderRadius: "1.5vh", padding: "1.5vh 2vw", fontSize: "5vh", fontWeight: 700, textAlign: "center" }}>
          {stage.message}
        </div>
      )}
      {stage.languageNotice && (
        <div role="status" aria-live="polite" style={{ border: "0.3vh solid #ffd166", background: "#2a2000", color: "#ffd166", borderRadius: "1vh", padding: "0.8vh 1.2vw", fontSize: "2.8vh", fontWeight: 600, textAlign: "center" }}>
          {stage.languageNotice}
        </div>
      )}
      {/* "safe center": if the words still overflow, the first line stays visible and the end is cut, never both ends. */}
      <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "safe center", gap: "1vh" }}>
        {stage.current ? (
          stage.current.lines.map((line, i) => (
            <div key={i} style={{ fontSize: `${stageFontVh(stage.current!.lines) * (style?.wordsScale ?? 1)}vh`, lineHeight: 1.25, fontWeight: 600 }}>{line}</div>
          ))
        ) : (
          <div style={{ fontSize: "6vh", color: "#555" }}>—</div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "4vw", fontSize: "3.6vh" }}>
        <span style={{ color: "#ffd166", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stage.note ? `Note: ${stage.note}` : ""}</span>
        {showNext && <span style={{ color: "#9aa0a6", whiteSpace: "nowrap" }}>{stage.next ? `NEXT: ${stage.next}` : "End of service"}</span>}
      </div>
    </div>
  )
}
