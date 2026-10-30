import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Sparkles,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
  LoaderCircle,
} from 'lucide-react';
import type { Answer, Question } from '../../shared/types';
import { post } from '../api';
export function questionText(q: Question) {
  return `Questão ${q.position}\n\n${q.prompt}\n\n${q.choices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c.text}`).join('\n')}`;
}
export default function QuestionCard({
  question: q,
  provider,
  model,
  onSaved,
  onDirty,
  onError,
}: {
  question: Question;
  provider: 'ollama' | 'openai';
  model: string;
  onSaved: () => Promise<void>;
  onDirty: (id: number, dirty: boolean) => void;
  onError: (s: string) => void;
}) {
  const [answer, setAnswer] = useState<Answer>(q.answer);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localSuggestion, setLocalSuggestion] = useState(q.suggestion);
  // Atualizações da fila não substituem um rascunho que está sendo digitado.
  const savedAnswerJson = JSON.stringify(q.answer);
  useEffect(() => {
    if (!dirty) setAnswer(JSON.parse(savedAnswerJson));
  }, [savedAnswerJson, dirty]);
  const update = (next: Answer) => {
    setAnswer(next);
    setDirty(true);
    onDirty(q.id, true);
  };
  const save = async (approve: boolean) => {
    setBusy(true);
    try {
      await post(`/questions/${q.id}/answer`, { answer, approve });
      await onSaved();
      setDirty(false);
      onDirty(q.id, false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    if (!model) {
      onError('Selecione o modelo no assistente de estudos.');
      return;
    }
    setBusy(true);
    try {
      setLocalSuggestion(await post(`/questions/${q.id}/suggest`, { provider, model }));
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Não foi possível gerar a sugestão.');
    } finally {
      setBusy(false);
    }
  };
  const suggestion = localSuggestion || q.suggestion;
  return (
    <article className="panel question-card">
      <div className="question-top">
        <span className="question-index">QUESTÃO {q.position.toString().padStart(2, '0')}</span>
        <span className={`review-state ${q.approved_hash && !dirty ? 'approved' : ''}`}>
          {q.approved_hash && !dirty ? (
            <>
              <ShieldCheck size={14} />
              Aprovada
            </>
          ) : dirty ? (
            'Alterações não salvas'
          ) : (
            'Aguardando revisão'
          )}
        </span>
      </div>
      <p className="question-prompt">{q.prompt}</p>
      {q.images.map((src, i) => (
        <a className="question-image-link" key={src} href={src} target="_blank" rel="noreferrer">
          Imagem {i + 1} do enunciado
          <ExternalLink size={14} />
        </a>
      ))}
      {q.type === 'unsupported' ? (
        <p className="message">Este formato precisa de preenchimento manual no portal.</p>
      ) : q.type === 'text' ? (
        <label>
          Sua resposta
          <textarea
            rows={5}
            value={answer.text}
            onChange={(event) => update({ text: event.target.value, choices: [] })}
          />
        </label>
      ) : (
        <fieldset className="choices">
          <legend className="sr-only">Sua resposta à questão {q.position}</legend>
          {q.choices.map((choice, index) => (
            <label
              className={`choice ${answer.choices.includes(choice.id) ? 'selected' : ''}`}
              key={choice.id}
            >
              <input
                type={q.type === 'single' ? 'radio' : 'checkbox'}
                name={`question-${q.id}`}
                checked={answer.choices.includes(choice.id)}
                onChange={(event) =>
                  update({
                    text: '',
                    choices:
                      q.type === 'single'
                        ? [choice.id]
                        : event.target.checked
                          ? [...answer.choices, choice.id]
                          : answer.choices.filter((c) => c !== choice.id),
                  })
                }
              />
              <span className="choice-letter">{String.fromCharCode(65 + index)}</span>
              <span>{choice.text}</span>
            </label>
          ))}
        </fieldset>
      )}
      {suggestion && (
        <div className="suggestion">
          <div className="panel-title">
            <Sparkles size={16} />
            <strong>Sugestão da IA · confira antes de usar</strong>
          </div>
          <p>
            {suggestion.answer.text ||
              q.choices
                .filter((c) => suggestion.answer.choices.includes(c.id))
                .map((c) => c.text)
                .join('; ')}
          </p>
          <p>{suggestion.explanation}</p>
          <small>
            {suggestion.provider} · {suggestion.model}
            {suggestion.references.length
              ? ` · ${suggestion.references.join(', ')}`
              : ' · Sem referência de material'}
          </small>
          <button className="text-button" onClick={() => update(suggestion.answer)}>
            Usar como rascunho
            <ArrowRight size={14} />
          </button>
        </div>
      )}
      <div className="question-footer">
        <button
          className="text-button"
          onClick={() =>
            void navigator.clipboard
              .writeText(questionText(q))
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => onError('O navegador não permitiu copiar.'))
          }
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copiada' : 'Copiar questão'}
        </button>
        {q.type !== 'unsupported' && (
          <div className="button-group">
            <button className="text-button" disabled={busy} onClick={() => void generate()}>
              {busy ? <LoaderCircle className="spinning" size={15} /> : <Sparkles size={15} />}
              Sugerir com IA
            </button>
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() => void save(false)}
            >
              Salvar
            </button>
            <button
              className="button primary small"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <Check size={15} />
              Aprovar resposta
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
