type TopBarProps = {
  activeFileName: string;
  isDirty: boolean;
};

export function TopBar({
  activeFileName,
  isDirty
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="brand-area">
        <div className="brand-title">
          <strong>{activeFileName}{isDirty ? " — Edited" : ""}</strong>
          <span>Polarbear</span>
        </div>
      </div>
    </header>
  );
}
