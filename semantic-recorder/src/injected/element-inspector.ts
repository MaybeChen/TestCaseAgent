import type { ElementContext } from '../domain/semantic-trace.js';
export const clip = (value: string | null | undefined, length = 240): string => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
export const sensitive = (el: Element): boolean => el.matches('input[type=password], [data-recorder-sensitive], [autocomplete=current-password], [autocomplete=new-password], [autocomplete=cc-number], [autocomplete=cc-csc], [autocomplete=one-time-code]') || !!el.closest('[data-recorder-sensitive]');
export function safeText(el: Element): string {
  if (sensitive(el)) return '[REDACTED]';
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('input,textarea,script,style,[data-recorder-sensitive]').forEach(n => n.remove());
  return clip(copy.textContent);
}
export function inspect(el: Element): ElementContext {
  const attr = (name: string) => clip(el.getAttribute(name)) || undefined;
  const label = 'labels' in el ? clip(Array.from((el as HTMLInputElement).labels ?? []).map(l => safeText(l)).join(' ')) || undefined : undefined;
  const labelled = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean).map(id => el.ownerDocument.getElementById(id)).filter((n): n is HTMLElement => !!n).map(safeText).join(' ');
  const candidates = [['aria-labelledby', labelled], ['aria-label', attr('aria-label')], ['label', label], ['alt', attr('alt')], ['title', attr('title')], ['text', safeText(el)]] as const;
  const name = candidates.find(([, value]) => !!value);
  const tag = el.tagName.toLowerCase();
  const type = attr('type');
  const implicit = tag === 'button' ? 'button' : tag === 'a' && el.hasAttribute('href') ? 'link' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? (type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' ? 'button' : 'textbox') : undefined;
  return { tag, role: attr('role') ?? implicit, accessibleName: clip(name?.[1]) || undefined,
    nameSource: name?.[0], nameIsCandidate: true, text: safeText(el) || undefined,
    ariaLabel: attr('aria-label'), label, placeholder: attr('placeholder'), title: attr('title'),
    testId: attr('data-testid'), id: attr('id'), type, sensitive: sensitive(el) };
}
export function readValue(el: Element): { value: string; redacted: boolean } {
  if (sensitive(el)) return { value: '[REDACTED]', redacted: true };
  let value = '';
  if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) value = String(el.checked);
  else if (el instanceof HTMLSelectElement) value = JSON.stringify(Array.from(el.selectedOptions).map(o => o.value));
  else if ('value' in el) value = String(el.value);
  else value = safeText(el);
  return { value: value.slice(0, 1000), redacted: false };
}
