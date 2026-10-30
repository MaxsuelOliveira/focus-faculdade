import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowDownToLine,
  BookOpen,
  Check,
  Copy,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { Assessment, AssessmentDetail, Course, Question } from '../../shared/types';
import { answerText, parseStudyQuestions, studyAnswer, studyMarkdown } from '../../shared/study';
import { api, post } from '../api';
import { Empty, Modal } from './ui';
import './study.css';

type SetSummary = Assessment & { question_count: number; answered_count: number };
type Models = {
  available: boolean;
  models: string[];
  openaiConfigured: boolean;
  openaiModel: string;
};
export default function StudyDesk({ courses }: { courses: Course[] }) {
  const [sets, setSets] = useState<SetSummary[]>([]);
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [input, setInput] = useState('');
  const [questionTypes, setQuestionTypes] = useState<Record<number, 'single' | 'multiple'>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [models, setModels] = useState<Models>({
    available: false,
    models: [],
    openaiConfigured: false,
    openaiModel: '',
  });
  const [provider, setProvider] = useState<'ollama' | 'openai'>('ollama');
  const [model, setModel] = useState('');
  const cancelled = useRef(false);
  const active = useRef(true);
  const parsed = useMemo(
    () =>
      parseStudyQuestions(input).map((q, index) => ({
        ...q,
        type: questionTypes[index] || q.type,
      })),
    [input, questionTypes],
  );
  const refreshModels = async () => setModels(await api<Models>('/ai/models'));
  const loadSets = async () => setSets(await api<SetSummary[]>('/study/sets'));
  useEffect(() => {
    active.current = true;
    cancelled.current = false;
    void loadSets().catch(() => setError('Não foi possível carregar seus gabaritos.'));
    void refreshModels().catch(() => setError('Não foi possível consultar os provedores de IA.'));
    return () => {
      active.current = false;
      cancelled.current = true;
    };
  }, []);
  const open = async (id: number) => {
    setError('');
    setMessage('');
    try {
      setDetail(await api<AssessmentDetail>(`/assessments/${id}`));
    } catch {
      setError('Não foi possível abrir este gabarito.');
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Gabarito copiado. Você pode consultar ou colar no portal.');
    } catch {
      setError('O navegador não permitiu copiar. Use a exportação em Markdown.');
    }
  };
  const generate = async (questions: Question[]) => {
    if (!model.trim()) {
      setError('Selecione o modelo de IA antes de gerar as respostas.');
      return;
    }
    if (!detail) return;
    const id = detail.assessment.id;
    setBusy(true);
    setError('');
    setMessage('');
    cancelled.current = false;
    let completed = 0;
    try {
      for (const q of questions) {
        if (cancelled.current) break;
        setProgress(`Respondendo questão ${q.position} · ${completed + 1} de ${questions.length}`);
        await post(`/questions/${q.id}/suggest`, { provider, model: model.trim() });
        completed++;
        const next = await api<AssessmentDetail>(`/assessments/${id}`);
        if (active.current) setDetail(next);
      }
      if (active.current) {
        await loadSets();
        setMessage(
          `${completed} resposta(s) salva(s) no gabarito${cancelled.current ? '. Geração interrompida.' : '.'}`,
        );
      }
    } catch (err) {
      if (active.current)
        setError(
          `${err instanceof Error ? err.message : 'Não foi possível gerar.'} As respostas já concluídas continuam salvas.`,
        );
    } finally {
      if (active.current) {
        setBusy(false);
        setProgress('');
      }
    }
  };
  const saveToKey = async (q: Question) => {
    if (!q.suggestion || !detail) return;
    setError('');
    try {
      await post(`/questions/${q.id}/answer`, { answer: q.suggestion.answer, approve: true });
      setDetail(await api<AssessmentDetail>(`/assessments/${detail.assessment.id}`));
      setMessage('Resposta da IA salva no seu gabarito.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    }
  };
  return (
    <section className="study-desk">
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}
      <div className="study-intro">
        <span className="soft-icon">
          <Sparkles size={23} />
        </span>
        <div>
          <h2>A IA responde. Seu gabarito fica organizado.</h2>
          <p>
            Cole as perguntas de uma disciplina ou simulado e gere respostas com explicações.
            Depois, consulte aqui e responda manualmente no AVA.
          </p>
        </div>
      </div>
      {!detail ? (
        <>
          <div className="section-heading">
            <h2>Meus gabaritos</h2>
            <button
              className="button primary"
              onClick={() => {
                setCreating(true);
                setInput('');
              }}
            >
              <Plus size={16} />
              Novo gabarito
            </button>
          </div>
          {!sets.length ? (
            <Empty
              title="Cole as primeiras questões"
              text="Crie um gabarito por disciplina ou simulado. As respostas ficam guardadas neste computador."
            />
          ) : (
            <div className="course-grid">
              {sets.map((set) => (
                <button className="course-card" key={set.id} onClick={() => void open(set.id)}>
                  <span className="course-symbol">
                    <BookOpen size={22} />
                  </span>
                  <span className="eyebrow">{set.course_name}</span>
                  <h2>{set.title}</h2>
                  <p>
                    {set.answered_count || 0} de {set.question_count} questões respondidas
                  </p>
                  <span className="course-footer">Consultar gabarito →</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button
            className="back-link"
            disabled={busy}
            onClick={() => {
              setDetail(null);
              setMessage('');
            }}
          >
            <ArrowLeft size={16} />
            Todos os gabaritos
          </button>
          <div className="section-heading">
            <div>
              <span className="eyebrow">{detail.assessment.course_name}</span>
              <h2>{detail.assessment.title}</h2>
            </div>
            <div className="button-group">
              <button className="button secondary" onClick={() => void copy(studyMarkdown(detail))}>
                <Copy size={15} />
                Copiar gabarito
              </button>
              <a className="button secondary" href={`/api/study/${detail.assessment.id}/markdown`}>
                <ArrowDownToLine size={15} />
                Exportar
              </a>
            </div>
          </div>
          <div className="panel study-controls">
            <div className="study-provider">
              <label>
                Provedor
                <select
                  disabled={busy}
                  value={provider}
                  onChange={(event) => {
                    setProvider(event.target.value as typeof provider);
                    setModel('');
                  }}
                >
                  <option value="ollama">Ollama · local</option>
                  <option value="openai" disabled={!models.openaiConfigured}>
                    OpenAI · API opcional
                  </option>
                </select>
              </label>
              <label>
                Modelo
                {provider === 'ollama' ? (
                  <select
                    disabled={busy}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    <option value="">Selecione um modelo</option>
                    {models.models.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    disabled={busy}
                    value={model}
                    placeholder={models.openaiModel || 'Nome do modelo'}
                    onChange={(event) => setModel(event.target.value)}
                  />
                )}
              </label>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="Atualizar modelos de IA"
                onClick={() =>
                  void refreshModels().catch(() =>
                    setError('Não foi possível atualizar os modelos.'),
                  )
                }
              >
                <RefreshCw size={18} />
              </button>
            </div>
            {!models.available && provider === 'ollama' && (
              <p className="hint">
                Ollama indisponível. Inicie o serviço e instale um modelo; depois clique em
                atualizar modelos. Você pode preparar os gabaritos enquanto isso.
              </p>
            )}
            {provider === 'openai' && (
              <p className="hint">
                Ao gerar, as questões e os materiais selecionados serão enviados à API da OpenAI. A
                geração pode ter custo.
              </p>
            )}
            <div className="button-group">
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void generate(
                    detail.questions.filter((q) => q.type !== 'unsupported' && !studyAnswer(q)),
                  )
                }
              >
                <Sparkles size={16} />
                Responder questões pendentes
              </button>
              {busy && (
                <button
                  className="button secondary"
                  onClick={() => {
                    cancelled.current = true;
                    setProgress('Finalizando a questão atual antes de parar…');
                  }}
                >
                  Parar após esta questão
                </button>
              )}
              {busy && (
                <span className="study-progress" role="status">
                  <LoaderCircle className="spinning" size={16} />
                  {progress}
                </span>
              )}
            </div>
          </div>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setAddingMaterial(true)}
          >
            <Plus size={15} />
            Adicionar material de apoio
          </button>
          {!!detail.materials.length && (
            <details className="instructions">
              <summary>
                Materiais usados como contexto ({detail.materials.filter((m) => m.selected).length}{' '}
                selecionados)
              </summary>
              <p>Selecione os textos que ajudam a responder este gabarito.</p>
              {detail.materials.map((m) => (
                <label className="material-check" key={m.id}>
                  <input
                    disabled={busy}
                    type="checkbox"
                    checked={!!m.selected}
                    onChange={() => {
                      void api(`/materials/${m.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ selected: !m.selected }),
                      })
                        .then(() => open(detail.assessment.id))
                        .catch(() => setError('Não foi possível selecionar o material.'));
                    }}
                  />
                  {m.title}
                </label>
              ))}
            </details>
          )}
          {detail.questions.map((q) => {
            const result = studyAnswer(q);
            const changedSuggestion =
              !!q.approved_hash &&
              !!q.suggestion &&
              JSON.stringify(q.answer) !== JSON.stringify(q.suggestion.answer);
            return (
              <article className="panel study-question" key={q.id}>
                <div className="question-top">
                  <span className="question-index">
                    QUESTÃO {q.position.toString().padStart(2, '0')}
                  </span>
                  <span className="badge">{result ? result.source : 'Aguardando IA'}</span>
                </div>
                <p className="question-prompt">{q.prompt}</p>
                {q.choices.map((c) => (
                  <div
                    className={`study-option ${result?.answer.choices.includes(c.id) ? 'correct' : ''}`}
                    key={c.id}
                  >
                    <strong>{c.id})</strong> {c.text}
                    {result?.answer.choices.includes(c.id) && <Check size={16} />}
                  </div>
                ))}
                {result && (
                  <div className="study-result">
                    <strong>Resposta para seu gabarito</strong>
                    <p>{answerText(q, result.answer)}</p>
                    {q.suggestion && (
                      <>
                        {changedSuggestion && (
                          <>
                            <strong>Nova sugestão da IA</strong>
                            <p>{answerText(q, q.suggestion.answer)}</p>
                          </>
                        )}
                        <strong>
                          {changedSuggestion
                            ? 'Explicação da nova sugestão'
                            : 'Por que essa resposta?'}
                        </strong>
                        <p>{q.suggestion.explanation}</p>
                        <small>
                          {q.suggestion.provider} · {q.suggestion.model} · Sugestão para conferir
                          com o material da disciplina.
                        </small>
                      </>
                    )}
                  </div>
                )}
                <div className="question-footer">
                  <button
                    className="text-button"
                    disabled={!result}
                    onClick={() => result && void copy(answerText(q, result.answer))}
                  >
                    <Copy size={15} />
                    Copiar resposta
                  </button>
                  <div className="button-group">
                    {q.suggestion && (!q.approved_hash || changedSuggestion) && (
                      <button
                        className="button secondary small"
                        disabled={busy}
                        onClick={() => void saveToKey(q)}
                      >
                        <Check size={15} />
                        Usar no meu gabarito
                      </button>
                    )}
                    <button
                      className="button primary small"
                      disabled={busy || q.type === 'unsupported'}
                      onClick={() => void generate([q])}
                    >
                      <Sparkles size={15} />
                      {q.suggestion ? 'Gerar outra resposta' : 'Responder com IA'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </>
      )}
      {addingMaterial && detail && (
        <Modal title="Material de apoio do gabarito" close={() => setAddingMaterial(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setError('');
              void post('/materials', {
                course_id: detail.assessment.course_id,
                title: data.get('title'),
                content: data.get('content'),
              })
                .then(async () => {
                  setDetail(await api<AssessmentDetail>(`/assessments/${detail.assessment.id}`));
                  setAddingMaterial(false);
                })
                .catch((err) =>
                  setError(
                    err instanceof Error ? err.message : 'Não foi possível adicionar o material.',
                  ),
                );
            }}
          >
            <p>
              Cole o conteúdo da disciplina para a IA usar nas respostas. O material fica disponível
              nos gabaritos desta disciplina.
            </p>
            {error && (
              <div role="alert" className="message error">
                {error}
              </div>
            )}
            <label>
              Título do material
              <input name="title" required maxLength={300} />
            </label>
            <label>
              Conteúdo do material
              <textarea name="content" required maxLength={150000} rows={9} />
            </label>
            <div className="modal-actions">
              <button className="button primary">Salvar material de apoio</button>
            </div>
          </form>
        </Modal>
      )}
      {creating && (
        <Modal title="Novo gabarito de estudo" close={() => setCreating(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setBusy(true);
              setError('');
              void post<AssessmentDetail>('/study/sets', {
                title: form.get('title'),
                course_id: form.get('course') ? Number(form.get('course')) : undefined,
                course_name: form.get('course_name') || undefined,
                questions: parsed,
              })
                .then((next) => {
                  setDetail(next);
                  setCreating(false);
                  void loadSets();
                })
                .catch((err) =>
                  setError(
                    err instanceof Error ? err.message : 'Não foi possível criar o gabarito.',
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            {error && (
              <div role="alert" className="message error">
                {error}
              </div>
            )}
            <p>
              Cole enunciados e alternativas, como aparecem na disciplina. Para várias questões,
              separe cada uma com uma linha contendo <strong>---</strong>.
            </p>
            <label>
              Nome do gabarito
              <input
                name="title"
                required
                maxLength={300}
                placeholder="Ex.: Programação — Simulado da unidade 1"
              />
            </label>
            <label>
              Disciplina
              <select name="course">
                <option value="">Outra disciplina / estudo pessoal</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nome da disciplina, se for outra
              <input name="course_name" maxLength={300} placeholder="Ex.: Matemática" />
            </label>
            <label>
              Perguntas e alternativas
              <textarea
                aria-label="Perguntas e alternativas"
                value={input}
                onChange={(event) => {
                  setInput(event.target.value);
                  setQuestionTypes({});
                }}
                rows={9}
                required
                maxLength={150000}
                placeholder={
                  'Qual é a capital do Brasil?\nA) Brasília\nB) Salvador\n---\nExplique o que é uma variável.'
                }
              />
            </label>
            <div className="study-preview">
              <strong>{parsed.length} questão(ões) identificada(s)</strong>
              {parsed.map((q, index) => (
                <div key={index} className="study-preview-row">
                  <p>
                    {index + 1}. {q.prompt.slice(0, 110)} ·{' '}
                    {q.choices.length ? `${q.choices.length} alternativas` : 'Discursiva'}
                  </p>
                  {!!q.choices.length && (
                    <select
                      aria-label={`Tipo da questão ${index + 1}`}
                      value={q.type}
                      onChange={(event) =>
                        setQuestionTypes((current) => ({
                          ...current,
                          [index]: event.target.value as 'single' | 'multiple',
                        }))
                      }
                    >
                      <option value="single">Uma alternativa</option>
                      <option value="multiple">Várias alternativas</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
            <p className="hint">
              As alternativas A), B), C)… serão identificadas automaticamente. Confira o tipo de
              resposta antes de criar o gabarito.
            </p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setCreating(false)}>
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={busy || !parsed.length || parsed.length > 50}
              >
                Criar gabarito
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
