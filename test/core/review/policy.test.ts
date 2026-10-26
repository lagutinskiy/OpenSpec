import { describe, it, expect } from 'vitest';
import { ReviewPolicySchema, resolveReviewerSettings, resolveRoundLimit } from '../../../src/core/review/types.js';

describe('review policy', () => {
  it('keeps legacy configuration valid with existing defaults', () => {
    const policy = ReviewPolicySchema.parse({ reviewer: 'codex', base: 'main' });
    expect(policy.maxRounds).toBe(3);
    expect(resolveReviewerSettings(policy, 'code', 'codex')).toEqual({});
    expect(resolveRoundLimit(policy, 'code')).toBe(3);
  });
  it('validates effort for each reviewer, including the non-selected one', () => {
    expect(() => ReviewPolicySchema.parse({ reviewers: { claude: { effort: 'max' }, codex: { effort: 'minimal' } } })).not.toThrow();
    expect(() => ReviewPolicySchema.parse({ reviewers: { codex: { effort: 'max' } } })).toThrow(/codex.*max.*minimal, low, medium, high, xhigh/);
    expect(() => ReviewPolicySchema.parse({ reviewers: { claude: { effort: 'minimal' } } })).toThrow(/claude/);
    expect(() => ReviewPolicySchema.parse({ stages: { code: { reviewers: { claude: { effort: 'turbo' } } } } })).toThrow(/turbo/);
  });
  it('rejects unknown fields and empty models', () => {
    expect(() => ReviewPolicySchema.parse({ reviewers: { gemini: { model: 'x' } } })).toThrow();
    expect(() => ReviewPolicySchema.parse({ stages: { verify: {} } })).toThrow();
    expect(() => ReviewPolicySchema.parse({ reviewers: { codex: { model: '' } } })).toThrow();
  });
  it('merges stage overrides field by field over reviewer-wide settings', () => {
    const policy = ReviewPolicySchema.parse({
      reviewers: { claude: { model: 'opus', effort: 'high' }, codex: { effort: 'high' } },
      stages: { requirements: { reviewers: { codex: { effort: 'medium' } } }, code: { reviewers: { claude: { effort: 'max' } } } },
    });
    expect(resolveReviewerSettings(policy, 'requirements', 'codex')).toEqual({ effort: 'medium' });
    expect(resolveReviewerSettings(policy, 'code', 'codex')).toEqual({ effort: 'high' });
    expect(resolveReviewerSettings(policy, 'code', 'claude')).toEqual({ model: 'opus', effort: 'max' });
    expect(resolveReviewerSettings(policy, 'requirements', 'claude')).toEqual({ model: 'opus', effort: 'high' });
  });
  it('resolves stage round limits and bounds them from 1 to 20', () => {
    const policy = ReviewPolicySchema.parse({ maxRounds: 3, stages: { code: { maxRounds: 5 } } });
    expect(resolveRoundLimit(policy, 'code')).toBe(5);
    expect(resolveRoundLimit(policy, 'requirements')).toBe(3);
    for (const maxRounds of [0, 21, 1.5]) {
      expect(() => ReviewPolicySchema.parse({ stages: { code: { maxRounds } } })).toThrow();
      expect(() => ReviewPolicySchema.parse({ maxRounds })).toThrow();
    }
  });
});
