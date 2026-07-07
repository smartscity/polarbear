import type { MouseEvent } from "react";
import appIconUrl from "../../../src-tauri/icons/128x128.png";
import { openExternalUrl } from "../../tauri/externalLinks";

type AboutPolarbearDialogProps = {
  onClose: () => void;
};

const projectUrl = "https://github.com/smartscity/polarbear";

export function AboutPolarbearDialog({ onClose }: AboutPolarbearDialogProps) {
  const openProjectLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternalUrl(projectUrl);
  };

  return (
    <div
      className="about-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-polarbear-title"
      >
        {/*<div className="about-window-dots" aria-hidden="true">*/}
        {/*  <span className="close-dot" />*/}
        {/*  <span />*/}
        {/*  <span />*/}
        {/*</div>*/}
        <img className="about-app-icon" src={appIconUrl} alt="" aria-hidden="true" />
        <h1 id="about-polarbear-title">Polarbear</h1>
        <p className="about-version">Version 0.1.0</p>
        <p className="about-tagline">a minimal Markdown editor and reader</p>
        <a href={projectUrl} onClick={openProjectLink} target="_blank" rel="noreferrer">
          {projectUrl}
        </a>
        <p className="about-copyright">
          Copyright © 2020-2026 smartscity. All rights reserved.
        </p>
        <button type="button" className="about-close-button" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
