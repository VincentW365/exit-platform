/**
 * High-level case progress strip (Directive 6.1 AC): eight clickable stage
 * chips summarizing the journey. Summary only - never a forced sequence.
 */
import Link from 'next/link';
import type { ProgressStage } from '@exit/db';

const STATE_CLASS: Record<ProgressStage['state'], string> = {
  COMPLETED: 'progress-chip--done',
  IN_PROGRESS: 'progress-chip--active',
  BLOCKED: 'progress-chip--blocked',
  NOT_STARTED: 'progress-chip--todo',
  NOT_APPLICABLE: 'progress-chip--na',
};

const STATE_TEXT: Record<ProgressStage['state'], string> = {
  COMPLETED: 'Completed',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  NOT_STARTED: 'Not started',
  NOT_APPLICABLE: 'N/A',
};

export function ProgressStrip({ stages }: { stages: ProgressStage[] }) {
  return (
    <nav aria-label="Case progress" className="progress-strip">
      <ol>
        {stages.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={`progress-chip ${STATE_CLASS[s.state]}`}
              title={s.detail}
            >
              <span className="progress-chip__label">{s.label}</span>
              <span className="progress-chip__state">{STATE_TEXT[s.state]}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
