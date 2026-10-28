import { invoke } from "@tauri-apps/api/core"
import { useEffect, useState } from "react"
import { outputOnAir } from "@/lib/output-on-air"
import { sceneForOutput } from "@/lib/scenes"
import type { BroadcastOutput, BroadcastOutputStatus, NdiFrameRate, Scene } from "@/types"

/**
 * How much this computer can run at once (#243 G13, AC.5): soft limits worked out from its cores
 * and memory, which the operator can change in Settings → Outputs. Going past one only warns
 * ("this computer may drop frames"); nothing is refused, except 60 fps NDI on a smaller computer,
 * which asks first.
 */

/** The computer's size, from the machine_info command. */
export interface MachineInfo {
  cores: number
  physicalCores: number | null
  memoryTotalMb: number
  os: string
  arch: string
}

export type CapacityKind = "outputs" | "ndiSenders" | "browserFeeds" | "cameras" | "videoScenes"

export type CapacityLimits = Record<CapacityKind, number>

/** Limits the operator set in Settings; a kind not listed is worked out from the computer. */
export type CapacityOverrides = Partial<Record<CapacityKind, number>>

export const CAPACITY_KINDS: ReadonlyArray<{ kind: CapacityKind; label: string; hint: string }> = [
  { kind: "outputs", label: "Outputs on at once", hint: "Screens, NDI senders and browser feeds together" },
  { kind: "ndiSenders", label: "NDI senders", hint: "Each one draws and sends every frame" },
  { kind: "browserFeeds", label: "Browser feeds", hint: "Pages and Google TVs draw these themselves" },
  { kind: "cameras", label: "Cameras in the camera router", hint: "Phones and cameras added in Production → Cameras" },
  { kind: "videoScenes", label: "Outputs showing a scene with live video", hint: "Each one plays its cameras itself" },
]

/** What Rhema assumes when it cannot ask (a browser preview, an older build): a modest laptop. */
export const UNKNOWN_MACHINE: MachineInfo = { cores: 4, physicalCores: 2, memoryTotalMb: 8192, os: "unknown", arch: "unknown" }

/** 60 fps NDI without asking: at least this many physical cores and this much memory. */
export const NDI_60_MIN_CORES = 6
export const NDI_60_MIN_MEMORY_GB = 16

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))

/** Physical cores, or half the logical ones when the system does not say. */
export function physicalCores(m: MachineInfo): number {
  return Math.max(1, m.physicalCores ?? Math.ceil(m.cores / 2))
}

/**
 * The limits worked out from the computer: about one NDI sender per physical core (fewer under
 * 8 GB), browser feeds and outputs at twice that, one camera per core, and live-video scenes one
 * fewer than the cores. A 4-core, 16 GB Intel Mac gets 4 NDI senders, 8 outputs, 4 cameras.
 */
export function defaultLimits(m: MachineInfo): CapacityLimits {
  const p = physicalCores(m)
  const small = m.memoryTotalMb < 8 * 1024 - 256
  const ndi = clamp(p, 1, 8)
  return {
    outputs: clamp(p * 2, 3, 16),
    ndiSenders: small ? Math.min(ndi, 2) : ndi,
    browserFeeds: clamp(p * 2, 4, 16),
    cameras: small ? Math.min(clamp(p, 2, 8), 2) : clamp(p, 2, 8),
    videoScenes: clamp(p - 1, 1, 6),
  }
}

/** A saved override counts when it is a whole number from 1 to 64. */
export function validLimit(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 64
}

export function capacityLimits(m: MachineInfo, overrides: CapacityOverrides | undefined): CapacityLimits {
  const limits = defaultLimits(m)
  for (const { kind } of CAPACITY_KINDS) {
    const n = overrides?.[kind]
    if (validLimit(n)) limits[kind] = n
  }
  return limits
}

/** Whether 60 fps NDI suits this computer without asking. */
export function suits60fps(m: MachineInfo): boolean {
  return physicalCores(m) >= NDI_60_MIN_CORES && m.memoryTotalMb >= NDI_60_MIN_MEMORY_GB * 1024 - 256
}

export type CapacityUse = Record<CapacityKind, number>

/** A scene plays live video when it has a camera layer. */
export function hasLiveVideo(scene: Scene | undefined): boolean {
  return !!scene?.layers.some((l) => l.kind === "camera" && !!l.cameraUrl)
}

/** What is running now: outputs on, by kind, cameras added, and outputs on a scene with live video. */
export function capacityUse(outputs: BroadcastOutput[], status: Record<string, BroadcastOutputStatus | undefined>, scenes: Scene[], cameras: number): CapacityUse {
  const on = outputs.filter((o) => outputOnAir(o, status[o.id]))
  return {
    outputs: on.length,
    ndiSenders: on.filter((o) => o.type === "ndi").length,
    browserFeeds: on.filter((o) => o.type === "browser").length,
    cameras,
    videoScenes: on.filter((o) => hasLiveVideo(sceneForOutput(o, scenes))).length,
  }
}

/** The same counts with one more output turned on. */
export function withOutputOn(use: CapacityUse, output: BroadcastOutput, scenes: Scene[]): CapacityUse {
  return {
    ...use,
    outputs: use.outputs + 1,
    ndiSenders: use.ndiSenders + (output.type === "ndi" ? 1 : 0),
    browserFeeds: use.browserFeeds + (output.type === "browser" ? 1 : 0),
    videoScenes: use.videoScenes + (hasLiveVideo(sceneForOutput(output, scenes)) ? 1 : 0),
  }
}

const NOUNS: Record<CapacityKind, [string, string]> = {
  outputs: ["output on", "outputs on"],
  ndiSenders: ["NDI sender", "NDI senders"],
  browserFeeds: ["browser feed", "browser feeds"],
  cameras: ["camera", "cameras"],
  videoScenes: ["output showing live video", "outputs showing live video"],
}

/** "5 NDI senders (it suits about 4)" for each kind over its limit. */
export function overLimits(use: CapacityUse, limits: CapacityLimits): Array<{ kind: CapacityKind; text: string }> {
  return CAPACITY_KINDS.filter(({ kind }) => use[kind] > limits[kind]).map(({ kind }) => ({ kind, text: `${use[kind]} ${NOUNS[kind][use[kind] === 1 ? 0 : 1]} (it suits about ${limits[kind]})` }))
}

/**
 * What to say before turning an output on, or null when it is fine: the limits it would take past
 * (only those it adds to), and (separately) 60 fps NDI on a computer below what it needs.
 */
export function startWarning(output: BroadcastOutput, before: CapacityUse, scenes: Scene[], limits: CapacityLimits, machine: MachineInfo, frameRate: NdiFrameRate = output.ndi.frameRate): { over: string | null; fps60: string | null } | null {
  const after = withOutputOn(before, output, scenes)
  const over = overLimits(after, limits).filter(({ kind }) => after[kind] > before[kind])
  const overText = over.length > 0 ? `This computer may drop frames: with ${output.name} on it runs ${over.map((o) => o.text).join(", ")}. Turn another output off, or lower a frame rate.` : null
  const fps60 = output.type === "ndi" && frameRate === "fps60" && !suits60fps(machine) ? `${output.name} is set to 60 fps. This computer (${physicalCores(machine)} cores, ${Math.round(machine.memoryTotalMb / 1024)} GB) is below what 60 fps NDI needs (${NDI_60_MIN_CORES} cores and ${NDI_60_MIN_MEMORY_GB} GB) and may drop frames; 30 fps is smooth for words and most video.` : null
  return overText || fps60 ? { over: overText, fps60 } : null
}

let machinePromise: Promise<MachineInfo> | null = null

/** The computer's size, asked once; a modest laptop when it cannot be asked. */
export function machineInfo(): Promise<MachineInfo> {
  machinePromise ??= invoke<MachineInfo>("machine_info").then(
    (m) => (m && m.cores > 0 && m.memoryTotalMb > 0 ? m : UNKNOWN_MACHINE),
    () => UNKNOWN_MACHINE,
  )
  return machinePromise
}

/** Forget the cached answer (tests). */
export function resetMachineInfo(): void {
  machinePromise = null
}

/** The computer's size for a component; the modest-laptop guess until it answers. */
export function useMachineInfo(): MachineInfo & { known: boolean } {
  const [m, setM] = useState<MachineInfo & { known: boolean }>({ ...UNKNOWN_MACHINE, known: false })
  useEffect(() => {
    let live = true
    void machineInfo().then((info) => {
      if (live) setM({ ...info, known: info !== UNKNOWN_MACHINE })
    })
    return () => {
      live = false
    }
  }, [])
  return m
}
