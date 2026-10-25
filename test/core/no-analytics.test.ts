import { describe, it, expect } from 'vitest';
import { validateConfigKeyPath } from '../../src/core/config-schema.js';

describe('private local CLI configuration', () => {
  it('does not expose the removed analytics setting', () => {
    expect(validateConfigKeyPath('telemetry.enabled').valid).toBe(false);
    expect(validateConfigKeyPath('featureFlags.example').valid).toBe(true);
  });
});
