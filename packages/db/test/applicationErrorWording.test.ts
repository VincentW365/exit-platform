/**
 * DEC-075: Next refuses a request body above the limit the build accepts
 * before any platform code runs, and the words it leaves ("Body exceeded 12mb
 * limit", "Unexpected end of form") name neither a file nor a cause. The
 * recorded row keeps Next's words first and adds what a support reader needs.
 */
import { describe, expect, it } from 'vitest';
import { explainRequestError, safeErrorMessage } from '../src/services/applicationErrorService.ts';

const NEXT_413 =
  'Body exceeded 12mb limit.\nTo configure the body size limit for Server Actions, see: https://nextjs.org/docs/app/api-reference/next-config-js/serverActions#bodysizelimit';

describe('request refusals in words (DEC-075)', () => {
  it('explains the body limit and the cut-off form, naming the build limit', () => {
    const a = explainRequestError(NEXT_413, 12);
    expect(a).toMatch(
      /^Body exceeded 12mb limit\. The request was larger than this build accepts \(12 MB\)/,
    );
    expect(a).toContain('usually a file over the upload limit');
    expect(a).not.toContain('To configure');
    const b = explainRequestError('Unexpected end of form', 12);
    expect(b).toMatch(
      /^Unexpected end of form\. The request was larger than this build accepts \(12 MB\)/,
    );
    // No inlined limit: still explained, without a number.
    expect(explainRequestError('Unexpected end of form', null)).toMatch(
      /^Unexpected end of form\. The request was larger than this build accepts or was cut off/,
    );
  });

  it('leaves every other message alone and stays within the audit row', () => {
    expect(explainRequestError('Unsupported state or unable to authenticate data', 12)).toBe(
      'Unsupported state or unable to authenticate data',
    );
    expect(explainRequestError('', 12)).toBe('');
    for (const m of [NEXT_413, 'Unexpected end of form']) {
      const recorded = safeErrorMessage(explainRequestError(m, 12));
      expect(recorded.length).toBeLessThanOrEqual(280);
      expect(recorded).toContain('See "Upload limit" under site health.');
    }
  });
});
