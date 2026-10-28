import { DatabaseSync } from "node:sqlite";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { chmodSync } from "node:fs";
export const tokenHash = (token) =>
  createHash("sha256").update(token).digest("hex");
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status, expose: true });
};
export class SharedStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS shared_views (id TEXT PRIMARY KEY, document TEXT NOT NULL)",
    );
  }
  all() {
    return this.db
      .prepare("SELECT document FROM shared_views")
      .all()
      .map((r) => JSON.parse(r.document));
  }
  get(id) {
    const row = this.db
      .prepare("SELECT document FROM shared_views WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.document) : null;
  }
  member(id, user) {
    const v = this.get(id);
    if (!v?.members[user]) fail(404, "Shared view not found.");
    return v;
  }
  owner(id, user) {
    const v = this.member(id, user);
    if (v.ownerId !== user) fail(403, "Only the owner can manage this view.");
    return v;
  }
  list(user) {
    return this.all().filter((v) => v.members[user]);
  }
  create(user, email, definition) {
    if (this.list(user).length >= 50)
      fail(400, "You can join up to 50 shared views.");
    const v = {
      ...definition,
      id: randomUUID(),
      schemaVersion: 1,
      ownerId: user,
      members: { [user]: { email, contributions: [] } },
      invitations: [],
      links: [],
      createdAt: Date.now(),
    };
    this.db
      .prepare("INSERT INTO shared_views VALUES (?,?)")
      .run(v.id, JSON.stringify(v));
    return v;
  }
  mutate(id, fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = this.get(id);
      if (!v) fail(404, "Shared view not found.");
      const result = fn(v);
      this.db
        .prepare("UPDATE shared_views SET document=? WHERE id=?")
        .run(JSON.stringify(v), id);
      this.db.exec("COMMIT");
      return result ?? v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  invite(id, user, email) {
    this.owner(id, user);
    const token = randomBytes(32).toString("base64url");
    this.mutate(id, (v) => {
      if (Object.keys(v.members).length >= 10)
        fail(400, "This view supports up to 10 members.");
      v.invitations = v.invitations.filter(
        (i) => i.email !== email && i.expiresAt > Date.now() && !i.usedAt,
      );
      v.invitations.push({
        id: randomUUID(),
        email,
        hash: tokenHash(token),
        expiresAt: Date.now() + 7 * 86400000,
      });
    });
    return token;
  }
  invitation(token) {
    const hash = tokenHash(token);
    const v = this.all().find((v) =>
      v.invitations.some(
        (i) => i.hash === hash && !i.usedAt && i.expiresAt > Date.now(),
      ),
    );
    if (!v) fail(404, "This invitation expired or was revoked.");
    return v;
  }
  accept(token, user, email) {
    const found = this.invitation(token);
    return this.mutate(found.id, (v) => {
      const i = v.invitations.find(
        (i) =>
          i.hash === tokenHash(token) && !i.usedAt && i.expiresAt > Date.now(),
      );
      if (!i) fail(404, "This invitation expired or was used.");
      if (i.email !== email.toLowerCase())
        fail(
          403,
          "Sign in with the Google account this invitation was addressed to.",
        );
      if (Object.keys(v.members).length >= 10 && !v.members[user])
        fail(400, "This view is full.");
      v.members[user] ??= { email, contributions: [] };
      i.usedAt = Date.now();
    });
  }
  link(id, user, scope) {
    this.owner(id, user);
    const token = randomBytes(32).toString("base64url");
    this.mutate(id, (v) => {
      v.links = v.links.filter((l) => l.expiresAt > Date.now());
      if (v.links.length >= 20) fail(400, "Revoke an existing link first.");
      v.links.push({
        id: randomUUID(),
        hash: tokenHash(token),
        scope,
        expiresAt: Date.now() + 30 * 86400000,
      });
    });
    return token;
  }
  publicView(token, scope) {
    const hash = tokenHash(token);
    const v = this.all().find((v) =>
      v.links.some(
        (l) => l.hash === hash && l.scope === scope && l.expiresAt > Date.now(),
      ),
    );
    if (!v) fail(404, "This link expired or was revoked.");
    return v;
  }
  delete(id, user) {
    this.owner(id, user);
    this.db.prepare("DELETE FROM shared_views WHERE id=?").run(id);
  }
  close() {
    this.db.close();
  }
}
