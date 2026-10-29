// Share only concurrent reads. No TTL or retained responses: access changes and
// manual refreshes still reach Google on the next request.
export function createSingleFlight() {
  const pending = new Map();
  const run = (key, load) => {
    if (pending.has(key)) return pending.get(key);
    const request = Promise.resolve().then(load);
    pending.set(key, request);
    const clear = () => {
      if (pending.get(key) === request) pending.delete(key);
    };
    request.then(clear, clear);
    return request;
  };
  run.invalidate = (matches) => {
    for (const key of pending.keys()) if (matches(key)) pending.delete(key);
  };
  return run;
}
