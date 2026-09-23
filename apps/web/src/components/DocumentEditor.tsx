'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BodySegment } from '@exit/domain';

/**
 * The HR document editor (DEC-069, directive sections 1 to 3).
 *
 * HR sees the letter as readable paragraphs and edits them in place. The
 * facts that come from the case - the employee's name, the dates, the case
 * reference - are shown as locked chips carrying their current value: they
 * can be moved with the text around them but not retyped, so a letter can
 * never quietly disagree with the case. If a fact is wrong, the case is
 * corrected and the letter follows.
 *
 * Deliberately small: paragraphs, line breaks, undo and redo. The company's
 * letters are plain text by rule (no markup survives validation and the PDF
 * renderer sets prose in one face), so emphasis is not offered rather than
 * offered and then stripped.
 *
 * What is saved is the template's own format - plain text with the
 * placeholders retained - written into a hidden input for the server action.
 */
export interface EditorFact {
  placeholder: string;
  label: string;
  value: string;
}

function serialise(root: HTMLElement): string {
  const paragraphs: string[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'P') {
      paragraphs.push(serialiseInline(node as HTMLElement));
    } else if (node.nodeType === Node.TEXT_NODE) {
      paragraphs.push(node.textContent ?? '');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      paragraphs.push(serialiseInline(node as HTMLElement));
    }
  }
  return paragraphs
    .map((p) =>
      p
        .replace(/ /g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .trim(),
    )
    .filter((p) => p.length > 0)
    .join('\n\n');
}

function serialiseInline(el: HTMLElement): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const e = node as HTMLElement;
      if (e.dataset['placeholder']) out += `[[${e.dataset['placeholder']}]]`;
      else if (e.tagName === 'BR') out += '\n';
      else if (e.tagName === 'DIV' || e.tagName === 'P') out += `\n${serialiseInline(e)}`;
      else out += serialiseInline(e);
    }
  }
  return out;
}

export function DocumentEditor({
  name,
  paragraphs,
  facts,
  initialBody,
  disabled,
}: {
  /** The hidden input the server action reads the body from. */
  name: string;
  paragraphs: BodySegment[][];
  facts: Record<string, EditorFact>;
  initialBody: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState(initialBody);
  const [dirty, setDirty] = useState(false);
  const hintId = useId();

  const sync = useCallback(() => {
    if (!ref.current) return;
    const next = serialise(ref.current);
    setBody(next);
    setDirty(next !== initialBody);
  }, [initialBody]);

  // Undo and redo ride on the browser's own editing history, which is the
  // behaviour HR already knows from every text field.
  const command = (cmd: 'undo' | 'redo') => {
    ref.current?.focus();
    try {
      document.execCommand(cmd);
    } catch {
      // A browser without the command still has Ctrl+Z / Ctrl+Y.
    }
    sync();
  };

  useEffect(() => {
    sync();
  }, [sync]);

  const factCount = useMemo(() => Object.keys(facts).length, [facts]);

  return (
    <div className="doc-editor" data-dirty={dirty ? 'yes' : 'no'}>
      <input type="hidden" name={name} value={body} />
      <div className="doc-editor__toolbar" role="toolbar" aria-label="Editing">
        <button
          type="button"
          className="secondary compact"
          onClick={() => command('undo')}
          disabled={disabled}
        >
          Undo
        </button>
        <button
          type="button"
          className="secondary compact"
          onClick={() => command('redo')}
          disabled={disabled}
        >
          Redo
        </button>
        <span className="meta" id={hintId}>
          Press Enter for a new paragraph, Shift+Enter for a line break.{' '}
          {factCount > 0 ? 'Highlighted values come from the case and cannot be typed over.' : null}
        </span>
      </div>
      <div
        ref={ref}
        className="doc-editor__surface"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Document wording"
        aria-describedby={hintId}
        spellCheck
        onInput={sync}
        onBlur={sync}
        onKeyDown={(e) => {
          // Shift+Enter is a line break inside the paragraph; Enter alone
          // starts a new paragraph, which is what a letter means by it.
          if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertLineBreak');
            sync();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertParagraph');
            sync();
          }
        }}
        onPaste={(e) => {
          // Plain text only: pasted markup would fail validation anyway.
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
          sync();
        }}
      >
        {paragraphs.map((segments, i) => (
          <p key={i}>
            {segments.map((s, j) =>
              s.kind === 'fact' ? (
                <span
                  key={j}
                  className="doc-editor__fact"
                  contentEditable={false}
                  data-placeholder={s.placeholder}
                  title={`${s.label} - from the case`}
                >
                  {facts[s.placeholder]?.value || `[${s.label}]`}
                </span>
              ) : (
                <Text key={j} value={s.value} />
              ),
            )}
          </p>
        ))}
      </div>
      <p className="meta" aria-live="polite">
        {dirty ? 'Unsaved changes.' : 'No unsaved changes.'}
      </p>
    </div>
  );
}

/** Text with its line breaks kept, as the paragraph carries them. */
function Text({ value }: { value: string }) {
  const lines = value.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {line}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}
