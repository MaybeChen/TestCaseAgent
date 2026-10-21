import type { ContainerContext, RecordedEvent, SemanticTrace } from '../domain/semantic-trace.js';
export function extractIdentity(containers: ContainerContext[], eventId: string, values: SemanticTrace['values']): RecordedEvent['identityCandidates'] {
  const primary = containers.find(c => c.type === 'table_row') ?? containers.find(c => c.type === 'form');
  return (primary?.fields ?? []).filter(f => !f.redacted && f.value && f.name && /^(用户名|姓名|邮箱|客户名称|客户编号|订单号|订单编号|username|user name|email|e-mail|customer name|customer number|order number)$/i.test(f.name)).map((f, index) => {
    const ref = `${eventId}:identity:${index}`; values[ref] = { value: f.value, redacted: false };
    return { field: f.name!, valueRef: ref, source: f.source, stability: 'unknown' as const };
  });
}
