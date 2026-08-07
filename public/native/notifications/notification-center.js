// Thin bridge: the notification center now lives in the React bundle
// (frontend/src/features/notificationCenter). Re-export keeps the module's
// public surface stable for app.js and legacy tests.
export { createNotificationCenter } from "../react/notification-center.js";
