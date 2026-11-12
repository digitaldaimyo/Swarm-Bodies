import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import { App } from "./ui/App";
import "./styles.css";

render(<App />, document.getElementById("app") as HTMLElement);

// Offline app shell (SPEC §10.7). Updates apply on the next launch.
if (!new URLSearchParams(location.search).has("e2e")) registerSW({ immediate: true });
