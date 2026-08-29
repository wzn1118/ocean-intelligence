import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import AuthBootstrap from "./AuthBootstrap";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthBootstrap />
  </StrictMode>,
);
