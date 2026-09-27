import assert from 'node:assert/strict';

type TokenRow = {
  token: string;
  project_id?: string | null;
};

type UpdateCall = {
  values: Record<string, unknown>;
  column: string;
  tokens: string[];
};

type FakeSupabase = {
  updates: UpdateCall[];
  from: (table: string) => FakeQuery;
};

class FakeQuery {
  private result: { data: any; error: any };
  private updateValues: Record<string, unknown> | null = null;
  private readonly rows: TokenRow[];
  private readonly updates: UpdateCall[];

  constructor(rows: TokenRow[], updates: UpdateCall[]) {
    this.rows = rows;
    this.updates = updates;
    this.result = { data: rows, error: null };
  }

  select(): FakeQuery {
    this.result = { data: this.rows, error: null };
    return this;
  }

  update(values: Record<string, unknown>): FakeQuery {
    this.updateValues = values;
    this.result = { data: null, error: null };
    return this;
  }

  eq(): FakeQuery {
    return this;
  }

  in(column: string, tokens: string[]): Promise<{ data: null; error: null }> {
    this.updates.push({
      values: this.updateValues || {},
      column,
      tokens,
    });
    return Promise.resolve({ data: null, error: null });
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function createFakeSupabase(rows: TokenRow[]): FakeSupabase {
  const updates: UpdateCall[] = [];
  return {
    updates,
    from(table: string): FakeQuery {
      assert.equal(table, 'device_push_tokens');
      return new FakeQuery(rows, updates);
    },
  };
}

async function withPushMocks<T>(
  rows: TokenRow[],
  ticketFor: (token: string) => Record<string, unknown> = () => ({ status: 'ok' }),
  run: (context: { supabase: FakeSupabase; requests: any[][] }) => Promise<T>,
): Promise<T> {
  // Load the Supabase module before pushService so its factory can be replaced
  // without opening a real connection.
  const supabaseConfig = require('../config/supabase') as {
    getServiceSupabaseClient: () => unknown;
  };
  const pushService = require('./pushService').pushService as {
    deliver: (userId: string, payload: Record<string, unknown>) => Promise<any>;
  };
  const originalFactory = supabaseConfig.getServiceSupabaseClient;
  const originalFetch = (globalThis as any).fetch;
  const supabase = createFakeSupabase(rows);
  const requests: any[][] = [];

  supabaseConfig.getServiceSupabaseClient = () => supabase;
  (globalThis as any).fetch = async (_url: string, init: { body: string }) => {
    const messages = JSON.parse(init.body);
    requests.push(messages);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: messages.map((message: { to: string }) => ticketFor(message.to)),
      }),
    };
  };

  try {
    await pushService.deliver('test-user', { title: 'Test', body: 'Test body' });
    return await run({ supabase, requests });
  } finally {
    supabaseConfig.getServiceSupabaseClient = originalFactory;
    (globalThis as any).fetch = originalFetch;
  }
}

async function testOneProjectUsesOneBatch(): Promise<void> {
  await withPushMocks(
    [
      { token: 'a-1', project_id: 'project-a' },
      { token: 'a-2', project_id: 'project-a' },
    ],
    undefined,
    async ({ requests }) => {
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].map((message) => message.to), ['a-1', 'a-2']);
    },
  );
}

async function testMultipleProjectsNeverShareABatch(): Promise<void> {
  await withPushMocks(
    [
      { token: 'a-1', project_id: 'project-a' },
      { token: 'b-1', project_id: 'project-b' },
      { token: 'a-2', project_id: 'project-a' },
    ],
    undefined,
    async ({ requests }) => {
      assert.equal(requests.length, 2);
      for (const request of requests) {
        const projects = new Set(request.map((message) => message.to.startsWith('a-') ? 'project-a' : 'project-b'));
        assert.equal(projects.size, 1, 'Expo request must contain one EAS project only');
      }
      assert.deepEqual(
        requests.flat().map((message) => message.to).sort(),
        ['a-1', 'a-2', 'b-1'],
      );
    },
  );
}

async function testOneProjectIsChunkedAtExpoLimit(): Promise<void> {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    token: `a-${index}`,
    project_id: 'project-a',
  }));

  await withPushMocks(rows, undefined, async ({ requests }) => {
    assert.deepEqual(requests.map((request) => request.length), [100, 1]);
    assert.ok(requests.every((request) => request.every((message) => message.to.startsWith('a-'))));
  });
}

async function testUnscopedTokensAreRetiredAndNeverSent(): Promise<void> {
  await withPushMocks(
    [
      { token: 'scoped', project_id: 'project-a' },
      { token: 'legacy', project_id: null },
    ],
    undefined,
    async ({ supabase, requests }) => {
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].map((message) => message.to), ['scoped']);
      assert.deepEqual(supabase.updates, [{
        values: { is_active: false },
        column: 'token',
        tokens: ['legacy'],
      }]);
    },
  );
}

async function testDeviceNotRegisteredTokensAreRetired(): Promise<void> {
  await withPushMocks(
    [
      { token: 'valid', project_id: 'project-a' },
      { token: 'stale', project_id: 'project-a' },
    ],
    (token) => token === 'stale'
      ? { status: 'error', message: 'Device is not registered', details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok' },
    async ({ supabase }) => {
      assert.deepEqual(supabase.updates, [{
        values: { is_active: false },
        column: 'token',
        tokens: ['stale'],
      }]);
    },
  );
}

async function main(): Promise<void> {
  await testOneProjectUsesOneBatch();
  await testMultipleProjectsNeverShareABatch();
  await testOneProjectIsChunkedAtExpoLimit();
  await testUnscopedTokensAreRetiredAndNeverSent();
  await testDeviceNotRegisteredTokensAreRetired();
  console.log('Push project routing regression checks passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});