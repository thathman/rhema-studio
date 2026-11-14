// Native Tauri acceptance scenario for #444 / #411: a service of three events (a 15-minute Opening Prayer
// whose scene has a camera and a lower third, a Sermon with two moments, a post-service quiz) is saved,
// closed and reopened with every id, time and scene intact; four phases are added; 20 view flips, a
// reorder inside an event, an event move and Undo keep the plan exact; Program never changes.
const normal = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const tick = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0) })
const settle = async () => { for (let i = 0; i < 20; i += 1) await tick() }
const program = () => { const b = qa.broadcast.getState(); return JSON.stringify([b.isLive, b.liveItemId ?? null, b.liveVerse?.reference ?? null]) }
const plan = () => JSON.stringify({
  items: qa.queue.getState().items.map((i) => [i.id, i.planned_minutes ?? null, i.scene_id ?? null]),
  events: qa.queue.getState().headers.filter((h) => h.type === "group").map((h) => [h.id, h.name, h.at]),
})

async function runScenario() {
  // An isolated QA profile: whatever an earlier journey left open is synthetic and may be discarded.
  if (qa.service.getState().current) qa.service.getState().closeProgram({ discard: true })
  await settle()
  const L = (id, kind, box) => ({ id, name: id, kind, box, opacity: 1, visible: true })
  qa.broadcast.getState().saveScene({ id: "qa-five-prayer", name: "QA prayer camera + name", background: "#000000", createdAt: 0, updatedAt: 0,
    layers: [L("cam", "camera", { x: 0, y: 0, w: 100, h: 100 }), L("lt", "lowerThird", { x: 5, y: 75, w: 90, h: 18 })] })
  const slide = (id, title, body, minutes, scene) => ({ id, kind: "slide", slide: { title, body }, reference: title, confidence: 1, source: "manual", added_at: 0, planned_minutes: minutes, ...(scene ? { scene_id: scene } : {}) })
  qa.queue.setState({
    items: [
      slide("qa-five-prayer-item", "Opening Prayer", "Let us pray", 15, "qa-five-prayer"),
      slide("qa-five-sermon-1", "Sermon · point one", "Point one", 20),
      slide("qa-five-sermon-2", "Sermon · point two", "Point two", 15),
      { id: "qa-five-quiz", kind: "cue", reference: "Sermon recall quiz", confidence: 1, source: "manual", added_at: 0, planned_minutes: 8, payload_extra: { rhema_engage: { title: "Sermon recall", reviewed: false, questions: [] } } },
    ],
    headers: [
      { id: "qa-five-ev-prayer", type: "group", name: "Opening Prayer", at: 0, event: { schema_version: 1 } },
      { id: "qa-five-ev-sermon", type: "group", name: "Sermon", at: 1, event: { schema_version: 1 } },
      { id: "qa-five-ev-quiz", type: "group", name: "Post-service quiz", at: 3, event: { schema_version: 1 } },
    ],
    activeIndex: null, past: [], future: [],
  })
  const programBefore = program()
  const created = await qa.service.getState().createFromRundown("QA five-part service", "2026-11-15")
  if (created !== "created") throw new Error(`Could not save the service: ${created}`)
  const id = qa.service.getState().current?.id
  const saved = plan()
  if (await qa.service.getState().closeProgram() !== "closed") throw new Error("Could not close the service")
  if (await qa.service.getState().openProgram(id) !== "ok") throw new Error("Could not reopen the service")
  await settle()
  const reopened = plan()
  if (reopened !== saved) throw new Error(`Reopened plan differs: ${saved} → ${reopened}`)
  const parsed = JSON.parse(reopened)
  if (JSON.stringify(parsed.items.map((i) => i[1])) !== "[15,20,15,8]") throw new Error(`Planned minutes changed: ${reopened}`)
  if (parsed.items[0][2] !== "qa-five-prayer") throw new Error("The prayer lost its scene")
  const layers = qa.broadcast.getState().scenes.find((s) => s.id === "qa-five-prayer")?.layers.map((l) => l.kind).join(",")
  if (layers !== "camera,lowerThird") throw new Error(`The prayer scene's layers changed: ${layers}`)

  qa.shell.getState().setWorkspace("prepare")
  await settle()
  const button = (text) => [...document.querySelectorAll("button")].find((b) => normal(b.innerText) === text && !b.disabled)
  button("Organise into phases")?.click()
  await settle()
  button("Add phases")?.click()
  await settle()
  const phases = qa.queue.getState().headers.filter((h) => h.type === "phase").length
  if (phases !== 4) throw new Error(`Expected four default phases, found ${phases}`)
  const withPhases = plan()
  let flips = 0
  for (let i = 0; i < 20; i += 1) {
    const view = i % 2 === 0 ? "Simple list" : "Grouped by phase"
    const b = [...document.querySelectorAll('[aria-label="Running order view"] button')].find((x) => normal(x.innerText) === view)
    if (b) { b.click(); flips += 1 }
    await tick()
  }
  if (flips !== 20) throw new Error(`Only ${flips} view flips were possible`)
  if (plan() !== withPhases) throw new Error("View flips changed the plan")

  const q = qa.queue.getState()
  q.reorderItems(2, 1)
  const sermon = qa.queue.getState().headers.find((h) => h.type === "group" && h.name === "Sermon")
  qa.queue.getState().moveEvent(sermon.id, -1)
  if (plan() === withPhases) throw new Error("Reorder and event move did nothing")
  qa.queue.getState().undo()
  qa.queue.getState().undo()
  await settle()
  if (plan() !== withPhases) throw new Error("Two Undos did not restore the plan")
  if (program() !== programBefore) throw new Error("Program changed without a Take")
  return { created, reopened: true, minutes: parsed.items.map((i) => i[1]), sceneLayers: layers, phases, flips, undoRestored: true, programUnchanged: true }
}
