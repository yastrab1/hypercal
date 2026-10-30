export function continuousFor(view, phone) {
  return (
    (phone ? view?.continuousScrollPhone : view?.continuousScrollWeb) ??
    view?.continuousScroll ??
    true
  );
}
