import type { Snapshot } from '../domain/semantic-trace.js';
import { safeText } from './element-inspector.js';
export function snapshot(target?: Element): Snapshot {
  const visible = (el: Element) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  return { url: location.href.slice(0, 4096), visibleMessages: Array.from(document.querySelectorAll('[role=status],[role=alert],[aria-live=polite],[aria-live=assertive]')).filter(visible).slice(0, 10).map(safeText), dialogs: Array.from(document.querySelectorAll('dialog[open],[role=dialog],[role=alertdialog]')).filter(visible).slice(0, 10).map(safeText), targetConnected: target?.isConnected };
}
export function observeAfter(id: string, target: Element, before: Snapshot, emit: (message: unknown) => void): () => void {
  let done = false;
  const finish = () => {
    if (done) return; done = true; observer.disconnect(); clearTimeout(timeout); clearTimeout(settle);
    const after = snapshot(target);
    emit({ kind: 'state', id, after, changed: JSON.stringify(before) !== JSON.stringify(after) });
  };
  let settle: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => { clearTimeout(settle); settle = setTimeout(finish, 40); });
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const timeout = setTimeout(finish, 800);
  return finish;
}
