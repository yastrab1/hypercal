import { useEffect, useState } from "react";
import { Plus, Check, Trash2 } from "lucide-react";
import { api } from "./api";
import type { Tag, TagCriterion, Calendar } from "./types";

const manual = {
  mode: "event" as const,
  calendarIds: [],
  include: "",
  exclude: "",
};
const blankCriterion: TagCriterion = {
  calendarMode: "any",
  calendarIds: [],
  include: "",
  exclude: "",
};
// Pre-union saved rules have no criteria list; show them as one criterion.
function criteriaOf(rule: NonNullable<Tag["rule"]>): TagCriterion[] {
  if (rule.criteria?.length) return rule.criteria;
  return [
    {
      calendarMode: rule.calendarIds.length ? "only" : "any",
      calendarIds: rule.calendarIds,
      include: rule.include,
      exclude: rule.exclude,
    },
  ];
}
export function TagSettings({
  tags,
  calendars,
  disabled,
  live,
  onSave,
  onDelete,
}: {
  tags: Tag[];
  calendars: Calendar[];
  disabled: boolean;
  live: boolean;
  onSave: (tags: Tag[]) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [status, setStatus] = useState<{
    pending: number;
    scanning: boolean;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const load = () =>
      api<NonNullable<typeof status>>("/tag-rule-sync")
        .then((value) => {
          if (!cancelled) setStatus(value);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live]);
  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tag-settings">
      <p className="panel-description">
        Apply tags to individual events, or let calendar and text rules apply
        them automatically.
      </p>
      {!live && (
        <p className="inline-note">
          Connect Google to run automatic rules. Demo settings are saved on this
          device.
        </p>
      )}
      <div className="tag-settings-list">
        {tags.map((tag) => (
          <div key={tag.name}>
            <button
              type="button"
              className="tag-settings-choice"
              aria-expanded={selected === tag.name}
              onClick={() => {
                setSelected(selected === tag.name ? null : tag.name);
                setError("");
                setDeleting(null);
              }}
            >
              <i style={{ background: tag.color }} aria-hidden="true" />
              <span>
                {tag.name}
                <small>
                  {tag.rule?.mode === "automatic" ? "Automatic" : "By event"}
                </small>
              </span>
              <span>{selected === tag.name ? "Close" : "Edit"}</span>
            </button>
            {selected === tag.name && (
              <TagRuleForm
                key={JSON.stringify(tag)}
                tag={tag}
                calendars={calendars}
                disabled={disabled || busy}
                onSave={async (value) => {
                  await run(
                    () =>
                      onSave(
                        tags.map((t) => (t.name === tag.name ? value : t)),
                      ),
                    "Tag settings saved. Matching events update in the background.",
                  );
                }}
                onDelete={() => setDeleting(tag.name)}
              />
            )}
            {deleting === tag.name && (
              <div className="tag-settings-delete">
                <p>Delete “{tag.name}” and its assignments? Events are kept.</p>
                <button
                  type="button"
                  className="danger-button"
                  disabled={disabled || busy}
                  onClick={async () => {
                    if (await run(() => onDelete(tag.name), "Tag deleted.")) {
                      setSelected(null);
                      setDeleting(null);
                    }
                  }}
                >
                  Delete tag
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setDeleting(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {!tags.length && <p className="muted">Create a tag to get started.</p>}
      {adding ? (
        <form
          className="editor-form tag-settings-new"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const name = String(data.get("name")).trim();
            if (tags.some((tag) => tag.name === name)) {
              setError("That tag already exists.");
              return;
            }
            if (
              await run(
                () =>
                  onSave([
                    ...tags,
                    { name, color: String(data.get("color")), rule: manual },
                  ]),
                "Tag created.",
              )
            ) {
              setAdding(false);
              setSelected(name);
            }
          }}
        >
          <fieldset disabled={disabled || busy}>
            <label className="field">
              Tag name
              <input required name="name" maxLength={60} autoFocus />
            </label>
            <label className="field">
              Color
              <input name="color" type="color" defaultValue="#4b99d2" />
            </label>
          </fieldset>
          <div className="form-actions">
            <button className="primary-button" disabled={disabled || busy}>
              Create tag
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || busy || tags.length >= 40}
          onClick={() => setAdding(true)}
        >
          <Plus size={16} /> New tag
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="inline-note" role="status">
          {notice}
        </p>
      )}
      {status && (
        <p className="inline-note" role="status">
          {status.error ||
            (status.scanning
              ? "Finding matching events…"
              : status.pending
                ? `${status.pending} event updates queued for Google.`
                : "Automatic tag sync is up to date.")}
        </p>
      )}
    </section>
  );
}
function TagRuleForm({
  tag,
  calendars,
  disabled,
  onSave,
  onDelete,
}: {
  tag: Tag;
  calendars: Calendar[];
  disabled: boolean;
  onSave: (tag: Tag) => Promise<void>;
  onDelete: () => void;
}) {
  const [rule, setRule] = useState(tag.rule || manual);
  const criteria = criteriaOf(rule);
  const update = (index: number, patch: Partial<TagCriterion>) =>
    setRule({
      ...rule,
      criteria: criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
  const [color, setColor] = useState(tag.color);
  const [calendarQuery, setCalendarQuery] = useState("");
  const shown = calendars.filter((calendar) =>
    calendar.name
      .toLocaleLowerCase()
      .includes(calendarQuery.trim().toLocaleLowerCase()),
  );
  const external = (calendar: Calendar) =>
    calendar.source === "ical" || calendar.owned === false || calendar.readOnly;
  const groups = [
    { name: "Other calendars", values: shown.filter(external) },
    {
      name: "My calendars",
      values: shown.filter((calendar) => !external(calendar)),
    },
  ];
  return (
    <form
      className="editor-form tag-rule-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          ...tag,
          color,
          rule:
            rule.mode === "automatic"
              ? { ...rule, calendarIds: [], include: "", exclude: "", criteria }
              : rule,
        });
      }}
    >
      <fieldset disabled={disabled}>
        <label className="field">
          Color
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label className="field">
          Application
          <select
            value={rule.mode}
            onChange={(e) =>
              setRule({
                ...rule,
                mode: e.target.value as "event" | "automatic",
              })
            }
          >
            <option value="event">By event</option>
            <option value="automatic">Automatic</option>
          </select>
          <small>
            {rule.mode === "event"
              ? "Choose this tag in the event editor. Switching back keeps tags already applied."
              : "The rule controls this tag. An event gets this tag when any match below applies. Within one match, its calendars and include regex must both match and its exclude regex wins."}
          </small>
        </label>
        {rule.mode === "automatic" && (
          <>
            {criteria.map((criterion, index) => (
              <fieldset className="tag-criterion" key={index}>
                <legend>
                  {index === 0 ? "Match" : "Or match"} #{index + 1}
                </legend>
                <label className="field">
                  Calendars
                  <select
                    value={criterion.calendarMode}
                    onChange={(e) =>
                      update(index, {
                        calendarMode: e.target
                          .value as TagCriterion["calendarMode"],
                      })
                    }
                  >
                    <option value="any">All calendars</option>
                    <option value="only">Only the selected calendars</option>
                    <option value="except">
                      All calendars except the selected
                    </option>
                  </select>
                </label>
                {criterion.calendarMode !== "any" && (
                  <>
                    <label className="field">
                      Find a calendar
                      <input
                        type="search"
                        value={calendarQuery}
                        onChange={(e) => setCalendarQuery(e.target.value)}
                        placeholder="e.g. Prask"
                      />
                      <small>
                        {calendars.length} calendars available, including shared
                        calendars and subscriptions.
                      </small>
                    </label>
                    <div className="view-calendar-picker">
                      {groups
                        .filter((group) => group.values.length)
                        .map((group) => (
                          <div className="tag-calendar-group" key={group.name}>
                            <h4>{group.name}</h4>
                            {group.values.map((calendar) => (
                              <label
                                className="calendar-toggle"
                                key={calendar.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={criterion.calendarIds.includes(
                                    calendar.id,
                                  )}
                                  style={{ accentColor: calendar.color }}
                                  onChange={() =>
                                    update(index, {
                                      calendarIds:
                                        criterion.calendarIds.includes(
                                          calendar.id,
                                        )
                                          ? criterion.calendarIds.filter(
                                              (id) => id !== calendar.id,
                                            )
                                          : [
                                              ...criterion.calendarIds,
                                              calendar.id,
                                            ],
                                    })
                                  }
                                />
                                <span>
                                  {calendar.name}
                                  {calendar.readOnly ? " (read-only)" : ""}
                                </span>
                              </label>
                            ))}
                          </div>
                        ))}
                      {!shown.length && (
                        <p className="small muted">
                          No calendars match this name.
                        </p>
                      )}
                      {criterion.calendarIds
                        .filter((id) => !calendars.some((c) => c.id === id))
                        .map((id) => (
                          <label className="calendar-toggle" key={id}>
                            <input
                              type="checkbox"
                              checked
                              onChange={() =>
                                update(index, {
                                  calendarIds: criterion.calendarIds.filter(
                                    (value) => value !== id,
                                  ),
                                })
                              }
                            />
                            <span>Unavailable calendar</span>
                          </label>
                        ))}
                    </div>
                  </>
                )}
                <label className="field">
                  Include regex
                  <input
                    value={criterion.include}
                    maxLength={500}
                    spellCheck={false}
                    placeholder="exam|test"
                    onChange={(e) => update(index, { include: e.target.value })}
                  />
                  <small>
                    Optional. Empty matches every event in these calendars.
                    Matches title, notes or location, ignoring case.
                  </small>
                </label>
                <label className="field">
                  Exclude regex
                  <input
                    value={criterion.exclude}
                    maxLength={500}
                    spellCheck={false}
                    placeholder="practice|cancelled"
                    onChange={(e) => update(index, { exclude: e.target.value })}
                  />
                  <small>
                    Optional. Excludes events from this match only, even when
                    its include pattern matches.
                  </small>
                </label>
                {criteria.length > 1 && (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() =>
                      setRule({
                        ...rule,
                        criteria: criteria.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2 size={15} /> Remove match #{index + 1}
                  </button>
                )}
              </fieldset>
            ))}
            {criteria.length < 20 && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setRule({ ...rule, criteria: [...criteria, blankCriterion] })
                }
              >
                <Plus size={15} /> Add another match (OR)
              </button>
            )}
            <p className="small muted">
              Use patterns without / delimiters. Lookarounds and backreferences
              are not supported. Events support up to 12 tags.
            </p>
            <p className="small muted">
              Rules apply to loaded events and scan the next 12 months in the
              background. Writable Google calendars get tag metadata; read-only
              sources keep tags in HyperCal and its exports.
            </p>
          </>
        )}
      </fieldset>
      <div className="form-actions">
        <button className="primary-button" disabled={disabled}>
          <Check size={16} /> Save tag settings
        </button>
        <button
          type="button"
          className="danger-button"
          disabled={disabled}
          onClick={onDelete}
        >
          <Trash2 size={15} /> Delete
        </button>
      </div>
    </form>
  );
}
