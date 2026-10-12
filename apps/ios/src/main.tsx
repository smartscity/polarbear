import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../desktop/src/shared/i18n/I18nProvider";
import { ReaderApp } from "./ReaderApp";
import "./reader.css";

createRoot(document.getElementById("root")!).render(<StrictMode><I18nProvider><ReaderApp /></I18nProvider></StrictMode>);
