import { useEffect, useRef, useState, type RefObject } from "react";
// Pointer motion updates only compositor transforms. React renders at gesture
// start/end, never for every pointer sample of the calendar underneath.
export function useDrawerGesture(
  enabled: boolean,
  open: boolean,
  onChange: (open: boolean) => void,
  drawer: RefObject<HTMLElement | null>,
  shade: RefObject<HTMLButtonElement | null>,
) {
  const [dragging, setDragging] = useState(false);
  const width = Math.min(320, window.innerWidth * 0.88);
  const suppressUntil = useRef(0);
  useEffect(() => {
    if (!enabled) {
      setDragging(false);
      return;
    }
    let gesture: {
      x: number;
      y: number;
      start: number;
      lastX: number;
      lastTime: number;
      velocity: number;
      active: boolean;
      offset: number;
    } | null = null;
    let frame = 0,
      settle: ReturnType<typeof setTimeout> | undefined;
    const cleanupStyles = () => {
      if (drawer.current) {
        drawer.current.style.removeProperty("transform");
        drawer.current.style.removeProperty("transition");
        drawer.current.style.removeProperty("will-change");
      }
      if (shade.current) {
        shade.current.style.removeProperty("opacity");
        shade.current.style.removeProperty("visibility");
      }
    };
    const draw = () => {
      frame = 0;
      if (!gesture) return;
      drawer.current?.style.setProperty(
        "transform",
        `translate3d(${gesture.offset - width}px,0,0)`,
      );
      if (shade.current) {
        shade.current.style.opacity = String(gesture.offset / width);
        shade.current.style.visibility = "visible";
      }
    };
    const down = (e: PointerEvent) => {
      if (
        e.button !== 0 ||
        !e.isPrimary ||
        (!open && e.clientX > 28) ||
        (open && e.clientX > width) ||
        (e.target as HTMLElement).closest("input,select,textarea")
      )
        return;
      clearTimeout(settle);
      gesture = {
        x: e.clientX,
        y: e.clientY,
        start: performance.now(),
        lastX: e.clientX,
        lastTime: performance.now(),
        velocity: 0,
        active: false,
        offset: open ? width : 0,
      };
    };
    const move = (e: PointerEvent) => {
      if (!gesture) return;
      const dx = e.clientX - gesture.x,
        dy = e.clientY - gesture.y;
      if (!gesture.active) {
        if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
          gesture = null;
          return;
        }
        if (Math.abs(dx) < 5 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
        gesture.active = true;
        setDragging(true);
        drawer.current?.style.setProperty("transition", "none");
        drawer.current?.style.setProperty("will-change", "transform");
      }
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      gesture.velocity =
        (e.clientX - gesture.lastX) / Math.max(1, now - gesture.lastTime);
      gesture.lastX = e.clientX;
      gesture.lastTime = now;
      gesture.offset = Math.max(0, Math.min(width, (open ? width : 0) + dx));
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const finish = (e: PointerEvent) => {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      cancelAnimationFrame(frame);
      frame = 0;
      if (!g.active) return;
      const velocity = performance.now() - g.lastTime < 100 ? g.velocity : 0;
      const next =
        Math.abs(velocity) > 0.35 ? velocity > 0 : g.offset > width * 0.36;
      onChange(next);
      setDragging(false);
      suppressUntil.current = performance.now() + 250;
      // Snap only the short remaining distance after the finger releases.
      if (drawer.current) {
        drawer.current.style.transition =
          "transform 120ms cubic-bezier(.2,.8,.2,1)";
        drawer.current.style.transform = `translate3d(${next ? 0 : -width}px,0,0)`;
      }
      if (shade.current) shade.current.style.opacity = next ? "1" : "0";
      settle = setTimeout(cleanupStyles, 130);
    };
    const cancel = () => {
      gesture = null;
      cancelAnimationFrame(frame);
      setDragging(false);
      cleanupStyles();
    };
    const click = (e: MouseEvent) => {
      if (performance.now() < suppressUntil.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("click", click, true);
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      cleanupStyles();
    };
  }, [enabled, open, onChange, width, drawer, shade]);
  return { width, dragging };
}
