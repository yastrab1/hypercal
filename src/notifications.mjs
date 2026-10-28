export const notificationPresets = [0, 5, 10, 15, 30, 60, 1440];
export function validNotification(value) {
  return (
    value === "calendar" ||
    value === "none" ||
    (/^\d+$/.test(value) &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) <= 40320)
  );
}
export function notificationFields(value) {
  if (!validNotification(value))
    throw new Error("Choose a notification from 0 minutes to 28 days.");
  return value === "calendar"
    ? { useDefaultReminders: true }
    : { reminderMinutes: value === "none" ? null : Number(value) };
}
export function notificationParts(value) {
  const minutes = /^\d+$/.test(value) ? Number(value) : 10;
  const unit =
    minutes > 0 && minutes % 1440 === 0
      ? 1440
      : minutes > 0 && minutes % 60 === 0
        ? 60
        : 1;
  return { amount: minutes / unit, unit };
}
