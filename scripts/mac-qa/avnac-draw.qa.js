const A = AvnacQA
// A backdrop picture made on the spot (no network, no files).
const g = document.createElement("canvas"); g.width = 640; g.height = 360
const gx = g.getContext("2d"); const grad = gx.createLinearGradient(0, 0, 640, 360); grad.addColorStop(0, "#1b2a6b"); grad.addColorStop(1, "#7a1f5c"); gx.fillStyle = grad; gx.fillRect(0, 0, 640, 360)
const src = g.toDataURL("image/png")
const base = { parentId: A.SARASWATI_ROOT_ID, visible: true, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, originX: "left", originY: "top" }
let scene = A.createEmptySaraswatiScene({ width: 1920, height: 1080, bg: { type: "solid", color: "#000000" } })
scene = A.applyCommand(scene, { type: "ADD_NODE", node: { ...base, id: "bg", type: "image", x: 0, y: 0, width: 1920, height: 1080, src, cropX: 0, cropY: 0, clipPath: null } })
for (let i = 0; i < 100; i++) {
  scene = A.applyCommand(scene, { type: "ADD_NODE", node: { ...base, id: "t" + i, type: "text", x: 40 + (i % 5) * 370, y: 40 + Math.floor(i / 5) * 50, text: "Layer " + i, width: 360, fontSize: 36, fontFamily: "Helvetica", fontWeight: "700", fontStyle: "normal", textAlign: "left", lineHeight: 1.2, underline: false, color: { type: "solid", color: "#ffffff" }, stroke: null, strokeWidth: 0 } })
}
await A.renderSceneToCanvas(scene, { awaitFonts: true }) // warm-up: image decode, fonts
const times = []
let last = null
for (let i = 0; i < 10; i++) { const t = performance.now(); last = await A.renderSceneToCanvas(scene, { awaitFonts: false }); times.push(performance.now() - t) }
const ctx = last.getContext("2d")
const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data)
const small = await A.renderSceneToCanvas(scene, { maxCssPx: 960, awaitFonts: false })
times.sort((a, b) => a - b)
return { size: [last.width, last.height], layers: Object.keys(scene.nodes).length - 1, msMedian: +times[5].toFixed(2), msMax: +times[9].toFixed(2), backdropPixel: px(1900, 1060), textPixelRow: px(60, 60), png: small.toDataURL("image/png") }
