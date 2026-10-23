type WorkspaceSaveSession = {
  getDirtyDocumentIds: () => string[];
  getContent: (id: string) => string | undefined;
  saveDocument: (id: string) => Promise<boolean>;
};

/** Gate repository IO on completed document saves, without owning editor state. */
export async function saveWorkspaceDocuments(session: WorkspaceSaveSession): Promise<boolean> {
  const savedContents = new Map<string, string>();
  for (const id of session.getDirtyDocumentIds()) {
    const content = session.getContent(id);
    if (content === undefined || !await session.saveDocument(id)) return false;
    savedContents.set(id, content);
  }
  // Earlier documents may change while later saves are pending. React can also
  // still expose an old dirty marker for an already committed snapshot.
  return session.getDirtyDocumentIds().every((id) =>
    savedContents.has(id) && savedContents.get(id) === session.getContent(id),
  );
}
