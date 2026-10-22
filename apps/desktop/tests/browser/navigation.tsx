import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextWorkspace } from "../../src/features/memory/context/ContextWorkspace";
import { useContextOsSession } from "../../src/features/memory/context/useContextOsSession";
import { I18nProvider } from "../../src/shared/i18n/I18nProvider";
import "../../src/styles.css";

function Harness() {
  const [visible, setVisible] = useState(true);
  return <><button onClick={() => setVisible(!visible)}>Switch surface</button>
    {visible && <ContextWorkspace documentContext={null} workspaceRoot="/test/project" onOpenSource={() => {}} onOpenWorkspace={() => {}} />}</>;
}
function SessionProbe() {
  const session = useContextOsSession("/test/project");
  useEffect(() => { Object.assign(window, { __contextSession: session }); }, [session]);
  return <output>{JSON.stringify(session.config)}</output>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider>{location.search.includes("probe") ? <SessionProbe /> : <Harness />}</I18nProvider>);
