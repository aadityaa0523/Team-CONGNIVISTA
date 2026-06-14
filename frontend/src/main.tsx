import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SentinelApp from "./sentinel/SentinelApp";
import "./index.css";
import "./gov.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SentinelApp />
  </StrictMode>,
);
