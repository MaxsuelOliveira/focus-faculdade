import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  FileText,
  Network,
  Presentation,
  GraduationCap,
} from 'lucide-react';
import { api, post } from '../api';
import type { LearningArtifact, LearningRun, LearningSource } from '../../shared/learning';
import type { Course } from '../../shared/types';
import './learning.css';
import { Modal } from './ui';
import LearningMap from './LearningMap';

type LearningCourse = Course & {
  learning_state: string;
  source_count: number;
  ready_count: number;
  state_origin: string;
  excluded_count: number;
};
type Data = { courses: LearningCourse[]; runs: LearningRun[]; artifacts: LearningArtifact[] };
const states: Record<string, string> = {
  in_progress: 'Em andamento',
  completed: 'Finalizadas',
  unclassified: 'Não classificadas',
};
const statuses: Record<string, string> = {
  queued: 'Na fila',
  running: 'Consumindo',
  paused: 'Pausado',
  needs_action: 'Revisão ou geração pendente',
  completed: 'Caderno criado',
  failed: 'Falhou',
};
const formats = [
  { id: 'summary', label: 'Resumo', icon: FileText },
  { id: 'mindmap', label: 'Mapa mental', icon: Network },
  { id: 'slides', label: 'Slides', icon: Presentation },
  { id: 'quiz', label: 'Simulado', icon: GraduationCap },
] as const;
export default function LearningDesk() {
  const [data, setData] = useState<Data>({ courses: [], runs: [], artifacts: [] });
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [runId, setRunId] = useState<number | null>(null);
  const [sources, setSources] = useState<LearningSource[]>([]);
  const [artifact, setArtifact] = useState<LearningArtifact | null>(null);
  const [tab, setTab] = useState<(typeof formats)[number]['id']>('summary');
  const [slide, setSlide] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<{
    correct: number;
    total: number;
    result: { correct: boolean; expected: number; explanation: string; refs: string[] }[];
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<LearningSource | null>(null);
  const [importing, setImporting] = useState(false);
  const [importTarget, setImportTarget] = useState<LearningSource | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [importTitle, setImportTitle] = useState('');
  const [importText, setImportText] = useState('');
  const [importLocator, setImportLocator] = useState('Texto fornecido pelo aluno');
  const refresh = useCallback(async () => {
    setData(await api<Data>('/learning'));
    setLoaded(true);
  }, []);
  useEffect(() => {
    void api<{ models: string[] }>('/ai/models')
      .then((m) => setModels(m.models))
      .catch(() => {});
    void refresh().catch(() => {
      setError('Não foi possível consultar seus cadernos.');
      setLoaded(true);
    });
    const timer = setInterval(() => void refresh().catch(() => {}), 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = data.runs.find((r) => r.id === runId);
  const course = data.courses.find((c) => c.id === run?.course_id);
  const activeCourseId = run?.course_id;
  const runUpdatedAt = run?.updated_at;
  useEffect(() => {
    if (!activeCourseId) return;
    let active = true;
    void api<LearningSource[]>(`/learning/courses/${activeCourseId}/sources`)
      .then((value) => {
        if (active) setSources(value);
      })
      .catch(() => {
        if (active) setError('Não foi possível ler as fontes.');
      });
    return () => {
      active = false;
    };
  }, [activeCourseId, runUpdatedAt]);
  async function action(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operação não concluída.');
    } finally {
      setBusy(false);
    }
  }
  function openArtifact(a: LearningArtifact) {
    setArtifact(a);
    setRunId(a.run_id);
    setSlide(0);
    setAnswers(Array(a.packet.quiz.length).fill(-1));
    setResult(null);
  }
  const sourceButtons = (refs: string[]) => (
    <div className="learn-refs">
      {refs.map((ref) => {
        const s = (artifact?.sources || sources).find((s) => ref === `source:${s.id}`);
        return (
          <button key={ref} onClick={() => s && setSource(s)} disabled={!s}>
            {s?.title || ref}
          </button>
        );
      })}
    </div>
  );
  return (
    <section className="learn" aria-label="Aprender e consumir">
      <div className="learn-heading">
        <div>
          <h1>{artifact ? artifact.packet.title : run ? course?.name : 'Aprender e consumir'}</h1>
          <p>
            {artifact
              ? 'Conteúdo gerado por IA para revisão. Consulte as fontes de cada conceito.'
              : run
                ? 'Acompanhe as fontes consumidas e resolva o que ficou pendente.'
                : 'Escolha as disciplinas e transforme os materiais em um caderno de estudos.'}
          </p>
        </div>
        <button disabled={busy} onClick={() => void action(() => post('/learning/discover'))}>
          <RefreshCw size={16} /> Descobrir disciplinas
        </button>
      </div>
      {error && (
        <p className="learn-error" role="alert">
          {error}
        </p>
      )}
      {(run || artifact) && (
        <button
          className="learn-back"
          onClick={() => {
            setRunId(null);
            setArtifact(null);
            setSources([]);
          }}
        >
          <ArrowLeft size={16} /> Todas as disciplinas
        </button>
      )}
      {!run && !artifact && (
        <>
          <div className="learn-filters">
            <div>
              {[['all', 'Todas'], ...Object.entries(states)].map(([id, label]) => (
                <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              aria-label="Buscar disciplina"
              placeholder="Buscar disciplina"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="learn-grid">
            <section className="learn-panel">
              <h2>Suas disciplinas</h2>
              {!loaded ? (
                <p>Consultando disciplinas…</p>
              ) : (
                data.courses
                  .filter(
                    (c) =>
                      (filter === 'all' || c.learning_state === filter) &&
                      c.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                  )
                  .map((c) => (
                    <div className="learn-course" key={c.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          onChange={() =>
                            setSelected((s) =>
                              s.includes(c.id) ? s.filter((id) => id !== c.id) : [...s, c.id],
                            )
                          }
                        />
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.ready_count} de {c.source_count} fontes processadas
                          </small>
                        </span>
                      </label>
                      <select
                        aria-label={`Situação de ${c.name}`}
                        value={c.learning_state}
                        disabled={busy}
                        onChange={(e) =>
                          void action(() =>
                            api(`/learning/courses/${c.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ state: e.target.value }),
                            }),
                          )
                        }
                      >
                        {Object.entries(states).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
              )}
              {loaded && !data.courses.length && (
                <p>Nenhuma disciplina descoberta. Consulte o portal para começar.</p>
              )}
              <p className="learn-caption">
                Classificação manual. A data do curso não comprova conclusão ou matrícula ativa.
              </p>
            </section>
            <aside className="learn-panel">
              <h2>Seu próximo caderno</h2>
              <BookOpen size={36} strokeWidth={1} />
              <h3>{selected.length} disciplina(s) selecionada(s)</h3>
              <p>
                Resumo com referências, mapa mental, slides por assunto e simulado com explicações.
              </p>
              <div className="learn-note">
                Vídeos só serão considerados consumidos quando houver texto ou transcrição
                acessível. Pendências permanecem visíveis.
              </div>
              <button
                className="learn-primary"
                disabled={busy || !selected.length}
                onClick={() =>
                  void action(async () => {
                    const runs = await post<LearningRun[]>('/learning/runs', {
                      course_ids: selected,
                      outputs: formats.map((f) => f.id),
                    });
                    setRunId(runs[0].id);
                  })
                }
              >
                Aprender e consumir <ArrowRight size={16} />
              </button>
            </aside>
          </div>
          <section className="learn-panel learn-history">
            <h2>Consumos e cadernos</h2>
            {!data.runs.length ? (
              <p>
                Nenhum consumo iniciado. Seus trabalhos aparecerão aqui, inclusive após reiniciar.
              </p>
            ) : (
              data.runs.map((r) => (
                <div className="learn-history-row" key={r.id}>
                  <div>
                    <strong>{data.courses.find((c) => c.id === r.course_id)?.name}</strong>
                    <small>
                      {statuses[r.status]} ·{' '}
                      {new Date(r.updated_at).toLocaleString('pt-BR', {
                        timeZone: 'America/Bahia',
                      })}
                    </small>
                  </div>
                  <button
                    onClick={() => {
                      setRunId(r.id);
                      setArtifact(null);
                    }}
                  >
                    Acompanhar
                  </button>
                  {data.artifacts
                    .filter((a) => a.run_id === r.id)
                    .map((a) => (
                      <button key={a.id} onClick={() => openArtifact(a)}>
                        Abrir caderno
                      </button>
                    ))}
                </div>
              ))
            )}
          </section>
        </>
      )}
      {run && !artifact && (
        <div className="learn-grid">
          <section className="learn-panel">
            <div className="learn-panel-heading">
              <h2>Materiais da disciplina</h2>
              <span>{statuses[run.status]}</span>
            </div>
            <p>
              {sources.filter((s) => s.status === 'ready').length} de{' '}
              {sources.filter((s) => s.status !== 'excluded').length} fontes processadas
            </p>
            <progress
              max={sources.filter((s) => s.status !== 'excluded').length || 1}
              value={sources.filter((s) => s.status === 'ready').length}
            />
            <p className="learn-caption">{run.progress}</p>
            {run.error && <p className="learn-caption">{run.error}</p>}
            {sources.map((s) => (
              <div className="learn-source" key={s.id}>
                <div>
                  <small>
                    {s.kind} ·{' '}
                    {s.status === 'ready'
                      ? 'Processado'
                      : s.status === 'excluded'
                        ? 'Não incluído'
                        : 'Pendente'}
                  </small>
                  <h3>{s.title}</h3>
                  <p>{s.locator || s.reason}</p>
                </div>
                <button onClick={() => setSource(s)}>Detalhes</button>
              </div>
            ))}
            {!sources.length && (
              <p>Aguardando descoberta dos materiais. Nenhuma fonte foi declarada consumida.</p>
            )}
          </section>
          <aside className="learn-panel">
            <h2>Controle do consumo</h2>
            <p>Leitura e transcrição permanecem separadas da geração do caderno.</p>
            <div className="learn-actions">
              <button
                disabled={busy || run.status === 'completed'}
                onClick={() =>
                  void action(() =>
                    post(`/learning/runs/${run.id}/control`, {
                      action: run.status === 'paused' ? 'resume' : 'pause',
                    }),
                  )
                }
              >
                {run.status === 'paused' ? 'Retomar' : 'Pausar'}
              </button>
              <button
                disabled={busy || run.status === 'running' || run.status === 'completed'}
                onClick={() =>
                  void action(() =>
                    post(`/learning/runs/${run.id}/control`, { action: 'reconcile' }),
                  )
                }
              >
                Conferir fontes
              </button>
              <button
                onClick={() => {
                  setImportTarget(null);
                  setImportTitle('');
                  setImportText('');
                  setImporting(true);
                }}
              >
                Adicionar texto ou transcrição
              </button>
              <button
                disabled={busy || !['needs_action', 'paused'].includes(run.status)}
                onClick={() => void action(() => post(`/learning/runs/${run.id}/transcribe`))}
              >
                Transcrever videoaulas localmente
              </button>
            </div>
            <div className="learn-note">
              Para gerar pelo MCP, peça ao assistente para consultar este consumo com{' '}
              <code>learning_context</code> (ID {run.id}) e salvar o caderno com referências.
            </div>
            <label className="learn-model">
              Modelo local no Ollama
              <select
                aria-label="Modelo para gerar o caderno"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="">Selecione um modelo</option>
                {models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            {!models.length && (
              <p>Nenhum modelo local disponível. Inicie o Ollama e atualize os modelos.</p>
            )}
            <div className="learn-actions">
              <button
                onClick={() =>
                  void action(async () =>
                    setModels((await api<{ models: string[] }>('/ai/models')).models),
                  )
                }
              >
                Atualizar modelos
              </button>
              <button
                className="learn-primary"
                disabled={busy || !model || !['needs_action', 'paused'].includes(run.status)}
                onClick={() =>
                  void action(() => post(`/learning/runs/${run.id}/generate`, { model }))
                }
              >
                Gerar caderno com IA local
              </button>
            </div>
            {data.artifacts
              .filter((a) => a.run_id === run.id)
              .map((a) => (
                <button className="learn-primary" key={a.id} onClick={() => openArtifact(a)}>
                  Abrir caderno
                </button>
              ))}
          </aside>
        </div>
      )}
      {artifact && (
        <>
          <div className="learn-result">
            <span>
              {artifact.coverage === 'partial'
                ? 'Cobertura parcial'
                : 'Fontes incluídas processadas'}
            </span>
            <span>
              {run?.provider} · {run?.model}
            </span>
            <a href={`/api/learning/artifacts/${artifact.id}/markdown`} download>
              Exportar Markdown
            </a>
            <a href={`/api/learning/artifacts/${artifact.id}/mindmap.svg`} download>
              Mapa em SVG
            </a>
            <a href={`/api/learning/artifacts/${artifact.id}/slides.html`} download>
              Slides em HTML
            </a>
          </div>
          <div className="learn-tabs">
            {formats.map((f) => (
              <button key={f.id} aria-pressed={tab === f.id} onClick={() => setTab(f.id)}>
                <f.icon size={16} />
                {f.label}
              </button>
            ))}
          </div>
          {tab === 'summary' && (
            <article className="learn-panel">
              {artifact.packet.summary.map((s, i) => (
                <section className="learn-topic" key={i}>
                  <h2>{s.title}</h2>
                  <p>{s.text}</p>
                  {sourceButtons(s.refs)}
                </section>
              ))}
            </article>
          )}
          {tab === 'mindmap' && (
            <section className="learn-panel">
              <h2>Conexões entre os conceitos</h2>
              <LearningMap
                key={artifact.id}
                packet={artifact.packet}
                reference={(ref) => {
                  const s = artifact.sources.find((s) => `source:${s.id}` === ref);
                  if (s) setSource(s);
                }}
              />
            </section>
          )}
          {tab === 'slides' && (
            <section className="learn-panel">
              <div className="learn-slide">
                <small>
                  {slide + 1} / {artifact.packet.slides.length}
                </small>
                <h2>{artifact.packet.slides[slide].title}</h2>
                <ul>
                  {artifact.packet.slides[slide].bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
                {sourceButtons(artifact.packet.slides[slide].refs)}
              </div>
              <div className="learn-controls">
                <button disabled={slide === 0} onClick={() => setSlide(slide - 1)}>
                  Anterior
                </button>
                <button
                  disabled={slide === artifact.packet.slides.length - 1}
                  onClick={() => setSlide(slide + 1)}
                >
                  Próximo
                </button>
              </div>
            </section>
          )}
          {tab === 'quiz' && (
            <section className="learn-panel">
              <h2>Simulado pessoal</h2>
              <p>Prática local baseada nas fontes. Não acessa tentativas do AVA.</p>
              {artifact.packet.quiz.map((q, i) => (
                <fieldset key={i} disabled={!!result}>
                  <legend>
                    {i + 1}. {q.prompt}
                  </legend>
                  {q.choices.map((c, j) => (
                    <label className="learn-answer" key={j}>
                      <input
                        type="radio"
                        name={`practice-${i}`}
                        checked={answers[i] === j}
                        onChange={() => setAnswers((prev) => prev.map((a, k) => (k === i ? j : a)))}
                      />
                      {c}
                    </label>
                  ))}
                  {result && (
                    <div className="learn-note">
                      <strong>{result.result[i].correct ? 'Correto' : 'Revisar'}</strong>
                      <p>{result.result[i].explanation}</p>
                      {sourceButtons(result.result[i].refs)}
                    </div>
                  )}
                </fieldset>
              ))}
              {result ? (
                <>
                  <p>
                    {result.correct} de {result.total} acertos
                  </p>
                  <button
                    onClick={() => {
                      setResult(null);
                      setAnswers(Array(artifact.packet.quiz.length).fill(-1));
                    }}
                  >
                    Praticar novamente
                  </button>
                </>
              ) : (
                <button
                  className="learn-primary"
                  disabled={
                    busy || answers.length !== artifact.packet.quiz.length || answers.includes(-1)
                  }
                  onClick={() =>
                    void action(async () =>
                      setResult(
                        await post(`/learning/artifacts/${artifact.id}/practice`, { answers }),
                      ),
                    )
                  }
                >
                  Conferir respostas
                </button>
              )}
            </section>
          )}
        </>
      )}
      {(source || importing) && (
        <Modal
          title={source ? 'Fonte do conteúdo' : 'Importar material'}
          close={() => {
            setSource(null);
            setImporting(false);
          }}
        >
          <section className="learn-dialog-content">
            {source ? (
              <>
                <h2>{source.title}</h2>
                <p>{source.locator || source.reason}</p>
                <small>
                  {source.updated_at} · {source.content_hash.slice(0, 12)}
                </small>
                <pre>{source.content || 'Conteúdo ainda não consumido.'}</pre>
                {/^https?:\/\//.test(source.url) && (
                  <a href={source.url} target="_blank" rel="noreferrer">
                    Abrir fonte original ↗
                  </a>
                )}
                {!artifact && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api(`/learning/sources/${source.id}/inclusion`, {
                          method: 'PATCH',
                          body: JSON.stringify({
                            included: source.status === 'excluded',
                            reason:
                              source.status === 'excluded'
                                ? 'Reincluído pelo aluno para conferir o conteúdo.'
                                : 'Não incluído por escolha do aluno; não foi declarado consumido.',
                          }),
                        });
                        setSources(await api(`/learning/courses/${source.course_id}/sources`));
                        setSource(null);
                      })
                    }
                  >
                    {source.status === 'excluded' ? 'Incluir no consumo' : 'Não incluir esta fonte'}
                  </button>
                )}
                {!artifact && (
                  <button
                    onClick={() => {
                      setImportTarget(source);
                      setImportTitle(source.title);
                      setImportLocator(source.locator || 'Páginas ou intervalo conferido');
                      setImportText(source.content);
                      setSource(null);
                      setImporting(true);
                    }}
                  >
                    Registrar texto ou revisão desta fonte
                  </button>
                )}
              </>
            ) : (
              <>
                <h2>Adicionar texto ou transcrição</h2>
                <label>
                  Título
                  <input value={importTitle} onChange={(e) => setImportTitle(e.target.value)} />
                </label>
                <label>
                  Páginas ou intervalo de tempo
                  <input value={importLocator} onChange={(e) => setImportLocator(e.target.value)} />
                </label>
                <label>
                  Conteúdo efetivamente lido
                  <textarea
                    rows={10}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                </label>
                <button
                  disabled={
                    busy || !importTitle.trim() || !importText.trim() || !importLocator.trim()
                  }
                  onClick={() =>
                    void action(async () => {
                      await post('/learning/sources', {
                        course_id: run!.course_id,
                        external_key: importTarget?.external_key || `manual:${crypto.randomUUID()}`,
                        title: importTitle,
                        kind: importTarget?.kind || 'text',
                        url: importTarget?.url || '',
                        content: importText,
                        locator: importLocator,
                      });
                      setImporting(false);
                      setImportText('');
                      setSources(await api(`/learning/courses/${run!.course_id}/sources`));
                    })
                  }
                >
                  Salvar material
                </button>
              </>
            )}
          </section>
        </Modal>
      )}
    </section>
  );
}
