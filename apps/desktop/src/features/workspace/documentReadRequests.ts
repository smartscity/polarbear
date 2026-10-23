export type DocumentReadSnapshot = Readonly<{
  content: string;
  revision: string;
  workspaceRoot: string;
  relativePath: string;
}>;

export type DocumentReloadResult =
  | { status: "reloaded" | "superseded" | "conflict" }
  | { status: "failed"; error: unknown };

type ReadSession = { snapshot: DocumentReadSnapshot; request: symbol | null };

/** Owns optimistic read permissions, never document content or native IO. */
export class DocumentReadRequests {
  private readonly sessions = new Map<string, ReadSession>();

  reconcile(documents: ReadonlyMap<string, DocumentReadSnapshot>): void {
    for (const id of this.sessions.keys()) {
      if (!documents.has(id)) this.sessions.delete(id);
    }
    for (const [id, snapshot] of documents) {
      const current = this.sessions.get(id);
      if (!current || current.snapshot.workspaceRoot !== snapshot.workspaceRoot || current.snapshot.relativePath !== snapshot.relativePath) {
        this.sessions.set(id, { snapshot, request: null });
      } else {
        if (current.snapshot.content !== snapshot.content || current.snapshot.revision !== snapshot.revision) {
          current.request = null;
        }
        current.snapshot = snapshot;
      }
    }
  }

  begin(id: string, expected?: Pick<DocumentReadSnapshot, "workspaceRoot" | "relativePath"> & { revision?: string }) {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (expected && (
      session.snapshot.workspaceRoot !== expected.workspaceRoot ||
      session.snapshot.relativePath !== expected.relativePath ||
      (expected.revision !== undefined && session.snapshot.revision !== expected.revision)
    )) return null;
    const request = Symbol();
    session.request = request;
    const isSameDocument = () => this.sessions.get(id) === session;
    const isCurrent = () => isSameDocument() && session.request === request;
    return {
      snapshot: session.snapshot,
      isSameDocument,
      isCurrent,
      take: () => {
        if (!isCurrent()) return false;
        session.request = null;
        return true;
      },
    };
  }

  invalidate(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.request = null;
  }

  clear(): void {
    this.sessions.clear();
  }
}
