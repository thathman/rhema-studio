// Native Tauri acceptance scenario for #392: a failed async Take reports failure without moving Live.
const waitFor = async (predicate, label, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out waiting for ${label}`)
}
const normal = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
const buttons = () => [...document.querySelectorAll("button, [role=tab]")]
const clickButton = async (name) => {
  const button = await waitFor(
    () => buttons().find((candidate) => normal(candidate.getAttribute("aria-label") || candidate.innerText) === name),
    `button “${name}”`,
  )
  if (button.disabled || button.getAttribute("aria-disabled") === "true") throw new Error(`Button “${name}” is disabled`)
  const pointerId = Date.now() % 100000
  const pointer = { bubbles: true, button: 0, pointerType: "mouse", pointerId, isPrimary: true }
  button.dispatchEvent(new PointerEvent("pointerdown", pointer))
  button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  button.dispatchEvent(new PointerEvent("pointerup", pointer))
  button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
  button.click()
  await sleep(100)
  return button
}
const clickRundownItem = async (item) => {
  const row = await waitFor(
    () => [...document.querySelectorAll("button[title]")].find((button) => button.title.includes("Click to preview") && normal(button.innerText).includes(item.reference)),
    `rundown item “${item.reference}”`,
  )
  row.click()
  await waitFor(() => qa.bible.getState().selectedQueueItemId === item.id, `${item.reference} preview selection`)
}

async function runScenario() {
  await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
  const qa = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
  let stage = "open Live"
  try {
    await clickButton("Live")
    await waitFor(() => document.querySelector('[data-studio-live]') || document.querySelector('[data-slot="preview-panel"]'), "Live workspace")

    stage = "seed an isolated service rundown and missing image"
    const baseline = {
      id: "qa-live-baseline",
      kind: "slide",
      slide: { title: "QA Live Baseline", body: "Synthetic on-air content" },
      reference: "QA Live Baseline",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    const missing = {
      id: "qa-missing-image-item",
      kind: "image",
      image: { media_id: "qa-missing-image", name: "QA Missing Image", fit: "contain" },
      reference: "QA Missing Image",
      confidence: 1,
      source: "manual",
      added_at: 0,
    }
    qa.media.setState({
      assets: [{
        id: "qa-missing-image",
        kind: "image",
        name: "QA Missing Image",
        file: "qa-missing-image.png",
        hash: "0".repeat(64),
        size: 0,
        mime: "image/png",
        width: null,
        height: null,
        duration_ms: null,
        source: "synthetic QA fixture",
        source_ref: "",
        original_path: "",
        created_at: new Date(0).toISOString(),
        path: "/synthetic-qa/qa-missing-image.png",
        present: false,
      }],
      urls: {},
      loaded: true,
      loading: false,
      error: null,
    })
    qa.queue.setState({ items: [baseline, missing], headers: [], activeIndex: null, addTarget: null, removedActive: null })

    stage = "Take the valid baseline live"
    await clickRundownItem(baseline)
    await clickButton("Take live")
    await waitFor(() => {
      const live = qa.broadcast.getState()
      return live.isLive && live.liveItemId === baseline.id && qa.queue.getState().activeIndex === 0
    }, "baseline to be live and active")
    const before = {
      liveItemId: qa.broadcast.getState().liveItemId,
      liveReference: qa.broadcast.getState().liveVerse?.reference,
      activeIndex: qa.queue.getState().activeIndex,
    }

    stage = "preview the missing image"
    await clickRundownItem(missing)
    await waitFor(() => qa.bible.getState().selectedSlide?.item.id === missing.id, "missing image preview")

    stage = "Take the missing image and inspect the failure"
    await clickButton("Take live")
    const notice = await waitFor(() => document.querySelector('[data-take-status="failed"]'), "visible failed-Take notice")
    const noticeText = normal(notice.innerText)
    if (!noticeText.includes("Take failed: QA Missing Image · empty")) throw new Error(`Failure notice omitted the result: ${noticeText}`)

    const after = {
      liveItemId: qa.broadcast.getState().liveItemId,
      liveReference: qa.broadcast.getState().liveVerse?.reference,
      activeIndex: qa.queue.getState().activeIndex,
      warning: qa.broadcast.getState().presentWarning,
    }
    if (!qa.broadcast.getState().isLive) throw new Error("Failed Take took the existing output off air")
    if (after.liveItemId !== baseline.id || after.liveReference !== baseline.reference) {
      throw new Error(`Failed Take replaced the on-air item: ${JSON.stringify(after)}`)
    }
    if (after.activeIndex !== 0) throw new Error(`Failed Take advanced the active rundown position: ${after.activeIndex}`)
    if (!after.warning?.includes("QA Missing Image not shown: the picture file is missing")) {
      throw new Error(`The missing-file warning was not visible in Live state: ${after.warning}`)
    }

    return { before, after, failedTakeNotice: noticeText, previewItemId: qa.bible.getState().selectedSlide?.item.id, live: qa.broadcast.getState().isLive }
  } catch (error) {
    throw new Error(JSON.stringify({
      stage,
      message: error?.message,
      stack: error?.stack,
      error: String(error),
      buttons: buttons().map((button) => normal(button.getAttribute("aria-label") || button.innerText)).filter(Boolean).slice(0, 80),
      queue: qa.queue.getState().items.map((item) => ({ id: item.id, reference: item.reference })),
      activeIndex: qa.queue.getState().activeIndex,
      live: {
        isLive: qa.broadcast.getState().isLive,
        liveItemId: qa.broadcast.getState().liveItemId,
        reference: qa.broadcast.getState().liveVerse?.reference,
        warning: qa.broadcast.getState().presentWarning,
      },
      body: normal(document.body.innerText).slice(0, 2400),
    }))
  }
}
