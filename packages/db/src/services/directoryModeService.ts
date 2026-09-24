/**
 * Which directory the platform reads, and whether it keeps it fresh on its
 * own (DEC-071, owner decision 2026-09-23).
 *
 * The answer used to be whatever `bamboohr.mode` happened to hold, which was
 * nothing after every rebuild and every deployment - so the live directory
 * was silently absent until someone set the key by hand. Now a configured
 * BambooHR credential means the directory is live and reconciled on a
 * schedule, an explicit setting still wins in either direction, and a test
 * environment never goes live on its own. The credential value itself is
 * never read here; only its configuration category.
 */
import { bambooDirectoryStatus, getConfig } from '@exit/config';
import { resolveDirectoryMode, resolveScheduledSync, type DirectoryMode } from '@exit/domain';
import { getSystemConfigValue } from './systemConfigService.ts';

export async function directoryMode(): Promise<DirectoryMode> {
  const config = getConfig();
  return resolveDirectoryMode({
    explicit: await getSystemConfigValue('bamboohr.mode'),
    credential: bambooDirectoryStatus(config),
    appEnvironment: config.appEnvironment,
  });
}

export async function scheduledSyncEnabled(): Promise<boolean> {
  return resolveScheduledSync({
    explicit: await getSystemConfigValue('bamboohr.scheduledSync'),
    mode: await directoryMode(),
  });
}
