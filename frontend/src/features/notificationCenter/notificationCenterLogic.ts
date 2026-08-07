export type NotificationKind = "info" | "warning" | "error";

export interface NotificationInput {
  title?: string;
  message?: string;
  detail?: string;
  type?: NotificationKind;
  duration?: number;
}

export function normalizeNotification(
  input: string | NotificationInput,
): NotificationInput {
  if (typeof input === "string") return { title: input };
  return input && typeof input === "object" ? input : { title: "Notification" };
}
