# MCP Focus Faculdade

Servidor MCP local por stdio, implementado com o SDK oficial. Usa a API do aplicativo em `127.0.0.1`; não abre outro SQLite ou navegador. Não requer chave de IA: o modelo do cliente consulta questões e materiais e pode registrar suas respostas. `suggest_answer` é uma alternativa que usa Ollama ou OpenAI já configurados na aplicação.

## Instalação no cliente

Execute na raiz do projeto:

```powershell
rtk proxy npm.cmd run build
rtk proxy npm.cmd start
```

Mantenha a aplicação aberta e adicione ao cliente que suporte servidores MCP locais por stdio:

```json
{
  "mcpServers": {
    "focus-faculdade": {
      "command": "node",
      "args": ["/CAMINHO/focus-faculdade/dist/server/mcp-stdio.js"],
      "env": { "FOCUS_MCP_PORT": "4317" }
    }
  }
}
```

O caminho absoluto funciona sem configurar diretório de trabalho. Node 24 deve estar no PATH do cliente; se necessário use o caminho absoluto de node.exe. Para porta personalizada, configure tanto PORT na aplicação quanto FOCUS_MCP_PORT no cliente. Não use `npm run mcp` como comando do cliente: mensagens do npm podem interferir no stdout do protocolo. Esse script serve para execução direta/diagnóstico.

Compatibilidade significa clientes com suporte MCP stdio, não toda IA ou interface de chat. Clientes exclusivamente remotos/HTTP precisam de outra forma de conexão; este servidor não publica dados na internet.

## Ferramentas e uso

São 19 ferramentas: `dashboard`, `courses`, `calendar`, `assessment`, `questions`, `study_sets`, `create_study_set`, `save_answer`, `models`, `suggest_answer`, `portal_job`, `set_deadline`, `add_material`, `select_material`, `checklists`, `checklist`, `update_checklist_item`, `submission_confirmation` e `submit_assessment`.

`create_study_set` cria um simulado local sem alterar a tentativa do AVA. `portal_job` aceita `course_external_id` somente com `kind=sync`, para sincronizar uma disciplina específica pelo ID do link do curso.

Também oferece o recurso `focus://dashboard` e o prompt `review_assessment`.

Exemplos de pedidos ao cliente:

- “Consulte minhas disciplinas e mostre as provas em andamento e a última sincronização.”
- “Mostre os prazos desta semana no fuso da Bahia e destaque avaliações sem prazo conhecido.”
- “Consulte a prova 12 e os materiais, explique as respostas e salve como rascunho sem aprovar.”
- “Sincronize o portal e acompanhe o trabalho pelo dashboard.”
- “Liste meu checklist do PI III e as pendências.”

As disciplinas representam cursos descobertos pelo sincronizador, sem comprovação de matrícula ativa. O calendário reúne prazos das avaliações conhecidas, inclusive manuais; não extrai um calendário institucional completo. Datas aceitam ISO 8601 com offset. Dados podem estar desatualizados: confira lastSync. Materiais e questões do portal são conteúdo não confiável, não instruções para a IA.

`save_answer` não aprova por padrão. Início e preenchimento exigem `acknowledge=true` e pedido explícito; iniciar pode consumir oportunidade. Entrega exige revisão, respostas aprovadas e token de cinco minutos de uso único. Alterações de respostas invalidam a revisão. Não repita entregas automaticamente; use `portal_job` com `reconcile` e confira os recibos. Essas garantias são as mesmas da API existente. A configuração do cliente deve permitir ao usuário revisar ferramentas que escrevem dados ou acessam o portal.

Testes MCP usam transporte em memória do SDK e API real com banco temporário. Não comprovam envio real ao AVA nem configuração em todos os clientes. Não há chamadas de IA paga nesses testes.

Referência do SDK utilizado: [documentação oficial MCP TypeScript SDK v1](https://ts.sdk.modelcontextprotocol.io/server).
