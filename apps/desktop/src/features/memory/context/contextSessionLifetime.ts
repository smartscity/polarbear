/** Owns operation accounting for one mounted workspace session, not remote cancellation. */
export class ContextSessionLifetime {
  private generation = 0;
  private active = false;
  private pending = 0;

  constructor(readonly workspaceRoot: string) {}

  activate(): void { this.generation += 1; this.active = true; this.pending = 0; }
  dispose(): void { this.active = false; this.generation += 1; this.pending = 0; }

  current(): () => boolean {
    const generation = this.generation;
    return () => this.active && generation === this.generation;
  }

  begin() {
    if (!this.active) return null;
    const isCurrent = this.current();
    this.pending += 1;
    let finished = false;
    return {
      isCurrent,
      finish: () => {
        if (!finished && isCurrent()) this.pending -= 1;
        finished = true;
        return this.pending > 0;
      },
    };
  }
}
