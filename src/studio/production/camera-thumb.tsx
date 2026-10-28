import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { VideoIcon } from "lucide-react"
import { WhepPlayer } from "@/lib/whep"

/**
 * A camera's live picture on its card (#209): small, muted, from the router like any screen. It
 * plays only while the card is on screen: scrolled away (or the window hidden), the player stops,
 * so a long camera list does not read every camera all the time.
 */
export function CameraThumb({ url, label }: { url: string | null; label: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const visible = () => document.visibilityState !== "hidden"
    // Without IntersectionObserver it simply plays (see the state's start).
    if (typeof IntersectionObserver === "undefined") return
    let inView = false
    const update = () => setSeen(inView && visible())
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting)
      update()
    })
    io.observe(el)
    document.addEventListener("visibilitychange", update)
    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  useEffect(() => {
    if (!seen || !url) return
    const p: WhepPlayer = new WhepPlayer(url, (u, sdp) => invoke<string>("whep_offer", { url: u, sdp }), () => setReady(p.ready))
    Object.assign(p.video.style, { position: "absolute", inset: "0", width: "100%", height: "100%", objectFit: "cover" })
    p.video.setAttribute("aria-label", `${label} live picture`)
    box.current?.appendChild(p.video)
    return () => {
      p.close()
      p.video.remove()
      setReady(false)
    }
  }, [seen, url, label])

  return (
    <div ref={box} className="relative aspect-video w-full overflow-hidden rounded-md bg-muted">
      {!ready && (
        <span className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 text-center text-muted-foreground">
          <VideoIcon className="size-5" aria-hidden />
          <span>{!url ? "No picture: the camera router is off" : seen ? "Waiting for a picture…" : "Paused while off screen"}</span>
        </span>
      )}
    </div>
  )
}
