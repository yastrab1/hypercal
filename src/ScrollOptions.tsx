import { continuousFor, type ScrollPreferences } from "./scroll-options.mjs";
import type { Layout } from "./types";

export function ScrollOptions({
  view,
  layout,
}: {
  view?: ScrollPreferences | null;
  layout: Layout;
}) {
  return (
    <fieldset className="scroll-options">
      <legend className="field-label">Continuous scrolling</legend>
      <label className="checkbox-field">
        <input
          type="checkbox"
          name="continuousScrollWeb"
          defaultChecked={continuousFor(view, false)}
        />
        Web
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          name="continuousScrollPhone"
          defaultChecked={continuousFor(view, true)}
        />
        Phone
      </label>
      <small>
        {layout === "month"
          ? "Scroll vertically by week row. Swipe left or right to align to the previous or next month."
          : "Scroll horizontally through individual days, without returning to Monday."}
      </small>
    </fieldset>
  );
}
