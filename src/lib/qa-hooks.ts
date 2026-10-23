/**
 * QA bridge hooks (see src-tauri/src/qa_bridge.rs): the app's stores, reached
 * by acceptance scripts only when the bridge has switched QA mode on in this
 * window. Normal runs never set `__RHEMA_QA__`, so this returns nothing.
 */
import { useVoice, hostTalk, TalkClient, setVoiceVolume, setHostChannels } from "@/lib/voice"
import { useBibleStore } from "@/stores/bible-store"
import { useBroadcastStore } from "@/stores/broadcast-store"
import { useQueueStore } from "@/stores/queue-store"
import { useServiceStore } from "@/stores/service-store"
import { useSongStore } from "@/stores/song-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useMediaStore } from "@/stores/media-store"
import { useJournalStore } from "@/stores/journal-store"
import { useApprovalGateStore } from "@/stores/approval-gate-store"
import { useEventClock } from "@/stores/event-clock-store"
import { useShellStore } from "@/studio/shell-store"
import { presentActions } from "@/studio/present-actions"
import { remoteActions } from "@/lib/remote-actions"

declare global {
  interface Window {
    __RHEMA_QA__?: boolean
    __rhemaQa?: () => Record<string, unknown> | undefined
  }
}

window.__rhemaQa = () =>
  window.__RHEMA_QA__
    ? {
        bible: useBibleStore, broadcast: useBroadcastStore, queue: useQueueStore, service: useServiceStore, songs: useSongStore,
        settings: useSettingsStore, media: useMediaStore, journal: useJournalStore, gate: useApprovalGateStore, shell: useShellStore,
        present: presentActions, remote: remoteActions, eventClock: useEventClock, voice: { useVoice, hostTalk, TalkClient, setVoiceVolume, setHostChannels },
      }
    : undefined
