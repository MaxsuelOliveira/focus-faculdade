import { Badge, Modal, Empty, Stat, AssessmentRow } from './components/ui';
import QuestionCard, { questionText } from './components/QuestionCard';
import StudyIllustration from './components/StudyIllustration';
import StudyDesk from './components/StudyDesk';
import ChecklistBoard from './components/ChecklistBoard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  FileText,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import type { Assessment, AssessmentDetail, Dashboard, JobKind, Question } from '../shared/types';
import { api, formatDate, post } from './api';

type View =
  | 'overview'
  | 'checklists'
  | 'study'
  | 'courses'
  | 'assessments'
  | 'library'
  | 'automation'
  | 'settings';
type AIModels = {
  available: boolean;
  models: string[];
  openaiConfigured: boolean;
  openaiModel: string;
};
type Confirmation = {
  token: string;
  expiresAt: string;
  assessment: Assessment;
  questions: Question[];
};
const labels: Record<View, string> = {
  overview: 'Visão geral',
  checklists: 'Meu checklist',
  study: 'Gabaritos com IA',
  courses: 'Disciplinas',
  assessments: 'Avaliações',
  library: 'Minhas questões',
  automation: 'Automações',
  settings: 'Configurações',
};

const jobLabels: Record<JobKind, string> = {
  sync: 'Sincronizar disciplinas',
  inspect: 'Consultar avaliação',
  extract: 'Extrair questões',
  start: 'Iniciar tentativa',
  fill: 'Preencher respostas',
  submit: 'Entregar avaliação',
  reconcile: 'Conferir tentativa',
};
const nav = [
  { id: 'overview', icon: LayoutDashboard },
  { id: 'checklists', icon: ListChecks },
  { id: 'study', icon: Sparkles },
  { id: 'courses', icon: BookOpen },
  { id: 'assessments', icon: ClipboardList },
  { id: 'library', icon: FileText },
  { id: 'automation', icon: Workflow },
] as const;
const empty: Dashboard = {
  courses: [],
  assessments: [],
  jobs: [],
  reminders: [],
  receipts: [],
  lastSync: null,
};
export default function App() {
  const [view, setView] = useState<View>(
    new URLSearchParams(window.location.search).get('view') === 'checklists'
      ? 'checklists'
      : 'overview',
  );
  const [dashboard, setDashboard] = useState<Dashboard>(empty);
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [library, setLibrary] = useState<
    (Question & { assessment_title: string; course_name: string })[]
  >([]);
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [action, setAction] = useState<{ kind: 'start' | 'fill'; id: number } | null>(null);
  const [material, setMaterial] = useState(false);
  const [deadline, setDeadline] = useState(false);
  const [dirtyQuestions, setDirtyQuestions] = useState<number[]>([]);
  const [models, setModels] = useState<AIModels>({
    available: false,
    models: [],
    openaiConfigured: false,
    openaiModel: '',
  });
  const [provider, setProvider] = useState<'ollama' | 'openai'>('ollama');
  const [model, setModel] = useState('');
  const [settings, setSettings] = useState<Record<string, string | number | boolean>>({});
  const [notifications, setNotifications] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const seen = useRef(new Set<number>());
  const detailId = useRef<number | null>(null);
  const notify = useCallback(async (data: Dashboard) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const reminder of data.reminders.filter(
      (r) => !r.notified_at && !seen.current.has(r.id),
    )) {
      seen.current.add(reminder.id);
      try {
        new Notification(`Avaliação: ${reminder.title}`, {
          body: `${reminder.course_name} • ${formatDate(reminder.due_at, true)}`,
          tag: `focus-${reminder.id}`,
        });
        await post(`/reminders/${reminder.id}/ack`);
      } catch {
        seen.current.delete(reminder.id);
      }
    }
  }, []);
  const refresh = useCallback(async () => {
    const data = await api<Dashboard>('/dashboard');
    setDashboard(data);
    void notify(data);
    const id = detailId.current;
    if (id) {
      const next = await api<AssessmentDetail>(`/assessments/${id}`);
      if (detailId.current === id) setDetail(next);
    }
    setLoading(false);
  }, [notify]);
  useEffect(() => {
    void refresh().catch(() => {
      setError(
        'Não foi possível conectar ao backend local. Confira se o aplicativo está em execução.',
      );
      setLoading(false);
    });
    void api<AIModels>('/ai/models')
      .then(setModels)
      .catch(() => {});
    void api<Record<string, string | number | boolean>>('/settings')
      .then(setSettings)
      .catch(() => {});
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (view === 'library')
      void api<typeof library>('/questions')
        .then(setLibrary)
        .catch(() => setError('Não foi possível carregar as questões.'));
  }, [view]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const run = async (task: () => Promise<unknown>, success?: string) => {
    setWorking(true);
    setError('');
    try {
      await task();
      if (success) setNotice(success);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir.');
    } finally {
      setWorking(false);
    }
  };
  const navigate = (next: View) => {
    setView(next);
    setDetail(null);
    detailId.current = null;
    setSearch('');
    setCourseFilter('');
    setDirtyQuestions([]);
  };
  const openAssessment = async (id: number) => {
    setError('');
    try {
      const next = await api<AssessmentDetail>(`/assessments/${id}`);
      detailId.current = id;
      setDirtyQuestions([]);
      setDetail(next);
      setView('assessments');
    } catch {
      setError('Não foi possível abrir a avaliação.');
    }
  };
  const enqueue = (kind: JobKind, assessment_id?: number, acknowledge = false) =>
    run(
      () => post('/jobs', { kind, assessment_id, acknowledge }),
      'Ação adicionada à fila. Acompanhe em Automações.',
    );
  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const permission = await Notification.requestPermission();
    setNotifications(permission);
    if (permission === 'granted') void notify(dashboard);
  };
  const pending = dashboard.assessments.filter(
    (a) => !a.external_id.startsWith('study:') && !['submitted', 'closed'].includes(a.status),
  );
  const approvedCount = detail?.questions.filter((q) => q.approved_hash).length || 0;
  const filtered = dashboard.assessments.filter(
    (a) =>
      !a.external_id.startsWith('study:') &&
      (!courseFilter || String(a.course_id) === courseFilter) &&
      `${a.title} ${a.course_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const busyJob = dashboard.jobs.find((j) => ['queued', 'running'].includes(j.status));
  const greeting = new Intl.DateTimeFormat('pt-BR', {
    hour: 'numeric',
    hourCycle: 'h23',
    timeZone: 'America/Bahia',
  }).format(new Date());
  const hour = Number(greeting);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate('overview');
          }}
        >
          <span className="brand-icon">
            <GraduationCap size={25} />
          </span>
          <span>
            focus<span className="brand-dot">.</span>
            <small>MEU ESPAÇO DE ESTUDOS</small>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">F</span>
          <div>
            <strong>Minha faculdade</strong>
            <small>Espaço pessoal</small>
          </div>
          <ShieldCheck size={16} />
        </div>
        <div className="nav-caption">ORGANIZAÇÃO</div>
        <nav aria-label="Navegação principal">
          {nav.map(({ id, icon: Icon }) => (
            <button
              key={id}
              aria-label={labels[id]}
              className={view === id ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{labels[id]}</span>
              {id === 'assessments' && pending.length > 0 && (
                <span className="nav-count">{pending.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-indicator" />
            <strong>Seus estudos, com você.</strong>
            <p>Informações salvas neste computador, em SQLite.</p>
            <Database size={17} />
          </div>
          <button
            className={view === 'settings' ? 'nav-item active' : 'nav-item'}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={19} />
            Configurações
          </button>
          <div className="profile">
            <span>EU</span>
            <div>
              <strong>Meu espaço pessoal</strong>
              <small>Horário de Brasília</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Meu espaço <ChevronRight size={14} />
            <strong>{labels[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-tag">
              <span /> Local e privado
            </span>
            <button
              className="icon-button notification-button"
              aria-label="Ver lembretes"
              onClick={() => {
                navigate('overview');
                document.getElementById('reminders')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <Bell size={20} />
              {dashboard.reminders.some((r) => !r.notified_at) && <i />}
            </button>
            <button
              className="top-avatar"
              aria-label="Abrir configurações"
              onClick={() => navigate('settings')}
            >
              EU
            </button>
          </div>
        </header>
        <main>
          {error && (
            <div className="message error" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button aria-label="Fechar erro" onClick={() => setError('')}>
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCheck size={19} />
              {notice}
            </div>
          )}
          {detail ? (
            <>
              <button
                className="back-link"
                onClick={() => {
                  setDetail(null);
                  detailId.current = null;
                }}
              >
                <ArrowLeft size={16} />
                Todas as avaliações
              </button>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">{detail.assessment.course_name}</div>
                  <h1>{detail.assessment.title}</h1>
                  <p>
                    <CalendarDays size={15} />
                    {formatDate(detail.assessment.due_at, true)} ·{' '}
                    {detail.assessment.duration_minutes
                      ? `${detail.assessment.duration_minutes} minutos`
                      : 'Duração a consultar'}
                  </p>
                </div>
                <Badge status={detail.assessment.status} />
              </div>
              <div className="assessment-toolbar">
                <button className="button secondary" onClick={() => setDeadline(true)}>
                  <CalendarDays size={16} />
                  Definir prazo
                </button>
                <a
                  className="button secondary"
                  href={detail.assessment.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink size={16} />
                  Abrir no AVA
                </a>
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={() => void enqueue('inspect', detail.assessment.id)}
                >
                  <RefreshCw size={16} />
                  Consultar regras
                </button>
                {detail.assessment.status === 'available' && (
                  <button
                    className="button primary"
                    disabled={working}
                    onClick={() => setAction({ kind: 'start', id: detail.assessment.id })}
                  >
                    Iniciar tentativa
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={() => void enqueue('extract', detail.assessment.id)}
                >
                  <ArrowDownToLine size={16} />
                  Extrair questões
                </button>
                <button
                  className="button secondary"
                  disabled={working}
                  onClick={() => void enqueue('reconcile', detail.assessment.id)}
                >
                  Conferir estado
                </button>
              </div>
              {detail.assessment.instructions && (
                <details className="instructions">
                  <summary>Instruções e regras do portal</summary>
                  <p>{detail.assessment.instructions}</p>
                </details>
              )}
              <div className="detail-grid">
                <section>
                  <div className="section-heading">
                    <h2>
                      Questões da avaliação <span className="count">{detail.questions.length}</span>
                    </h2>
                    <div className="button-group">
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(
                            () =>
                              navigator.clipboard.writeText(
                                detail.questions.map(questionText).join('\n\n'),
                              ),
                            'Questões copiadas.',
                          )
                        }
                      >
                        <Copy size={15} />
                        Copiar todas
                      </button>
                      <a
                        className="text-button"
                        href={`/api/assessments/${detail.assessment.id}/markdown`}
                      >
                        <Copy size={15} />
                        Exportar Markdown
                      </a>
                    </div>
                  </div>
                  {!detail.questions.length && (
                    <Empty
                      title="As questões ainda não foram extraídas"
                      text="Consulte as regras antes de iniciar uma tentativa. Algumas avaliações só mostram questões depois que o cronômetro começa."
                    />
                  )}
                  {detail.questions.map((q) => (
                    <QuestionCard
                      key={q.id}
                      question={q}
                      provider={provider}
                      model={model}
                      onSaved={() => refresh()}
                      onDirty={(id, changed) =>
                        setDirtyQuestions((current) =>
                          changed
                            ? [...new Set([...current, id])]
                            : current.filter((item) => item !== id),
                        )
                      }
                      onError={setError}
                    />
                  ))}
                </section>
                <aside className="detail-aside">
                  <div className="panel">
                    <div className="panel-title">
                      <Sparkles size={18} />
                      <h3>Assistente de estudos</h3>
                    </div>
                    <p className="muted">
                      Gere uma sugestão, confira o raciocínio e escreva sua resposta final.
                    </p>
                    <label>
                      Provedor
                      <select
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
                        <select value={model} onChange={(event) => setModel(event.target.value)}>
                          <option value="">Selecione um modelo</option>
                          {models.models.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={model}
                          placeholder={models.openaiModel || 'Nome do modelo'}
                          onChange={(event) => setModel(event.target.value)}
                        />
                      )}
                    </label>
                    {!models.available && provider === 'ollama' && (
                      <p className="hint">
                        Ollama indisponível. Inicie o serviço e atualize os modelos em
                        Configurações.
                      </p>
                    )}
                    {provider === 'openai' && (
                      <p className="hint">
                        Ao gerar, o enunciado e os materiais selecionados serão enviados à API da
                        OpenAI.
                      </p>
                    )}
                  </div>
                  <div className="panel">
                    <div className="panel-title">
                      <BookOpen size={18} />
                      <h3>Materiais de apoio</h3>
                    </div>
                    <p className="muted">Selecione os textos que a IA pode consultar.</p>
                    {detail.materials.map((m) => (
                      <label key={m.id} className="material-check">
                        <input
                          type="checkbox"
                          checked={!!m.selected}
                          onChange={() =>
                            void run(() =>
                              api(`/materials/${m.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ selected: !m.selected }),
                              }),
                            )
                          }
                        />
                        <span>
                          {m.title}
                          <small>{m.content.length.toLocaleString('pt-BR')} caracteres</small>
                        </span>
                      </label>
                    ))}
                    <button className="button secondary full" onClick={() => setMaterial(true)}>
                      <Plus size={15} />
                      Adicionar material
                    </button>
                  </div>
                  <div className="panel review-panel">
                    <div className="panel-title">
                      <ShieldCheck size={18} />
                      <h3>Sua revisão</h3>
                    </div>
                    <strong className="review-number">
                      {approvedCount}
                      <span> / {detail.questions.length}</span>
                    </strong>
                    <p className="muted">respostas aprovadas por você</p>
                    <div className="progress-track">
                      <span
                        style={{
                          width: `${detail.questions.length ? (approvedCount / detail.questions.length) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <button
                      className="button secondary full"
                      disabled={
                        working ||
                        !!dirtyQuestions.length ||
                        !detail.questions.length ||
                        approvedCount !== detail.questions.length ||
                        detail.assessment.status !== 'in_progress'
                      }
                      onClick={() => setAction({ kind: 'fill', id: detail.assessment.id })}
                    >
                      Preencher no portal
                    </button>
                    <button
                      className="button primary full"
                      disabled={
                        working ||
                        !!dirtyQuestions.length ||
                        !detail.questions.length ||
                        approvedCount !== detail.questions.length ||
                        detail.assessment.status !== 'in_progress'
                      }
                      onClick={() =>
                        void run(async () =>
                          setConfirm(
                            await post<Confirmation>(
                              `/assessments/${detail.assessment.id}/confirmation`,
                            ),
                          ),
                        )
                      }
                    >
                      Revisar entrega <ArrowRight size={16} />
                    </button>
                    <p className="hint">
                      A entrega só acontece depois da sua confirmação para esta avaliação.
                    </p>
                  </div>
                  {!!detail.receipts.length && (
                    <div className="panel">
                      <h3>Comprovantes</h3>
                      {detail.receipts.map((r) => (
                        <details key={r.id}>
                          <summary>{formatDate(r.created_at, true)}</summary>
                          <pre>{r.evidence}</pre>
                        </details>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">SEU PRÓXIMO PASSO COMEÇA AQUI</div>
                  <h1>
                    {view === 'overview'
                      ? `${hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'}, vamos estudar?`
                      : labels[view]}
                  </h1>
                  <p>
                    {view === 'overview'
                      ? 'Menos preocupação com prazos. Mais espaço para aprender.'
                      : view === 'automation'
                        ? 'Acompanhe cada etapa da navegação no portal.'
                        : view === 'settings'
                          ? 'Um espaço de estudos do seu jeito, neste computador.'
                          : 'Tudo organizado para você seguir em frente.'}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => void enqueue('sync')}
                  disabled={working || !!busyJob}
                >
                  <RefreshCw size={16} className={busyJob ? 'spinning' : ''} />
                  {busyJob ? 'Sincronizando…' : 'Sincronizar portal'}
                </button>
              </div>
              {loading ? (
                <div className="loading">
                  <LoaderCircle className="spinning" />
                  Carregando seu espaço…
                </div>
              ) : (
                <>
                  {view === 'overview' && (
                    <>
                      <section className="hero">
                        <div className="hero-copy">
                          <span className="hero-label">
                            <span />
                            UM DIA DE CADA VEZ
                          </span>
                          <h2>
                            Organize o hoje.
                            <br />
                            Chegue preparado amanhã.
                          </h2>
                          <p>
                            Disciplinas, avaliações e respostas em um só lugar.
                            <br className="desktop" /> Você cuida do aprendizado. Nós ajudamos com o
                            resto.
                          </p>
                          <button className="button hero-button" onClick={() => navigate('study')}>
                            Criar meu gabarito com IA
                            <ArrowRight size={17} />
                          </button>
                        </div>
                        <StudyIllustration />
                      </section>
                      <section className="stat-grid" aria-label="Resumo dos estudos">
                        <Stat
                          icon={<BookOpen />}
                          value={dashboard.courses.length}
                          title="Disciplinas acompanhadas"
                          note="Seu semestre organizado"
                        />
                        <Stat
                          icon={<ClipboardList />}
                          value={pending.length}
                          title="Avaliações pendentes"
                          note="Um passo de cada vez"
                          tone="peach"
                        />
                        <Stat
                          icon={<CheckCheck />}
                          value={
                            dashboard.assessments.filter((a) => a.status === 'submitted').length
                          }
                          title="Avaliações entregues"
                          note="Cada entrega é uma conquista"
                          tone="green"
                        />
                        <Stat
                          icon={<CalendarDays />}
                          value={
                            pending.filter(
                              (a) =>
                                a.due_at &&
                                Date.parse(a.due_at) > Date.now() &&
                                Date.parse(a.due_at) - Date.now() < 7 * 86400000,
                            ).length
                          }
                          title="Prazos nesta semana"
                          note="Fique de olho no calendário"
                          tone="lavender"
                        />
                      </section>
                      <div className="overview-grid">
                        <section className="panel assessment-panel">
                          <div className="section-heading">
                            <div>
                              <h2>Próximas avaliações</h2>
                              <p>Reserve um tempo para o que vem aí.</p>
                            </div>
                            <button className="text-button" onClick={() => navigate('assessments')}>
                              Ver todas
                              <ArrowRight size={15} />
                            </button>
                          </div>
                          {!pending.length ? (
                            <Empty
                              title="Seu planejamento começa aqui"
                              text="Sincronize o portal para encontrar suas disciplinas e avaliações."
                            >
                              <button
                                className="button secondary"
                                disabled={working || !!busyJob}
                                onClick={() => void enqueue('sync')}
                              >
                                Conectar ao portal
                                <ArrowRight size={16} />
                              </button>
                            </Empty>
                          ) : (
                            pending
                              .slice(0, 4)
                              .map((a) => (
                                <AssessmentRow key={a.id} assessment={a} open={openAssessment} />
                              ))
                          )}
                        </section>
                        <section className="panel reminders-panel" id="reminders">
                          <div className="section-heading">
                            <h2>Seus lembretes</h2>
                            <Bell size={18} />
                          </div>
                          <div className="reminder-note">
                            <span className="soft-icon peach">
                              <Clock3 size={19} />
                            </span>
                            <div>
                              <strong>Um aviso na hora certa</strong>
                              <p>7 dias, 3 dias, 1 dia e 2 horas antes de cada prazo.</p>
                            </div>
                          </div>
                          {dashboard.reminders.slice(0, 3).map((r) => (
                            <button
                              className="reminder-item"
                              key={r.id}
                              onClick={() => void openAssessment(r.assessment_id)}
                            >
                              <span className="reminder-dot" />
                              <span>
                                <strong>{r.title}</strong>
                                <small>{formatDate(r.due_at, true)}</small>
                              </span>
                              <ChevronRight size={15} />
                            </button>
                          ))}
                          {!dashboard.reminders.length && (
                            <p className="muted reminder-empty">
                              Seus próximos lembretes aparecerão aqui quando houver prazos
                              confirmados.
                            </p>
                          )}
                          <button
                            className="button secondary full"
                            onClick={() => void enableNotifications()}
                            disabled={notifications !== 'default'}
                          >
                            <Bell size={15} />
                            {notifications === 'granted'
                              ? 'Notificações ativadas'
                              : notifications === 'denied'
                                ? 'Notificações bloqueadas'
                                : notifications === 'unsupported'
                                  ? 'Navegador sem notificações'
                                  : 'Ativar notificações'}
                          </button>
                          <p className="hint">Com o aplicativo aberto neste computador.</p>
                        </section>
                      </div>
                      <section className="bottom-banner">
                        <span className="soft-icon">
                          <ShieldCheck size={22} />
                        </span>
                        <div>
                          <h3>A tecnologia ajuda. A decisão continua sendo sua.</h3>
                          <p>Revise as sugestões da IA e confirme cada entrega no seu tempo.</p>
                        </div>
                        <span className="mini-label">VOCÊ NO CONTROLE</span>
                      </section>
                    </>
                  )}
                  {view === 'checklists' && <ChecklistBoard />}
                  {view === 'study' && <StudyDesk courses={dashboard.courses} />}
                  {view === 'courses' && (
                    <>
                      {!dashboard.courses.length ? (
                        <Empty
                          title="Vamos conhecer suas disciplinas"
                          text="A sincronização consulta seu portal e mantém o histórico salvo localmente."
                        />
                      ) : (
                        <div className="course-grid">
                          {dashboard.courses.map((c, i) => (
                            <button
                              className="course-card"
                              key={c.id}
                              onClick={() => {
                                setView('assessments');
                                setCourseFilter(String(c.id));
                              }}
                            >
                              <span className={`course-symbol color-${i % 4}`}>
                                <BookOpen size={24} />
                              </span>
                              <span className="eyebrow">DISCIPLINA</span>
                              <h2>{c.name}</h2>
                              <p>
                                {dashboard.assessments.filter((a) => a.course_id === c.id).length}{' '}
                                avaliações encontradas
                              </p>
                              <span className="course-footer">
                                Acompanhar disciplina <ArrowRight size={18} />
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {view === 'assessments' && (
                    <section className="panel">
                      <div className="list-toolbar">
                        <label className="search-field">
                          <Search size={17} />
                          <input
                            aria-label="Buscar avaliações"
                            placeholder="Buscar avaliação ou disciplina…"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                          />
                        </label>
                        <select
                          aria-label="Filtrar disciplina"
                          value={courseFilter}
                          onChange={(event) => setCourseFilter(event.target.value)}
                        >
                          <option value="">Todas as disciplinas</option>
                          {dashboard.courses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      {filtered.length ? (
                        filtered.map((a) => (
                          <AssessmentRow key={a.id} assessment={a} open={openAssessment} />
                        ))
                      ) : (
                        <Empty
                          title={
                            dashboard.assessments.length
                              ? 'Nenhuma avaliação encontrada'
                              : 'Ainda não há avaliações por aqui'
                          }
                          text={
                            dashboard.assessments.length
                              ? 'Tente outro termo ou disciplina.'
                              : 'Sincronize o portal para consultar avaliações disponíveis.'
                          }
                        />
                      )}
                    </section>
                  )}
                  {view === 'library' && (
                    <>
                      <div className="list-toolbar">
                        <label className="search-field">
                          <Search size={17} />
                          <input
                            aria-label="Buscar questões"
                            placeholder="Buscar no enunciado…"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                          />
                        </label>
                      </div>
                      {!library.length ? (
                        <Empty
                          title="Seu caderno de questões"
                          text="Depois de extrair uma avaliação, suas questões ficam guardadas aqui para consulta e estudo."
                        />
                      ) : (
                        library
                          .filter((q) =>
                            q.prompt.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                          )
                          .map((q) => (
                            <article className="panel library-question" key={q.id}>
                              <div className="eyebrow">
                                {q.course_name} · {q.assessment_title}
                              </div>
                              <h3>Questão {q.position}</h3>
                              <p>{q.prompt}</p>
                              <div className="question-footer">
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    void run(
                                      () => navigator.clipboard.writeText(questionText(q)),
                                      'Questão copiada.',
                                    )
                                  }
                                >
                                  <Copy size={15} />
                                  Copiar questão
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() => void openAssessment(q.assessment_id)}
                                >
                                  Abrir avaliação
                                  <ArrowRight size={15} />
                                </button>
                              </div>
                            </article>
                          ))
                      )}
                    </>
                  )}
                  {view === 'automation' && (
                    <section className="panel">
                      <div className="section-heading">
                        <div>
                          <h2>Histórico de automações</h2>
                          <p>Uma tarefa por vez, com registro de cada etapa.</p>
                        </div>
                        <span className="local-tag">
                          <span />
                          {busyJob ? 'Fila ativa' : 'Aguardando'}
                        </span>
                      </div>
                      {!dashboard.jobs.length ? (
                        <Empty
                          title="Tudo pronto para começar"
                          text="Sincronize o portal para iniciar a primeira consulta."
                        />
                      ) : (
                        <div className="job-list">
                          {dashboard.jobs.map((job) => (
                            <div className="job-row" key={job.id}>
                              <span className={`job-icon ${job.status}`}>
                                <Workflow size={19} />
                              </span>
                              <div className="job-content">
                                <strong>{jobLabels[job.kind]}</strong>
                                <p>{job.progress}</p>
                                <small>
                                  #{job.id} · {formatDate(job.created_at, true)}
                                </small>
                              </div>
                              <Badge status={job.status} />
                              {['failed', 'needs_action'].includes(job.status) &&
                                ['sync', 'inspect', 'extract', 'reconcile'].includes(job.kind) && (
                                  <button
                                    className="icon-button"
                                    aria-label={`Repetir tarefa ${job.id}`}
                                    onClick={() => void run(() => post(`/jobs/${job.id}/retry`))}
                                  >
                                    <RefreshCw size={17} />
                                  </button>
                                )}
                              {job.status === 'uncertain' && job.assessment_id && (
                                <button
                                  className="button secondary small"
                                  onClick={() => void enqueue('reconcile', job.assessment_id!)}
                                >
                                  Conferir
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}
                  {view === 'settings' && (
                    <div className="settings-grid">
                      <section className="panel">
                        <div className="panel-title">
                          <Database size={19} />
                          <h2>Armazenamento local</h2>
                        </div>
                        <p>
                          Seus registros ficam no banco SQLite deste computador. Os backups diários
                          mantêm as últimas 14 cópias.
                        </p>
                        <div className="setting-row">
                          <span>Banco de dados</span>
                          <strong>SQLite · WAL</strong>
                        </div>
                        <div className="setting-row">
                          <span>Fuso horário</span>
                          <strong>America/Bahia</strong>
                        </div>
                        <div className="setting-row">
                          <span>Sincronização</span>
                          <strong>A cada 30 minutos</strong>
                        </div>
                        <div className="button-group">
                          <button
                            className="button secondary"
                            onClick={() =>
                              void run(
                                () => post('/backup'),
                                'Backup criado na pasta data/backups.',
                              )
                            }
                          >
                            <Database size={16} />
                            Criar backup
                          </button>
                          <a className="button secondary" href="/api/export">
                            <ArrowDownToLine size={16} />
                            Exportar JSON
                          </a>
                        </div>
                      </section>
                      <section className="panel">
                        <div className="panel-title">
                          <Sparkles size={19} />
                          <h2>Inteligência artificial</h2>
                        </div>
                        <p>
                          Ollama é o provedor padrão. A OpenAI só é usada quando selecionada em uma
                          geração.
                        </p>
                        <div className="setting-row">
                          <span>Ollama</span>
                          <strong>{models.available ? 'Disponível' : 'Indisponível'}</strong>
                        </div>
                        <div className="setting-row">
                          <span>Modelos instalados</span>
                          <strong>{models.models.length}</strong>
                        </div>
                        <div className="setting-row">
                          <span>API da OpenAI</span>
                          <strong>
                            {models.openaiConfigured ? 'Configurada' : 'Opcional · não configurada'}
                          </strong>
                        </div>
                        <button
                          className="button secondary"
                          onClick={() =>
                            void run(
                              async () => setModels(await api<AIModels>('/ai/models')),
                              'Lista de modelos atualizada.',
                            )
                          }
                        >
                          <RefreshCw size={16} />
                          Atualizar modelos
                        </button>
                        <p className="hint">
                          Credenciais e endereço do Ollama são configurados no .env do backend.
                          Nunca cole sua chave de API em materiais ou respostas.
                        </p>
                      </section>
                      <section className="panel">
                        <div className="panel-title">
                          <Bell size={19} />
                          <h2>Lembretes</h2>
                        </div>
                        <p>
                          Receba alertas dos prazos confirmados enquanto o aplicativo estiver
                          aberto.
                        </p>
                        <button
                          className="button secondary"
                          disabled={notifications !== 'default'}
                          onClick={() => void enableNotifications()}
                        >
                          {notifications === 'granted'
                            ? 'Notificações ativadas'
                            : notifications === 'denied'
                              ? 'Permita notificações nas opções do navegador'
                              : 'Ativar notificações'}
                        </button>
                      </section>
                      <section className="panel">
                        <div className="panel-title">
                          <ShieldCheck size={19} />
                          <h2>Acesso ao portal</h2>
                        </div>
                        <p>
                          Credenciais{' '}
                          {settings.credentialsConfigured
                            ? 'encontradas no ambiente local'
                            : 'a configurar no .env'}
                          . Verificações de acesso são concluídas por você no navegador da
                          automação.
                        </p>
                        <p className="hint">
                          A aplicação não inicia tentativas durante a sincronização. Início,
                          preenchimento e entrega têm ações separadas.
                        </p>
                        <a
                          href="https://faculdadefocus.jacad.com.br/aluno-v2/login"
                          target="_blank"
                          rel="noreferrer"
                          className="text-button"
                        >
                          Abrir JACAD <ExternalLink size={15} />
                        </a>
                      </section>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <footer>
            <span>
              focus<span className="brand-dot">.</span>{' '}
              <span className="footer-note">Aprender fica mais leve com organização.</span>
            </span>
            <span>
              <span className="status-dot" />
              {dashboard.lastSync
                ? `Última sincronização: ${formatDate(dashboard.lastSync, true)}`
                : 'Aguardando primeira sincronização'}
            </span>
          </footer>
        </main>
      </div>
      {action && (
        <Modal
          title={
            action.kind === 'start' ? 'Iniciar esta tentativa?' : 'Preencher respostas no portal?'
          }
          close={() => setAction(null)}
        >
          <p>
            {action.kind === 'start'
              ? 'O portal pode iniciar um cronômetro e consumir uma tentativa. Leia as instruções antes de continuar. Esta ação não entrega respostas.'
              : 'As respostas aprovadas serão preenchidas e salvas na tentativa aberta. A entrega definitiva exige outra confirmação.'}
          </p>
          <strong>{detail?.assessment.title}</strong>
          <p className="hint">Confira o navegador da automação durante a execução.</p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setAction(null)}>
              Voltar
            </button>
            <button
              className="button primary"
              onClick={() => {
                void enqueue(action.kind, action.id, true);
                setAction(null);
              }}
            >
              Confirmar {action.kind === 'start' ? 'início' : 'preenchimento'}
            </button>
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title="Confirmar entrega da avaliação" close={() => setConfirm(null)}>
          <div className="confirmation-banner">
            <ShieldCheck size={23} />
            <div>
              <strong>{confirm.assessment.title}</strong>
              <p>
                {confirm.assessment.course_name} · Tentativa {confirm.assessment.attempt_id}
              </p>
            </div>
          </div>
          <p>
            Confira as respostas aprovadas. Esta ação autoriza o envio definitivo desta avaliação no
            portal.
          </p>
          {confirm.questions.map((q) => (
            <div className="confirmation-answer" key={q.id}>
              <strong>Questão {q.position}</strong>
              <p>{q.prompt}</p>
              <div>
                {q.type === 'text'
                  ? q.answer.text
                  : q.choices
                      .filter((c) => q.answer.choices.includes(c.id))
                      .map((c) => c.text)
                      .join('; ')}
              </div>
            </div>
          ))}
          <p className="hint">
            A confirmação expira em 5 minutos. Qualquer alteração nas questões ou respostas exige
            nova revisão.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={working}
              onClick={() => setConfirm(null)}
            >
              Continuar revisando
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={() =>
                void run(async () => {
                  await post(`/assessments/${confirm.assessment.id}/submit`, {
                    token: confirm.token,
                  });
                  setConfirm(null);
                }, 'Entrega autorizada e adicionada à fila. Acompanhe o comprovante.')
              }
            >
              <CheckCheck size={17} />
              Confirmar entrega
            </button>
          </div>
        </Modal>
      )}
      {deadline && detail && (
        <Modal title="Definir prazo da avaliação" close={() => setDeadline(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('date');
              void run(async () => {
                await api(`/assessments/${detail.assessment.id}/deadline`, {
                  method: 'PATCH',
                  body: JSON.stringify({ due_at: new Date(`${value}:00-03:00`).toISOString() }),
                });
                setDeadline(false);
              }, 'Prazo salvo. Os lembretes já estão ativos.');
            }}
          >
            <p>
              Quando o portal não informa uma data verificável, você pode registrar o prazo
              publicado pela faculdade. Horário de Bahia/Brasília (UTC−3).
            </p>
            <label>
              Data e horário
              <input name="date" type="datetime-local" required />
            </label>
            <p className="hint">
              Este prazo é informado por você e será preservado nas próximas sincronizações.
            </p>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setDeadline(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={working}>
                Salvar prazo
              </button>
            </div>
          </form>
        </Modal>
      )}
      {material && detail && (
        <Modal title="Adicionar material de apoio" close={() => setMaterial(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run(async () => {
                await post('/materials', {
                  course_id: detail.assessment.course_id,
                  title: data.get('title'),
                  content: data.get('content'),
                });
                setMaterial(false);
              }, 'Material adicionado à disciplina.');
            }}
          >
            <p>
              Cole um trecho dos materiais da disciplina. O texto ficará salvo localmente e poderá
              ser selecionado como contexto para a IA.
            </p>
            <label>
              Título
              <input
                name="title"
                required
                maxLength={300}
                placeholder="Ex.: Unidade 1 — Introdução"
              />
            </label>
            <label>
              Conteúdo
              <textarea
                name="content"
                required
                rows={10}
                maxLength={150000}
                placeholder="Cole o texto do material aqui…"
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="button secondary" onClick={() => setMaterial(false)}>
                Cancelar
              </button>
              <button className="button primary" disabled={working}>
                Salvar material
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
