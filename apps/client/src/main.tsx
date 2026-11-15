import { render } from "preact";
import { healStaleChunks, startUpdates } from "./net/update";
import { App } from "./ui/App";
import "./styles.css";

healStaleChunks();
render(<App />, document.getElementById("app") as HTMLElement);

// Offline app shell (SPEC §10.7), kept current by net/update.ts.
if (!new URLSearchParams(location.search).has("e2e")) startUpdates();
