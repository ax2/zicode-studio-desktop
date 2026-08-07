// React migration bridge: chat message rendering now lives in the React
// implementation built into public/native/react/chat.js (see frontend/).
import { MessageRenderer, describeModelError } from "../native/react/chat.js";

export { MessageRenderer, describeModelError };
