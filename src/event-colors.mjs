// Google Calendar's supported event color IDs. Exact custom colors are retained
// in a private event property; Google Calendar displays the nearest palette color.
export const eventColors = [
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "8", name: "Graphite", hex: "#616161" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "11", name: "Tomato", hex: "#d50000" },
];
// Default swatches sampled from the user’s Google Calendar reference.
export const defaultEventColors = [
  { name: "Cherry", hex: "#c05476" },
  { name: "Rose", hex: "#d85675" },
  { name: "Coral", hex: "#d6837a" },
  { name: "Tomato", hex: "#da5234" },
  { name: "Tangerine", hex: "#e3683e" },
  { name: "Pumpkin", hex: "#dd7835" },
  { name: "Mango", hex: "#e0963c" },
  { name: "Banana", hex: "#e7ba51" },
  { name: "Gold", hex: "#d8be5e" },
  { name: "Citron", hex: "#bcc256" },
  { name: "Avocado", hex: "#85ad59" },
  { name: "Basil", hex: "#489160" },
  { name: "Eucalyptus", hex: "#55b080" },
  { name: "Teal", hex: "#429a8e" },
  { name: "Peacock", hex: "#4b99d2" },
  { name: "Cornflower", hex: "#668be1" },
  { name: "Blueberry", hex: "#828bc2" },
  { name: "Lavender", hex: "#6e72c3" },
  { name: "Lilac", hex: "#ae9cce" },
  { name: "Grape", hex: "#a479b1" },
  { name: "Amethyst", hex: "#a75aba" },
  { name: "Cocoa", hex: "#957367" },
  { name: "Graphite", hex: "#7c7c7c" },
  { name: "Birch", hex: "#a5998c" },
];
export function eventColor(event, calendars) {
  return (
    event.color ||
    calendars.find((c) => c.id === event.calendarId)?.color ||
    "#039be5"
  );
}
export function googleColorFields(color) {
  if (color === undefined) return {};
  const nearest = color
    ? eventColors.reduce((best, candidate) =>
        distance(color, candidate.hex) < distance(color, best.hex)
          ? candidate
          : best,
      )
    : null;
  return {
    colorId: nearest?.id || null,
    extendedProperties: { private: { hypercalColor: color } },
  };
}
function distance(a, b) {
  return [1, 3, 5].reduce(
    (n, i) =>
      n +
      (parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) ** 2,
    0,
  );
}
export function readEventColor(event) {
  const custom = event.extendedProperties?.private?.hypercalColor;
  // A color changed in Google Calendar takes precedence over stale metadata.
  return /^#[\da-f]{6}$/i.test(custom || "") &&
    googleColorFields(custom).colorId === event.colorId
    ? custom
    : eventColors.find((c) => c.id === event.colorId)?.hex;
}
