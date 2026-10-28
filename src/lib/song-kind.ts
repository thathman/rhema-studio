/** A choir ministration is a song the choir sings to the church, kept in the same library, marked by this tag. */
export const CHOIR_TAG = "choir"

const parts = (tags: string | undefined) => (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean)

export const isChoir = (tags: string | undefined) => parts(tags).some((t) => t.toLowerCase() === CHOIR_TAG)

/** The tags with the choir mark added or removed; the others kept as they are. */
export function withChoir(tags: string | undefined, on: boolean): string {
  const rest = parts(tags).filter((t) => t.toLowerCase() !== CHOIR_TAG)
  return (on ? [CHOIR_TAG, ...rest] : rest).join(", ")
}
