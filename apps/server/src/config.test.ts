import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('has local defaults', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 8080,
      allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
      pinnedRelease: null,
    });
    expect(config.logFile).not.toBeNull();
  });
  it('turns the log file off', () => {
    expect(loadConfig({ LOG_FILE: 'off' }).logFile).toBeNull();
  });
  it('refuses invalid values', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError);
    expect(() => loadConfig({ CLINVAR_RELEASE: 'latest' })).toThrow(ConfigError);
  });
});
