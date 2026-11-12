/** One server-sent event: its name ("message" when the host names none) and its data. */
export interface SseEvent {
  event: string
  data: string
}

/**
 * Reads the host's `/api/v1/live/events` stream as it arrives (#845 G1). A browser's EventSource
 * cannot send the desk's key, so the desk reads the stream with `fetch` and this parser: text in
 * any chunks, whole events out. Comments (the host's keep-alive) and fields other than `event` and
 * `data` are skipped; an event is complete at its blank line.
 */
export class SseParser {
  private buffer = ""
  private event = ""
  private data: string[] = []

  /** Feed the next chunk of text; returns the events it completed. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const out: SseEvent[] = []
    for (;;) {
      const end = this.buffer.search(/\r\n|\r|\n/)
      // A "\r" at the very end may be half of a "\r\n" split across chunks: wait for the next one.
      if (end < 0 || (this.buffer[end] === "\r" && end === this.buffer.length - 1)) break
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + (this.buffer.startsWith("\r\n", end) ? 2 : 1))
      if (line === "") {
        if (this.data.length) out.push({ event: this.event || "message", data: this.data.join("\n") })
        this.event = ""
        this.data = []
        continue
      }
      if (line.startsWith(":")) continue
      const colon = line.indexOf(":")
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? "" : line.slice(colon + 1)
      if (value.startsWith(" ")) value = value.slice(1)
      if (field === "event") this.event = value
      else if (field === "data") this.data.push(value)
    }
    return out
  }
}
