/** A window-local owner for navigation intent, not document buffers or IO. */
export class DocumentNavigation {
  private current: symbol | null = null;

  begin(): () => boolean {
    const request = Symbol();
    this.current = request;
    return () => this.current === request;
  }

  invalidate(): void {
    this.current = null;
  }
}

/** null means superseded navigation, not a missing or unreadable document. */
export type DocumentOpenResult = boolean | null;
