'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Keyboard behaviours the platform owes a reader who has put the mouse
 * aside (keyboard directive, 2026-09-09).
 *
 * Both are ENHANCEMENTS over native semantics, never replacements: the
 * items stay real links and buttons that Tab reaches and Enter activates,
 * and nothing here works if JavaScript is absent except the page itself.
 */

/**
 * Arrow-key movement between the focusable items inside a container -
 * a list of search results, a set of choices - with Escape handing focus
 * back to the control that produced them.
 *
 * Items opt in with `data-list-item`. Tab still moves through them one by
 * one (they are ordinary links), so this adds ↑ ↓ Home End without taking
 * anything away, and stays clear of the established combobox/listbox
 * pattern: the results are a table with columns, not a listbox, and
 * pretending otherwise would hide the columns from a screen reader.
 */
export function ArrowKeyList({
  children,
  escapeTo,
  focusFirst = false,
  className,
}: {
  children: ReactNode;
  /** CSS selector of the control Escape returns focus to. */
  escapeTo?: string;
  /** Move focus to the first item once mounted, if nothing else has it. */
  focusFirst?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusFirst) return;
    focusWhenVisible(() => ref.current?.querySelector<HTMLElement>('[data-list-item]') ?? null);
  }, [focusFirst]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-list-item]') ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | null = null;
    switch (e.key) {
      case 'ArrowDown':
        next = items[at < 0 ? 0 : Math.min(at + 1, items.length - 1)] ?? null;
        break;
      case 'ArrowUp':
        next = items[at < 0 ? 0 : Math.max(at - 1, 0)] ?? null;
        break;
      case 'Home':
        next = items[0] ?? null;
        break;
      case 'End':
        next = items[items.length - 1] ?? null;
        break;
      case 'Escape': {
        const back = escapeTo ? document.querySelector<HTMLElement>(escapeTo) : null;
        if (back) {
          e.preventDefault();
          back.focus();
        }
        return;
      }
      default:
        return;
    }
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <div ref={ref} className={className} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

/**
 * Put focus where the reader is about to type - but only if nothing else
 * already has it, and only once the element can actually take it. The
 * accordion reveals its open step a frame after mounting, so a focus call
 * made too early lands on a hidden field and silently does nothing.
 */
export function AutoFocus({ selector }: { selector: string }) {
  useEffect(() => {
    focusWhenVisible(() => document.querySelector<HTMLElement>(selector));
  }, [selector]);
  return null;
}

/**
 * Keep trying for a short while, then give up quietly rather than fight the
 * page. The budget is in TIME, not frames: a cold development page can take
 * a couple of seconds to hydrate the accordion that reveals the field, and
 * a dozen frames was not enough - the cursor never landed and a reader's
 * first keystrokes went nowhere.
 */
function focusWhenVisible(find: () => HTMLElement | null, budgetMs = 4000): void {
  const started = performance.now();
  const tick = () => {
    const free = document.activeElement === null || document.activeElement === document.body;
    // Somebody else took focus - the reader started typing elsewhere, or a
    // dialog opened. Never steal it back.
    if (!free) return;
    const el = find();
    if (el && el.offsetParent !== null && !el.hasAttribute('hidden')) {
      el.focus();
      return;
    }
    if (performance.now() - started < budgetMs) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
