import { describe, expect, it } from 'vitest';
import { hostName } from './local-access.ts';

describe('hostName', () => {
  it('drops the port and lower-cases', () => {
    expect(hostName('LocalHost:8080')).toBe('localhost');
    expect(hostName('127.0.0.1')).toBe('127.0.0.1');
  });
  it('keeps the brackets of an IPv6 literal', () => {
    expect(hostName('[::1]:8080')).toBe('[::1]');
  });
});
