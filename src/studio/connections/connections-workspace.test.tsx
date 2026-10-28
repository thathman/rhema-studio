// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }))

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { invoke } from "@tauri-apps/api/core"
import { ConnectionsWorkspace } from "./connections-workspace"
import { useNearbyConnection } from "./connections-store"
import { ShowOnTv } from "@/components/broadcast/output-editor-dialog"
import { useSettingsStore } from "@/stores/settings-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useRouterHealth } from "@/lib/cameras"
import { useObsStore } from "@/stores/obs-store"
import { useFeedHealthStore } from "@/lib/show-health"
import { useSettingsDialogStore } from "@/lib/settings-dialog"
import { useShellStore } from "@/studio/shell-store"
import { useProductionTab } from "@/studio/production/production-tab"
import { openConnectionsHub } from "./navigation"

const mockedInvoke = vi.mocked(invoke)
let root: Root
let host: HTMLDivElement
const originalOutputs = useBroadcastStore.getState().outputs

async function mount() {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(<ConnectionsWorkspace />))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mockedInvoke.mockReset()
  useSettingsStore.setState({ cameras: [], remoteDevices: [], joinAddress: "", obs: { ...useSettingsStore.getState().obs, enabled: false } })
  useBroadcastStore.setState({ outputs: originalOutputs, outputStatus: {} })
  useRouterHealth.setState({ status: null, checked: false })
  useObsStore.setState({ status: "off" })
  useFeedHealthStore.setState({})
  useNearbyConnection.setState({ tvAddress: null })
  useShellStore.setState({ workspace: "home", outputsDialogOpen: false, goRequest: null })
  useSettingsDialogStore.setState({ isOpen: false, activeSection: "audio" })
  useProductionTab.setState({ requested: null, scene: null })
  mockedInvoke.mockImplementation(async (command) => {
    if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: 8081, caFingerprint: "a".repeat(64), addresses: ["192.168.1.20"], desks: [] }
    if (command === "camera_router_status") return { installed: true, running: false, wanted: false, lanAddress: null, ports: {}, restarts: 0, error: null, paths: [] }
    if (command === "tv_discover" || command === "host_discover") return []
    return null
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  document.body.innerHTML = ""
  useNearbyConnection.setState({ tvAddress: null })
  useSettingsDialogStore.setState({ isOpen: false, activeSection: "audio" })
})

describe("Connections hub (#401)", () => {
  it("offers nearby TV and Rhema host discovery, with camera phones routed to their QR setup", async () => {
    await mount()
    expect(host.textContent).toContain("Nearby")
    expect(host.textContent).toContain("Connected")
    expect(host.textContent).toContain("Issues")
    expect(host.textContent).toContain("Camera phones")
    expect(host.textContent).toContain("Do not advertise for discovery")

    mockedInvoke.mockImplementation(async (command) => {
      if (command === "tv_discover") return [{ name: "Sanctuary TV", address: "192.168.1.61:8095" }]
      if (command === "host_discover") return [{ name: "Rhema · CAC Ikeja", address: "192.168.1.20:8080" }]
      if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: 8081, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      return null
    })
    const scan = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Find nearby devices"))!
    await act(async () => scan.click())

    expect(mockedInvoke).toHaveBeenCalledWith("tv_discover")
    expect(mockedInvoke).toHaveBeenCalledWith("host_discover")
    expect(host.textContent).toContain("Sanctuary TV")
    expect(host.textContent).toContain("Rhema · CAC Ikeja")
  })

  it("reports discovery failures and still presents address or QR recovery paths", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: false, lan: false, port: null, tlsPort: null, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      if (command === "tv_discover") throw new Error("No network")
      if (command === "host_discover") return []
      return null
    })
    await mount()
    const scan = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Find nearby devices"))!
    await act(async () => scan.click())
    expect(host.textContent).toContain("Could not look for TVs")
    expect(host.textContent).toContain("No host found")
    expect(host.textContent).toContain("enter its address")
    expect(host.textContent).toContain("scan its QR code")
  })

  it("routes a selected host to the existing code-pair flow and carries a selected TV into feed setup", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: 8081, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      if (command === "tv_discover") return [{ name: "Sanctuary TV", address: "192.168.1.61:8095" }]
      if (command === "host_discover") return [{ name: "Rhema · CAC Ikeja", address: "192.168.1.20:8080" }]
      return null
    })
    await mount()
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Find nearby devices"))!.click())
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Use this TV"))!.click())
    expect(useNearbyConnection.getState().tvAddress).toBe("192.168.1.61:8095")
    expect(useShellStore.getState().outputsDialogOpen).toBe(true)
    expect(useBroadcastStore.getState().isLive).toBe(false)

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Continue on this host"))!.click())
    expect(useSettingsStore.getState().joinAddress).toBe("192.168.1.20:8080")
    expect(document.body.textContent).toContain("Join a Rhema Studio host")
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="192.168.1.20:8080"]')?.value).toBe("192.168.1.20:8080")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("pre-fills the secured Google TV pairing form with the TV chosen from Connections", async () => {
    useNearbyConnection.getState().selectTv("192.168.1.61:8095")
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root.render(<ShowOnTv url="https://192.168.1.20:8081/feed/hall?k=feed-key" />))
    expect(host.querySelector<HTMLInputElement>("input[aria-label='TV address']")?.value).toBe("192.168.1.61:8095")
    expect(useNearbyConnection.getState().tvAddress).toBeNull()
  })

  it("shows connected status only when the TV, camera router and paired devices report it", async () => {
    const phoneHash = "a".repeat(64)
    const obsHash = "b".repeat(64)
    useSettingsStore.setState({
      cameras: [{ name: "pulpit", label: "Pulpit", token: "p".repeat(32) }],
      remoteDevices: [
        { hash: phoneHash, name: "Stage phone", paired_at: "2026-10-26T00:00:00Z", role: "stage" },
        { hash: obsHash, name: "Stream computer", paired_at: "2026-10-26T00:00:00Z", role: "obs-companion" },
      ],
      obs: { ...useSettingsStore.getState().obs, enabled: true },
    })
    const feed = { ...originalOutputs[0], id: "hall-feed", name: "Hall feed", type: "browser" as const, feedToken: "safe-test-token", tvs: [{ name: "Sanctuary TV", address: "192.168.1.61:8095", sentAt: Date.now() }] }
    useBroadcastStore.setState({ outputs: [...originalOutputs, feed] })
    useObsStore.setState({ status: "connected" })
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: 8081, addresses: [], desks: [
        { hash: phoneHash, name: "Stage phone", address: "192.168.1.71", connected: true, lastSeenMs: Date.now() },
        { hash: obsHash, name: "Stream computer", address: "192.168.1.72", connected: true, lastSeenMs: Date.now() },
      ] }
      if (command === "camera_router_status") return { installed: true, running: true, wanted: true, lanAddress: "192.168.1.20", ports: {}, restarts: 0, error: null, paths: [{ name: "pulpit", live: true, source: "rtspSession", readers: 2, tracks: ["H264"], frozen: false }] }
      if (command === "feed_status") return { watching: 1, seq: 1, acked: 1, tvs: [{ id: "192.168.1.61:8095", watching: 1 }] }
      return null
    })
    await mount()
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(host.textContent).toContain("Sanctuary TV")
    expect(host.textContent).toContain("Showing now")
    expect(host.textContent).toContain("Pulpit")
    expect(host.textContent).toContain("Sending")
    expect(host.textContent).toContain("Stage phone")
    expect(host.textContent).toContain("Connected now")
    expect(host.textContent).toContain("Stream computer")
    expect(host.textContent).toContain("OBS on this computerLocal OBS connectionConnected")
    expect(host.textContent).toContain("Nothing needs attention")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("routes app entry points to the same Connections page", () => {
    openConnectionsHub()
    expect(useShellStore.getState().goRequest).toBe("connections")
  })

  it("pairs phones and OBS computers through the expiring code and local QR flow", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: 8081, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      if (command === "get_http_status") return { running: true, port: 8080, lan: true, tls_port: 8081 }
      if (command === "remote_lan_address") return "192.168.1.20"
      if (command === "remote_pair_start") return "381624"
      return null
    })
    await mount()
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Pair phone, controller or OBS computer"))!.click())
    const start = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Show pairing code")) as HTMLButtonElement
    await act(async () => start.click())
    expect(mockedInvoke).toHaveBeenCalledWith("remote_pair_start")
    expect(document.body.querySelector('[aria-label="Pairing code"]')?.textContent).toBe("381624")
    await vi.waitFor(() => expect(document.body.querySelector('img[alt="Pairing link QR code"]')).not.toBeNull())
    expect(document.body.textContent).toContain("OBS Companion computer")
    expect(document.body.textContent).toContain("within two minutes")
    expect(document.body.textContent).toContain("Encrypted link · HTTPS")
    expect(document.body.textContent).not.toContain("Not encrypted")
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("warns when LAN pairing uses HTTP and links directly to the secure phone-page setting", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: null, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      if (command === "get_http_status") return { running: true, port: 8080, lan: true, tls_port: null }
      if (command === "remote_lan_address") return "192.168.1.20"
      if (command === "remote_pair_start") return "381624"
      return null
    })
    await mount()
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Pair phone, controller or OBS computer"))!.click())
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Show pairing code"))!.click())

    expect(document.body.textContent).toContain("Not encrypted")
    expect(document.body.textContent).toContain("HTTP")
    expect(document.body.textContent).toContain("Anyone monitoring the church network could observe the pairing traffic")
    expect(document.querySelector('[aria-label="Pairing security"] [role="status"]')?.textContent).toContain("Not encrypted · HTTP")
    expect(document.body.querySelector('[aria-label="Pairing code"]')?.textContent).toBe("381624")
    await vi.waitFor(() => expect(document.body.querySelector('img[alt="Pairing link QR code"]')).not.toBeNull())

    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Open secure phone setting"))!.click())
    await vi.waitFor(() => {
      expect(useSettingsDialogStore.getState().isOpen).toBe(true)
      expect(useSettingsDialogStore.getState().activeSection).toBe("remote")
    })
    expect(useBroadcastStore.getState().isLive).toBe(false)
  })

  it("does not start pairing while the host listener is off and offers the settings recovery route", async () => {
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: false, lan: false, port: null, tlsPort: null, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      if (command === "get_http_status") return { running: false, port: null, lan: false }
      return null
    })
    await mount()
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Pair phone, controller or OBS computer"))!.click())
    const start = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Show pairing code")) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(document.body.textContent).toContain("The network listener is off")
    expect(document.body.textContent).toContain("Open network settings")
    expect(mockedInvoke).not.toHaveBeenCalledWith("remote_pair_start")
  })

  it("rechecks the listener after network settings change", async () => {
    let listenerOn = false
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "host_status") return { running: true, lan: true, port: 8080, tlsPort: 8081, addresses: [], desks: [] }
      if (command === "camera_router_status") return null
      if (command === "get_http_status") return listenerOn ? { running: true, port: 8080, lan: true, tls_port: 8081 } : { running: false, port: null, lan: false }
      return null
    })
    await mount()
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Pair phone, controller or OBS computer"))!.click())
    expect([...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Show pairing code"))?.disabled).toBe(true)

    listenerOn = true
    await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Check again"))!.click())
    expect([...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Show pairing code"))?.disabled).toBe(false)
  })

  it("opens the existing phone camera QR setup from Connections", async () => {
    await mount()
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Set up")!.click())
    expect(document.body.textContent).toContain("Connect church cameras")
    expect(document.body.textContent).toContain("Camera router")
    expect(document.body.textContent).toContain("Add a camera")
  })
})
