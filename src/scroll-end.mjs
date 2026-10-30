// Let the browser finish touch/trackpad inertia. An idle timeout alone can
// mistake a pause with a finger still down for the end of a gesture.
export function observeScrollEnd(element, settle) {
  let touching = false;
  let timer;
  let disposed = false;
  const native = "onscrollend" in element;
  const clear = () => clearTimeout(timer);
  const finish = () => {
    clear();
    if (!touching && !disposed) settle();
  };
  const fallback = () => {
    clear();
    timer = setTimeout(finish, 280);
  };
  const scroll = () => {
    if (native) clear();
    else fallback();
  };
  const start = () => {
    touching = true;
    clear();
  };
  const end = (event) => {
    touching = event.touches.length > 0;
    // Also covers a touch that stops an ongoing fling without another scroll.
    if (!touching) fallback();
  };
  const handlers = {
    scroll,
    scrollend: finish,
    touchstart: start,
    touchend: end,
    touchcancel: end,
    wheel: clear,
  };
  for (const [name, handler] of Object.entries(handlers))
    element.addEventListener(name, handler, { passive: true });
  return () => {
    disposed = true;
    clear();
    for (const [name, handler] of Object.entries(handlers))
      element.removeEventListener(name, handler);
  };
}
