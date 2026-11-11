'use client';

import type { ChangeEvent, ComponentPropsWithoutRef } from 'react';

/**
 * A file input that says, before anything is sent, that the chosen file is
 * larger than the platform accepts. Owner report, 2026-11-11: a banner above
 * the request limit came back as "Something Went Wrong" with a reference and
 * no word of why. The browser's own validation carries the message and holds
 * the submit; the server keeps every check of its own for a browser without
 * scripts, and the build accepts request bodies above every limit stated here
 * (next.config.ts), so a file this control lets through arrives whole.
 */
export function FileInput({
  maxBytes,
  limitLabel,
  onChange,
  ...rest
}: Omit<ComponentPropsWithoutRef<'input'>, 'type'> & {
  maxBytes: number;
  /** The rule in words, for example "The limit is 2 MB." */
  limitLabel: string;
}) {
  function check(e: ChangeEvent<HTMLInputElement>): void {
    const input = e.currentTarget;
    const file = input.files?.[0];
    const tooLarge = file !== undefined && file.size > maxBytes;
    input.setCustomValidity(tooLarge ? `This file is ${megabytes(file.size)}. ${limitLabel}` : '');
    if (tooLarge) input.reportValidity();
    onChange?.(e);
  }
  return <input {...rest} type="file" onChange={check} />;
}

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
