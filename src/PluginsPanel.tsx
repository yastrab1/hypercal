import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ExternalLink, Plus, Puzzle } from "lucide-react";
import { api } from "./api";
import type { Calendar } from "./types";

type Instance = {
  id: string;
  type: "edupage";
  name: string;
  schoolUrl: string;
  calendarId: string;
  enabled: boolean;
  trigger: "open" | "interval";
  intervalMinutes: number;
  homework: boolean;
  exams: boolean;
  excludeSubjects: string[];
  excludeRegex: string;
  connected: boolean;
  status: string;
  message: string;
  subjects?: string[];
  environmentLoginAvailable: boolean;
  webhookEnabled: boolean;
  webhookConfigured?: boolean;
  importedCount: number;
  lastSuccessAt?: number;
  assignmentCount?: number;
  preview?: {
    id: string;
    title: string;
    subject: string;
    date: string;
    kind: string;
  }[];
  history: { at: number; status: string; message: string; reason: string }[];
};
type Listing = {
  instances: Instance[];
  browserConfigured: boolean;
  defaultSchoolUrl: string;
  environmentLoginAvailable: boolean;
};
type BrowserState = {
  image: string;
  width: number;
  height: number;
  title: string;
  location: string;
};
const time = (value?: number) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not synced yet";

export function PluginsPanel({
  calendars,
  connected,
  onChanged,
}: {
  calendars: Calendar[];
  connected: boolean;
  onChanged: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState<BrowserState | null>(null);
  const [text, setText] = useState("");
  const [hideText, setHideText] = useState(true);
  const [webhook, setWebhook] = useState<{ url: string; token: string } | null>(
    null,
  );
  const [removed, setRemoved] = useState<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const success = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = async () => {
    const data = await api<Listing>("/plugins");
    if (!mounted.current) return;
    setListing(data);
    const latest = Math.max(
      0,
      ...data.instances.map((i) => i.lastSuccessAt || 0),
    );
    if (success.current !== null && latest > success.current) changed.current();
    success.current = latest;
  };
  useEffect(() => {
    if (!connected) return;
    let closed = false;
    const refresh = () =>
      load().catch((e) => {
        if (!closed) setError(e.message);
      });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [connected]);
  const active = listing?.instances.find((i) => i.id === selected);
  useEffect(() => {
    if (!remote || !active) return;
    let closed = false;
    const timer = setInterval(() => {
      if (!busy)
        api<BrowserState>(`/plugins/${active.id}/browser/snapshot`, {
          method: "POST",
        })
          .then((data) => {
            if (mounted.current && !closed) setRemote(data);
          })
          .catch((e) => setError(e.message));
    }, 2500);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }, [!!remote, active?.id, busy]);
  // Leaving the screen releases interactive mode so app-open jobs can run.
  useEffect(() => {
    if (!remote || !active) return;
    return () => {
      void api(`/plugins/${active.id}/browser/cancel`, {
        method: "POST",
      }).catch(() => {});
    };
  }, [!!remote, active?.id]);
  const action = async (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const browserInput = (input: unknown) =>
    action(async () => {
      const result = await api<BrowserState>(
        `/plugins/${active!.id}/browser/input`,
        { method: "POST", body: JSON.stringify({ input }) },
      );
      setRemote(result);
    });
  if (!connected)
    return (
      <div className="plugin-panel">
        <Puzzle size={28} />
        <h3>Connect Google first</h3>
        <p>
          Plugins sync to calendars in your Google account. Sign in from Account
          and settings to configure them.
        </p>
      </div>
    );
  return (
    <div className="plugin-panel">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {removed && (
        <p className="plugin-notice">
          Plugin removed. Imported events were kept.{" "}
          <button
            type="button"
            onClick={() =>
              action(async () => {
                await api(`/plugins/${removed}/restore`, { method: "POST" });
                setRemoved(null);
                await load();
              })
            }
          >
            Undo
          </button>
        </p>
      )}
      {!listing && <p role="status">Loading plugins…</p>}
      {listing && !active && !creating && (
        <>
          <p>
            Sync school assignments automatically when you open HyperCal. Your
            calendar stays usable while imports run.
          </p>
          <div className="plugin-list">
            {listing.instances.map((instance) => (
              <button
                type="button"
                key={instance.id}
                className="plugin-row"
                onClick={() => {
                  setSelected(instance.id);
                  setWebhook(null);
                }}
              >
                <Puzzle size={21} />
                <span>
                  <strong>{instance.name}</strong>
                  <small>{instance.message}</small>
                </span>
                <span className={`plugin-status ${instance.status}`}>
                  {["queued", "running"].includes(instance.status)
                    ? "Syncing"
                    : instance.enabled
                      ? "On"
                      : "Off"}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setCreating(true);
              setSelected(null);
            }}
          >
            <Plus size={16} />
            Add EduPage plugin
          </button>
          {!listing.browserConfigured && (
            <p className="plugin-notice">
              The browser worker is not configured on this server yet. Settings
              can be saved, but sign-in and imports need that service.
            </p>
          )}
        </>
      )}
      {listing && (active || creating) && (
        <>
          <button
            type="button"
            className="plugin-back"
            onClick={() => {
              setRemote(null);
              setSelected(null);
              setCreating(false);
              setWebhook(null);
            }}
          >
            <ChevronLeft size={16} />
            All plugins
          </button>
          {remote && active ? (
            <section className="plugin-browser">
              <h3>Connect to EduPage</h3>
              <p>
                Use the browser below to finish sign-in or scan its QR code with
                your EduPage app. HyperCal keeps the session privately on R2D2.
              </p>
              <p className="plugin-browser-origin">{remote.location}</p>
              <button
                type="button"
                className="plugin-browser-screen"
                disabled={busy}
                aria-label="Click a field in the EduPage browser"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  void browserInput({
                    type: "click",
                    x:
                      ((event.clientX - rect.left) / rect.width) * remote.width,
                    y:
                      ((event.clientY - rect.top) / rect.height) *
                      remote.height,
                  });
                }}
              >
                <img
                  src={remote.image}
                  alt={`EduPage browser: ${remote.title}`}
                />
              </button>
              <div className="plugin-browser-keys">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => browserInput({ type: "key", key: "Tab" })}
                >
                  Next field
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => browserInput({ type: "key", key: "Enter" })}
                >
                  Enter
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    browserInput({ type: "key", key: "Backspace" })
                  }
                >
                  Backspace
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => browserInput({ type: "scroll", direction: 1 })}
                >
                  Scroll down
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = text;
                  setText("");
                  void browserInput({ type: "text", text: value });
                }}
              >
                <label className="field">
                  Text for selected field
                  <input
                    type={hideText ? "password" : "text"}
                    autoComplete="off"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={2000}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={hideText}
                    onChange={(e) => setHideText(e.target.checked)}
                  />
                  Hide typed text
                </label>
                <button
                  type="submit"
                  className="secondary-button"
                  disabled={busy || !text}
                >
                  Type into EduPage
                </button>
              </form>
              <div className="plugin-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api(`/plugins/${active.id}/browser/finish`, {
                        method: "POST",
                      });
                      setRemote(null);
                      await load();
                    })
                  }
                >
                  {busy ? "Checking…" : "Finish connection and preview"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setRemote(null)}
                >
                  Back to settings
                </button>
              </div>
            </section>
          ) : (
            <>
              {active && (
                <div className="plugin-summary" aria-live="polite">
                  <strong>{active.message}</strong>
                  <small>
                    Last successful sync: {time(active.lastSuccessAt)}
                  </small>
                </div>
              )}
              <form
                key={active?.id || "new"}
                className="editor-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void action(async () => {
                    const config = {
                      type: "edupage",
                      name: String(form.get("name")),
                      schoolUrl: String(form.get("schoolUrl")),
                      calendarId: String(form.get("calendarId")),
                      enabled: form.get("enabled") === "on",
                      trigger: String(form.get("trigger")),
                      intervalMinutes:
                        Number(form.get("intervalValue")) *
                        (form.get("intervalUnit") === "hours" ? 60 : 1),
                      homework: form.get("homework") === "on",
                      exams: form.get("exams") === "on",
                      excludeSubjects: [
                        ...new Set([
                          ...form.getAll("excludedSubject").map(String),
                          ...String(form.get("excludeSubjects"))
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        ]),
                      ],
                      excludeRegex: String(form.get("excludeRegex")),
                      webhookEnabled: form.get("webhookEnabled") === "on",
                    };
                    const result = await api<Instance>(
                      active ? `/plugins/${active.id}` : "/plugins",
                      {
                        method: active ? "PATCH" : "POST",
                        body: JSON.stringify(config),
                      },
                    );
                    await load();
                    setSelected(result.id);
                    setCreating(false);
                  });
                }}
              >
                <fieldset disabled={busy}>
                  <label className="field">
                    Plugin name
                    <input
                      name="name"
                      defaultValue={active?.name || "EduPage"}
                      required
                      maxLength={80}
                    />
                  </label>
                  <label className="field">
                    School website
                    <input
                      name="schoolUrl"
                      type="url"
                      required
                      defaultValue={
                        active?.schoolUrl || listing.defaultSchoolUrl
                      }
                    />
                  </label>
                  <label className="field">
                    Sync to calendar
                    <select
                      name="calendarId"
                      required
                      defaultValue={
                        active?.calendarId ||
                        calendars.find(
                          (c) => c.source === "google" && !c.readOnly,
                        )?.id ||
                        ""
                      }
                    >
                      <option value="" disabled>
                        Choose a writable Google calendar
                      </option>
                      {calendars
                        .filter((c) => c.source === "google" && !c.readOnly)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={
                        active?.enabled ?? listing.environmentLoginAvailable
                      }
                    />
                    Enable automatic sync
                  </label>
                  <label className="field">
                    Sync automatically
                    <select
                      name="trigger"
                      defaultValue={active?.trigger || "open"}
                    >
                      <option value="open">
                        When HyperCal opens or resumes
                      </option>
                      <option value="interval">
                        On a schedule, even while the app is closed
                      </option>
                    </select>
                  </label>
                  <details className="plugin-advanced">
                    <summary>Schedule and webhook options</summary>
                    <p>
                      The interval is only used when “On a schedule” is
                      selected. App-open sync is limited to once a minute across
                      devices.
                    </p>
                    <div className="plugin-interval">
                      <label className="field">
                        Every
                        <input
                          name="intervalValue"
                          type="number"
                          min={1}
                          max={10080}
                          defaultValue={
                            active?.intervalMinutes &&
                            active.intervalMinutes % 60 === 0
                              ? active.intervalMinutes / 60
                              : active?.intervalMinutes || 1
                          }
                        />
                      </label>
                      <label className="field">
                        Unit
                        <select
                          name="intervalUnit"
                          defaultValue={
                            !active?.intervalMinutes ||
                            active.intervalMinutes % 60 === 0
                              ? "hours"
                              : "minutes"
                          }
                        >
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                        </select>
                      </label>
                    </div>
                    <label className="checkbox-field">
                      <input
                        type="checkbox"
                        name="webhookEnabled"
                        defaultChecked={active?.webhookEnabled}
                      />
                      Allow authenticated webhook triggers
                    </label>
                  </details>
                  <span className="field-label">Import</span>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      name="exams"
                      defaultChecked={active?.exams ?? true}
                    />
                    Exams and tests
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      name="homework"
                      defaultChecked={active?.homework ?? true}
                    />
                    Homework
                  </label>
                  {!!active?.subjects?.length && (
                    <fieldset className="plugin-subject-picker">
                      <legend className="field-label">Exclude subjects</legend>
                      {active.subjects.map((subject) => (
                        <label className="checkbox-field" key={subject}>
                          <input
                            type="checkbox"
                            name="excludedSubject"
                            value={subject}
                            defaultChecked={active.excludeSubjects.includes(
                              subject,
                            )}
                          />
                          {subject}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <label className="field">
                    {active?.subjects?.length
                      ? "Other subjects to exclude"
                      : "Exclude subjects"}
                    <textarea
                      name="excludeSubjects"
                      rows={2}
                      defaultValue={
                        active?.excludeSubjects
                          .filter(
                            (subject) => !active.subjects?.includes(subject),
                          )
                          .join("\n") || ""
                      }
                      placeholder="One subject per line"
                    />
                  </label>
                  <label className="field">
                    Exclude matching regex
                    <input
                      name="excludeRegex"
                      defaultValue={active?.excludeRegex || ""}
                      maxLength={500}
                      spellCheck={false}
                      placeholder="e.g. practice|optional"
                    />
                    <small>
                      Matches the subject, title, or description, ignoring case.
                      Existing imports are kept when exclusions change.
                    </small>
                  </label>
                  <button className="primary-button" type="submit">
                    {busy ? "Saving…" : active ? "Save plugin" : "Add plugin"}
                  </button>
                </fieldset>
              </form>
              {active && (
                <>
                  <section className="plugin-connection">
                    <h3>EduPage connection</h3>
                    <p>
                      {active.environmentLoginAvailable
                        ? "Server credentials are configured for your account. The browser signs in automatically when needed."
                        : "Set your credentials in R2D2’s private EduPage environment file, or sign in directly in the isolated browser."}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || !listing.browserConfigured}
                      onClick={() =>
                        action(async () => {
                          setRemote(
                            await api<BrowserState>(
                              `/plugins/${active.id}/browser/open`,
                              { method: "POST" },
                            ),
                          );
                        })
                      }
                    >
                      <ExternalLink size={15} />
                      {active.connected
                        ? "Review browser connection"
                        : "Finish sign-in"}
                    </button>
                  </section>
                  {!!active.preview?.length && (
                    <section className="plugin-preview">
                      <h3>Latest assignment preview</h3>
                      <p>
                        {active.assignmentCount} upcoming assignments found.
                        Imported as all-day events.
                      </p>
                      <ul>
                        {active.preview.map((item) => (
                          <li key={item.id}>
                            <time>{item.date}</time>
                            <span>
                              {item.subject && (
                                <strong>{item.subject} · </strong>
                              )}
                              {item.title}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <details className="plugin-advanced">
                    <summary>Webhook credentials</summary>
                    <p>
                      Send an authenticated POST request from an external
                      service. The token is shown only when generated.
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          setWebhook(
                            await api(`/plugins/${active.id}/webhook`, {
                              method: "POST",
                            }),
                          );
                          await load();
                        })
                      }
                    >
                      {active.webhookConfigured
                        ? "Replace webhook token"
                        : "Generate webhook token"}
                    </button>
                    {webhook && (
                      <div className="plugin-secret">
                        <label className="field">
                          Webhook URL
                          <input readOnly value={webhook.url} />
                        </label>
                        <label className="field">
                          Bearer token
                          <input
                            type="password"
                            readOnly
                            value={webhook.token}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(webhook.token)
                              .catch(() =>
                                setError(
                                  "Could not copy. Select the token field to copy it.",
                                ),
                              )
                          }
                        >
                          Copy token
                        </button>
                      </div>
                    )}
                  </details>
                  {!!active.history.length && (
                    <details className="plugin-advanced">
                      <summary>Recent syncs</summary>
                      <ul className="plugin-history">
                        {active.history.map((item, i) => (
                          <li key={i}>
                            <time>{time(item.at)}</time>
                            <span>{item.message}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await api(`/plugins/${active.id}`, {
                          method: "DELETE",
                        });
                        setRemoved(active.id);
                        setSelected(null);
                        await load();
                      })
                    }
                  >
                    Remove plugin
                  </button>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
