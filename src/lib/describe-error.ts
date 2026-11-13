/**
 * Words for an error a person can read: its message (from an Error, or a host error object with a
 * message), never "[object Object]" or a raw type name (UX audit §5.6).
 */
export function describeError(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message)
  return e instanceof Error ? e.message : String(e)
}
