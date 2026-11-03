import { useState, type ReactNode } from 'react';
import type { LearningPacket } from '../../shared/learning';
export default function LearningMap({
  packet,
  reference,
}: {
  packet: LearningPacket;
  reference: (ref: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(
    new Set(
      packet.mindmap
        .filter((n) => n.parent !== null && packet.mindmap.some((c) => c.parent === n.id))
        .map((n) => n.id),
    ),
  );
  const render = (id: string): ReactNode => {
    const n = packet.mindmap.find((n) => n.id === id)!;
    const children = packet.mindmap.filter((c) => c.parent === id);
    const closed = collapsed.has(id);
    return (
      <li key={id}>
        <div className="learn-map-node">
          {children.length > 0 && (
            <button
              aria-label={`${closed ? 'Expandir' : 'Recolher'} ${n.label}`}
              aria-expanded={!closed}
              onClick={() =>
                setCollapsed((old) => {
                  const next = new Set(old);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            >
              {closed ? '+' : '−'}
            </button>
          )}
          <strong>{n.label}</strong>
          <button onClick={() => reference(n.refs[0])}>Fonte</button>
        </div>
        {children.length > 0 && !closed && <ul>{children.map((c) => render(c.id))}</ul>}
      </li>
    );
  };
  return (
    <div className="learn-map-tree">
      <ul>{packet.mindmap.filter((n) => n.parent === null).map((n) => render(n.id))}</ul>
    </div>
  );
}
