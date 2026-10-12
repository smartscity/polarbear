import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../../desktop/src/shared/i18n/I18nProvider";

export function Sheet({ title, close, children, full = false }: { title: string; close: () => void; children: ReactNode; full?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={full ? "reader-sheet fullscreen" : "reader-sheet"} onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }} aria-label={title}>
    <div className="sheet-content"><header><h2>{title}</h2><button className="icon-button" aria-label={t("common.close")} title={t("common.close")} onClick={close}><X /></button></header>{children}</div>
  </dialog>;
}
