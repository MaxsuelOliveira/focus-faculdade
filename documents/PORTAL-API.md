# Integração HTTP com JACAD e API Moodle

O sincronizador usa exclusivamente requisições HTTP e respostas JSON estruturadas. Não inicia Chromium, não usa seletores/`innerText` para dados acadêmicos e não possui fallback visual. A descoberta de disciplinas do módulo de aprendizado usa a mesma integração. Ações explícitas de tentativa, preenchimento e entrega e o consumo de materiais são fluxos separados e mantêm as confirmações existentes.

O contrato foi observado e reproduzido na instalação da Faculdade Focus em 03/11/2026. São APIs internas autenticadas, sem garantia de estabilidade pela instituição. O código valida as respostas antes de gravar e trata campos indisponíveis como desconhecidos. API não implica precisão absoluta nem autorização para consultar informações que a conta não pode acessar.

## 1. Autenticação sem tela de login

| Passo             | Requisição                                                | Contrato observado                                                                                                              |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sessão inicial    | `GET https://faculdadefocus.jacad.com.br/aluno-v2/login`  | Cookie de sessão e ação do formulário de autenticação.                                                                          |
| Login             | `POST /aluno-v2/login/do/`                                | Form URL-encoded com `login.login`, `login.password` e `login.referenciaLogarComo` vazio. A ação pode conter `;jsessionid=...`. |
| JACAD autenticado | Redirecionamento HTTP para `/aluno-v2`                    | Valida que não voltou ao formulário de senha.                                                                                   |
| SSO AVA           | `POST /aluno-v2/moodle/auth/do`                           | Form vazio. Retorna redirecionamento temporário para o Moodle.                                                                  |
| Sessão Moodle     | Seguir somente redirects HTTPS nos dois hosts autorizados | Cookie Moodle e bootstrap JSON `M.cfg`, com `wwwroot` e `sesskey`.                                                              |

A leitura mínima do formulário e do bootstrap serve somente para o protocolo de autenticação, não para interpretar conteúdo acadêmico. O menu do JACAD foi inspecionado por `POST /aluno-v2/carrega-menu-servicos`, que revelou o formulário SSO; esse passo de descoberta não precisa ser repetido a cada sincronização.

Credenciais vêm do `.env`/ambiente do próprio aluno. O cliente HTTP usa cookie jar em memória e fecha a sessão local ao terminar, inclusive em caso de erro. Não persiste cookies, não registra corpos de login e não devolve `sesskey` na API local. Não existe troca de senha, criação de token móvel ou contorno de MFA/CAPTCHA no sincronizador. Redirecionamentos para outros hosts são recusados antes de acessá-los.

## 2. RPC JSON observado

Destino:

```text
POST https://graduacao.faculdadefocus.edu.br/lib/ajax/service.php?sesskey=<CHAVE_DA_SESSAO>
Content-Type: application/json
Cookie: <COOKIE_DO_PROPRIO_ALUNO>
```

Exemplo sintético:

```json
[
  {
    "index": 0,
    "methodname": "core_course_get_enrolled_courses_by_timeline_classification",
    "args": { "classification": "all", "limit": 100, "offset": 0, "sort": "fullname" }
  }
]
```

Envelope de sucesso: `[{"error":false,"data":...}]`. Envelope de falha: `[{"error":true,"exception":...}]`. Corpos remotos de erro nunca são repassados ao usuário ou persistidos em logs. O cliente aceita somente os três métodos de consulta abaixo; métodos de escrita são recusados antes da requisição.

### Catálogo e cursos em andamento

`core_course_get_enrolled_courses_by_timeline_classification`

- `classification`: `all` para o catálogo e `inprogress` para a classificação do servidor.
- `limit`: 100; `offset`: começa em zero e avança por `nextoffset`.
- `sort`: `fullname`.
- Resposta: `{courses: [...], nextoffset: number}`.

Cada curso fornece `id`, `fullname`, `startdate`, `enddate`, `viewurl`, `visible`, `hidden` e, quando presente, `coursecategory`. Os timestamps são segundos Unix; zero representa ausência de data. A integração percorre todas as páginas e rejeita IDs repetidos ou paginação sem avanço. `inProgress` é o pertencimento à resposta `inprogress`, não uma conclusão baseada no nome ou mês escrito no título. Isso representa a classificação do AVA, não um comprovante administrativo de matrícula ativa no JACAD.

### Módulos e catálogo de provas

`core_courseformat_get_state`, com `{courseid: <ID_MOODLE>}`.

O campo `data` vem como string JSON, decodificada uma única vez e validada como `{course, section, cm}`. `cm` fornece os IDs de curso-módulo, `name`, `module`, `url`, `visible`, `uservisible` e, quando habilitado, `completionstate`.

Atividades `module="quiz"` identificam avaliações; `assign` identifica tarefas. **ID de curso-módulo não é assumido como ID interno de instância de questionário.** A correlação de prazos usa URL canônica, ID da atividade e ID do curso. Módulos inacessíveis não são tratados como provas disponíveis. Ausências em uma nova resposta são marcadas nos fatos do snapshot, sem apagar respostas ou histórico local.

`completionstate` registra conclusão de atividade. Ele não comprova tentativa aberta, envio, aprovação ou nota, portanto não alimenta esses estados.

### Calendário

`core_calendar_get_calendar_monthly_view`, com:

```json
{
  "year": 2026,
  "month": 10,
  "courseid": 0,
  "categoryid": 0,
  "includenavigation": false,
  "mini": false,
  "day": 1,
  "view": "month"
}
```

Os eventos vêm em `weeks[].days[].events[]`. O sincronizador guarda `id`, `name`, `description`, `eventtype`, `modulename`, `timestart`, `timeduration`, `course.id` e `url`. Não armazena URLs de edição/exclusão, que podem conter chaves de sessão. Eventos repetidos em dias/meses são deduplicados por ID; respostas contraditórias interrompem a operação.

O planejamento consulta os meses entre a primeira data inicial não nula dos cursos e a data mais distante entre seus términos e um ano após a consulta, acrescentando um mês em cada extremidade para cobrir fronteiras de fuso. Se não houver início, usa um ano anterior. A cobertura efetiva vem dos timestamps `date.timestamp` e `nextperiod.timestamp` retornados pelo servidor: não se presume que o mês comece à meia-noite UTC. Cada resposta precisa corresponder ao ano/mês solicitado e ser contígua à anterior. Intervalos acima de 120 meses são recusados, sem truncamento silencioso. Eventos anteriores já armazenados fora da nova cobertura permanecem identificáveis, mas a API não declara cobertura completa fora do último intervalo consultado. A consulta local inclui eventos que se sobrepõem ao intervalo pelo par `timestart`/`timeduration`, inclusive eventos longos que começaram em outro mês.

Um evento `modulename="quiz"` e `eventtype="close"` fornece o fechamento da avaliação quando aponta para a mesma atividade e curso. Datas conflitantes são expostas como ambiguidade. Não são convertidos avisos como “liberada no dia 20” em datas de vencimento. Prazos manuais permanecem preservados no banco existente e são identificados separadamente do fechamento recebido pela API.

## 3. Limites comprovados do acesso atual

O serviço `mod_quiz_get_quizzes_by_courses` foi consultado com a sessão web e respondeu `servicenotavailable`. A definição oficial do Moodle o disponibiliza no serviço móvel, sem habilitação AJAX por padrão. Um teste de autenticação móvel com as mesmas credenciais retornou `invalidlogin`; o sincronizador não repete esse login nem tenta obter tokens por rotas alternativas.

Consequentemente, a implementação atual **não fornece pela API disponível**: limite de tentativas, duração máxima, estado atual da tentativa, comprovante de envio nem questões reais da prova. Na projeção `/api/portal/*`, campos correspondentes ficam desconhecidos, mesmo se houver observações antigas obtidas por outro fluxo. Perguntas locais continuam acessíveis, identificadas por `questionSource="local_extraction_or_study"`. Nenhuma tentativa é iniciada para completar dados faltantes.

Para ampliar essas capacidades, a instituição precisaria disponibilizar um serviço/token autorizado que permita as consultas correspondentes. Não há variável de token “mágica” nem promessa de suporte móvel sem validação real.

Referências primárias: [serviços oficiais do módulo Quiz](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/quiz/db/services.php) e [contrato oficial do estado de curso](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/course/format/classes/external/get_state.php). A existência no código oficial não significa que um serviço esteja autorizado nessa instalação; a evidência principal continua sendo a resposta do servidor.

## 4. API local e OpenAPI

Contrato legível por máquina: [portal-api.openapi.json](portal-api.openapi.json), também servido em `GET /api/portal/openapi`.

| Método e rota                              | Uso                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/jobs` com `kind="sync"`         | Enfileira sincronização HTTP; `course_external_id` opcional limita a consulta de módulos a um curso do catálogo autorizado.  |
| `GET /api/dashboard`                       | Acompanha a fila e as observações locais existentes. Não comprova que todos os campos históricos foram revalidados pela API. |
| `GET /api/portal/status`                   | Capacidades, última conclusão, cobertura e escopo da consulta de módulos.                                                    |
| `GET /api/portal/courses`                  | Cursos e avaliações com origem por campo e classificação do servidor. Cursos locais sem snapshot têm `api=null`.             |
| `GET /api/portal/assessments/:id`          | Avaliação por ID local, limites da fonte e perguntas locais identificadas.                                                   |
| `GET /api/portal/calendar?from=...&to=...` | Eventos Moodle, prazos efetivos locais separados e `coverageComplete`.                                                       |
| `GET /api/portal/export`                   | Exportação privada de catálogo, fatos e eventos, sem cookies ou `sesskey`.                                                   |

As escritas continuam exigindo `Origin` local autorizado e `X-Focus-Client: local`; o Host também é validado. Datas de consulta usam ISO 8601 com offset e intervalo inclusivo. Encode `+` como `%2B` na query string.

O MCP usa a projeção `/api/portal/*` nas ferramentas `courses`, `calendar` e `assessment`. `calendar.events` contém o calendário estruturado; `assessmentDeadlines` mantém os prazos locais e possíveis overrides, sem apresentá-los como novos eventos oficiais.

## 5. Persistência, falhas e validação

Primeiro são consultadas e validadas todas as respostas; depois uma transação SQLite grava catálogo, módulos, eventos, cobertura e `lastApiSync`. Uma falha não apaga o snapshot anterior nem avança a data de sucesso. A sincronização é serial pela fila existente. Uma consulta específica não substitui silenciosamente uma consulta geral ou vice-versa.

Tabelas adicionais: `portal_api_courses`, `portal_api_modules`, `portal_api_events` e `portal_api_syncs`. Os backups nativos do SQLite as incluem; a exportação desses dados usa `/api/portal/export`. O exportador geral legado permanece compatível com suas entidades anteriores.

Erros sanitizados distinguem autenticação necessária, serviço indisponível, contrato inválido e falha HTTP. MFA/CAPTCHA exigido pelo servidor resulta em impedimento explícito, não em abertura automática do navegador.

Os testes cobrem autenticação e redirects simulados, allowlist de métodos, ausência de navegador no despacho de sincronização, paginação, validação de contratos, falha parcial, deduplicação e remoção de eventos, preservação de respostas/aprovações e prazo manual, cobertura e proteção das rotas locais. A verificação real é feita em banco privado isolado; nenhum HAR, cookie, dado de aluno ou resposta autenticada deve ser adicionado ao repositório público.
