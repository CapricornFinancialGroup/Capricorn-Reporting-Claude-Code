import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { detectMode } from "./api.js";
import { App } from "./App.js";
import { Kiosk } from "./Kiosk.js";
import "./styles.css";

const mode = detectMode();
const root = createRoot(document.getElementById("root")!);
root.render(<StrictMode>{mode === "kiosk" ? <Kiosk mode={mode} /> : <App mode={mode} />}</StrictMode>);
