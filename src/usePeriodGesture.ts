import { useEffect, type RefObject } from "react";
import { flushSync } from "react-dom";

// Only transforms change while dragging; React renders the adjacent pages once.
export function usePeriodGesture(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onMove: (step: number) => void,
  onPreview: (visible: boolean) => void,
) {
  useEffect(() => {
    const surface = ref.current;
    const track = surface?.querySelector<HTMLElement>(".period-track");
    if (!surface || !track || !enabled) return;
    let start: { x: number; y: number; time: number; id: number } | null = null;
    let horizontal = false,
      suppress = 0,
      frame = 0,
      offset = 0;
    let animation: Animation | null = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = () => {
      frame = 0;
      track.style.transform = `translate3d(${offset}px,0,0)`;
    };
    const settle = (step: number) => {
      if (frame) {
        cancelAnimationFrame(frame);
        paint();
      }
      const target = step ? -step * surface.clientWidth : 0;
      const finish = () => {
        flushSync(() => {
          if (step) onMove(step);
          onPreview(false);
        });
        track.style.transform = "";
        track.style.willChange = "";
        animation?.cancel();
        animation = null;
      };
      if (reduced) {
        finish();
        return;
      }
      animation = track.animate(
        [
          { transform: `translate3d(${offset}px,0,0)` },
          { transform: `translate3d(${target}px,0,0)` },
        ],
        { duration: 220, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" },
      );
      animation.onfinish = finish;
    };
    const down = (e: PointerEvent) => {
      if (
        animation ||
        e.button !== 0 ||
        !e.isPrimary ||
        e.clientX < 32 ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[data-no-period-swipe]",
        )
      )
        return;
      start = {
        x: e.clientX,
        y: e.clientY,
        time: performance.now(),
        id: e.pointerId,
      };
      horizontal = false;
      offset = 0;
    };
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (!horizontal && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        start = null;
        return;
      }
      if (
        !horizontal &&
        Math.abs(dx) > 10 &&
        Math.abs(dx) > Math.abs(dy) * 1.35
      ) {
        horizontal = true;
        track.style.willChange = "transform";
        surface.setPointerCapture(e.pointerId);
        flushSync(() => onPreview(true));
      }
      if (!horizontal) return;
      if (e.cancelable) e.preventDefault();
      offset = Math.max(
        -surface.clientWidth,
        Math.min(surface.clientWidth, dx),
      );
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - start.time);
      start = null;
      if (!horizontal) return;
      suppress = performance.now() + 350;
      const commit =
        Math.abs(dx) > surface.clientWidth * 0.2 ||
        (Math.abs(dx) > 28 && speed > 0.4);
      settle(commit ? (dx < 0 ? 1 : -1) : 0);
    };
    const cancel = () => {
      if (horizontal && start) {
        start = null;
        settle(0);
      } else start = null;
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < suppress) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    surface.addEventListener("pointerdown", down, { passive: true });
    surface.addEventListener("pointermove", move, { passive: false });
    surface.addEventListener("pointerup", up);
    surface.addEventListener("pointercancel", cancel);
    surface.addEventListener("click", click, true);
    return () => {
      cancelAnimationFrame(frame);
      animation?.cancel();
      track.style.transform = "";
      track.style.willChange = "";
      surface.removeEventListener("pointerdown", down);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerup", up);
      surface.removeEventListener("pointercancel", cancel);
      surface.removeEventListener("click", click, true);
    };
  }, [ref, enabled, onMove, onPreview]);
}
