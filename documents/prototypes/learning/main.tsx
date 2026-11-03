import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BookOpen,
  Network,
  FileText,
  Presentation,
  ListChecks,
  ArrowRight,
  ArrowLeft,
  Pause,
  Play,
  Search,
  History,
  GraduationCap,
  X,
} from 'lucide-react';
import './style.css';

const course = 'GESTÃO FINANCEIRA - ELETIVA (2026.NOV)';
const screens = [
  'Disciplinas',
  'Preparar',
  'Consumo',
  'Resumo',
  'Mapa mental',
  'Slides',
  'Simulado',
  'Histórico',
];
const icons = [BookOpen, ListChecks, Play, FileText, Network, Presentation, GraduationCap, History];
const materials = [
  {
    title: 'Fundamentos da gestão financeira',
    type: 'Texto',
    state: 'Lido',
    source: 'Exemplo de texto · p. 1–8',
  },
  {
    title: 'Fluxo de caixa e capital de giro',
    type: 'PDF',
    state: 'Lido',
    source: 'Exemplo de apostila · p. 9–16',
  },
  {
    title: 'Decisões de investimento',
    type: 'Vídeo',
    state: 'Pendente',
    source: 'Transcrição ainda não disponível',
  },
];
const topics = [
  'Objetivos financeiros',
  'Fluxo de caixa',
  'Capital de giro',
  'Decisões de investimento',
];
const paragraphs = [
  'A gestão financeira organiza as decisões de captação e aplicação de recursos. O planejamento conecta os objetivos da organização à disponibilidade de caixa.',
  'O fluxo de caixa acompanha entradas e saídas ao longo do tempo. Seu planejamento permite identificar períodos de insuficiência e antecipar necessidades de recursos.',
  'Capital de giro sustenta a operação cotidiana. Prazos de estoque, recebimento e pagamento influenciam a necessidade de financiamento.',
  'A análise de investimentos compara desembolsos e benefícios esperados. Risco, prazo e custo de capital precisam ser considerados em conjunto.',
];
function App() {
  const [screen, setScreen] = useState(0);
  const [filter, setFilter] = useState('Todas');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(true);
  const [paused, setPaused] = useState(false);
  const [source, setSource] = useState<number | null>(null);
  const [slide, setSlide] = useState(0);
  const [answer, setAnswer] = useState('');
  const [corrected, setCorrected] = useState(false);
  const [notice, setNotice] = useState('');
  const [model, setModel] = useState('Ollama · modelo a selecionar');
  const [outputs, setOutputs] = useState(['Resumo', 'Mapa mental', 'Slides', 'Simulado']);
  const [scenario, setScenario] = useState('Com conteúdo');
  const go = (id: number) => {
    setScreen(id);
    setNotice('');
  };
  const download = () => {
    const blob = new Blob(
      [
        `# ${course}\n\nDEMONSTRAÇÃO VISUAL — não extraído do AVA.\n\n${topics.map((t, i) => `## ${t}\n${paragraphs[i]}`).join('\n\n')}`,
      ],
      { type: 'text/markdown;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exemplo-resumo.md';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Exemplo exportado. O pacote real será gerado após consumir as fontes.');
  };
  return (
    <div className="shell">
      <aside className="rail">
        <a className="brand" href="#" aria-label="Focus Faculdade" onClick={() => go(0)}>
          <BookOpen size={25} />
        </a>
        <nav aria-label="Telas do protótipo">
          {screens.map((name, i) => {
            const Icon = icons[i];
            return (
              <button
                key={name}
                title={name}
                aria-label={name}
                aria-current={screen === i ? 'page' : undefined}
                onClick={() => go(i)}
              >
                <Icon size={19} />
                <span>{name}</span>
              </button>
            );
          })}
        </nav>
        <span className="rail-foot">Focus</span>
      </aside>
      <main>
        <div className="prototype">
          <strong>Protótipo para aprovação</strong>
          <span>Dados demonstrativos · sem consumo ou geração real</span>
          <a href="/">Abrir aplicativo atual ↗</a>
        </div>
        <header>
          <div>
            <p className="breadcrumb">
              Focus Faculdade / Aprendizagem{screen > 0 ? ' / Gestão Financeira' : ''}
            </p>
            <h1>{screens[screen]}</h1>
            <p className="subtitle">
              {screen === 0
                ? 'Escolha o que estudar. Transforme os materiais em um caderno com fontes.'
                : course}
            </p>
          </div>
          {screen > 2 && screen < 7 && (
            <button onClick={download}>
              Exportar exemplo <ArrowRight size={15} />
            </button>
          )}
        </header>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {screen === 0 && (
          <>
            <div className="filters">
              <div className="tabs" aria-label="Situação das disciplinas">
                {['Todas', 'Em andamento', 'Finalizadas', 'Não classificadas'].map((t) => (
                  <button
                    key={t}
                    className={filter === t ? 'active' : ''}
                    onClick={() => setFilter(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Buscar disciplina"
                  placeholder="Buscar disciplina"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <div className="two-col">
              <section className="panel">
                <div className="panel-head">
                  <h2>Suas disciplinas</h2>
                  <small>Exemplos de organização</small>
                </div>
                {[
                  { name: course, status: 'Em andamento', period: 'Novembro · 2026' },
                  {
                    name: 'PROGRAMAÇÃO PARA INTERNET (2026.OUT)',
                    status: 'Finalizadas',
                    period: 'Outubro · 2026',
                  },
                  {
                    name: 'PROJETO INTERDISCIPLINAR III',
                    status: 'Não classificadas',
                    period: 'Situação acadêmica a confirmar',
                  },
                ]
                  .filter(
                    (c) =>
                      (filter === 'Todas' || filter === c.status) &&
                      c.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                  )
                  .map((c, i) => (
                    <label className="course-row" key={c.name}>
                      <input
                        type="checkbox"
                        checked={i === 0 && selected}
                        onChange={(e) => {
                          setSelected(e.target.checked);
                          if (c.name !== course)
                            setNotice('Neste protótipo, o fluxo detalhado usa Gestão Financeira.');
                        }}
                      />
                      <div>
                        <h3>{c.name}</h3>
                        <p>{c.period}</p>
                      </div>
                      <span className="badge">{c.status}</span>
                    </label>
                  ))}
                <p className="footnote">
                  “Finalizada” será informada pelo portal ou marcada por você. A data do curso,
                  sozinha, não define a situação.
                </p>
              </section>
              <section className="panel selection">
                <h2>Seu próximo caderno</h2>
                <BookOpen size={38} strokeWidth={1} />
                <h3>{selected ? 'Gestão Financeira' : 'Selecione uma disciplina'}</h3>
                <p>
                  Leia os materiais, acompanhe o que ficou pendente e revise em quatro formatos.
                </p>
                <ul>
                  <li>Resumo com referências</li>
                  <li>Mapa mental navegável</li>
                  <li>Slides por assunto</li>
                  <li>Simulado com explicações</li>
                </ul>
                <button className="primary" disabled={!selected} onClick={() => go(1)}>
                  Aprender e consumir <ArrowRight size={16} />
                </button>
              </section>
            </div>
          </>
        )}
        {screen === 1 && (
          <div className="two-col">
            <section className="panel">
              <h2>Preparar a aprendizagem</h2>
              <p>
                Primeiro descobrimos os materiais disponíveis. Depois você acompanha a leitura e a
                geração.
              </p>
              <div className="steps">
                {[
                  'Descobrir materiais',
                  'Ler e transcrever',
                  'Organizar conceitos',
                  'Gerar caderno',
                ].map((s, i) => (
                  <div key={s}>
                    <span>{i + 1}</span>
                    {s}
                  </div>
                ))}
              </div>
              <h3>O que você quer gerar?</h3>
              <div className="options">
                {['Resumo', 'Mapa mental', 'Slides', 'Simulado'].map((o) => (
                  <label key={o}>
                    <input
                      type="checkbox"
                      checked={outputs.includes(o)}
                      onChange={() =>
                        setOutputs((prev) =>
                          prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o],
                        )
                      }
                    />
                    {o}
                  </label>
                ))}
              </div>
              <label className="field">
                IA para organizar o conteúdo
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option>Ollama · modelo a selecionar</option>
                  <option>MCP · assistente conectado</option>
                  <option>OpenAI · escolha explícita por geração</option>
                </select>
              </label>
              <p className="footnote">
                OpenAI pode gerar custos. Nenhum provedor é chamado neste protótipo.
              </p>
            </section>
            <section className="panel">
              <h2>Escopo e cobertura</h2>
              <p>Textos, PDFs e transcrições acessíveis da disciplina selecionada.</p>
              <div className="note">
                Vídeos sem transcrição ficam pendentes. O sistema não vai declarar que consumiu um
                vídeo apenas por abrir sua página.
              </div>
              <p>
                Conteúdos privados permanecem no armazenamento local. Trechos só são enviados ao
                provedor escolhido por você.
              </p>
              <button disabled={!outputs.length} className="primary" onClick={() => go(2)}>
                Pré-visualizar consumo <ArrowRight size={16} />
              </button>
              <p className="footnote">Ação demonstrativa. Nenhuma avaliação é iniciada.</p>
            </section>
          </div>
        )}
        {screen === 2 && (
          <>
            <div className="two-col">
              <section className="panel">
                <div className="panel-head">
                  <h2>{paused ? 'Consumo pausado' : 'Leitura dos materiais'}</h2>
                  <button onClick={() => setPaused(!paused)}>
                    {paused ? <Play size={15} /> : <Pause size={15} />}{' '}
                    {paused ? 'Retomar' : 'Pausar'}
                  </button>
                </div>
                <div className="coverage">
                  <strong>
                    2 <small>de 3 materiais processados</small>
                  </strong>
                  <progress value="2" max="3" />
                  <p>1 vídeo pendente · cobertura parcial</p>
                </div>
                <div className="material-list">
                  {materials.map((m, i) => (
                    <div key={m.title}>
                      <div>
                        <small>{m.type}</small>
                        <h3>{m.title}</h3>
                        <p>{m.source}</p>
                      </div>
                      <span className="badge">{m.state}</span>
                      <button onClick={() => setSource(i)}>Detalhes</button>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <h2>O que acontece agora?</h2>
                <ol className="timeline">
                  <li>Descoberta dos materiais</li>
                  <li>Extração de texto e referências</li>
                  <li className="pending">Resolver a transcrição do vídeo</li>
                  <li>Gerar os formatos escolhidos</li>
                </ol>
                <div className="note">
                  Com uma fonte pendente, o caderno é identificado como parcial. Você pode anexar
                  uma transcrição ou continuar com as fontes lidas.
                </div>
                <button
                  className="primary"
                  disabled={paused}
                  onClick={() => {
                    go(3);
                    setNotice(
                      'Prévia de caderno parcial. Conteúdo ilustrativo, ainda não extraído da disciplina.',
                    );
                  }}
                >
                  Ver caderno parcial <ArrowRight size={16} />
                </button>
              </section>
            </div>
          </>
        )}
        {screen >= 3 && screen <= 6 && (
          <>
            <div className="result-bar">
              <span className="badge">Prévia parcial · dados demonstrativos</span>
              <span>2 fontes de exemplo · 1 pendência</span>
              <button onClick={() => go(2)}>Ver cobertura</button>
            </div>
            <div className="result-tabs">
              {screens.slice(3, 7).map((s, i) => (
                <button
                  key={s}
                  className={screen === i + 3 ? 'active' : ''}
                  onClick={() => go(i + 3)}
                >
                  {s}
                </button>
              ))}
            </div>
            {screen === 3 && (
              <div className="two-col reading">
                <article className="panel">
                  <h2>O essencial da disciplina</h2>
                  <p className="lead">
                    Decidir como obter, aplicar e preservar os recursos de uma organização.
                  </p>
                  {topics.slice(0, 3).map((t, i) => (
                    <section className="topic" key={t}>
                      <h3>{t}</h3>
                      <p>{paragraphs[i]}</p>
                      <button className="source-link" onClick={() => setSource(i === 0 ? 0 : 1)}>
                        Consultar fonte de exemplo · {i === 0 ? 'p. 1–8' : 'p. 9–16'} ↗
                      </button>
                    </section>
                  ))}
                  <div className="note">
                    Decisões de investimento: cobertura incompleta enquanto o vídeo estiver
                    pendente.
                  </div>
                </article>
                <aside className="panel">
                  <h2>Roteiro de revisão</h2>
                  <ol className="timeline">
                    {topics.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ol>
                  <h3>Pergunta para refletir</h3>
                  <p>Por que uma empresa com lucro pode ter dificuldade para pagar suas contas?</p>
                  <button onClick={() => go(6)}>
                    Praticar no simulado <ArrowRight size={15} />
                  </button>
                  <p className="footnote">
                    Exemplos editoriais de interface. Não constituem resumo validado do curso.
                  </p>
                </aside>
              </div>
            )}
            {screen === 4 && (
              <section className="panel">
                <div className="panel-head">
                  <h2>Conexões entre os conceitos</h2>
                  <small>Clique em um ramo para consultar a origem</small>
                </div>
                <div className="mindmap">
                  <div className="map-root">
                    Gestão financeira<small>Planejar · decidir · acompanhar</small>
                  </div>
                  <div className="branches">
                    {topics.map((t, i) => (
                      <button key={t} onClick={() => setSource(i === 3 ? 2 : i === 0 ? 0 : 1)}>
                        <strong>{t}</strong>
                        <span>
                          {
                            [
                              'Objetivos e recursos',
                              'Entradas e saídas',
                              'Operação e prazos',
                              'Risco e retorno',
                            ][i]
                          }
                        </span>
                        <small>{i === 3 ? 'Fonte pendente' : 'Ver fonte de exemplo ↗'}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}
            {screen === 5 && (
              <section className="panel">
                <div className="slide">
                  <small>Gestão Financeira · revisão</small>
                  <span className="slide-num">
                    {slide + 1} / {topics.length}
                  </span>
                  <h2>{topics[slide]}</h2>
                  <p>{paragraphs[slide]}</p>
                  <div className="slide-note">
                    {slide === 3
                      ? 'Fonte pendente — não coberto pelo exemplo.'
                      : 'Fonte demonstrativa · consultar versão e páginas no caderno.'}
                  </div>
                </div>
                <div className="slide-controls">
                  <button
                    aria-label="Slide anterior"
                    disabled={slide === 0}
                    onClick={() => setSlide(slide - 1)}
                  >
                    <ArrowLeft size={17} /> Anterior
                  </button>
                  <div>
                    {topics.map((t, i) => (
                      <button
                        key={t}
                        aria-label={`Slide ${i + 1}`}
                        aria-current={slide === i ? 'step' : undefined}
                        className={slide === i ? 'active' : ''}
                        onClick={() => setSlide(i)}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button disabled={slide === 3} onClick={() => setSlide(slide + 1)}>
                    Próximo <ArrowRight size={17} />
                  </button>
                </div>
              </section>
            )}
            {screen === 6 && (
              <div className="two-col">
                <section className="panel">
                  <div className="panel-head">
                    <h2>Questão de prática</h2>
                    <small>1 questão demonstrativa</small>
                  </div>
                  <p className="lead">
                    Qual é a principal finalidade de projetar o fluxo de caixa?
                  </p>
                  <fieldset disabled={corrected}>
                    <legend>Escolha uma alternativa</legend>
                    {[
                      'Antecipar entradas, saídas e necessidades de recursos.',
                      'Garantir que toda venda seja recebida no mesmo dia.',
                      'Substituir a apuração do resultado contábil.',
                    ].map((a, i) => (
                      <label className="answer" key={a}>
                        <input
                          type="radio"
                          name="answer"
                          checked={answer === String(i)}
                          onChange={() => setAnswer(String(i))}
                        />
                        <span>
                          {String.fromCharCode(65 + i)}. {a}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {!corrected ? (
                    <button
                      className="primary"
                      disabled={!answer}
                      onClick={() => setCorrected(true)}
                    >
                      Conferir resposta
                    </button>
                  ) : (
                    <div className="feedback">
                      <h3>{answer === '0' ? 'Resposta correta' : 'Reveja o conceito'}</h3>
                      <p>
                        A alternativa A antecipa a disponibilidade de caixa ao longo do tempo,
                        permitindo planejar necessidades de recursos.
                      </p>
                      <button onClick={() => setSource(1)}>Revisar fonte de exemplo</button>
                      <button
                        onClick={() => {
                          setCorrected(false);
                          setAnswer('');
                        }}
                      >
                        Tentar novamente
                      </button>
                    </div>
                  )}
                </section>
                <aside className="panel">
                  <h2>Praticar para compreender</h2>
                  <p>
                    O simulado será criado a partir dos materiais efetivamente consumidos, com
                    justificativa e referência em cada questão.
                  </p>
                  <div className="note">
                    Simulado pessoal. As questões geradas não representam o gabarito ou as perguntas
                    de uma prova do AVA.
                  </div>
                  <h3>Depois de responder</h3>
                  <p>
                    Seu histórico mostrará os assuntos que precisam de revisão, sem confundir
                    desempenho no simulado com conclusão da disciplina.
                  </p>
                </aside>
              </div>
            )}
          </>
        )}
        {screen === 7 && (
          <section className="panel">
            <div className="panel-head">
              <h2>Versões e pendências</h2>
              <select
                aria-label="Cenário do histórico"
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              >
                {['Com conteúdo', 'Vazio', 'Erro', 'Processando'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            {scenario === 'Vazio' ? (
              <div className="empty">
                <BookOpen size={30} />
                <h3>Nenhum caderno criado</h3>
                <p>Escolha uma disciplina e comece a descoberta dos materiais.</p>
                <button onClick={() => go(0)}>Escolher disciplina</button>
              </div>
            ) : scenario === 'Erro' ? (
              <div className="empty" role="alert">
                <h3>Não foi possível concluir a leitura</h3>
                <p>
                  O progresso anterior permanece salvo. Confira a fonte que falhou antes de retomar.
                </p>
                <button onClick={() => go(2)}>Ver materiais pendentes</button>
              </div>
            ) : scenario === 'Processando' ? (
              <div className="empty" role="status">
                <h3>Organizando os conceitos</h3>
                <p>Acompanhe as etapas e os materiais disponíveis.</p>
                <button onClick={() => go(2)}>Acompanhar consumo</button>
              </div>
            ) : (
              <>
                <div className="history-row">
                  <div>
                    <h3>Caderno de Gestão Financeira</h3>
                    <p>Versão 1 · demonstração · cobertura parcial</p>
                  </div>
                  <span className="badge">Revisão pendente</span>
                  <button onClick={() => go(3)}>
                    Abrir caderno <ArrowRight size={15} />
                  </button>
                </div>
                <p className="footnote">
                  Na implementação, cada versão guardará fontes, hashes do conteúdo, provedor,
                  modelo e data de geração.
                </p>
              </>
            )}
          </section>
        )}
        <footer>
          Focus Faculdade · Aprender com contexto, revisar com fontes.
          <span>Proposta visual 01</span>
        </footer>
      </main>
      {source !== null && (
        <div className="overlay" onClick={() => setSource(null)}>
          <section
            className="source-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="close" aria-label="Fechar fonte" onClick={() => setSource(null)}>
              <X size={20} />
            </button>
            <small>Origem do conteúdo · demonstração</small>
            <h2 id="source-title">{materials[source].title}</h2>
            <span className="badge">{materials[source].state}</span>
            <p>{materials[source].source}</p>
            <blockquote>
              {source === 2
                ? 'Não há transcrição disponível neste exemplo. Anexe uma transcrição ou mantenha o material pendente.'
                : paragraphs[source]}
            </blockquote>
            <p className="footnote">
              O conteúdo acima é apenas uma amostra de layout. A versão real exibirá a URL
              autorizada, a página ou o intervalo de tempo e o trecho original.
            </p>
            <button
              onClick={() => {
                setSource(null);
                go(2);
              }}
            >
              Voltar aos materiais
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
