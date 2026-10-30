import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  CalendarDays,
  CheckCheck,
  ExternalLink,
  FileText,
  ListChecks,
  RefreshCw,
  Save,
} from 'lucide-react';
import type { ChecklistItem, ChecklistPlan } from '../../shared/checklists';
import { api, formatDate } from '../api';
import { Empty } from './ui';
import './checklists.css';
const deadlineDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Bahia',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export default function ChecklistBoard() {
  const [plans, setPlans] = useState<ChecklistPlan[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setPlans(await api<ChecklistPlan[]>('/checklists'));
      setError('');
    } catch {
      setError('Não foi possível carregar o checklist. Confira a conexão com o aplicativo local.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const plan = plans.find((plan) => plan.id === selected) || plans[0];
  const update = async (item: ChecklistItem, change: { done?: boolean; notes?: string }) => {
    setError('');
    try {
      const updated = await api<ChecklistPlan>(`/checklist-items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision: item.revision, ...change }),
      });
      setPlans((current) => current.map((plan) => (plan.id === updated.id ? updated : plan)));
    } catch (err) {
      await load();
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
      throw err;
    }
  };
  if (loading)
    return (
      <p className="loading" role="status">
        Carregando seu checklist…
      </p>
    );
  if (!plan)
    return (
      <>
        <div className="message" role="status">
          {error || 'Nenhum checklist cadastrado ainda.'}
        </div>
        <Empty
          title="Seu próximo projeto começa aqui"
          text="Os checklists de disciplina serão exibidos com etapas e fontes verificadas."
        />
        <button className="button secondary" onClick={() => void load()}>
          <RefreshCw size={16} />
          Atualizar checklist
        </button>
      </>
    );
  const required = plan.items.filter((item) => item.required);
  const done = required.filter((item) => item.done).length;
  const percent = required.length ? Math.round((done / required.length) * 100) : 0;
  const phases = [...new Set(plan.items.map((item) => item.phase))];
  const personalExpired = Date.parse(plan.personal_due_at) < Date.now();
  return (
    <section className="checklist-board">
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {plans.length > 1 && (
        <label className="checklist-picker">
          Disciplina
          <select value={plan.id} onChange={(event) => setSelected(Number(event.target.value))}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="checklist-hero">
        <span className="soft-icon">
          <ListChecks size={25} />
        </span>
        <div>
          <div className="eyebrow">SEU PLANO DE CONCLUSÃO</div>
          <h2>{plan.title}</h2>
          <p>{plan.course_name}</p>
          <p>{plan.summary}</p>
        </div>
      </div>
      <div className="checklist-deadlines">
        <div>
          <CalendarDays size={20} />
          <span>
            <small>MINHA META · ANTES DO DIA 31</small>
            <strong>{deadlineDate(plan.personal_due_at)}</strong>
            <p>
              {personalExpired
                ? 'Sua meta pessoal passou. Reorganize as pendências e confira o prazo oficial.'
                : 'Meta pessoal: concluir em 30/10 até 23h59.'}
            </p>
          </span>
        </div>
        <div>
          <CalendarDays size={20} />
          <span>
            <small>PRAZO OFICIAL NO AVA</small>
            <strong>{deadlineDate(plan.official_due_at)}</strong>
            <p>Relatório final e fechamento da avaliação semestral.</p>
          </span>
        </div>
      </div>
      <details className="checklist-warnings" open>
        <summary>
          <AlertCircle size={17} />
          Leia antes de começar · pontos de atenção
        </summary>
        <ul>
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </details>
      <div className="checklist-layout">
        <div className="checklist-tasks">
          <div className="section-heading">
            <h2>O que preciso fazer</h2>
            <select
              aria-label="Filtrar tarefas do checklist"
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">Todas as tarefas</option>
              <option value="pending">Só pendentes</option>
              <option value="done">Só concluídas</option>
            </select>
          </div>
          {phases.map((phase) => {
            const group = plan.items.filter((item) => item.phase === phase);
            const visible = group.filter(
              (item) => filter === 'all' || item.done === (filter === 'done'),
            );
            if (!visible.length) return null;
            return (
              <section className="panel checklist-phase" key={phase}>
                <div className="section-heading">
                  <h3>{phase}</h3>
                  <span className="count">
                    {group.filter((item) => item.done).length}/{group.length}
                  </span>
                </div>
                {visible.map((item) => (
                  <ChecklistTask key={item.id} item={item} plan={plan} update={update} />
                ))}
              </section>
            );
          })}
          {!plan.items.some((item) => filter === 'all' || item.done === (filter === 'done')) && (
            <Empty
              title="Nenhuma tarefa neste filtro"
              text="Mude o filtro para ver as outras etapas."
            />
          )}
        </div>
        <aside className="checklist-aside">
          <section className="panel checklist-progress">
            <div className="panel-title">
              <CheckCheck size={20} />
              <h3>Meu progresso</h3>
            </div>
            <strong>{percent}%</strong>
            <p>
              {done} de {required.length} exigências documentadas marcadas
            </p>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Exigências concluídas"
              aria-valuenow={done}
              aria-valuemin={0}
              aria-valuemax={required.length}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            <p className="hint">
              {plan.items.filter((item) => item.done).length} de {plan.items.length} tarefas no
              total, incluindo organização e conferências.
            </p>
            <p className="hint">
              Marque somente o que você já concluiu. As marcações ficam no SQLite e não representam
              envio nem aprovação na faculdade.
            </p>
            <a
              className="button primary full"
              href={plan.source_url}
              target="_blank"
              rel="noreferrer"
            >
              Abrir entrega no AVA
              <ExternalLink size={15} />
            </a>
            <a className="button secondary full" href={`/api/checklists/${plan.id}/markdown`}>
              <ArrowDownToLine size={15} />
              Exportar checklist
            </a>
            <button className="text-button" onClick={() => void load()}>
              <RefreshCw size={14} />
              Recarregar marcações
            </button>
          </section>
          <section className="panel checklist-sources">
            <div className="panel-title">
              <FileText size={19} />
              <h3>Fontes conferidas</h3>
            </div>
            <p className="hint">
              Leitura e consulta: {formatDate(plan.source_checked_at, true)}. Os links levam aos
              materiais oficiais.
            </p>
            {plan.sources.map((source) => (
              <div key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                  <ExternalLink size={13} />
                </a>
                <p>{source.detail}</p>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}

function ChecklistTask({
  item,
  plan,
  update,
}: {
  item: ChecklistItem;
  plan: ChecklistPlan;
  update: (item: ChecklistItem, change: { done?: boolean; notes?: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(item.done);
  const [notes, setNotes] = useState(item.notes);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dirty) setNotes(item.notes);
  }, [item.notes, dirty]);
  useEffect(() => {
    setChecked(item.done);
  }, [item.done, item.revision]);
  const persist = async (change: { done?: boolean; notes?: string }) => {
    setBusy(true);
    setSaved(false);
    try {
      await update(item, change);
      if (change.notes !== undefined) {
        setDirty(false);
        setSaved(true);
      }
    } catch {
      setChecked(
        item.done,
      ); /* O painel mostra o erro; manter o texto local para não perder o rascunho. */
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className={`checklist-task ${checked ? 'done' : ''}`}>
      <label className="checklist-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(event) => {
            setChecked(event.target.checked);
            void persist({ done: event.target.checked });
          }}
        />
        <span>{item.title}</span>
      </label>
      <div className="checklist-task-body">
        <span className={`checklist-kind ${item.kind}`}>
          {item.kind === 'requirement'
            ? 'Exigência nos materiais'
            : item.kind === 'verify'
              ? 'Conferir no AVA / com tutor'
              : 'Organização sugerida'}
        </span>
        <p>{item.description}</p>
        <div className="checklist-references">
          {item.source_refs.map((ref) => {
            const source = plan.sources.find((source) => source.id === ref);
            return (
              source && (
                <a key={ref} href={source.url} target="_blank" rel="noreferrer">
                  Fonte: {source.title}
                  <ExternalLink size={11} />
                </a>
              )
            );
          })}
        </div>
        <details>
          <summary>
            {item.notes ? 'Minhas anotações salvas' : 'Adicionar anotações e links'}
          </summary>
          <label>
            Anotações para: {item.title}
            <textarea
              rows={3}
              value={notes}
              maxLength={5000}
              onChange={(event) => {
                setNotes(event.target.value);
                setDirty(true);
                setSaved(false);
              }}
              placeholder="O que já fiz, link do arquivo, dúvida ou próximo passo…"
            />
          </label>
          <div className="button-group">
            <button
              className="button secondary small"
              disabled={busy || !dirty}
              onClick={() => void persist({ notes })}
            >
              <Save size={14} />
              Salvar anotações
            </button>
            {saved && (
              <span role="status" className="hint">
                Anotações salvas.
              </span>
            )}
            {dirty && <span className="hint">Rascunho ainda não salvo.</span>}
          </div>
        </details>
      </div>
    </article>
  );
}
