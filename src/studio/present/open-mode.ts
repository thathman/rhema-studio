export interface ListenerStatus {
  running: boolean
  /** The listener's actual scope, as the host reports it. */
  lan?: boolean
}

export interface AuthStatus {
  required: boolean
}

/** How often Live re-reads the host's listener and key state. */
export const OPEN_MODE_POLL_MS = 3000

/**
 * Open mode (#839 S15, owner decision 11 Nov): remote keys are off and a command listener (HTTP or
 * OSC) is reachable from the LAN, so any device on the network can read everything and send every
 * command except group Take and Record, Configure included. The host's own state decides it, never
 * the saved settings: what is running is what is reachable.
 */
export function isOpenMode(http: ListenerStatus | null, osc: ListenerStatus | null, auth: AuthStatus | null): boolean {
  const onLan = (s: ListenerStatus | null) => !!s?.running && s.lan === true
  return (onLan(http) || onLan(osc)) && !!auth && auth.required === false
}
