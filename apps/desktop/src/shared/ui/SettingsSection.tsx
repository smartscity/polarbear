import { useId, type ReactNode } from "react";

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return <section className="settings-section" aria-labelledby={id}><h3 id={id}>{title}</h3>{children}</section>;
}

export function SettingsRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="settings-row"><div className="settings-row-copy"><span className="settings-label">{label}</span>
    {description && <p className="settings-description">{description}</p>}</div><div className="settings-control">{children}</div></div>;
}
