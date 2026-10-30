import type { Answer, AssessmentDetail, Question, QuestionType } from './types.js';

export interface StudyQuestionInput {
  prompt: string;
  type: Exclude<QuestionType, 'unsupported'>;
  choices: { id: string; text: string }[];
}

/** Separadores explícitos evitam dividir um enunciado em parágrafos por engano. */
export function parseStudyQuestions(text: string): StudyQuestionInput[] {
  return text
    .split(/^\s*---+\s*$/m)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.replace(/^Quest[ãa]o\s+\d+\s*[:.-]?\s*\n?/i, '').split('\n');
      const prompt: string[] = [];
      const choices: { id: string; text: string }[] = [];
      for (const line of lines) {
        const option = line.match(/^\s*(?:\(([A-Za-z])\)|([A-Za-z])[).])\s+(.+)$/);
        if (option)
          choices.push({ id: (option[1] || option[2]).toUpperCase(), text: option[3].trim() });
        else if (choices.length) choices[choices.length - 1].text += `\n${line}`;
        else prompt.push(line);
      }
      return {
        prompt: prompt.join('\n').trim(),
        type: choices.length >= 2 ? 'single' : 'text',
        choices: choices.length >= 2 ? choices : [],
      };
    });
}

export function studyAnswer(q: Question): { answer: Answer; source: string } | null {
  if (q.answer.text.trim() || q.answer.choices.length)
    return { answer: q.answer, source: 'Meu gabarito' };
  if (q.suggestion) return { answer: q.suggestion.answer, source: 'Resposta da IA' };
  return null;
}
export function answerText(q: Question, answer: Answer) {
  return q.type === 'text'
    ? answer.text
    : q.choices
        .filter((c) => answer.choices.includes(c.id))
        .map((c) => `${c.id}) ${c.text}`)
        .join('\n');
}
export function studyMarkdown(detail: AssessmentDetail) {
  return (
    `# Gabarito — ${detail.assessment.title}\n\nDisciplina: ${detail.assessment.course_name}\n\n` +
    detail.questions
      .map((q) => {
        const result = studyAnswer(q);
        const changed =
          result &&
          q.suggestion &&
          JSON.stringify(result.answer) !== JSON.stringify(q.suggestion.answer);
        return `## Questão ${q.position}\n\n${q.prompt}\n\n${q.choices.map((c) => `${c.id}) ${c.text}`).join('\n')}\n\n**Resposta:** ${result ? answerText(q, result.answer) : 'Ainda não respondida'}\n\n${changed ? `**Nova sugestão da IA (ainda não adotada):** ${answerText(q, q.suggestion!.answer)}\n\n` : ''}${q.suggestion ? `**Explicação da IA:** ${q.suggestion.explanation}\n\n` : ''}`;
      })
      .join('\n---\n\n')
  );
}
