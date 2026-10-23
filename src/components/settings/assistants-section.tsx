import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * AI assistants (Rhema MCP, #252): an assistant that speaks the Model Context Protocol (Claude
 * Desktop or Claude Code, for example) can read this church's services, songs and hymns and the
 * installed Bible editions to plan a service. Off by default; read-only; runs on this computer.
 */
export function AssistantsSection() {
  const enabled = useSettingsStore((s) => s.mcpEnabled)
  const [command, setCommand] = useState<string | null>(null)
  useEffect(() => {
    void invoke<string>("mcp_server_command").then(setCommand).catch(() => setCommand(null))
  }, [])
  const config = JSON.stringify({ mcpServers: { "rhema-studio": { command: command ?? "/Applications/Rhema.app/Contents/MacOS/Rhema", args: ["--mcp"] } } }, null, 2)
  const copy = () => navigator.clipboard.writeText(config).then(() => toast.success("Copied", { description: "Paste it into the assistant's MCP settings." })).catch(() => toast.error("Could not copy: select the text instead."))
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        An AI assistant that supports MCP can read this church's saved services and templates, the song library and hymn book (titles, numbers, authors and licences; never lyrics) and the Bible editions installed here, to help plan a service. Scripture it quotes comes from these editions.
      </p>
      <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <span>
          <span className="block font-medium">Let AI assistants read Rhema</span>
          <span className="block text-xs text-muted-foreground">Read-only: an assistant cannot change a service, a song, a setting or anything on a screen. Off: it is told to ask you to turn this on.</span>
        </span>
        <Switch checked={enabled} onCheckedChange={(on) => useSettingsStore.getState().setMcpEnabled(on)} aria-label="Let AI assistants read Rhema" />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold">Add Rhema to the assistant's MCP settings</span>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-[0.6875rem] leading-relaxed select-all">{config}</pre>
        <div><Button size="sm" variant="outline" onClick={() => void copy()}>Copy</Button></div>
      </div>
      <p className="text-xs text-muted-foreground">
        The assistant starts Rhema in the background on this computer and talks to it directly; Rhema itself sends nothing anywhere. What the assistant does with what it reads is up to the assistant and its provider: an online assistant sends your questions and these answers to its own service. Turning this off takes effect the next time the assistant starts Rhema.
      </p>
    </div>
  )
}
