# HyperCal design

## Reference

The user supplied a screenshot of Google Calendar in dark mode and requested less decorative color. Follow its compact toolbar, charcoal chrome, darker calendar canvas, subtle grid, and readable events. Preserve Google calendar colors instead of assigning an unrelated palette.

## Themes

Light: near-white calendar canvas, pale gray chrome, blue actions. Dark: #1b1b1c chrome, #131314 canvas, #333537 dividers, #e3e3e3 primary text, #a8c7fa selection/actions. Dark is the initial prototype theme; users may choose light, dark, or their device theme. Persist per device.

## Layout and type

System sans typography. Desktop sidebar 256px, compact single-row date/navigation toolbar, calendar surface with rounded outer corners. Avoid decorative headings and large empty toolbar areas. All-day events use filled calendar colors; timed events in month view use colored dots and neutral text. Day/week blocks use calendar color fills. Mobile defaults to a dense month grid with connected multi-day ribbons and a compact Google Calendar inspired toolbar. An account avatar is at the top; the left drawer holds account details, layouts, custom views and calendars and opens/closes by horizontal dragging. Mobile event editing fills the screen with close/save actions at the top and icon-led rows. The user supplied mobile month and event-editor screenshots as the reference. Saved data appears before sync; cached/offline state is explicit. Custom view editing is available on web and Android.

## Interaction

Keyboard shortcuts and a command palette are primary controls. Explicit editor focus, visible focus indicators, dialog focus trapping and escape-to-close. Errors, pending writes, demo mode and connection states remain explicit. No decorative images or animation.

View and plugin management are available through Calendar settings on web and Android. View editors retain the full filtering and per-device scrolling controls on phones, with visible touch targets. Shared-view management remains in the sidebar.
