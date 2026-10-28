import { create } from "zustand"

/** A device an operator picked in Nearby, carried into the matching setup form for this visit. */
export const useNearbyConnection = create<{ tvAddress: string | null; selectTv: (address: string) => void; clearTv: () => void }>((set) => ({
  tvAddress: null,
  selectTv: (tvAddress) => set({ tvAddress }),
  clearTv: () => set({ tvAddress: null }),
}))
