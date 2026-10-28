import { createCalendarCache } from "./cache.mjs";
// Cache failures (quota/private browsing) must never prevent normal API use.
const emptyStorage: Storage = {
  length: 0,
  clear() {},
  getItem() {
    return null;
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {},
};
let storage = emptyStorage;
try {
  storage = window.localStorage;
} catch {}
export const calendarCache = createCalendarCache(storage);
