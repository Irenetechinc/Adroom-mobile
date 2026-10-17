import assert from 'assert';
import {
  runDeclarativeTool,
  sanitizeAgentContext,
  toolTestMatches,
  validateToolImplementation,
  validateToolSchema,
} from './agentToolSandbox';

async function main() {
  const implementation = {
    steps: [
      { id: 'clean', operation: 'normalize_text', path: '$input.message', output: 'cleaned' },
      { id: 'total', operation: 'sum', path: '$input.amounts', output: 'total' },
      { id: 'unique_tags', operation: 'unique', path: '$input.tags', output: 'tags' },
      { id: 'count_tags', operation: 'count', path: '$results.tags', output: 'tag_count' },
    ],
    output_path: '$results',
  };
  const result = await runDeclarativeTool({
    message: '  Hello   ADIRUM ',
    amounts: [2, 3, 4],
    tags: ['a', 'b', 'a'],
  }, implementation);

  assert.deepStrictEqual(result, {
    cleaned: 'hello adirum',
    total: 9,
    tags: ['a', 'b'],
    tag_count: 2,
  });
  assert.strictEqual(toolTestMatches({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
  assert.strictEqual(
    validateToolSchema({ type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, { message: 'ok' }).valid,
    true,
  );
  assert.strictEqual(
    validateToolSchema({ type: 'object', required: ['message'], properties: { message: { type: 'string' } } }, {}).valid,
    false,
  );
  assert.strictEqual(validateToolImplementation({ steps: [{ id: 'bad', operation: 'execute_js' }] }).valid, false);
  assert.deepStrictEqual(
    sanitizeAgentContext({
      api_key: 'never-share-this',
      note: 'Contact person@example.com or +1 555 123 4567; bearer: Bearer abc.def',
    }),
    {
      api_key: '[redacted]',
      note: 'Contact [redacted] or [redacted]; bearer: [redacted]',
    },
  );

  const leaf = {
    steps: [{ id: 'normalized', operation: 'normalize_text', path: '$input.value', output: 'value' }],
    output_path: '$results',
  };
  const composed = await runDeclarativeTool(
    { child: { value: ' Composed tool ' } },
    {
      steps: [{ id: 'invoke', operation: 'call_tool', tool_name: 'cleaner', input_path: '$input.child', output: 'child_result' }],
      output_path: '$results',
    },
    {
      invokeTool: async (name, input, stack) => {
        assert.strictEqual(name, 'cleaner');
        assert.deepStrictEqual(stack, ['cleaner']);
        return runDeclarativeTool(input, leaf, { stack });
      },
    },
  );
  assert.deepStrictEqual(composed, { child_result: { value: 'composed tool' } });

  await assert.rejects(
    () => runDeclarativeTool({}, { steps: [{ id: 'x', operation: 'call_tool', tool_name: 'missing' }] }),
    /composition is unavailable/,
  );
  console.log('Agent tool sandbox tests passed.');
}

main().catch((error) => {
  console.error('Agent tool sandbox tests failed:', error);
  process.exitCode = 1;
});
