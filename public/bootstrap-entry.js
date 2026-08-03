import { initializeI18n } from "./i18n.js";
import { restoreMobileStartRoute } from "./native/features/mobile-start-route.js";
import { renderStartupFailure } from "./native/features/startup-failure.js";

initializeI18n();
if (!restoreMobileStartRoute()) {
  import("./native/app.js").catch((error) => renderStartupFailure(error));
}
