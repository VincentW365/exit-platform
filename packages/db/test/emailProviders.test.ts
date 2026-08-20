/**
 * The Microsoft Graph request shape. No network happens here and no
 * credentials exist in this repository - the boundary is built and tested
 * deterministically so the day it is switched on, the payload is already
 * right (Directive 4 section C).
 */
import { describe, expect, it } from 'vitest';
import { buildGraphSendRequest } from '../src/services/emailProviders.ts';

const BASE = {
  subject: 'Acknowledgement of Resignation - Avery Brown',
  body: 'Please find the letter attached.',
  destination: 'avery.brown@example.test',
  senderMailbox: 'hr@example.test',
};

describe('graph send request', () => {
  it('addresses a single recipient and asks for a sent-items copy', () => {
    const { url, payload } = buildGraphSendRequest(BASE);
    expect(url).toContain('/users/hr%40example.test/sendMail');
    const message = (payload as { message: Record<string, unknown> }).message;
    expect(message.toRecipients).toEqual([
      { emailAddress: { address: 'avery.brown@example.test' } },
    ]);
    expect(message.body).toEqual({ contentType: 'Text', content: BASE.body });
    expect(payload.saveToSentItems).toBe(true);
    // Absent rather than empty: the shape carries only what was asked for.
    expect(message).not.toHaveProperty('ccRecipients');
    expect(message).not.toHaveProperty('attachments');
  });

  it('carries copied recipients when HR selects them (DEC-054)', () => {
    const { payload } = buildGraphSendRequest({
      ...BASE,
      cc: ['hr.one@example.test', 'hr.two@example.test'],
    });
    const message = (payload as { message: Record<string, unknown> }).message;
    expect(message.ccRecipients).toEqual([
      { emailAddress: { address: 'hr.one@example.test' } },
      { emailAddress: { address: 'hr.two@example.test' } },
    ]);
  });

  it('attaches the rendered letter as base64 file content', () => {
    const bytes = Buffer.from('%PDF-1.7 synthetic', 'utf8');
    const { payload } = buildGraphSendRequest({
      ...BASE,
      attachments: [
        { fileName: 'OFF-2026-0001-letter-v1.pdf', mimeType: 'application/pdf', bytes },
      ],
    });
    const message = (payload as { message: Record<string, unknown> }).message;
    expect(message.attachments).toEqual([
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'OFF-2026-0001-letter-v1.pdf',
        contentType: 'application/pdf',
        contentBytes: bytes.toString('base64'),
      },
    ]);
  });
});
