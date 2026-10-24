import { useEffect } from "react";
import { BergamotWorker } from "../../shared/translation/bergamotWorker";
import { captionRequest } from "./captionAdapter";
import { useUserSettings } from "../../shared/settings/useUserSettings";

/** The hidden native window owns this queue consumer, independently of the editor and caption panel. */
export function CaptionTranslator() {
  const { caption } = useUserSettings();
  useEffect(() => {
    if (!caption.showChinese) return;
    let disposed = false;
    let engine: BergamotWorker | undefined;
    let lastWork = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;
    const consume = async () => {
      try {
        const job = await captionRequest<"claim">({ action: "claim" });
        if (disposed) return;
        if (job) {
          lastWork = Date.now();
          let chinese: string | null = null;
          try {
            engine ??= new BergamotWorker();
            chinese = await Promise.race([engine.translate(job.english), new Promise<never>((_, reject) => {
              deadline = setTimeout(() => reject(new Error("Caption translation timeout")), 90_000);
            })]);
          } catch { engine?.dispose(); engine = undefined; }
          finally { clearTimeout(deadline); }
          if (!disposed) await captionRequest({ action: "complete", id: job.id, lease: job.lease, chinese });
        } else if (Date.now() - lastWork > 90_000) { engine?.dispose(); engine = undefined; }
      } catch { engine?.dispose(); engine = undefined; }
      if (!disposed) timer = setTimeout(() => { void consume(); }, 750);
    };
    timer = setTimeout(() => { void consume(); }, 0);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(deadline); engine?.dispose(); };
  }, [caption.showChinese]);
  return null;
}
