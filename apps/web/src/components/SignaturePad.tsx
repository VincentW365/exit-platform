'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * One standard signing control for the whole platform (DEC-068, directive 1
 * sections 3 to 6). The same component captures a full signature and a set of
 * initials; only the box size and the wording differ.
 *
 * Input is pointer events, so a finger, a stylus, a trackpad and a mouse all
 * follow one code path. The pointer is captured on the canvas, which is the
 * only element that disables touch panning - the page itself still scrolls
 * normally around it, so a phone user is never trapped.
 *
 * The canvas is sized in device pixels and scaled by the device pixel ratio,
 * so a mark stays crisp on a phone and is never stretched. Strokes are kept
 * as points rather than pixels, which is what makes undo and a clean redraw
 * after a rotation possible.
 *
 * The exported PNG is trimmed to the ink and keeps a transparent background,
 * so it drops onto the PDF and the on-screen form without a white box around
 * it.
 */

type Point = { x: number; y: number };
type Stroke = Point[];

export type SignatureMode = 'SIGNATURE' | 'INITIALS';

const LINE_WIDTH: Record<SignatureMode, number> = { SIGNATURE: 2.4, INITIALS: 2.8 };
/** Drawing height in CSS pixels; the width follows the container. */
const BOX_HEIGHT: Record<SignatureMode, number> = { SIGNATURE: 150, INITIALS: 120 };
const INK = '#111827';

function draw(canvas: HTMLCanvasElement, strokes: Stroke[], mode: SignatureMode): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.strokeStyle = INK;
  ctx.lineWidth = LINE_WIDTH[mode];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      // A tap is a dot, not nothing: a full stop in a set of initials counts.
      ctx.beginPath();
      ctx.arc(stroke[0]!.x, stroke[0]!.y, LINE_WIDTH[mode] / 2, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
    for (let i = 1; i < stroke.length; i += 1) {
      const prev = stroke[i - 1]!;
      const curr = stroke[i]!;
      // Midpoint smoothing: a drawn line, not a chain of visible segments.
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.stroke();
  }
}

/** Ink bounds in CSS pixels, padded, or null when nothing was drawn. */
function inkBounds(strokes: Stroke[], pad: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes)
    for (const p of stroke) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  if (!Number.isFinite(minX)) return null;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/**
 * Export the mark as a transparent PNG trimmed to the ink, at roughly twice
 * the on-screen size so it stays sharp in the PDF.
 */
function exportPng(strokes: Stroke[], mode: SignatureMode): string | null {
  const bounds = inkBounds(strokes, LINE_WIDTH[mode] * 2);
  if (!bounds) return null;
  const scale = 2;
  const width = Math.max(16, Math.ceil((bounds.maxX - bounds.minX) * scale));
  const height = Math.max(8, Math.ceil((bounds.maxY - bounds.minY) * scale));
  const out = document.createElement('canvas');
  out.width = Math.min(width, 4000);
  out.height = Math.min(height, 2000);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(scale, 0, 0, scale, -bounds.minX * scale, -bounds.minY * scale);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = LINE_WIDTH[mode];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0]!.x, stroke[0]!.y, LINE_WIDTH[mode] / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
    for (let i = 1; i < stroke.length; i += 1) {
      const prev = stroke[i - 1]!;
      const curr = stroke[i]!;
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
    }
    ctx.stroke();
  }
  return out.toDataURL('image/png');
}

/** A typed name rendered as a mark, for a signer who cannot draw one. */
export function typedMarkPng(text: string, mode: SignatureMode): string | null {
  const value = text.trim();
  if (!value) return null;
  const size = mode === 'INITIALS' ? 64 : 56;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  const font = `italic ${size}px "Segoe Script", "Brush Script MT", cursive`;
  measure.font = font;
  const width = Math.min(4000, Math.ceil(measure.measureText(value).width) + 24);
  const out = document.createElement('canvas');
  out.width = Math.max(16, width);
  out.height = Math.ceil(size * 1.6);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.font = font;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, 12, out.height / 2);
  return out.toDataURL('image/png');
}

export interface SignaturePadProps {
  mode: SignatureMode;
  /** What the signer is signing, in the form's own words. */
  label: string;
  /** The current mark, as a PNG data URL, or empty. */
  value: string;
  onChange: (value: string, provenance: 'DRAWN' | 'TYPED') => void;
  /** Offered under an initials pad once one set has been drawn. */
  onReuseOffer?: { label: string; onApply: () => void } | null;
  /** Offered under the first initials pad that has a mark. */
  onOfferReuse?: ((dataUrl: string) => void) | null;
  describedBy?: string;
  disabled?: boolean;
}

export function SignaturePad({
  mode,
  label,
  value,
  onChange,
  onReuseOffer,
  onOfferReuse,
  describedBy,
  disabled,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState('');
  const [showTyped, setShowTyped] = useState(false);
  const hintId = useId();

  /** Match the backing store to the element's real size and pixel ratio. */
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    draw(canvas, strokesRef.current, mode);
  }, [mode]);

  useEffect(() => {
    resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (canvasRef.current && observer) observer.observe(canvasRef.current);
    return () => observer?.disconnect();
  }, [resize]);

  // A mark applied from elsewhere ("apply these initials") clears the local
  // strokes: the pad now shows somebody's decision, not this canvas's ink.
  useEffect(() => {
    if (value === '' && strokesRef.current.length > 0) {
      strokesRef.current = [];
      setHasInk(false);
      if (canvasRef.current) draw(canvasRef.current, [], mode);
    }
  }, [value, mode]);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const commit = useCallback(() => {
    const png = exportPng(strokesRef.current, mode);
    setHasInk(Boolean(png));
    onChange(png ?? '', 'DRAWN');
  }, [mode, onChange]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    // Ignore a second finger: a two-finger gesture is scrolling, not signing.
    if (drawingRef.current) return;
    drawingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    strokesRef.current = [...strokesRef.current, [pointAt(e)]];
    draw(e.currentTarget, strokesRef.current, mode);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || disabled) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!stroke) return;
    stroke.push(pointAt(e));
    draw(e.currentTarget, strokesRef.current, mode);
  };

  const endStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    commit();
  };

  const cancelStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A cancelled pointer (a call arriving, the browser taking over) must not
    // leave half a stroke behind.
    if (!drawingRef.current) return;
    drawingRef.current = false;
    strokesRef.current = strokesRef.current.slice(0, -1);
    draw(e.currentTarget, strokesRef.current, mode);
    commit();
  };

  const clear = () => {
    strokesRef.current = [];
    setHasInk(false);
    setTyped('');
    if (canvasRef.current) draw(canvasRef.current, [], mode);
    onChange('', 'DRAWN');
  };

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    if (canvasRef.current) draw(canvasRef.current, strokesRef.current, mode);
    commit();
  };

  const noun = mode === 'INITIALS' ? 'initials' : 'signature';
  const applied = value !== '';

  return (
    <div className="sigpad" data-mode={mode} data-applied={applied ? 'yes' : 'no'}>
      <div className="sigpad__head">
        <span className="sigpad__label">{label}</span>
        <span className="sigpad__state">
          {applied ? (
            <>
              <span aria-hidden="true">&#10003;</span> Added
            </>
          ) : (
            'Not yet added'
          )}
        </span>
      </div>

      {applied && !hasInk ? (
        // The mark came from elsewhere, so show it rather than an empty pad.
        <div className="sigpad__applied">
          {/* eslint-disable-next-line @next/next/no-img-element -- in-memory data URL */}
          <img src={value} alt={`Your ${noun} for ${label}`} className="sigpad__appliedImage" />
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="sigpad__canvas"
          style={{ height: BOX_HEIGHT[mode] }}
          // Only this element stops touch panning, so the page still scrolls.
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={cancelStroke}
          aria-label={`Draw your ${noun} for ${label}`}
          aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
          role="img"
        />
      )}

      <p id={hintId} className="sigpad__hint">
        Draw your {noun} in the box using a finger, a stylus, a trackpad or a mouse.
      </p>

      <div className="sigpad__actions">
        <button type="button" className="btn btn--quiet" onClick={clear} disabled={disabled}>
          Clear
        </button>
        {hasInk ? (
          <button type="button" className="btn btn--quiet" onClick={undo} disabled={disabled}>
            Undo last stroke
          </button>
        ) : null}
        {onOfferReuse && applied ? (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => onOfferReuse(value)}
            disabled={disabled}
          >
            Use these initials everywhere else
          </button>
        ) : null}
        {onReuseOffer && !applied ? (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={onReuseOffer.onApply}
            disabled={disabled}
          >
            {onReuseOffer.label}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => setShowTyped((v) => !v)}
          aria-expanded={showTyped}
          disabled={disabled}
        >
          {showTyped ? 'Hide typing option' : 'I cannot draw it'}
        </button>
      </div>

      {showTyped ? (
        <div className="sigpad__typed">
          <label className="field">
            <span className="field__label">Type your {noun} instead</span>
            <input
              type="text"
              className="input"
              value={typed}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={disabled || typed.trim() === ''}
            onClick={() => {
              const png = typedMarkPng(typed, mode);
              if (!png) return;
              strokesRef.current = [];
              setHasInk(false);
              if (canvasRef.current) draw(canvasRef.current, [], mode);
              onChange(png, 'TYPED');
              setShowTyped(false);
            }}
          >
            Use typed {noun}
          </button>
          <p className="hint">
            A typed {noun} is recorded as typed rather than drawn, and is shown that way on the
            form.
          </p>
        </div>
      ) : null}
    </div>
  );
}
