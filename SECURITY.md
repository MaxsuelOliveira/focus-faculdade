# Segurança e privacidade

Não publique vulnerabilidades com dados de alunos. Use o canal privado de segurança do GitHub quando disponível; não envie senhas, cookies ou bancos, mesmo nesse canal. Uma descrição mínima e uma reprodução com dados fictícios são suficientes para começar.

Credenciais ficam no `.env` local. O aplicativo armazena dados em SQLite e mantém uma sessão autenticada do navegador em `data/browser/`. O arquivo `.env`, toda a pasta `data/`, relatórios em `academic/`, exports e capturas são privados e ignorados pelo Git. Backups locais também contêm dados pessoais.

O backend escuta em `127.0.0.1`, valida Host e Origin e exige um cabeçalho de cliente nas escritas. Isso protege o uso local previsto; não representa autenticação para um serviço público. Não exponha a porta via proxy, rede externa ou túnel sem projetar autenticação e isolamento adequados.

O MCP é local por stdio e só acessa a API em loopback. As ferramentas permitem ações no portal. Revise a permissão do cliente de IA e as confirmações antes de iniciar ou entregar avaliações. A IA conectada recebe o conteúdo que consultar; ao escolher um modelo externo, considere que esses dados serão processados pelo respectivo provedor. A alternativa Ollama pode executar localmente.

`npm run privacy:check` examina arquivos rastreados e blobs do histórico à procura de arquivos privados, padrões de segredo e valores conhecidos do `.env` local, sem imprimir os valores. É uma verificação adicional, não garantia de ausência de qualquer dado sensível.
