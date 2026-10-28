import { create } from "zustand";

/** Memory-only session: never saved inside a service, settings.json or diagnostic export. */
export interface EngageHostSession {
  endpoint: string;
  code: string;
  hostToken: string;
  joinUrl: string;
  screenUrl: string;
  quizItemId: string;
}
interface HostState {
  session: EngageHostSession | null;
  setSession: (session: EngageHostSession | null) => void;
}
export const useEngageHost = create<HostState>(set => ({
  session: null,
  setSession: session => set({ session }),
}));
