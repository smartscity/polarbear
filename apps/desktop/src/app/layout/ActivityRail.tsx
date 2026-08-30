export type AppSurface = "workspace" | "context";

type ActivityRailProps = {
  activeSurface: AppSurface;
  onSelect: (surface: AppSurface) => void;
  workspaceLabel: string;
  contextLabel: string;
};

export function ActivityRail({
  activeSurface,
  onSelect,
  workspaceLabel,
  contextLabel,
}: ActivityRailProps) {
  return (
    <nav className="activity-rail" aria-label={workspaceLabel}>
      <button
        type="button"
        className={activeSurface === "workspace" ? "active" : ""}
        aria-label={workspaceLabel}
        aria-pressed={activeSurface === "workspace"}
        title={workspaceLabel}
        onClick={() => onSelect("workspace")}
      >
        <WorkspaceIcon />
      </button>
      <button
        type="button"
        className={activeSurface === "context" ? "active" : ""}
        aria-label={contextLabel}
        aria-pressed={activeSurface === "context"}
        title={contextLabel}
        onClick={() => onSelect("context")}
      >
        <ContextIcon />
      </button>
    </nav>
  );
}

function WorkspaceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <path d="M3.25 4.25h4l1.25 1.5h6.25v8H3.25z" />
      <path d="M3.25 7h11.5" />
    </svg>
  );
}

function ContextIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="5.75" />
      <path d="M9 6.2v3.1l2.1 1.35" />
    </svg>
  );
}
