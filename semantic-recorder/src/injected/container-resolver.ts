import type { ContainerContext, Field } from '../domain/semantic-trace.js';
import { clip, inspect, readValue, safeText, sensitive } from './element-inspector.js';
export interface ContainerResolver { supports(element: Element): boolean; resolve(element: Element): ContainerContext | null }
const rowSelector = 'tr,[role=row]';
export class TableRowResolver implements ContainerResolver {
  supports(el: Element) { return !!el.closest(rowSelector); }
  resolve(el: Element): ContainerContext | null {
    const row = el.closest(rowSelector);
    if (!row) return null;
    const table = row.closest('table,[role=table],[role=grid]');
    const cells = Array.from(row.querySelectorAll('td,th,[role=cell],[role=gridcell],[role=rowheader]')).filter(c => c.closest(rowSelector) === row);
    const headers = table ? Array.from(table.querySelectorAll('th,[role=columnheader]')).filter(h => h.closest('table,[role=table],[role=grid]') === table && h.getAttribute('scope') !== 'row') : [];
    const headerRows = new Set(headers.map(h => h.closest(rowSelector)));
    const simple = headerRows.size === 1 && headers.length === cells.length && ![...headers, ...cells].some(c => Number(c.getAttribute('colspan') ?? 1) !== 1 || Number(c.getAttribute('rowspan') ?? 1) !== 1);
    let incomplete = !table || cells.length > 30;
    const fields: Field[] = [];
    cells.slice(0, 30).forEach((cell, index) => {
      // Action cells provide context, not candidate identity fields.
      if (cell.querySelector('button,a,input,select,textarea,[role=button]')) return;
      const ids = (cell.getAttribute('headers') ?? '').split(/\s+/).filter(Boolean);
      let names: string[] = [];
      if (ids.length) names = ids.map(id => cell.ownerDocument.getElementById(id)).filter((h): h is HTMLElement => !!h && h.closest('table,[role=table],[role=grid]') === table).map(safeText);
      else if (cell.hasAttribute('aria-colindex')) {
        const matches = headers.filter(h => h.getAttribute('aria-colindex') === cell.getAttribute('aria-colindex'));
        if (matches.length === 1) names = matches.map(safeText);
      } else if (simple && headers[index]) names = [safeText(headers[index]!)];
      const name = names.length ? clip(names.join(' / ')) : undefined;
      if (!name) incomplete = true;
      fields.push({ name, value: safeText(cell), redacted: sensitive(cell), index, source: 'table_cell' });
    });
    return { type: 'table_row', name: table?.getAttribute('aria-label') ?? undefined, fields, incomplete, evidence: [simple ? 'single header row matched by column order' : 'explicit headers/aria-colindex where available; unnamed cells retain index'] };
  }
}
export class FormResolver implements ContainerResolver {
  supports(el: Element) { return !!el.closest('form,[role=form]'); }
  resolve(el: Element): ContainerContext | null {
    const form = el.closest('form,[role=form]'); if (!form) return null;
    const controls = Array.from(form.querySelectorAll('input,select,textarea')).filter(c => c.closest('form,[role=form]') === form);
    return { type: 'form', name: inspect(form).accessibleName, fields: controls.slice(0, 20).map((control, index) => ({ name: inspect(control).label ?? inspect(control).ariaLabel ?? control.getAttribute('name') ?? undefined, ...readValue(control), index, source: 'form_field' as const })), incomplete: controls.length > 20, evidence: ['nearest form ancestor; control labels are candidates'] };
  }
}
export class DialogResolver implements ContainerResolver {
  supports(el: Element) { return !!el.closest('dialog,[role=dialog],[role=alertdialog]'); }
  resolve(el: Element): ContainerContext | null { const d = el.closest('dialog,[role=dialog],[role=alertdialog]'); return d ? { type: 'dialog', name: inspect(d).accessibleName, fields: [], summary: safeText(d), incomplete: false, evidence: ['dialog ancestor'] } : null; }
}
export class ListResolver implements ContainerResolver {
  supports(el: Element) { return !!el.closest('li,[role=listitem],[data-recorder-card]'); }
  resolve(el: Element): ContainerContext | null { const n = el.closest('li,[role=listitem],[data-recorder-card]'); return n ? { type: n.hasAttribute('data-recorder-card') ? 'card' : 'list_item', fields: [], summary: safeText(n), incomplete: true, evidence: ['list item or explicitly marked card; no inferred entity'] } : null; }
}
export class GenericResolver implements ContainerResolver {
  supports() { return true; }
  resolve(el: Element): ContainerContext { const ancestors: string[] = []; let p = el.parentElement; for (let i = 0; p && i < 3; i++, p = p.parentElement) ancestors.push(p.tagName.toLowerCase()); return { type: 'generic', fields: [], summary: safeText(el.parentElement ?? el), incomplete: true, evidence: ancestors }; }
}
const resolvers = [new TableRowResolver(), new FormResolver(), new DialogResolver(), new ListResolver()];
export function resolveContainers(el: Element): ContainerContext[] {
  const result = resolvers.filter(r => r.supports(el)).map(r => r.resolve(el)).filter((c): c is ContainerContext => c !== null);
  return result.length ? result : [new GenericResolver().resolve(el)];
}
