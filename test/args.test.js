import assert from 'node:assert/strict';
import test from 'node:test';
import { listFlag, numberFlag, parseArgs } from '../src/args.js';

test('parses positional arguments, inline flags, and repeated flags', () => {
  assert.deepEqual(parseArgs(['plan', 'latest', '--provider=codex', '--query', 'first', '--query', 'second']), {
    command: 'plan',
    positional: ['latest'],
    flags: { provider: 'codex', query: ['first', 'second'] }
  });
});

test('validates bounded numbers and comma-separated lists', () => {
  assert.equal(numberFlag({ samples: '3' }, 'samples', 1, { min: 1, max: 20 }), 3);
  assert.throws(() => numberFlag({ samples: '21' }, 'samples', 1, { min: 1, max: 20 }), /must be a number/);
  assert.deepEqual(listFlag(['Alpha,Beta', 'Gamma']), ['Alpha', 'Beta', 'Gamma']);
});
