// Thin bridge: the LAN QR modal now lives in the React bundle
// (frontend/src/features/lanQr). Re-exports keep the module's public surface
// stable for app.js and legacy tests.
export { refreshLanQrButton, setupLanQr } from "../react/lan-qr.js";
