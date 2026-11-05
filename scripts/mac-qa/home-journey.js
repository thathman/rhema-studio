// Native Tauri acceptance scenario for #405 and #406: Home's Next, its Sunday summary and its readiness
// counter in the real desktop app. Next skips hidden items and items in a skipped phase, exactly as Live
// does; the summary says why an item is skipped; the counter is "Service readiness", not "Content".
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
  const button = await waitFor(() => buttons().find((candidate) => normal(candidate.getAttribute("aria-label") || candidate.innerText) === name), `button “${name}”`)
  button.click()
  await sleep(100)
  return button
}
const slide = (id, title) => ({ id, kind: "slide", slide: { title, body: "Synthetic Home QA moment" }, reference: title, confidence: 1, source: "manual", added_at: 0 })
const rowFor = (reference) => {
  const section = document.querySelector('section[aria-labelledby="glance"]')
  return normal([...(section?.querySelectorAll("li") ?? [])].find((li) => normal(li.innerText).includes(reference))?.innerText)
}

async function runScenario() {
  await waitFor(() => document.querySelector("#root")?.childElementCount, "Rhema Studio window")
  const qa = await waitFor(() => window.__rhemaQa?.(), "isolated QA stores")
  let stage = "seed a service with a hidden item and a skipped phase"
  try {
    const a = slide("qa-home-a", "QA Home Opening")
    const b = { ...slide("qa-home-b", "QA Home Hidden"), hidden: true }
    const c = slide("qa-home-c", "QA Home Skipped Phase")
    const d = slide("qa-home-d", "QA Home Closing")
    qa.queue.setState({
      items: [a, b, c, d],
      headers: [
        { id: "qa-home-pre", type: "phase", name: "Opening", at: 0, rule: "manual", role: "pre" },
        { id: "qa-home-main", type: "phase", name: "Skipped phase", at: 2, rule: "manual", role: "main", disabled: true },
        { id: "qa-home-post", type: "phase", name: "Closing", at: 3, rule: "manual", role: "post" },
      ],
      activeIndex: 0,
      addTarget: null,
    })

    stage = "open Home"
    await clickButton("Home")
    await waitFor(() => document.querySelector('section[aria-labelledby="glance"] li'), "Sunday at a glance rows")

    stage = "Next skips the hidden item and the skipped phase"
    const rows = { a: rowFor(a.reference), b: rowFor(b.reference), c: rowFor(c.reference), d: rowFor(d.reference) }
    if (!rows.d.includes("· next")) throw new Error(`Next is not the closing item: ${JSON.stringify(rows)}`)
    for (const key of ["a", "b", "c"]) if (rows[key].includes("· next")) throw new Error(`Next points at a skipped or active item: ${JSON.stringify(rows)}`)
    if (!rows.b.includes("Hidden for this service")) throw new Error(`The hidden item is not labelled: ${rows.b}`)
    if (!rows.c.includes("Phase skipped for this service")) throw new Error(`The skipped-phase item is not labelled: ${rows.c}`)

    stage = "the Sunday plan counts the skipped items"
    const body = normal(document.body.innerText)
    if (!body.includes("2 items skipped")) throw new Error("Sunday plan does not count the 2 skipped items")

    stage = "the counter is Service readiness"
    if (!body.includes("Service readiness")) throw new Error("No Service readiness counter on Home")
    if (/content readiness/i.test(body)) throw new Error("Home still labels the counter Content readiness")
    const progress = document.querySelector('[role="progressbar"][aria-label="Service readiness checks"]')
    if (!progress) throw new Error("The readiness progress bar has no Service readiness label")
    const readiness = { ok: Number(progress.getAttribute("aria-valuenow")), counted: Number(progress.getAttribute("aria-valuemax")) }
    if (!(readiness.ok <= readiness.counted)) throw new Error(`Readiness counts are inconsistent: ${JSON.stringify(readiness)}`)

    stage = "on the last item there is no Next"
    qa.queue.setState({ activeIndex: 3 })
    await waitFor(() => !normal(document.querySelector('section[aria-labelledby="glance"]')?.innerText).includes("· next"), "no Next on the last item")

    stage = "an all-hidden service says nothing is scheduled"
    qa.queue.setState({ items: [a, b, c, d].map((item) => ({ ...item, hidden: true })), activeIndex: null })
    const empty = await waitFor(() => [...document.querySelectorAll('section[aria-labelledby="glance"] [role="status"]')].find((el) => normal(el.innerText).includes("nothing is scheduled to present")), "all-skipped notice")

    return { rows, readiness, allSkipped: normal(empty.innerText) }
  } catch (error) {
    throw new Error(JSON.stringify({
      stage,
      message: error?.message,
      error: String(error),
      queue: qa.queue.getState().items.map((item) => ({ id: item.id, reference: item.reference, hidden: !!item.hidden })),
      activeIndex: qa.queue.getState().activeIndex,
      body: normal(document.body.innerText).slice(0, 2400),
    }))
  }
}
