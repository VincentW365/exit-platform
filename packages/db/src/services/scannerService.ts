/**
 * Malware-scanner adapter boundary (Directive 4 section H).
 *
 * Modes: 'disabled' (uploads stay QUARANTINED with an exception),
 * 'dev-passthrough' (non-production only, clearly labelled), and 'external'
 * (production boundary; configuration-gated, no live scanner exists in this
 * repository so it fails closed).
 */
import { getConfig } from '@exit/config';
import { scannerUnavailableOutcome } from '@exit/domain';
import { openException } from './exceptionService.ts';

export interface ScanOutcome {
  status: 'CLEAN' | 'INFECTED' | 'QUARANTINED' | 'SCAN_FAILED' | 'REJECTED';
  note: string;
  scannerVersion: string;
  signatureVersion: string;
  scannedAt: Date;
}

export interface ScannerAdapter {
  readonly mode: string;
  validateConfig(): string[];
  health(): Promise<{ ok: boolean; detail: string }>;
  scan(bytes: Uint8Array, correlationId: string): Promise<ScanOutcome>;
}

class DevPassthroughScanner implements ScannerAdapter {
  readonly mode = 'dev-passthrough';
  validateConfig(): string[] {
    return getConfig().isProduction
      ? ['The development passthrough scanner cannot be selected in production (H.3).']
      : [];
  }
  async health() {
    return getConfig().isProduction
      ? { ok: false, detail: 'forbidden in production' }
      : { ok: true, detail: 'DEVELOPMENT PASSTHROUGH - no real malware scan is performed' };
  }
  async scan(): Promise<ScanOutcome> {
    if (getConfig().isProduction) throw new Error('passthrough scanner forbidden in production');
    return {
      status: 'CLEAN',
      note: 'DEVELOPMENT PASSTHROUGH: no real malware scan was performed.',
      scannerVersion: 'dev-passthrough-1',
      signatureVersion: 'none',
      scannedAt: new Date(),
    };
  }
}

class DisabledScanner implements ScannerAdapter {
  readonly mode = 'disabled';
  validateConfig(): string[] {
    return getConfig().isProduction ? ['SCAN_MODE=disabled is not permitted in production.'] : [];
  }
  async health() {
    return { ok: false, detail: 'scanner disabled - uploads remain quarantined' };
  }
  async scan(): Promise<ScanOutcome> {
    // H.2: unavailable scanner -> quarantined, never auto-clean.
    const outcome = scannerUnavailableOutcome();
    return {
      status: outcome.status,
      note: outcome.note,
      scannerVersion: 'none',
      signatureVersion: 'none',
      scannedAt: new Date(),
    };
  }
}

class ExternalScannerBoundary implements ScannerAdapter {
  readonly mode = 'external';
  validateConfig(): string[] {
    return getConfig().SCANNER_URL ? [] : ['SCANNER_URL is not configured.'];
  }
  async health() {
    const errors = this.validateConfig();
    return errors.length
      ? { ok: false, detail: 'not configured' }
      : {
          ok: true,
          detail: 'configuration present (live connectivity untested - no scanner deployed)',
        };
  }
  async scan(): Promise<ScanOutcome> {
    // Fail closed: no live scanner exists in this repository. The upload
    // stays quarantined and an exception is raised by the caller (H.2).
    return {
      status: 'SCAN_FAILED',
      note: 'External scanner not reachable (boundary only in this increment).',
      scannerVersion: 'external-boundary',
      signatureVersion: 'unknown',
      scannedAt: new Date(),
    };
  }
}

export function getScanner(): ScannerAdapter {
  switch (getConfig().SCAN_MODE) {
    case 'dev-passthrough':
      return new DevPassthroughScanner();
    case 'external':
      return new ExternalScannerBoundary();
    case 'disabled':
    default:
      return new DisabledScanner();
  }
}

/** H.2: raise the exception for an unavailable/failed scan. */
export async function raiseScannerException(caseId: string, attachmentId: string): Promise<void> {
  await openException(caseId, {
    exceptionType: 'RENDER_FAILED',
    severity: 'WARNING',
    title: 'Upload quarantined: malware scanner unavailable',
    detail:
      'The scanner is unavailable or failed; the upload remains quarantined and is not downloadable (H.2).',
    refType: 'Attachment',
    refId: attachmentId,
    ownerDepartment: 'HR',
  });
}
