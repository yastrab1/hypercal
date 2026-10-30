// One month per horizontal trackpad gesture, including its momentum tail.
// Vertical/diagonal week-row scrolling remains entirely native.
export function observeMonthWheel(element, onStep) {
  let x = 0,
    y = 0,
    axis = null,
    moved = false,
    timer;
  const reset = () => {
    x = 0;
    y = 0;
    axis = null;
    moved = false;
  };
  const wheel = (event) => {
    if (event.ctrlKey) return; // Preserve browser pinch-to-zoom.
    clearTimeout(timer);
    timer = setTimeout(reset, 280);
    const scale =
      event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? element.clientWidth
          : 1;
    x += event.deltaX * scale;
    y += event.deltaY * scale;
    if (!axis && Math.max(Math.abs(x), Math.abs(y)) > 6)
      axis = Math.abs(x) > Math.abs(y) * 1.35 ? "x" : "y";
    if (axis !== "x") return;
    event.preventDefault();
    if (!moved && Math.abs(x) >= 48) {
      moved = true;
      onStep(x > 0 ? 1 : -1);
    }
  };
  element.addEventListener("wheel", wheel, { passive: false });
  return () => {
    clearTimeout(timer);
    element.removeEventListener("wheel", wheel);
  };
}
