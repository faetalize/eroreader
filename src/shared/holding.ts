// Whether the pointer is pressed on `control`, e.g. a slider being dragged. A control in the
// user's hand is never set from outside: settings arriving meanwhile can only be older.
export function holding(control: HTMLElement): () => boolean {
  let held = false;
  control.addEventListener("pointerdown", () => (held = true));
  const release = () => (held = false);
  control.addEventListener("pointerup", release);
  control.addEventListener("pointercancel", release);
  control.addEventListener("lostpointercapture", release);
  control.ownerDocument.addEventListener("pointerup", release, true);
  return () => held;
}
