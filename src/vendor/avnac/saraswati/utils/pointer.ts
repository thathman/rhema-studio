export function pointerIsTouch(e: Event): boolean {
  return "pointerType" in e && (e as PointerEvent).pointerType === "touch";
}
