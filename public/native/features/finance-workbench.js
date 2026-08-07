// Thin bridge: the finance workbench now lives in the React bundle
// (frontend/src/features/financeWorkbench). Re-export keeps the module's
// public surface stable for app.js and legacy imports.
export { setupFinanceWorkbench } from "../react/finance-workbench.js";
