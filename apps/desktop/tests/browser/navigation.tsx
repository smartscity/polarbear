import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextWorkspace } from "../../src/features/memory/context/ContextWorkspace";
import { useContextOsSession } from "../../src/features/memory/context/useContextOsSession";
import { I18nProvider } from "../../src/shared/i18n/I18nProvider";
import "../../src/styles.css";

function Harness() {
  const [visible, setVisible] = useState(true);
  const [workspace, setWorkspace] = useState("/test/project");
  return <><button onClick={() => setVisible(!visible)}>Switch surface</button>
    <button onClick={() => setWorkspace("/test/other")}>Switch workspace</button>
    {visible && <ContextWorkspace documentContext={null} workspaceRoot={workspace} onOpenSource={() => {}} onOpenWorkspace={() => {}} />}</>;
}
function SessionProbe() {
  const [workspace, setWorkspace] = useState("/test/project");
  const session = useContextOsSession(workspace);
  useEffect(() => { Object.assign(window, { __contextSession: session, __selectWorkspace: setWorkspace }); }, [session]);
  return <output>{JSON.stringify({ config: session.config, loading: session.isLoading, mutating: session.isMutating, error: session.error })}</output>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider>{location.search.includes("probe") ? <SessionProbe /> : <Harness />}</I18nProvider>);
