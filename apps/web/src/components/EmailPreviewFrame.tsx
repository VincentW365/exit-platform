'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * A captured email rendered in its own document, sized to its content so the
 * whole message - banner included - is in view without scrolling inside the
 * frame (DEC-067 section 6). Same-origin so the platform's image route sees
 * the session; no scripts - the document is the platform's own escaped text
 * and one image element.
 */
export function EmailPreviewFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  const fit = useCallback(() => {
    const frame = ref.current;
    const body = frame?.contentDocument?.body;
    if (!frame || !body) return;
    frame.style.height = `${Math.max(body.scrollHeight + 24, 160)}px`;
  }, []);

  useEffect(() => {
    // Images decode after load fires; measure again as they arrive and when
    // the width changes (a phone rotating, a window resizing).
    const frame = ref.current;
    const imgs = frame?.contentDocument?.images;
    const listeners: Array<() => void> = [];
    if (imgs) {
      for (const img of Array.from(imgs)) {
        img.addEventListener('load', fit);
        listeners.push(() => img.removeEventListener('load', fit));
      }
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (frame && observer) observer.observe(frame);
    fit();
    return () => {
      for (const off of listeners) off();
      observer?.disconnect();
    };
  }, [fit, html]);

  return (
    <iframe
      ref={ref}
      className="email-preview__frame"
      title={title}
      sandbox="allow-same-origin"
      srcDoc={html}
      onLoad={fit}
    />
  );
}
