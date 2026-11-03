# Aprender e consumir

O fluxo reúne materiais de disciplinas em resumo, mapa mental, slides e simulado pessoal. A direção visual foi aprovada em 03/11/2026. A interface real está em **Aprender e consumir**, com busca, seleção e classificação entre em andamento, concluída e não classificada.

## Uso

1. Descubra as disciplinas, selecione aquelas que deseja estudar e inicie a leitura.
2. Confira progresso, pendências, pausa e retomada. Importe texto manual quando necessário; retire fontes explicitamente do contexto com justificativa.
3. Transcreva os vídeos: o sistema prefere legendas HLS/VTT e oferece reconhecimento local do áudio quando não existem legendas.
4. Selecione um modelo instalado do Ollama e gere o caderno. A geração percorre todo o texto extraído em blocos, elimina conteúdo idêntico e conserva blocos válidos para retomada.
5. Revise os conceitos pelas fontes. Exporte Markdown, mapa SVG e slides HTML imprimíveis; pratique o simulado local com correção e justificativas.

Nenhuma destas operações inicia ou envia uma prova no AVA.

## Arquitetura e persistência

- shared/learning.ts: contratos, referências, alternativas e integridade da árvore.
- server/learning/store.ts: SQLite, migrações versionadas 4–10, fontes, consumos, cache, mídia, cadernos imutáveis e prática.
- server/learning/portal.ts e external.ts: leitura autenticada, destinos autorizados, PDFs completos e mídia.
- pdf.ts: PDF.js, com identificação explícita de páginas sem texto.
- ocr.ts: Tesseract local em português para imagens, com confiança e ressalva sobre relações visuais.
- media.ts e transcribe.ts: identidade dos vídeos, HLS/VTT com limites, captura local de áudio e reconhecimento opcional.
- generate.ts: geração Ollama com JSON validado por bloco, referências restritas e retomada do cache.
- export.ts: SVG e HTML escapados; a cobertura acompanha os arquivos.
- src/components/LearningDesk.tsx, LearningMap.tsx e learning.css: painel e árvore navegável; modais reutilizam o componente existente.

IDs e hashes congelam as fontes antes da geração. Mudanças de conteúdo invalidam a gravação até nova conferência. Cada caderno conserva a cópia das fontes usada naquela versão. Fontes não incluídas permanecem registradas com justificativa, não podem fundamentar conceitos e não são declaradas consumidas. URLs com tokens, PDFs, legendas, áudio, dados pessoais e resultados ficam no diretório privado, fora do Git.

A fila é persistente e serial. Leituras e geração podem ser recuperadas; o cache evita repetir blocos concluídos. Essa recuperação não muda as regras existentes de reconciliação e confirmação para ações de avaliação.

## Configuração no Windows

```powershell
rtk proxy npm.cmd install
rtk proxy npm.cmd run browser:install
rtk proxy npm.cmd run build
rtk proxy npm.cmd start
```

Interface em http://127.0.0.1:4317. Preserve o .env. Configure OLLAMA_URL para a instância local e instale um modelo antes de gerar. Nenhuma chamada OpenAI é usada como fallback da aprendizagem. O MCP permite que o assistente conectado produza e salve um pacote explícito.

O OCR baixa o idioma português na primeira utilização; as imagens são reconhecidas localmente. Para vídeos sem legendas, instale FFmpeg/ffprobe no PATH, Python e faster-whisper (rtk proxy python -m pip install faster-whisper). O primeiro reconhecimento pode baixar o modelo. O processamento usa CPU e pode ser demorado. Não há análise automática dos elementos visuais do vídeo. Legendas não dependem do reconhecimento de áudio.

Para desenvolvimento: rtk proxy npm.cmd run dev. Encerre com Ctrl+C no terminal de origem. Não são instalados serviços permanentes. Backup e restauração seguem os comandos e retenção existentes do README.

## MCP

O servidor anuncia 27 ferramentas, incluindo oito de aprendizagem:

- learning_dashboard: disciplinas, consumos e cadernos.
- learning_discover: descoberta autenticada.
- learning_consume: leitura por disciplina.
- learning_context: metadados e hashes sem despejar documentos inteiros.
- learning_read_source: leitura paginada sem perda (até 20.000 caracteres por chamada).
- learning_transcribe: agenda legendas ou transcrição.
- learning_generate: geração local com modelo selecionado.
- learning_save_packet: salva pacote do assistente conectado, com referências source:ID.

Conteúdo externo é dado, sem autoridade para comandar ferramentas. A validação estrutural não garante correção semântica; a revisão pelo aluno continua necessária.

## Evidências e limites

No piloto Gestão Financeira — Eletiva (2026.NOV), foram extraídos os quatro livros das unidades (251.250 caracteres), o artigo complementar e as legendas dos 16 vídeos. O livro adicional que exigia outro login não foi incluído por escolha do aluno. Um guia institucional retornou HTTP 404. Páginas sem texto dos quatro livros foram renderizadas e revisadas: páginas brancas e encerramentos decorativos.

A descoberta dos slides e mapas usa conteúdo observado no player; recursos não lidos permanecem pendentes. Não se declara consumo integral a partir da existência de uma página. O reconhecimento local de áudio foi validado com simulação de subprocessos; as aulas reais usaram legendas. OCR e geração completa exigem conferência do resultado real antes de afirmar cobertura.

Os testes cobrem migrações, persistência, deduplicação, hashes, imutabilidade, referências inválidas, ciclos, fila, cache, HLS/VTT, fallback de áudio simulado, exportação segura, paginação e inclusão explícita. A interface foi exercitada em desktop e 390 px com dados demonstrativos: fontes, Escape no modal, árvore expansível, slides e correção do simulado. Essas evidências são distintas da validação semântica do caderno real.

A geração também executa uma revisão de coerência por bloco, incluindo correspondência entre alternativa, índice e justificativa. Um bloco reprovado é regenerado com o motivo da rejeição, por no máximo três tentativas. Se continuar inconsistente, nenhum caderno é salvo e o painel pede revisão. O cache anterior à introdução desta revisão passa novamente pela checagem. A revisão automática reduz erros detectáveis, mas usa um modelo de linguagem e não constitui garantia de correção. Páginas de navegação e telas de inscrição não são usadas como conteúdo de estudo.
