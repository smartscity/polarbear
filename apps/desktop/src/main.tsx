import React from "react";
import ReactDOM from "react-dom/client";
import { ErrorBoundary } from "./ErrorBoundary";
import { I18nProvider } from "./shared/i18n/I18nProvider";
import { initializeUserSettings } from "./shared/settings/userSettings";
import "./styles.css";
const App = React.lazy(() => import("./App").then((module) => ({ default: module.App })));
const CaptionPanel = React.lazy(() => import("./features/caption/CaptionPanel").then((module) => ({ default: module.CaptionPanel })));
const CaptionTranslator = React.lazy(() => import("./features/caption/CaptionTranslator").then((module) => ({ default: module.CaptionTranslator })));

console.info("Polarbear frontend booting...");

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

const root = ReactDOM.createRoot(rootElement);
// All surfaces hydrate the same authority before their initial state is derived.
void initializeUserSettings().catch((error: unknown) => {
  console.error("Settings hydration failed; retaining read-only legacy preferences.", error);
}).then(() => root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <React.Suspense fallback={null}>
        {new URLSearchParams(location.search).get("surface") === "caption-translator" ? <CaptionTranslator />
          : new URLSearchParams(location.search).get("surface") === "caption" ? <CaptionPanel /> : <App />}
        </React.Suspense>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
));
