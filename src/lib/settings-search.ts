import type { SettingsSection } from "@/lib/settings-dialog"

/**
 * What Settings search looks through: each section's visible labels first (the words a
 * volunteer sees), then other words people use for the same thing. Keep the labels in step
 * with the section when its wording changes.
 */
export const SETTINGS_SEARCH_INDEX: Record<SettingsSection, { labels: string[]; keywords: string[] }> = {
  bible: {
    labels: ["Primary Translation", "Secondary Translation", "English", "Other Languages"],
    keywords: ["bible", "version", "edition", "language", "yoruba", "bilingual", "second language", "kjv", "scripture"],
  },
  screens: {
    labels: ["Open outputs", "Where each look is used (Design)"],
    keywords: ["outputs", "screens", "ndi", "projector", "stage screen", "signage", "display", "monitor", "obs", "congregation", "look"],
  },
  display: {
    labels: ["Heard verses", "Wait for me (recommended)", "Bible feeds only", "Auto"],
    keywords: ["auto-live", "auto live", "detection", "detected verse", "take live", "confidence", "automatic"],
  },
  audio: {
    labels: ["Input Device", "Test Input", "Input Gain", "Talk headset"],
    keywords: ["microphone", "mic", "sound", "level", "volume", "gain", "audio", "headset", "headphones", "talk", "intercom", "comms"],
  },
  speech: {
    labels: ["Provider", "Cloud (Deepgram)", "Local (Whisper)", "Deepgram API Key", "Withdraw"],
    keywords: ["transcription", "listening", "speech", "api key", "cloud keys", "key", "offline", "consent"],
  },
  remote: {
    labels: [
      "Accept commands from other devices on this network",
      "Secure page for phones (https)",
      "Require a key or a paired device",
      "Key the controller must send (optional)",
      "Paired devices",
      "Pair a device",
      "Connect to OBS (recording status, marks and OBS's scenes)",
      "OSC (Open Sound Control)",
      "HTTP API",
      "Port",
      "Firewall Note",
      "Command Log",
    ],
    keywords: ["remote", "phone", "tablet", "stream deck", "companion", "network", "lan", "wi-fi", "obs", "obs scenes", "studio mode", "password", "pairing", "talk"],
  },
  assistants: {
    labels: ["Let AI assistants read Rhema", "Add Rhema to the assistant's MCP settings", "Copy"],
    keywords: ["ai", "mcp", "assistant", "claude", "chatgpt"],
  },
  diagnostics: {
    labels: ["Time range", "Save logs…", "Version", "Log folder"],
    keywords: ["logs", "bug report", "support", "problem", "crash"],
  },
  help: {
    labels: ["Interactive Tutorial", "Keyboard Shortcuts", "About"],
    keywords: ["help", "tour", "walkthrough", "shortcuts", "licence", "credits", "version"],
  },
}

/** Lower case without accents, so "yoruba" finds "Yorùbá" and "Gain" finds "gain". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

/** The words of a search, folded. */
export function searchWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** True when every word of the search is in the text (an empty search matches everything). */
export function matchesSearch(text: string, words: readonly string[]): boolean {
  const folded = fold(text)
  return words.every((w) => folded.includes(w))
}

export interface SettingsSearchHit {
  id: SettingsSection
  /** The section's visible labels that hold every word, to show under its name. */
  labels: string[]
}

/**
 * The sections a search finds, in the order given. A section is found when all the words
 * appear somewhere in its name, its title, its labels or its keywords.
 */
export function searchSettings(
  query: string,
  sections: ReadonlyArray<{ id: SettingsSection; name: string; title: string }>,
): SettingsSearchHit[] {
  const words = searchWords(query)
  return sections.flatMap(({ id, name, title }) => {
    const { labels, keywords } = SETTINGS_SEARCH_INDEX[id]
    if (!matchesSearch([name, title, ...labels, ...keywords].join(" \n "), words)) return []
    return [{ id, labels: words.length ? labels.filter((l) => matchesSearch(l, words)) : [] }]
  })
}

/** Things people look for in Settings that live on their own page (#215): Settings search points there. */
export type ElsewhereId = "church" | "appearance" | "cameras" | "hosting" | "service-defaults" | "backups"

export interface ElsewhereEntry {
  id: ElsewhereId
  /** What it is, as the row says it. */
  name: string
  /** Where it lives, as the row says it ("Design → Brand kit"). */
  where: string
  keywords: string[]
}

export const SETTINGS_ELSEWHERE: readonly ElsewhereEntry[] = [
  { id: "church", name: "Church name, logo and colours", where: "Design → Brand kit", keywords: ["church", "church name", "identity", "logo", "brand", "brand kit", "colours", "colors", "fonts", "general"] },
  { id: "appearance", name: "Light, dark or system", where: "Desk menu, at the foot of the sidebar", keywords: ["appearance", "light", "dark", "dark mode", "light mode", "system", "theme", "night"] },
  { id: "cameras", name: "Cameras and the camera router", where: "Production → Cameras", keywords: ["camera", "cameras", "camera router", "mediamtx", "whep", "video", "pulpit", "phone camera"] },
  { id: "hosting", name: "Host or join, roles and the talk channel", where: "Production → Operators", keywords: ["host", "join", "hosting", "roles", "role", "operators", "volunteers", "desks", "another computer", "permissions", "crew"] },
  { id: "service-defaults", name: "Approvals before a service goes live", where: "Team → Approvals", keywords: ["service defaults", "approval", "approvals", "approve", "unapproved", "ask before", "defaults", "operator name", "your name"] },
  { id: "backups", name: "Backups and the church folder", where: "Archive", keywords: ["backup", "backups", "back up", "restore", "church folder", "archive", "export", "import", "data", "nas", "sync"] },
]

/** The pages elsewhere that a search finds (none for an empty search: those are not Settings). */
export function searchElsewhere(query: string): ElsewhereEntry[] {
  const words = searchWords(query)
  if (words.length === 0) return []
  return SETTINGS_ELSEWHERE.filter((e) => matchesSearch([e.name, e.where, ...e.keywords].join(" \n "), words))
}

/** Labels this short or shorter can be marked; whole paragraphs are not, or everything would light up. */
const LABEL_LENGTH = 80

/**
 * Marks (data-search-hit) the labels, names and buttons inside `box` whose own words hold the
 * search, and clears the marks of an earlier one. Nothing is marked for an empty search.
 */
export function markSearchHits(box: HTMLElement, words: readonly string[]): void {
  for (const el of box.querySelectorAll("[data-search-hit]")) el.removeAttribute("data-search-hit")
  if (words.length === 0) return
  for (const el of box.querySelectorAll<HTMLElement>("label, span, p, button, h3, h4, div")) {
    const own = Array.from(el.childNodes, (n) => (n.nodeType === Node.TEXT_NODE ? n.textContent : "")).join("").trim()
    if (own && own.length <= LABEL_LENGTH && matchesSearch(own, words)) el.setAttribute("data-search-hit", "")
  }
}
