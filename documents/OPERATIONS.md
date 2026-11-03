# Operação local

Consulte o README para instalação. O backend usa Node 24, Fastify e SQLite; o frontend usa React/Vite. A aplicação fica em `http://127.0.0.1:4317`; em desenvolvimento a interface fica em `http://127.0.0.1:5173`. Use uma instância por diretório de dados.

## Configuração

| Variável                           | Finalidade                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `USERNAME`, `PASSWORD`             | Login acadêmico do `.env`. O USERNAME do Windows não é usado como login.      |
| `FOCUS_USERNAME`, `FOCUS_PASSWORD` | Alternativas no ambiente, com prioridade sobre o arquivo.                     |
| `URL_LOGIN`                        | Entrada JACAD da Faculdade Focus.                                             |
| `AVA_COURSE_URL`                   | Link de uma disciplina acessível pela sua conta.                              |
| `PORT`                             | Porta do backend; padrão 4317.                                                |
| `DATA_DIR`                         | Pasta privada; padrão `data/`, relativo ao diretório de execução.             |
| `OLLAMA_URL`                       | Serviço Ollama; padrão `http://127.0.0.1:11434`.                              |
| `FOCUS_MANAGED_OLLAMA`             | No Windows, permite iniciar instância própria em uma porta local configurada. |
| `OLLAMA_NUM_GPU`                   | Opcional; `0` permite execução em CPU.                                        |
| `OPENAI_API_KEY`, `OPENAI_MODEL`   | Opcionais. Não são necessários para conectar o MCP ao modelo do cliente.      |

O aplicativo precisa ser iniciado na raiz do projeto, para resolver corretamente `.env` e dados. O entrypoint MCP aceita caminho absoluto e não lê suas credenciais. `FOCUS_MCP_PORT` configura a porta da API para o MCP.

## Fluxo acadêmico

1. Sincronize para consultar o catálogo de cursos, atividades e calendário por HTTP e RPC JSON. A sincronização não abre navegador, não lê texto de páginas acadêmicas e não inicia tentativas. O consumo de materiais de estudo é um fluxo separado.
2. Confira a última sincronização, as regras e os prazos. A sincronização automática ocorre a cada 30 minutos enquanto a aplicação está ativa.
3. Se a disciplina não aparecer, use o MCP para sincronizar seu ID externo específico.
4. Crie gabaritos locais colando questões, ou use `create_study_set` pelo MCP. Separe questões coladas com `---`; alternativas `A)`, `B)` etc. são reconhecidas.
5. Gere explicações e revise as respostas. A IA não aprova suas sugestões automaticamente.
6. Para operações no portal, consulte regras antes de iniciar e siga as confirmações da interface. O início pode consumir uma oportunidade e começar o cronômetro.
7. Em caso de estado incerto, reconcilie antes de repetir qualquer ação. Ausência de recibo não comprova entrega.

Se o AVA exigir uma tentativa para revelar perguntas, não existe promessa de consulta sem consumo. Use materiais e simulados próprios para se preparar antes de iniciar. A ferramenta de inspeção é somente leitura:

```sh
npm run portal:assessment -- ID_CURSO ID_AVALIACAO
```

Essa inspeção manual usa perfil de navegador separado, grava em `data/assessments/` e não inicia tentativas. Ela não é usada como fallback da sincronização. Pode precisar de login adicional. Não execute duas inspeções simultâneas com o mesmo perfil. Para sincronização HTTP, contratos e exportação de eventos, veja [PORTAL-API.md](PORTAL-API.md).

## IA opcional

Com Ollama ativo, instale um modelo e atualize a lista na interface. A geração usa `/api/tags` e `/api/chat`, com contexto textual limitado e validação de formato. A opção OpenAI usa a Responses API e pode gerar cobrança; não há fallback automático do Ollama para a API paga. Modelos não recebem credenciais nem ferramentas do navegador.

## Backup e restauração

```sh
npm run backup
# Feche a aplicação antes de restaurar:
npm run restore -- data/backups/ARQUIVO.sqlite --app-stopped
```

Backups SQLite diários usam o mecanismo nativo, com retenção de 14 cópias. Restauração valida o arquivo e preserva o banco anterior; WAL/SHM presentes impedem a restauração. Não apague WAL de um banco em uso. Backups SQLite não incluem cookies ou `.env`.

Use a exportação JSON geral e a exportação Markdown de avaliações/checklists para cópias pessoais. Esses arquivos contêm dados privados e devem permanecer em `data/`, `academic/` ou outro local fora do Git.

## Publicação segura

`npm run privacy:check` valida arquivos rastreados e todos os refs locais, inclusive snapshots do editor. Se um snapshot contiver dados privados, não publique esse histórico.

O mantenedor pode usar `npm run public:prepare` para exportar somente os arquivos do commit atual para uma pasta nova em `output/public-release/`. A exportação não copia `.git`, credenciais ou dados acadêmicos e exclui relatórios de validação pessoais. Inicialize um novo Git na cópia e execute a checagem novamente antes de publicar. Um resultado aprovado é evidência adicional, não garantia absoluta de privacidade.
