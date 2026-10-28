// A copy is a new, standalone event. Provider identity, recurrence, guest lists,
// organizer, conferencing and attachments must not leak into an insert request.
export function copiedEventBody(source) {
  if (!source.start || !source.end || source.status === "cancelled") {
    throw Object.assign(
      new Error("This event is no longer available to copy."),
      { status: 404 },
    );
  }
  const body = {};
  for (const key of [
    "summary",
    "description",
    "location",
    "start",
    "end",
    "reminders",
    "transparency",
    "visibility",
  ]) {
    if (source[key] !== undefined) body[key] = structuredClone(source[key]);
  }
  return body;
}
