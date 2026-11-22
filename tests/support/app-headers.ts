/**
 * The headers every Android and iPhone app call carries (plan 6.1 Task 3,
 * shyden-labs/ShyTalk#77): its platform and its version, which the server
 * holds to that platform's floor.
 */
export const PLATFORM_HEADER = 'x-shytalk-platform';
export const VERSION_HEADER = 'x-shytalk-version';

export const appHeaders = (platform: string, version: string): Record<string, string> => ({
  [PLATFORM_HEADER]: platform,
  [VERSION_HEADER]: version,
});
