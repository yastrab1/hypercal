import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
export const dataDir = resolve(process.env.DATA_DIR || ".data");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const file = join(dataDir, "accounts.json");
let db;
try {
  db = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  db = { accounts: {} };
}
function save() {
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}
export function getAccount(id) {
  return db.accounts[id];
}
export function upsertAccount(id, patch) {
  db.accounts[id] = {
    views: [],
    subscriptions: [],
    ...db.accounts[id],
    ...patch,
  };
  save();
  return db.accounts[id];
}
export function addItem(id, kind, item) {
  const account = getAccount(id);
  const result = { ...item, id: randomUUID() };
  account[kind].push(result);
  save();
  return result;
}
export function updateItem(id, kind, itemId, patch) {
  const account = getAccount(id);
  const i = account[kind].findIndex((x) => x.id === itemId);
  if (i < 0) return null;
  account[kind][i] = { ...account[kind][i], ...patch, id: itemId };
  save();
  return account[kind][i];
}
export function removeItem(id, kind, itemId) {
  const a = getAccount(id);
  a[kind] = a[kind].filter((x) => x.id !== itemId);
  save();
}

export function saveViewDefinition(id, item, itemId) {
  const account = getAccount(id);
  if (itemId && !account.views.some((v) => v.id === itemId)) return null;
  if (item.isDefault)
    account.views = account.views.map((v) =>
      v.layout === item.layout ? { ...v, isDefault: false } : v,
    );
  return itemId
    ? updateItem(id, "views", itemId, item)
    : addItem(id, "views", item);
}
export function setLayoutDefault(id, layout, viewId) {
  const account = getAccount(id);
  if (
    viewId &&
    !account.views.some((v) => v.id === viewId && v.layout === layout)
  )
    return null;
  account.views = account.views.map((v) =>
    v.layout === layout ? { ...v, isDefault: v.id === viewId } : v,
  );
  save();
  return account.views;
}
export function listAccountIds() {
  return Object.keys(db.accounts);
}
