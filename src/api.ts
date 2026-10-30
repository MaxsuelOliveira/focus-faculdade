export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Focus-Client': 'local', ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}
export const post = <T>(url: string, body: unknown = {}) =>
  api<T>(url, { method: 'POST', body: JSON.stringify(body) });
export function formatDate(value: string | null, time = false) {
  if (!value) return 'Prazo a confirmar';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit',
    month: 'short',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(value));
}
