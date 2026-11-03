import type { LearningArtifact, LearningPacket } from '../../shared/learning.js';
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function coverageNote(artifact: Pick<LearningArtifact, 'coverage' | 'sources'>) {
  const excluded = artifact.sources.filter((s) => s.status === 'excluded');
  const pending = artifact.sources.filter((s) => !['ready', 'excluded'].includes(s.status));
  return `Cobertura ${artifact.coverage === 'complete' ? 'das fontes incluídas concluída' : 'parcial'}. ${pending.length} fonte(s) pendente(s); ${excluded.length} não incluída(s).`;
}
export function mindmapSvg(packet: LearningPacket, note = 'Material gerado por IA para revisão.') {
  const nodes = packet.mindmap;
  const positioned = new Map<string, { x: number; y: number }>();
  let row = 0;
  function place(id: string, depth: number): number {
    const children = nodes.filter((n) => n.parent === id);
    const ys = children.map((n) => place(n.id, depth + 1));
    const y = ys.length ? (ys[0] + ys.at(-1)!) / 2 : row++ * 100 + 55;
    positioned.set(id, { x: depth * 290 + 20, y });
    return y;
  }
  const root = nodes.find((n) => n.parent === null);
  if (!root) throw new Error('Mapa sem raiz.');
  place(root.id, 0);
  const width = Math.max(...[...positioned.values()].map((p) => p.x)) + 280;
  const height = Math.max(row * 100 + 20, 140);
  const edges = nodes
    .filter((n) => n.parent)
    .map((n) => {
      const p = positioned.get(n.parent!)!;
      const c = positioned.get(n.id)!;
      return `<path d="M${p.x + 240},${p.y} H${p.x + 260} V${c.y} H${c.x}"/>`;
    })
    .join('');
  const boxes = nodes
    .map((n) => {
      const p = positioned.get(n.id)!;
      const words = n.label.split(/\s+/);
      const lines: string[] = [''];
      for (const word of words) {
        if (lines.at(-1)!.length + word.length > 28) lines.push(word);
        else lines[lines.length - 1] += (lines.at(-1) ? ' ' : '') + word;
      }
      return `<g><title>${escape(n.label)} — ${escape(n.refs.join(', '))}</title><rect x="${p.x}" y="${p.y - 38}" width="240" height="76" rx="6"/><text x="${p.x + 12}" y="${p.y - 13}">${lines
        .slice(0, 3)
        .map((l, i) => `<tspan x="${p.x + 12}" dy="${i ? 18 : 0}">${escape(l)}</tspan>`)
        .join('')}</text></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(width, 900)}" height="${height + 50}" viewBox="0 0 ${Math.max(width, 900)} ${height + 50}" role="img" aria-label="${escape(packet.title)}"><title>${escape(packet.title)}</title><desc>${escape(note)}</desc><style>svg{background:#f5f7f4}path{fill:none;stroke:#8da394;stroke-width:1.5}rect{fill:white;stroke:#c5d1c7}text{font:14px Arial,sans-serif;fill:#24352b}</style><text x="20" y="25">${escape(note)}</text><g transform="translate(0 45)">${edges}${boxes}</g></svg>`;
}
export function slidesHtml(packet: LearningPacket, note = 'Material gerado por IA para revisão.') {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><title>${escape(packet.title)}</title><style>body{margin:0;background:#f5f7f4;color:#24352b;font-family:Arial,sans-serif}main{max-width:1100px;margin:auto}section{background:white;padding:48px;margin:28px 16px;border:1px solid #dce1db;min-height:420px;box-sizing:border-box}h1{font-size:32px;line-height:1.3}li{font-size:21px;line-height:1.7;margin:14px 0}small,footer{font-size:12px;color:#52665a}footer{margin-top:36px}@page{size:A4 landscape;margin:12mm}@media print{body{background:white}section{margin:0;border:0;padding:20px;min-height:0;break-after:page;break-inside:avoid}section:last-child{break-after:auto}li{font-size:18px}}</style></head><body><main>${packet.slides.map((s, i) => `<section><small>${escape(packet.title)} · ${i + 1}/${packet.slides.length}</small><h1>${escape(s.title)}</h1><ul>${s.bullets.map((b) => `<li>${escape(b)}</li>`).join('')}</ul><footer>Material gerado por IA para revisão. ${escape(note)} Fontes: ${escape(s.refs.join(', '))}</footer></section>`).join('')}</main></body></html>`;
}
