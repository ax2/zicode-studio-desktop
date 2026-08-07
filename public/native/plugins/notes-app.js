// React migration bridge: the notes app now renders through the React
// implementation built into public/native/react/notes.js (see frontend/).
import { setupNotesApp as setupReactNotesApp } from "../react/notes.js";

export function setupNotesApp(options = {}) {
  return setupReactNotesApp(options);
}
