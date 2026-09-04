const approvedSources = new Set<string>();

/**
 * Remembers explicit PlantUML remote-render approval for the current app session.
 * Approval is scoped to the exact source so editing a diagram requires consent again.
 */
export function approvePlantUmlRemoteRender(source: string): void {
  approvedSources.add(source);
}

export function hasPlantUmlRemoteRenderApproval(source: string): boolean {
  return approvedSources.has(source);
}
