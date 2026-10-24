import { updateTableInteractionState } from "./tableInteractionState";

const menus = new Map<HTMLElement, { owner: HTMLElement; close: (restoreFocus?: boolean) => void }>();

/** Registers disposal before scheduling focus, so a closed portal cannot revive. */
export function registerTableMenu(
  owner: HTMLElement,
  menu: HTMLElement,
  focus: () => void,
  restoreFocus?: () => void,
): (restoreFocus?: boolean) => void {
  let closed = false;
  let frame = 0;
  const close = (restore = true) => {
    if (closed) return;
    closed = true;
    window.cancelAnimationFrame(frame);
    document.removeEventListener("pointerdown", outside, true);
    window.removeEventListener("blur", blur);
    menus.delete(menu);
    updateTableInteractionState(owner, { mode: "idle" });
    menu.remove();
    if (restore && owner.isConnected) restoreFocus?.();
  };
  const outside = (event: PointerEvent) => {
    if (!(event.target instanceof Node) || !menu.contains(event.target)) close();
  };
  const blur = () => close(false);
  menus.set(menu, { owner, close });
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("blur", blur, { once: true });
  frame = window.requestAnimationFrame(() => {
    if (closed) return;
    if (!owner.isConnected || !menu.isConnected) { close(false); return; }
    focus();
  });
  return close;
}

export function closeTableMenus(owner?: HTMLElement): void {
  for (const entry of menus.values()) {
    if (!owner || entry.owner === owner) entry.close(false);
  }
}
