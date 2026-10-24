/**
 * A host's certificate fingerprint as people compare it (#209): Rhema Companion shows it before
 * pairing, the host shows it in Settings → Remote control. The first 20 of its 64 hex characters,
 * in groups of four ("3F2A 9C11 07BD 44E0 A1C3"): enough to tell two computers apart by eye.
 */
export function certificateWords(fingerprint: string): string {
  const hex = fingerprint.replace(/[^0-9a-f]/gi, "").toUpperCase().slice(0, 20)
  return hex.match(/.{1,4}/g)?.join(" ") ?? ""
}

/** What Rhema Companion keeps about the host it paired with (companion.json). */
export interface PairedHost {
  address: string
  tlsPort: number
  certificate: string
}
