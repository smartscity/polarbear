type StatusBarProps = {
  activeFileName: string;
  characterCount: number;
  isDirty: boolean;
};

export function StatusBar({
  activeFileName,
  characterCount,
  isDirty
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{activeFileName}</span>
      <span>{isDirty ? "Unsaved" : "Saved"}</span>
      <span>{characterCount} characters</span>
      <span>markdown-preview enabled · mermaid-renderer enabled</span>
    </footer>
  );
}
