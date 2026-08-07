// Thin bridge: the project header pills now live in the React bundle
// (frontend/src/features/projectHeader). Re-export keeps the module's
// public surface stable for app.js and legacy tests.
export { setupProjectHeader } from "../react/project-header.js";
