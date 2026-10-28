import { useEffect, type RefObject } from "react";
export function usePeriodGesture(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onMove: (step: number) => void,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; time: number } | null = null;
    let horizontal = false,
      suppress = 0;
    const down = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        !e.isPrimary ||
        e.clientX < 32 ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[data-no-period-swipe]",
        )
      )
        return;
      start = { x: e.clientX, y: e.clientY, time: performance.now() };
      horizontal = false;
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (!horizontal && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        start = null;
        return;
      }
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.35)
        horizontal = true;
      if (horizontal && e.cancelable) e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - start.time);
      if (
        horizontal &&
        Math.abs(dx) > Math.abs(dy) * 1.35 &&
        (Math.abs(dx) > 55 || (Math.abs(dx) > 28 && speed > 0.4))
      ) {
        onMove(dx < 0 ? 1 : -1);
        suppress = performance.now() + 300;
      }
      start = null;
    };
    const cancel = () => {
      start = null;
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < suppress) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("pointerdown", down, { passive: true });
    el.addEventListener("pointermove", move, { passive: false });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("click", click, true);
    };
  }, [ref, enabled, onMove]);
}
