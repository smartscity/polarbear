import type { MouseEvent } from "react";
import { openExternalUrl } from "../../tauri/externalLinks";

type StatusBarProps = {
  activeFileName: string;
  characterCount: number;
  debugEnabled: boolean;
  isDirty: boolean;
  onDebugToggle: () => void;
};

export function StatusBar({
  activeFileName,
  characterCount,
  debugEnabled,
  isDirty,
  onDebugToggle
}: StatusBarProps) {
  const openProjectLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const url = "https://github.com/smartscity/polarbear";
    void openExternalUrl(url);
  };

  return (
    <footer className="status-bar">
      <div className="status-bar-left">
        <span>{activeFileName}</span>
        <span>{isDirty ? "Unsaved" : "Saved"}</span>
        <span>{characterCount} characters</span>
      </div>
      <div className="status-bar-right">
        {/*<button*/}
        {/*  type="button"*/}
        {/*  className={`status-debug-toggle ${debugEnabled ? "active" : ""}`}*/}
        {/*  aria-pressed={debugEnabled}*/}
        {/*  onClick={onDebugToggle}*/}
        {/*>*/}
        {/*  Debug*/}
        {/*</button>*/}
        <a
          className="designer-credit"
          href="https://github.com/smartscity/polarbear"
          onClick={openProjectLink}
          target="_blank"
          rel="noreferrer"
        >
          Copyright © 2020-2026 smartscity All rights reserved.
        </a>
      </div>
    </footer>
  );
}
