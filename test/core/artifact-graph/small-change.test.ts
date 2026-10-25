import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSchema } from '../../../src/core/artifact-graph/schema.js';

describe('small change planning', () => {
  it('requires a proposal, behavioral specs and tasks without mandatory design', () => {
    const schema = parseSchema(readFileSync('schemas/small-change/schema.yaml', 'utf8'));
    expect(schema.artifacts.map(a => a.id)).toEqual(['proposal', 'specs', 'tasks']);
    expect(schema.artifacts.find(a => a.id === 'tasks')?.requires).toEqual(['specs']);
    expect(schema.apply?.requires).toEqual(['tasks']);
  });
});
