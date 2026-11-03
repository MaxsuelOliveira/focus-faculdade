# Como transformar materiais de uma disciplina em um caderno com fontes

Livros, videoaulas e artigos costumam ficar em páginas diferentes. Reunir esses materiais com IA parece simples até surgir uma pergunta: o que foi realmente lido?

No Focus Faculdade, construímos um fluxo local que começa pela seleção da disciplina e termina em quatro formas de revisão: resumo, mapa mental, slides e simulado pessoal. A origem do conteúdo acompanha o resultado.

## Primeiro, registrar o que existe

Cada material recebe uma identidade, um tipo, uma localização e um estado. Um vídeo listado na página não é declarado consumido. Um PDF que contém páginas sem texto também não passa silenciosamente por completo. O painel mostra o que foi extraído e o que exige intervenção.

A identidade precisa sobreviver a sessões diferentes sem misturar materiais diferentes. Parâmetros de autenticação temporários não devem duplicar uma fonte; parâmetros que identificam uma unidade precisam continuar distintos. Isso exigiu testes com os endereços reais do leitor, incluindo parâmetros com letras maiúsculas.

## Texto, legendas e imagem têm limites diferentes

Os PDFs são lidos página a página com PDF.js. As páginas sem texto geram uma pendência própria. Imagens podem passar pelo Tesseract local, com indicação de confiança e aviso de que reconhecer palavras não equivale a interpretar todas as relações de um diagrama.

Para videoaulas, a primeira opção são as legendas disponibilizadas pelo próprio player. O leitor percorre playlists HLS e preserva os timestamps VTT. Na ausência de legendas, existe um caminho opcional com FFmpeg e faster-whisper para reconhecer o áudio localmente. Nenhum dos dois caminhos afirma ter analisado os elementos visuais do vídeo.

## A geração precisa ser retomável

Uma disciplina pode ultrapassar a janela de contexto de um modelo. O texto extraído é dividido em blocos, sem limitar a leitura aos primeiros parágrafos. Cada bloco produz uma parte do resumo, um slide, uma questão autoral e nós para o mapa.

O Ollama recebe um schema JSON restrito. O backend valida referências, alternativas, limites e estrutura da árvore antes de salvar cada bloco no cache. Uma interrupção pode ser retomada sem refazer os blocos válidos. Texto idêntico encontrado em URLs distintas é processado uma única vez.

Essa validação ajuda a detectar referências inventadas e saídas malformadas. Ela não prova a correção de um conceito ou de um gabarito. A conferência humana permanece parte do fluxo.

## O caderno conserva sua base

Antes da geração, IDs e hashes congelam as fontes. O caderno guarda uma cópia da versão usada. Assim, atualizar um livro não reescreve a fundamentação de um caderno antigo.

Resumo, mapa e slides oferecem acesso às fontes. O aluno pode exportar Markdown, SVG e HTML imprimível. O simulado é uma prática local com justificativas; sua nota não promete resultado em uma prova do portal.

Uma exclusão explícita também é informação: o material continua registrado com o motivo, mas não pode fundamentar uma resposta nem aparece como consumido.

## O que o piloto comprovou

O piloto usou Gestão Financeira — Eletiva (2026.NOV). Foram extraídos os quatro livros das unidades, totalizando 251.250 caracteres, um artigo complementar e as legendas de 16 vídeos. Slides e mapas também fazem parte do inventário do leitor externo.

Um livro adicional dependia de outra autenticação e foi retirado do contexto por escolha do aluno. Um guia institucional retornou HTTP 404. Essas limitações acompanham a cobertura, em vez de desaparecerem atrás de um indicador de sucesso.

Os fluxos de resumo, fonte, mapa expansível, slides e correção do simulado foram exercitados no navegador com dados demonstrativos, incluindo largura de 390 px. Testes automatizados cobrem persistência, fila, cache, identidade, referências, transcrição, exportações e segurança das operações locais. O reconhecimento de áudio sem legendas foi testado por simulação; as aulas reais do piloto usaram legendas.

A conclusão do processamento não é uma medida de aprendizagem. O objetivo do sistema é tornar a revisão mais organizada e verificável, sem prometer compreensão integral, economia de tempo ou taxa de acerto sem medição.

## Executar e conhecer o projeto

O aplicativo usa Node.js, TypeScript, React, SQLite e Playwright. A geração local usa Ollama; dados acadêmicos, sessões e credenciais permanecem fora do repositório público.

O código e as instruções estão no [GitHub do Focus Faculdade](https://github.com/MaxsuelOliveira/focus-faculdade). A [documentação de aprendizagem](../learning-system.md) descreve instalação, arquitetura e limites.

Este artigo é entregue como arquivo editorial no repositório. Nenhuma publicação em rede social ou outro veículo foi realizada.

A geração também executa uma revisão de coerência por bloco, incluindo correspondência entre alternativa, índice e justificativa. Um bloco reprovado é regenerado com o motivo da rejeição, por no máximo três tentativas. Se continuar inconsistente, nenhum caderno é salvo e o painel pede revisão. O cache anterior à introdução desta revisão passa novamente pela checagem. A revisão automática reduz erros detectáveis, mas usa um modelo de linguagem e não constitui garantia de correção. Páginas de navegação e telas de inscrição não são usadas como conteúdo de estudo.
