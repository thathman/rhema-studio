/** How many saved services Home lists (#804 R5); History lists them all. */
export const HOME_RECENT_SERVICES = 3

/** Home's short list: the first few open (not archived) services, in the service store's order; never templates. */
export function recentServices<T extends { archived_at?: string | null; is_template?: boolean }>(programs: readonly T[], limit = HOME_RECENT_SERVICES): T[] {
  return programs.filter((p) => !p.archived_at && !p.is_template).slice(0, limit)
}
