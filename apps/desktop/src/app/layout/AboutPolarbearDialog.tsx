import type { MouseEvent } from "react";
import appIconUrl from "../../../src-tauri/icons/128x128.png";
import { openExternalUrl } from "../../shared/tauri/openExternalUrl";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { PRODUCT_CONFIG } from "../../shared/config/productConfig";

type AboutPolarbearDialogProps = {
  onClose: () => void;
};

export function AboutPolarbearDialog({ onClose }: AboutPolarbearDialogProps) {
  const { t } = useI18n();
  const openProjectLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternalUrl(PRODUCT_CONFIG.repositoryUrl);
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
        <h1 id="about-polarbear-title">{PRODUCT_CONFIG.name}</h1>
        <p className="about-version">
          {t("about.version", { version: PRODUCT_CONFIG.version })}
        </p>
        <p className="about-tagline">{t("about.tagline")}</p>
        <a
          href={PRODUCT_CONFIG.repositoryUrl}
          onClick={openProjectLink}
          target="_blank"
          rel="noreferrer"
        >
          {PRODUCT_CONFIG.repositoryUrl}
        </a>
        <p className="about-copyright">
          {PRODUCT_CONFIG.copyright}
        </p>
        <button type="button" className="about-close-button" onClick={onClose}>
          {t("common.close")}
        </button>
      </section>
    </div>
  );
}
