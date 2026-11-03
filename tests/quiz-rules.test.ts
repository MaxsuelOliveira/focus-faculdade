import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quizRulesFingerprint } from '../server/automation/rules.js';

const rules = {
  instructions: 'Uma tentativa. Duração máxima: 1 hora',
  duration_minutes: 60,
  due_at: '2026-10-31T23:59:00-03:00',
};

test('manual deadline matches when portal omits machine-readable deadline', () => {
  assert.equal(
    quizRulesFingerprint(rules),
    quizRulesFingerprint({ ...rules, due_at: null }, rules.due_at),
  );
});
test('equivalent timezone representations do not invalidate authorization', () => {
  assert.equal(
    quizRulesFingerprint(rules),
    quizRulesFingerprint({ ...rules, due_at: '2026-11-01T02:59:00.000Z' }),
  );
});
test('portal deadline changes override manual fallback and invalidate authorization', () => {
  assert.notEqual(
    quizRulesFingerprint(rules),
    quizRulesFingerprint({ ...rules, due_at: '2026-11-01T01:59:00Z' }, rules.due_at),
  );
});
test('duration, instructions, missing deadline and edited manual date invalidate authorization', () => {
  for (const change of [
    { duration_minutes: 30 },
    { instructions: 'Duas tentativas' },
    { due_at: null },
  ]) {
    assert.notEqual(quizRulesFingerprint(rules), quizRulesFingerprint({ ...rules, ...change }));
  }
  assert.notEqual(
    quizRulesFingerprint(rules),
    quizRulesFingerprint({ ...rules, due_at: null }, '2026-11-01T22:59:00-03:00'),
  );
});
