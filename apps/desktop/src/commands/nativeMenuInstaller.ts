type MenuHandle = {
  close(): Promise<void>;
  setAsAppMenu(): Promise<{ close(): Promise<void> } | null>;
};
type Installation = { create: () => Promise<MenuHandle>; cancelled: boolean };

/** Serializes native installation and retains at most one pending replacement. */
export class NativeMenuInstaller {
  private pending: Installation | null = null;
  private running = false;

  constructor(private readonly reportError: (error: unknown) => void) {}

  replace(create: () => Promise<MenuHandle>): () => void {
    const installation = { create, cancelled: false };
    if (this.pending) this.pending.cancelled = true;
    this.pending = installation;
    void this.drain();
    return () => {
      installation.cancelled = true;
      if (this.pending === installation) this.pending = null;
    };
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending) {
        const installation = this.pending;
        this.pending = null;
        let menu: MenuHandle | undefined;
        try {
          menu = await installation.create();
          if (!installation.cancelled) {
            // Tauri retains the installed native menu; returned RIDs are separate leases.
            const previous = await menu.setAsAppMenu();
            await previous?.close();
          }
        } catch (error) {
          this.reportError(error);
        } finally {
          try { await menu?.close(); } catch (error) { this.reportError(error); }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
