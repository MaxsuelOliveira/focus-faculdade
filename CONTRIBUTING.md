# Como contribuir

Abra uma issue descrevendo o problema com dados fictícios. Inclua sistema operacional, versão do Node, comando executado e comportamento esperado. Nunca anexe dados de aluno, cookies, capturas autenticadas ou arquivos de `data/`.

Para desenvolver, use Node 24+, `npm ci`, `npm run browser:install` e `npm run dev`. A interface fica em `http://127.0.0.1:5173`. Configure somente credenciais próprias no `.env` local. A sincronização real acessa sua conta; testes automatizados usam fixtures e bancos temporários.

Antes de abrir um PR:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run privacy:check
git diff --check
```

Preserve a fila serial, as confirmações de ações no portal e a separação entre sugestões, respostas e aprovação. Não enfraqueça os controles de Host/Origin. Alterações de adaptadores precisam de fixtures fictícias; operações reais de entrega não fazem parte da CI.

Contribuições seguem a licença MIT. Este é um projeto independente da instituição.
