import { useEffect, useRef, type ReactNode } from 'react';
import { BookOpen, X, ChevronRight } from 'lucide-react';
import type { Assessment } from '../../shared/types';
const statuses: Record<string, string> = {
  available: 'Disponível',
  in_progress: 'Em andamento',
  submitted: 'Entregue',
  closed: 'Encerrada',
  unknown: 'A consultar',
  queued: 'Na fila',
  running: 'Em execução',
  completed: 'Concluído',
  failed: 'Falhou',
  needs_action: 'Sua atenção',
  uncertain: 'Conferir resultado',
};
export function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{statuses[status] || status}</span>;
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Fechar" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <BookOpen size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Stat({
  icon,
  value,
  title,
  note,
  tone = '',
}: {
  icon: ReactNode;
  value: number;
  title: string;
  note: string;
  tone?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className={`soft-icon ${tone}`}>{icon}</span>
        <span className="stat-value">{value.toString().padStart(2, '0')}</span>
      </div>
      <h3>{title}</h3>
      <p>{note}</p>
    </article>
  );
}
export function AssessmentRow({
  assessment: a,
  open,
}: {
  assessment: Assessment;
  open: (id: number) => Promise<void>;
}) {
  const date = a.due_at ? new Date(a.due_at) : null;
  return (
    <button className="assessment-row" onClick={() => void open(a.id)}>
      <span className="date-tile">
        {date
          ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', day: '2-digit' }).format(
              date,
            )
          : '—'}
        <small>
          {date
            ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', month: 'short' })
                .format(date)
                .replace('.', '')
            : 'DATA'}
        </small>
      </span>
      <span className="assessment-name">
        <strong>{a.title}</strong>
        <small>{a.course_name}</small>
      </span>
      <Badge status={a.status} />
      <ChevronRight size={17} />
    </button>
  );
}
