/** "Friday 6 pm · Main hall" on its own line above the details. An announcement is a plain slide. */
export function announcementBody(when: string, where: string, details: string): string {
  const meta = [when.trim(), where.trim()].filter(Boolean).join(" · ")
  return [meta, details.trim()].filter(Boolean).join("\n")
}
