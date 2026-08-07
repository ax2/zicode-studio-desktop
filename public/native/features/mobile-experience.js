// Thin bridge: the mobile experience controller now lives in the React bundle
// (frontend/src/features/mobileExperience). Re-exports keep the module's public
// surface stable for app.js and legacy tests.
export {
  canUseRemotePwa,
  isIosDevice,
  setupMobileExperience,
} from "../react/mobile-experience.js";
