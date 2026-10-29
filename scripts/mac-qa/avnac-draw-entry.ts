// QA harness (not shipped): the Avnac engine pieces a native-window test needs, bundled as one script
// (`esbuild --bundle --format=iife --global-name=AvnacQA`) and run through the QA bridge.
export { applyCommand, buildRenderCommands, createEmptySaraswatiScene, SARASWATI_ROOT_ID } from "../../src/vendor/avnac/saraswati"
export { renderSceneToCanvas } from "../../src/vendor/avnac/renderer/offscreen-render"
export { createContentPaintScheduler } from "../../src/vendor/avnac/renderer/paint-scheduler"
export { canvas2DRendererBackend } from "../../src/vendor/avnac/renderer/backends/canvas2d/renderer"
