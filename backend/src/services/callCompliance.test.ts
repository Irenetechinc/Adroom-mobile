import { classifyCallOutcome, warmupDailyCallLimit } from './callCompliance';

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

assertEqual(warmupDailyCallLimit(0), 5);
assertEqual(warmupDailyCallLimit(6), 5);
assertEqual(warmupDailyCallLimit(7), 10);
assertEqual(warmupDailyCallLimit(21), 20);
assertEqual(warmupDailyCallLimit(28), 25);

assertEqual(classifyCallOutcome('busy', {}, '', 0), 'busy');
assertEqual(classifyCallOutcome('no-answer', {}, '', 0), 'no_answer');
assertEqual(classifyCallOutcome('completed', {}, 'machine_end_beep', 12), 'voicemail');
assertEqual(classifyCallOutcome('completed', { voice_disposition: 'converted' }, 'human', 20), 'converted');
assertEqual(classifyCallOutcome('completed', { voice_disposition: 'follow_up' }, 'human', 20), 'follow_up_scheduled');
assertEqual(classifyCallOutcome('completed', { voice_disposition: 'do_not_call' }, 'human', 5), 'opted_out');
assertEqual(classifyCallOutcome('completed', { voice_disposition: 'caller_ended' }, 'human', 5), 'hung_up');

console.log('Call compliance and outcome classification tests passed.');
