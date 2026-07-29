import type { QuestionShape } from '@exit/domain';

/**
 * Accessible survey question inputs. Field names follow the pattern
 * q:<questionId>:<rating|choice|text> consumed by the submit handlers.
 */
export function SurveyQuestions({ questions }: { questions: readonly QuestionShape[] }) {
  return (
    <div className="stack">
      {questions.map((q, idx) => (
        <fieldset key={q.id}>
          <legend>
            {idx + 1}. {q.prompt}
            {q.required ? ' (required)' : ' (optional)'}
          </legend>
          {q.type === 'RATING_1_5' ? (
            <div className="actions-row" role="radiogroup" aria-label={q.prompt}>
              {[1, 2, 3, 4, 5].map((n) => (
                <label
                  key={n}
                  style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
                >
                  <input type="radio" name={`q:${q.id}:rating`} value={n} required={q.required} />
                  {n}
                  {n === 1 ? ' (poor)' : n === 5 ? ' (excellent)' : ''}
                </label>
              ))}
            </div>
          ) : null}
          {q.type === 'SINGLE_CHOICE' || q.type === 'YES_NO_PNTS' ? (
            <div className="stack" role="radiogroup" aria-label={q.prompt}>
              {(q.type === 'YES_NO_PNTS' && q.options.length === 0
                ? ['Yes', 'No', 'Prefer not to say']
                : q.options
              ).map((opt) => (
                <label
                  key={opt}
                  style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}
                >
                  <input type="radio" name={`q:${q.id}:choice`} value={opt} required={q.required} />
                  {opt}
                </label>
              ))}
            </div>
          ) : null}
          {q.type === 'MULTI_CHOICE' ? (
            <div className="stack">
              {q.options.map((opt) => (
                <label
                  key={opt}
                  style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}
                >
                  <input type="checkbox" name={`q:${q.id}:choice`} value={opt} />
                  {opt}
                </label>
              ))}
            </div>
          ) : null}
          {q.type === 'SHORT_TEXT' ? (
            <div className="field">
              <label htmlFor={`q-${q.id}`} className="sr-only">
                {q.prompt}
              </label>
              <input
                id={`q-${q.id}`}
                type="text"
                name={`q:${q.id}:text`}
                maxLength={q.maxLength ?? 200}
                required={q.required}
              />
              <p className="hint">Up to {q.maxLength ?? 200} characters.</p>
            </div>
          ) : null}
          {q.type === 'LONG_TEXT' ? (
            <div className="field">
              <label htmlFor={`q-${q.id}`} className="sr-only">
                {q.prompt}
              </label>
              <textarea
                id={`q-${q.id}`}
                name={`q:${q.id}:text`}
                rows={4}
                maxLength={q.maxLength ?? 2000}
                required={q.required}
              />
              <p className="hint">Up to {q.maxLength ?? 2000} characters.</p>
            </div>
          ) : null}
        </fieldset>
      ))}
    </div>
  );
}
