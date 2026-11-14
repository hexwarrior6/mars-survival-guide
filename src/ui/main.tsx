import { createRoot } from "react-dom/client";
import { App } from "./App.js";

// No StrictMode: its development double-mount breaks the first R3F canvas —
// the second mount reuses the same <canvas> DOM element whose WebGL context
// was already force-lost during the unmount pass, so the 3D sandbox stayed
// black until a manual 2D → retry round-trip. Rendering correctness is
// covered by the watchdog/error-boundary fallbacks instead.
createRoot(document.getElementById("root") as HTMLElement).render(<App />);
