/**
 * Design-system primitives.
 *
 * These exist so screens are assembled from pieces that mean something -
 * a person, a case header, a step in a workflow, an asset, a document, an
 * event - instead of from the same generic card repeated down the page.
 *
 * Every status here is a colour AND a word: the tone is a fast second signal,
 * never the only one (WCAG 1.4.1).
 */
import type { ReactNode } from 'react';

/** The workflow meanings the whole application shares. */
export type Tone = 'done' | 'progress' | 'pending' | 'attention' | 'critical' | 'info' | 'neutral';

const toneClass = (tone: Tone | undefined, prefix: string): string =>
  tone && tone !== 'neutral' ? ` ${prefix}--${tone}` : '';

/** Two-letter monogram; falls back to a single letter for one-word names. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

/**
 * A section announces itself: an icon in its own colour, a title, an optional
 * sentence saying what the section is for, and room for one action.
 */
export function SectionHead({
  icon,
  title,
  description,
  tone,
  aside,
  id,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  tone?: Tone;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="section-head">
      {icon ? (
        <span className={`section-head__icon${toneClass(tone, 'section-head__icon')}`} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="section-head__text">
        <h2 className="section-head__title" id={id}>
          {title}
        </h2>
        {description ? <p className="section-head__desc">{description}</p> : null}
      </div>
      {aside ? <div className="section-head__aside">{aside}</div> : null}
    </div>
  );
}

/** A compact status or fact marker. The label carries the meaning. */
export function Chip({ tone, children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`chip${toneClass(tone, 'chip')}`}>{children}</span>;
}

/** Just the monogram - for a row whose title is already the person. */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="identity__avatar" aria-hidden>
      {initialsOf(name)}
    </span>
  );
}

/** A person: monogram, name, and what they do. */
export function Identity({
  name,
  role,
  large,
}: {
  name: string;
  role?: string | null;
  large?: boolean;
}) {
  return (
    <span className="identity">
      <span className={`identity__avatar${large ? ' identity__avatar--lg' : ''}`} aria-hidden>
        {initialsOf(name)}
      </span>
      <span className="identity__body">
        <span className="identity__name">{name}</span>
        {role ? <span className="identity__role">{role}</span> : null}
      </span>
    </span>
  );
}

/** Label above, value below - values read louder than their labels. */
export function Fact({
  label,
  children,
  isKey,
}: {
  label: string;
  children: ReactNode;
  isKey?: boolean;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={isKey ? 'is-key' : undefined}>{children}</dd>
    </div>
  );
}

/** A grid of label/value pairs. */
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={className ? `facts ${className}` : 'facts'}>{children}</dl>;
}

/** Completion as a bar plus the figure - never the bar alone. */
export function ProgressBar({
  percent,
  light,
  label,
}: {
  percent: number;
  light?: boolean;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Completion'}
    >
      <div className={`progress-bar${light ? ' progress-bar--light' : ''}`}>
        <div className="progress-bar__fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

/** One step in a sequence. */
export interface RailStep {
  name: string;
  meta?: string;
  state: 'done' | 'current' | 'todo' | 'blocked';
}

/** A workflow that looks like a workflow. */
export function Rail({ steps, label }: { steps: readonly RailStep[]; label: string }) {
  return (
    <ol className="rail" aria-label={label}>
      {steps.map((s) => (
        <li key={s.name} className={`rail__step rail__step--${s.state}`}>
          <span className="rail__step-name">{s.name}</span>
          {s.meta ? <span className="rail__step-meta">{s.meta}</span> : null}
          {/* The state is in the class for sighted users and in text here for
              everyone else - never colour alone. */}
          <span className="sr-only">
            {s.state === 'done'
              ? ' - completed'
              : s.state === 'current'
                ? ' - in progress'
                : s.state === 'blocked'
                  ? ' - blocked'
                  : ' - not started'}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A figure that dominates, with a note that gives it meaning. `compact` is
 * the smaller tile for secondary counts; `quiet` is a zero that should read
 * as calm rather than as a coloured success (owner directive, 2026-09-23).
 */
export function Kpi({
  label,
  value,
  unit,
  note,
  tone,
  icon,
  compact,
  quiet,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
  tone?: Tone;
  icon?: ReactNode;
  compact?: boolean;
  quiet?: boolean;
}) {
  return (
    <div
      className={`kpi${toneClass(tone, 'kpi')}${compact ? ' kpi--compact' : ''}${quiet ? ' kpi--quiet' : ''}`}
    >
      <div className="kpi__label">
        {icon ? <span aria-hidden>{icon}</span> : null}
        {label}
      </div>
      <div className="kpi__value">
        {value}
        {unit ? <span className="kpi__unit">{unit}</span> : null}
      </div>
      {note ? <div className="kpi__note">{note}</div> : null}
    </div>
  );
}

/** A list of entities sharing one row grammar. */
export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="rows" role={label ? 'list' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

/**
 * One entity: a mark saying what kind of thing it is, a body saying which one,
 * facts saying where it stands, and at most one action.
 */
export function Row({
  mark,
  title,
  sub,
  facts,
  action,
  tone,
  muted,
}: {
  mark?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  facts?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  muted?: boolean;
}) {
  return (
    <div
      className={`row-item${toneClass(tone, 'row-item')}${muted ? ' row-item--muted' : ''}`}
      role="listitem"
    >
      {mark ? (
        <span className="row-item__mark" aria-hidden>
          {mark}
        </span>
      ) : null}
      <div className="row-item__body">
        <div className="row-item__title">{title}</div>
        {sub ? <div className="row-item__sub">{sub}</div> : null}
      </div>
      {facts ? <div className="row-item__facts">{facts}</div> : null}
      {action ? <div className="row-item__action">{action}</div> : null}
    </div>
  );
}

/** A document as an object, not a filename. */
export function DocObject({
  icon,
  name,
  meta,
  status,
  actions,
}: {
  icon: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <article className="doc">
      <span className="doc__sheet" aria-hidden>
        {icon}
      </span>
      <div className="doc__body">
        <div className="doc__name">{name}</div>
        {meta ? <div className="doc__meta">{meta}</div> : null}
        {status ? <div style={{ marginTop: 'var(--space-2)' }}>{status}</div> : null}
        {actions ? <div className="doc__actions">{actions}</div> : null}
      </div>
    </article>
  );
}

/** An external party's own panel: who they are, then the work. */
export function ProviderPanel({
  monogram,
  name,
  subtitle,
  status,
  children,
  footer,
}: {
  monogram: string;
  name: string;
  subtitle?: string;
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="provider" aria-label={name}>
      <header className="provider__head">
        <span className="provider__logo" aria-hidden>
          {monogram}
        </span>
        <span className="provider__name">
          <strong>{name}</strong>
          {subtitle ? <span className="meta">{subtitle}</span> : null}
        </span>
        {status}
      </header>
      <div className="provider__body">{children}</div>
      {footer ? <div className="provider__foot">{footer}</div> : null}
    </section>
  );
}

/** A chronological feed. */
export function Activity({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ol className="activity" aria-label={label}>
      {children}
    </ol>
  );
}

/** One event: when, what, and - where it matters - what changed. */
export function Event({
  time,
  title,
  detail,
  from,
  to,
  tone,
  automated,
}: {
  time: string;
  title: ReactNode;
  detail?: ReactNode;
  from?: string;
  to?: string;
  tone?: 'done' | 'critical' | 'auto';
  automated?: boolean;
}) {
  return (
    <li className="activity__item">
      <span className={`activity__dot${tone ? ` activity__dot--${tone}` : ''}`} aria-hidden />
      <div className="activity__time">{time}</div>
      <div className="activity__title">{title}</div>
      {from !== undefined && to !== undefined ? (
        <div className="activity__change">
          <s>{from}</s>
          <span aria-hidden>&rarr;</span>
          <strong>{to}</strong>
        </div>
      ) : null}
      {detail ? <div className="activity__detail">{detail}</div> : null}
      {automated ? (
        <div className="activity__detail">
          <em>Triggered automatically by the workflow</em>
        </div>
      ) : null}
    </li>
  );
}
