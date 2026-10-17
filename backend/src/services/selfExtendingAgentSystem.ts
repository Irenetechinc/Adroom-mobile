import { createHash } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { AIEngine, runWithAIRequestContext } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { energyService } from './energyService';
import {
  DeclarativeToolImplementation,
  redactAgentText,
  runDeclarativeTool,
  sanitizeAgentContext,
  toolTestMatches,
  validateToolImplementation,
  validateToolSchema,
} from './agentToolSandbox';

export type AgentExtensionRequest = {
  userId: string;
  agentType: string;
  workKind: string;
  objective: string;
  context?: Record<string, unknown>;
  originType?: string;
  originId?: string;
  strategyId?: string;
  parentRunId?: string | null;
};

type ChildProposal = {
  task_name: string;
  purpose: string;
  scope: string;
  constraints: string[];
  completion_criteria: string;
  task: string;
  value_case: string;
  scheduled_at?: string;
};

type ToolProposal = {
  name: string;
  purpose: string;
  input_schema: Record<string, any>;
  output_schema: Record<string, any>;
  implementation: DeclarativeToolImplementation;
  test_cases: Array<{ input: unknown; expected: unknown }>;
  grant_to_agent_types?: string[];
};

function safeText(value: unknown, maxLength = 1000): string {
  return redactAgentText(String(value ?? '').trim()).slice(0, maxLength);
}

function normalizedName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function fingerprintFor(task: Pick<ChildProposal, 'task_name' | 'purpose' | 'scope' | 'task'>): string {
  const normalized = [task.task_name, task.purpose, task.scope, task.task]
    .map((part) => safeText(part, 400).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .join('|');
  return sha256(normalized);
}

function parseJson(value: any): any {
  if (value?.parsedJson && typeof value.parsedJson === 'object') return value.parsedJson;
  if (typeof value?.text !== 'string') return null;
  try {
    const start = value.text.indexOf('{');
    const end = value.text.lastIndexOf('}');
    return start >= 0 && end > start ? JSON.parse(value.text.slice(start, end + 1)) : null;
  } catch {
    return null;
  }
}

function validChildProposal(value: any): value is ChildProposal {
  return Boolean(
    value
    && safeText(value.task_name, 120)
    && safeText(value.purpose, 1000)
    && safeText(value.scope, 1500)
    && safeText(value.completion_criteria, 1000)
    && safeText(value.task, 5000)
    && safeText(value.value_case, 1000)
    && Array.isArray(value.constraints),
  );
}

function validToolProposal(value: any): value is ToolProposal {
  return Boolean(
    value
    && safeText(value.name, 100)
    && safeText(value.purpose, 1000)
    && value.input_schema
    && value.output_schema
    && value.implementation
    && Array.isArray(value.test_cases)
    && value.test_cases.length > 0
    && value.test_cases.length <= 20,
  );
}

export class SelfExtendingAgentSystem {
  private readonly supabase: SupabaseClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private workerBusy = false;
  private schemaUnavailableUntil = 0;
  private schemaWarningShown = false;
  private lastRecoveryAt = 0;

  constructor(supabase = getServiceSupabaseClient()) {
    this.supabase = supabase;
  }

  /**
   * Called from agent work boundaries. The parent action never waits for the
   * worker; the decision and any requested child work are persisted first.
   */
  async consider(request: AgentExtensionRequest): Promise<{ runId?: string; toolId?: string }> {
    if (!request.userId || !request.agentType || !request.objective) return {};
    if (!await this.schemaAvailable()) return {};
    const charge = await this.charge(request.userId, {
      action: 'extension_decision',
      agent_type: request.agentType,
      origin_type: request.originType || 'agent_work',
      origin_id: request.originId || null,
    });
    if (!charge.allowed) {
      await this.audit(request.userId, request.agentType, 'extension_decision_blocked', {
        reason: charge.reason,
        origin_type: request.originType || 'agent_work',
      });
      return {};
    }

    const context = sanitizeAgentContext(request.context || {}) as Record<string, unknown>;
    const [load, tools, linkedReports, subscription] = await Promise.all([
      this.readSystemLoad(),
      this.getToolsForAgent(request.userId, request.agentType),
      request.parentRunId
        ? this.getChildReports(request.parentRunId)
        : this.getReportsForOrigin(
            request.userId,
            request.originType || 'agent_work',
            request.originId || '',
            request.strategyId || '',
          ),
      energyService.getSubscription(request.userId),
    ]);
    const account = await energyService.getAccount(request.userId);
    const prompt = `You are the active Adirum AI ${safeText(request.agentType, 80)} agent. Decide whether this specific piece of work would benefit from a focused temporary worker, a newly composed reusable tool, both, or neither.

CURRENT WORK:
Kind: ${safeText(request.workKind, 120)}
Objective: ${safeText(request.objective, 1600)}
Context (sanitized; no credentials or direct contact details): ${JSON.stringify(context).slice(0, 9000)}

RESOURCE AND VALUE CONTEXT:
Plan: ${safeText(subscription?.plan || 'unknown', 60)} (${safeText(subscription?.status || 'unknown', 60)})
Available energy: ${Number(account?.balance_credits || 0)}
Current extension queue: ${JSON.stringify(load)}
Existing available tools: ${JSON.stringify(tools.map((tool: any) => ({
      name: tool.tool_name,
      purpose: tool.purpose,
      inputs: tool.input_schema,
      outputs: tool.output_schema,
      dependencies: tool.dependency_names,
    }))).slice(0, 7000)}
Parent reports: ${JSON.stringify(linkedReports).slice(0, 5000)}

Decision rules:
- Make the decision from the work's actual complexity, parallelism, likely benefit, plan, credit balance, queue pressure, and available tools; do not create work just to use the system.
- Prefer a sub-agent only for a focused independent task. Define its purpose, scope, constraints, and measurable completion criteria.
- A child only analyzes the supplied sanitized data and reports back. It cannot contact users/leads, publish content, access credentials, or perform external side effects.
- Create a tool only for a reusable capability missing from the active tools. Tools must be a JSON-only composition of the allowed operations below, and must include realistic test cases and expected outputs.
- Allowed tool operations: pick_fields, normalize_text, count, sum, average, unique, join, filter_non_empty, call_tool.
- A tool has no code/eval, filesystem, network, environment, credential, or database access. A call_tool step may only call another active tool the agent can access.
- Avoid duplicate or recursive work. Do not ask for a child task whose normalized purpose repeats an item in its ancestry: ${JSON.stringify(request.parentRunId ? await this.getAncestry(request.parentRunId) : [])}.
- If nothing is justified, return null for both proposals.

Return JSON only:
{
  "tool_calls": [{"name":"active_tool_name","input":{"field":"value"}}],
  "delegate": null | {
    "task_name": "short clear label",
    "purpose": "specific purpose",
    "scope": "what is in and out of scope",
    "constraints": ["safety and data constraints"],
    "completion_criteria": "objective completion test",
    "task": "the exact task the worker should perform",
    "value_case": "why the likely value justifies the energy and system load"
  },
  "tool": null | {
    "name": "short tool name",
    "purpose": "what reusable capability it provides",
    "input_schema": {"type":"object","required":["..."],"properties":{"...":{"type":"string","description":"..."}}},
    "output_schema": {"type":"object","properties":{"...":{"type":"string"}}},
    "implementation": {
      "steps": [
        {"id":"step_id","operation":"normalize_text","path":"$input.field","output":"normalized"}
      ],
      "output_path":"$results"
    },
    "test_cases": [{"input":{"field":" Example "},"expected":{"normalized":"example"}}],
    "grant_to_agent_types": []
  }
}`;

    try {
      const response = await this.generateForUser(request.userId, subscription, prompt, charge.model);
      const proposal = parseJson(response);
      let runId: string | undefined;
      let toolId: string | undefined;
      const toolResults: Record<string, unknown> = {};
      const availableToolCredits = Math.floor(
        Number(account?.balance_credits || 0) / Math.max(charge.credits, 0.01),
      );
      const requestedToolCalls = Array.isArray(proposal?.tool_calls) ? proposal.tool_calls : [];
      const seenToolCalls = new Set<string>();
      for (const call of requestedToolCalls.slice(0, availableToolCredits)) {
        if (!call || !call.name) continue;
        const callInput = sanitizeAgentContext(call.input);
        const callFingerprint = sha256({ name: normalizedName(call.name), input: callInput });
        if (seenToolCalls.has(callFingerprint)) continue;
        seenToolCalls.add(callFingerprint);
        try {
          const result = await this.runTool({
            userId: request.userId,
            agentType: request.agentType,
            toolName: call.name,
            input: callInput,
            subagentRunId: request.parentRunId || null,
          });
          toolResults[safeText(call.name, 80)] = result;
        } catch (error: any) {
          toolResults[safeText(call?.name, 80)] = { error: safeText(error.message, 400) };
        }
      }
      if (validChildProposal(proposal?.delegate)) {
        const queued = await this.enqueueSubagent({
          userId: request.userId,
          agentType: request.agentType,
          proposal: proposal.delegate,
          parentRunId: request.parentRunId || null,
          originType: request.originType || 'agent_work',
          originId: request.originId || request.strategyId || null,
          strategyId: request.strategyId || null,
          inheritedContext: { ...context, extension_tool_results: toolResults },
        });
        runId = queued?.id;
        if (runId) {
          await this.supabase.from('agent_subagent_runs').update({
            credits_charged: charge.credits,
            updated_at: new Date().toISOString(),
          }).eq('id', runId).eq('credits_charged', 0);
        }
      }
      if (validToolProposal(proposal?.tool)) {
        const created = await this.createTestedTool({
          userId: request.userId,
          agentType: request.agentType,
          proposal: proposal.tool,
          createdByRunId: request.parentRunId || null,
        });
        toolId = created?.id;
      }
      await this.audit(request.userId, request.agentType, 'extension_decision_completed', {
        origin_type: request.originType || 'agent_work',
        delegated: Boolean(runId),
        created_tool: Boolean(toolId),
        tools_used: Object.keys(toolResults),
        credits_charged: charge.credits,
      });
      return { runId, toolId };
    } catch (error: any) {
      console.error('[SelfExtension] Extension decision failed:', error.message);
      await this.audit(request.userId, request.agentType, 'extension_decision_failed', {
        origin_type: request.originType || 'agent_work',
        error: safeText(error.message, 500),
        credits_charged: charge.credits,
      });
      return {};
    }
  }

  private async generateForUser(userId: string, subscription: any, prompt: string, routedModel: string) {
    return runWithAIRequestContext({
      userId,
      plan: String(subscription?.plan || 'none'),
      status: String(subscription?.status || 'none'),
    }, () => {
      const ai = AIEngine.getInstance();
      return routedModel === 'gemini-flash' || routedModel === 'free_provider'
        ? ai.generateStrategyEconomy({}, prompt)
        : ai.generateStrategy({}, prompt);
    });
  }

  private async schemaAvailable(): Promise<boolean> {
    if (Date.now() < this.schemaUnavailableUntil) return false;
    const { error } = await this.supabase
      .from('agent_subagent_runs')
      .select('id', { count: 'exact', head: true })
      .limit(0);
    if (!error) {
      this.schemaWarningShown = false;
      return true;
    }
    this.schemaUnavailableUntil = Date.now() + 60_000;
    if (!this.schemaWarningShown) {
      console.warn('[SelfExtension] Extension tables are unavailable; apply the Supabase self-extension migration before enabling this feature.');
      this.schemaWarningShown = true;
    }
    return false;
  }

  private async charge(userId: string, metadata: Record<string, unknown>): Promise<{ allowed: boolean; credits: number; model: string; reason?: string }> {
    try {
      const result = await energyService.deductEnergyWithRouting(userId, 'agent_task', {
        source: 'self_extending_agent_system',
        ...metadata,
      });
      return {
        allowed: true,
        credits: Number(result.cma?.credits || 0),
        model: String(result.cma?.model || 'gemini-flash'),
      };
    } catch (error: any) {
      return { allowed: false, credits: 0, model: '', reason: safeText(error.message, 500) };
    }
  }

  private async readSystemLoad(): Promise<Record<string, number>> {
    const readCount = async (status: string) => {
      const { count, error } = await this.supabase
        .from('agent_subagent_runs')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw new Error(`Could not read extension queue: ${error.message}`);
      return Number(count || 0);
    };
    const [queued, running] = await Promise.all([readCount('queued'), readCount('running')]);
    const recentSince = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await this.supabase
      .from('agent_subagent_runs')
      .select('created_at, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', recentSince)
      .limit(200);
    if (error) throw new Error(`Could not read extension throughput: ${error.message}`);
    const durations = (data || [])
      .map((row: any) => new Date(row.completed_at).getTime() - new Date(row.created_at).getTime())
      .filter((duration) => Number.isFinite(duration) && duration >= 0);
    return {
      queued,
      running,
      completed_last_hour: durations.length,
      median_completion_ms: durations.length
        ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)]
        : 0,
    };
  }

  private async getToolsForAgent(userId: string, agentType: string) {
    const { data, error } = await this.supabase
      .from('agent_dynamic_tools')
      .select('id, owner_agent_type, tool_name, purpose, input_schema, output_schema, implementation, dependency_names, granted_to_agent_types, version, signature, status, use_count')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('tool_name')
      .limit(100);
    if (error) throw new Error(`Could not read dynamic tools: ${error.message}`);
    return (data || []).filter((tool: any) =>
      tool.owner_agent_type === agentType
      || (Array.isArray(tool.granted_to_agent_types) && tool.granted_to_agent_types.includes(agentType)),
    );
  }

  private async enqueueSubagent(params: {
    userId: string;
    agentType: string;
    proposal: ChildProposal;
    parentRunId: string | null;
    originType: string;
    originId: string | null;
    strategyId: string | null;
    inheritedContext: Record<string, unknown>;
  }): Promise<any | null> {
    const proposal = {
      task_name: safeText(params.proposal.task_name, 120),
      purpose: safeText(params.proposal.purpose, 1000),
      scope: safeText(params.proposal.scope, 1500),
      constraints: params.proposal.constraints.slice(0, 20).map((value) => safeText(value, 500)),
      completion_criteria: safeText(params.proposal.completion_criteria, 1000),
      task: safeText(params.proposal.task, 5000),
      value_case: safeText(params.proposal.value_case, 1000),
    };
    const fingerprint = fingerprintFor(proposal);
    const ancestry = params.parentRunId ? await this.getAncestry(params.parentRunId) : [];
    if (params.parentRunId) {
      const { data: parent } = await this.supabase
        .from('agent_subagent_runs')
        .select('status')
        .eq('id', params.parentRunId)
        .maybeSingle();
      if (!parent || parent.status === 'terminated' || parent.status === 'failed') {
        await this.audit(params.userId, params.agentType, 'subagent_child_creation_blocked', {
          parent_run_id: params.parentRunId,
          parent_status: parent?.status || 'missing',
        });
        return null;
      }
    }
    if (ancestry.some((entry: any) => entry.fingerprint === fingerprint)) {
      await this.audit(params.userId, params.agentType, 'subagent_recursion_blocked', {
        request_fingerprint: fingerprint,
        parent_run_id: params.parentRunId,
      });
      return null;
    }
    const { data: duplicate, error: duplicateError } = await this.supabase
      .from('agent_subagent_runs')
      .select('id, status')
      .eq('user_id', params.userId)
      .eq('request_fingerprint', fingerprint)
      .in('status', ['queued', 'running', 'completed', 'failed', 'terminated'])
      .limit(1)
      .maybeSingle();
    if (duplicateError) throw new Error(`Could not check duplicate sub-agent work: ${duplicateError.message}`);
    if (duplicate) {
      await this.audit(params.userId, params.agentType, 'subagent_duplicate_suppressed', {
        request_fingerprint: fingerprint,
        existing_run_id: duplicate.id,
      });
      return null;
    }

    const { data, error } = await this.supabase.from('agent_subagent_runs').insert({
      user_id: params.userId,
      parent_run_id: params.parentRunId,
      root_run_id: null,
      origin_type: safeText(params.originType, 80),
      origin_id: params.originId,
      strategy_id: params.strategyId,
      agent_type: safeText(params.agentType, 80),
      task_name: proposal.task_name,
      purpose: proposal.purpose,
      scope: proposal.scope,
      constraints: proposal.constraints,
      completion_criteria: proposal.completion_criteria,
      inherited_context: sanitizeAgentContext(params.inheritedContext),
      ancestry_fingerprints: [...ancestry.map((entry: any) => entry.fingerprint), fingerprint],
      request_fingerprint: fingerprint,
      status: 'queued',
      scheduled_at: new Date().toISOString(),
    }).select('*').single();
    if (error) throw new Error(`Could not queue sub-agent work: ${error.message}`);
    let rootRunId = data.id;
    let strategyId = params.strategyId;
    if (params.parentRunId) {
      const { data: parent } = await this.supabase
        .from('agent_subagent_runs')
        .select('root_run_id, strategy_id')
        .eq('id', params.parentRunId)
        .maybeSingle();
      rootRunId = parent?.root_run_id || params.parentRunId;
      strategyId = strategyId || parent?.strategy_id || undefined;
    }
    await this.supabase.from('agent_subagent_runs').update({
      root_run_id: rootRunId,
      strategy_id: strategyId || null,
      ancestry_fingerprints: [...ancestry.map((entry: any) => entry.fingerprint), fingerprint],
    }).eq('id', data.id);
    await this.audit(params.userId, params.agentType, 'subagent_created', {
      subagent_run_id: data.id,
      parent_run_id: params.parentRunId,
      request_fingerprint: fingerprint,
      value_case: proposal.value_case,
    }, data.id);
    await this.createMilestone(params.userId, data.id, 'work_started', 'Adirum AI started focused work', 'A focused work item is underway for your campaign.');
    this.broadcast('agent_subagent_created', { run_id: data.id, parent_run_id: params.parentRunId, user_id: params.userId });
    return data;
  }

  private async getAncestry(runId: string): Promise<Array<{ fingerprint: string; task_name?: string }>> {
    const { data, error } = await this.supabase
      .from('agent_subagent_runs')
      .select('id, parent_run_id, request_fingerprint, task_name')
      .eq('id', runId)
      .maybeSingle();
    if (error || !data) return [];
    const ancestry: Array<{ fingerprint: string; task_name?: string }> = [];
    let current: any = data;
    while (current) {
      ancestry.unshift({ fingerprint: current.request_fingerprint, task_name: current.task_name });
      if (!current.parent_run_id) break;
      const { data: parent } = await this.supabase
        .from('agent_subagent_runs')
        .select('id, parent_run_id, request_fingerprint, task_name')
        .eq('id', current.parent_run_id)
        .maybeSingle();
      current = parent;
    }
    return ancestry;
  }

  private async getChildReports(parentRunId: string): Promise<unknown[]> {
    const { data } = await this.supabase
      .from('agent_subagent_runs')
      .select('task_name, purpose, status, result, completed_at')
      .eq('parent_run_id', parentRunId)
      .in('status', ['completed', 'failed', 'terminated'])
      .order('completed_at', { ascending: false })
      .limit(20);
    return (data || []).map((row: any) => ({
      task_name: row.task_name,
      purpose: row.purpose,
      status: row.status,
      result: sanitizeAgentContext(row.result),
      completed_at: row.completed_at,
    }));
  }

  private async getReportsForOrigin(userId: string, originType: string, originId: string, strategyId: string): Promise<unknown[]> {
    const queries: PromiseLike<any>[] = [];
    if (originId) {
      queries.push(this.supabase
        .from('agent_subagent_runs')
        .select('id, task_name, purpose, status, result, completed_at')
        .eq('user_id', userId)
        .eq('origin_type', originType)
        .eq('origin_id', originId)
        .is('parent_run_id', null)
        .in('status', ['completed', 'failed', 'terminated'])
        .order('completed_at', { ascending: false })
        .limit(20));
    }
    if (strategyId) {
      queries.push(this.supabase
        .from('agent_subagent_runs')
        .select('id, task_name, purpose, status, result, completed_at')
        .eq('user_id', userId)
        .eq('strategy_id', strategyId)
        .is('parent_run_id', null)
        .in('status', ['completed', 'failed', 'terminated'])
        .order('completed_at', { ascending: false })
        .limit(20));
    }
    const results = await Promise.all(queries);
    const rows = new Map<string, any>();
    for (const query of results) {
      for (const row of query.data || []) rows.set(row.id, row);
    }
    return Array.from(rows.values()).map((row: any) => ({
      run_id: row.id,
      task_name: row.task_name,
      purpose: row.purpose,
      status: row.status,
      result: sanitizeAgentContext(row.result),
      completed_at: row.completed_at,
    }));
  }

  private async createTestedTool(params: {
    userId: string;
    agentType: string;
    proposal: ToolProposal;
    createdByRunId: string | null;
  }): Promise<any | null> {
    const name = normalizedName(params.proposal.name);
    const purpose = safeText(params.proposal.purpose, 1000);
    const implementation = params.proposal.implementation;
    const inputSchema = sanitizeAgentContext(params.proposal.input_schema);
    const outputSchema = sanitizeAgentContext(params.proposal.output_schema);
    const tests = params.proposal.test_cases.map((test) => ({
      input: sanitizeAgentContext(test.input),
      expected: sanitizeAgentContext(test.expected),
    }));
    const validation = validateToolImplementation(implementation);
    if (!name || !purpose || !validation.valid || tests.length === 0) {
      await this.audit(params.userId, params.agentType, 'tool_creation_rejected', {
        name,
        validation_error: validation.error || 'Tool fields or tests are invalid.',
      });
      return null;
    }
    const inputSchemaCheck = validateToolSchema(inputSchema, tests[0].input);
    if (!inputSchemaCheck.valid) {
      await this.audit(params.userId, params.agentType, 'tool_creation_rejected', {
        name,
        validation_error: inputSchemaCheck.error,
      });
      return null;
    }
    const signature = sha256({ inputSchema, outputSchema, implementation });
    const { data: duplicates, error: dupError } = await this.supabase
      .from('agent_dynamic_tools')
      .select('id, tool_name, owner_agent_type, granted_to_agent_types, status, version')
      .eq('user_id', params.userId)
      .eq('signature', signature)
      .limit(100);
    if (dupError) throw new Error(`Could not check tool duplication: ${dupError.message}`);
    const accessibleDuplicate = (duplicates || []).find((tool: any) =>
      tool.owner_agent_type === params.agentType
      || (Array.isArray(tool.granted_to_agent_types) && tool.granted_to_agent_types.includes(params.agentType)),
    );
    if (accessibleDuplicate) {
      await this.audit(params.userId, params.agentType, 'duplicate_tool_suppressed', {
        tool_id: accessibleDuplicate.id,
        tool_name: accessibleDuplicate.tool_name,
        status: accessibleDuplicate.status,
        signature,
      }, undefined, accessibleDuplicate.id);
      return accessibleDuplicate;
    }

    const { data: disabledVersions } = await this.supabase
      .from('agent_dynamic_tools')
      .select('id, disabled_reason')
      .eq('user_id', params.userId)
      .eq('owner_agent_type', params.agentType)
      .eq('tool_name', name)
      .eq('status', 'disabled');
    const adminDisabled = (disabledVersions || []).find((tool: any) =>
      /administrator|admin dashboard/i.test(String(tool.disabled_reason || '')),
    );
    if (adminDisabled) {
      await this.audit(params.userId, params.agentType, 'tool_creation_blocked_by_admin_disable', {
        tool_name: name,
        disabled_tool_id: adminDisabled.id,
      }, params.createdByRunId || undefined, adminDisabled.id);
      return null;
    }

    const results: Array<{ passed: boolean; error?: string }> = [];
    for (const test of tests) {
      try {
        const inputValid = validateToolSchema(inputSchema, test.input);
        if (!inputValid.valid) throw new Error(inputValid.error);
        const actual = await this.runImplementation(params.userId, params.agentType, implementation, test.input, [], { bill: false });
        const outputValid = validateToolSchema(outputSchema, actual);
        if (!outputValid.valid) throw new Error(`Output does not match schema: ${outputValid.error}`);
        if (!toolTestMatches(actual, test.expected)) throw new Error('Actual output did not match expected output.');
        results.push({ passed: true });
      } catch (error: any) {
        results.push({ passed: false, error: safeText(error.message, 500) });
      }
    }
    const allTestsPassed = results.length > 0 && results.every((result) => result.passed);
    const dependencies = Array.from(new Set(
      implementation.steps
        .filter((step) => step.operation === 'call_tool')
        .map((step) => normalizedName(step.tool_name)),
    ));
    const { data: previous } = await this.supabase
      .from('agent_dynamic_tools')
      .select('id, version')
      .eq('user_id', params.userId)
      .eq('owner_agent_type', params.agentType)
      .eq('tool_name', name)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const grants = Array.isArray(params.proposal.grant_to_agent_types)
      ? Array.from(new Set(params.proposal.grant_to_agent_types.map((type) => safeText(type, 80)).filter(Boolean))).slice(0, 40)
      : [];
    const { data: tool, error } = await this.supabase.from('agent_dynamic_tools').insert({
      user_id: params.userId,
      owner_agent_type: safeText(params.agentType, 80),
      tool_name: name,
      purpose,
      input_schema: inputSchema,
      output_schema: outputSchema,
      implementation,
      dependency_names: dependencies,
      granted_to_agent_types: grants,
      version: Number(previous?.version || 0) + 1,
      previous_version_id: previous?.id || null,
      signature,
      status: allTestsPassed ? 'active' : 'rejected',
      test_results: results,
      created_by_run_id: params.createdByRunId,
    }).select('*').single();
    if (error) throw new Error(`Could not register dynamic tool: ${error.message}`);

    if (previous?.id && allTestsPassed) {
      await this.supabase.from('agent_dynamic_tools').update({
        status: 'superseded',
        updated_at: new Date().toISOString(),
      }).eq('id', previous.id).eq('status', 'active');
    }
    await this.audit(params.userId, params.agentType, allTestsPassed ? 'tool_created' : 'tool_test_failed', {
      tool_id: tool.id,
      tool_name: name,
      version: tool.version,
      tests_passed: results.filter((result) => result.passed).length,
      tests_total: results.length,
      dependencies,
    }, params.createdByRunId || undefined, tool.id);
    if (allTestsPassed) {
      await this.createMilestone(params.userId, params.createdByRunId || tool.id, 'tool_ready', 'Adirum AI added a new capability', 'A new reusable capability has been tested and is ready for your agent.');
    }
    this.broadcast('agent_dynamic_tool_created', { tool_id: tool.id, tool_name: name, status: tool.status });
    return tool;
  }

  async runTool(params: {
    userId: string;
    agentType: string;
    toolName: string;
    input: unknown;
    subagentRunId?: string | null;
  }): Promise<unknown> {
    const name = normalizedName(params.toolName);
    const tools = await this.getToolsForAgent(params.userId, params.agentType);
    const tool = tools.find((item: any) => item.tool_name === name);
    if (!tool) throw new Error(`No active tool named "${name}" is available to ${params.agentType}.`);
    const charge = await this.charge(params.userId, {
      action: 'dynamic_tool_execution',
      agent_type: params.agentType,
      tool_id: tool.id,
      tool_name: name,
      subagent_run_id: params.subagentRunId || null,
    });
    if (!charge.allowed) throw new Error(charge.reason || 'The tool run is blocked by the current credit policy.');
    const inputCheck = validateToolSchema(tool.input_schema, params.input);
    if (!inputCheck.valid) {
      await this.logToolRun({
        userId: params.userId,
        tool,
        agentType: params.agentType,
        subagentRunId: params.subagentRunId,
        status: 'blocked',
        input: params.input,
        error: inputCheck.error,
        credits: charge.credits,
      });
      throw new Error(inputCheck.error);
    }

    try {
      const output = await this.runImplementation(
        params.userId,
        params.agentType,
        tool.implementation,
        params.input,
        [tool.id],
        { bill: true, subagentRunId: params.subagentRunId || null },
      );
      const outputCheck = validateToolSchema(tool.output_schema, output);
      if (!outputCheck.valid) throw new Error(`Tool output failed validation: ${outputCheck.error}`);
      const sanitized = sanitizeAgentContext(output);
      await this.supabase.from('agent_dynamic_tools').update({
        use_count: Number(tool.use_count || 0) + 1,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', tool.id).eq('status', 'active');
      await this.logToolRun({
        userId: params.userId,
        tool,
        agentType: params.agentType,
        subagentRunId: params.subagentRunId,
        status: 'succeeded',
        input: params.input,
        output: sanitized,
        credits: charge.credits,
      });
      await this.audit(params.userId, params.agentType, 'tool_used', {
        tool_name: name,
        version: tool.version,
        credits_charged: charge.credits,
      }, params.subagentRunId || undefined, tool.id);
      return sanitized;
    } catch (error: any) {
      await this.logToolRun({
        userId: params.userId,
        tool,
        agentType: params.agentType,
        subagentRunId: params.subagentRunId,
        status: 'failed',
        input: params.input,
        error: safeText(error.message, 500),
        credits: charge.credits,
      });
      throw error;
    }
  }

  private async runImplementation(
    userId: string,
    agentType: string,
    implementation: DeclarativeToolImplementation,
    input: unknown,
    stack: string[],
    execution: { bill: boolean; subagentRunId?: string | null },
  ): Promise<unknown> {
    return runDeclarativeTool(input, implementation, {
      stack,
      invokeTool: async (toolName, childInput, currentStack) => {
        const tools = await this.getToolsForAgent(userId, agentType);
        const child = tools.find((item: any) => item.tool_name === normalizedName(toolName));
        if (!child) throw new Error(`Composed tool "${toolName}" is not available to ${agentType}.`);
        if (currentStack.includes(child.id)) throw new Error(`Tool composition loop detected at "${toolName}".`);
        const childInputCheck = validateToolSchema(child.input_schema, childInput);
        if (!childInputCheck.valid) throw new Error(childInputCheck.error);
        const childCharge = execution.bill
          ? await this.charge(userId, {
              action: 'dynamic_tool_execution',
              agent_type: agentType,
              tool_id: child.id,
              tool_name: child.tool_name,
              subagent_run_id: execution.subagentRunId || null,
            })
          : { allowed: true, credits: 0, model: '' };
        if (!childCharge.allowed) throw new Error(childCharge.reason || 'Credit policy blocked the composed tool.');
        try {
          const childOutput = await this.runImplementation(
            userId,
            agentType,
            child.implementation,
            childInput,
            [...currentStack, child.id],
            execution,
          );
          const childOutputCheck = validateToolSchema(child.output_schema, childOutput);
          if (!childOutputCheck.valid) throw new Error(`Composed tool output failed validation: ${childOutputCheck.error}`);
          if (execution.bill) {
            await this.supabase.from('agent_dynamic_tools').update({
              use_count: Number(child.use_count || 0) + 1,
              last_used_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).eq('id', child.id).eq('status', 'active');
            await this.logToolRun({
              userId,
              tool: child,
              agentType,
              subagentRunId: execution.subagentRunId,
              status: 'succeeded',
              input: childInput,
              output: sanitizeAgentContext(childOutput),
              credits: childCharge.credits,
            });
            await this.audit(userId, agentType, 'tool_used', {
              tool_name: child.tool_name,
              version: child.version,
              credits_charged: childCharge.credits,
              composed: true,
            }, execution.subagentRunId || undefined, child.id);
          }
          return childOutput;
        } catch (error: any) {
          if (execution.bill) {
            await this.logToolRun({
              userId,
              tool: child,
              agentType,
              subagentRunId: execution.subagentRunId,
              status: 'failed',
              input: childInput,
              error: safeText(error.message, 500),
              credits: childCharge.credits,
            });
          }
          throw error;
        }
      },
    });
  }

  private async logToolRun(params: {
    userId: string;
    tool: any;
    agentType: string;
    subagentRunId?: string | null;
    status: 'succeeded' | 'failed' | 'blocked';
    input: unknown;
    output?: unknown;
    error?: string;
    credits: number;
  }) {
    const { error } = await this.supabase.from('agent_dynamic_tool_runs').insert({
      user_id: params.userId,
      tool_id: params.tool.id,
      tool_version: params.tool.version,
      agent_type: safeText(params.agentType, 80),
      subagent_run_id: params.subagentRunId || null,
      status: params.status,
      input_hash: sha256(sanitizeAgentContext(params.input)),
      output: params.output ? sanitizeAgentContext(params.output) : null,
      error_message: params.error || null,
      credits_charged: params.credits,
    });
    if (error) console.warn('[SelfExtension] Tool execution log failed:', error.message);
    if (params.subagentRunId && params.credits > 0) {
      const { data: run } = await this.supabase
        .from('agent_subagent_runs')
        .select('credits_charged')
        .eq('id', params.subagentRunId)
        .maybeSingle();
      if (run) {
        await this.supabase.from('agent_subagent_runs').update({
          credits_charged: Number(run.credits_charged || 0) + params.credits,
          updated_at: new Date().toISOString(),
        }).eq('id', params.subagentRunId);
      }
    }
  }

  private async createMilestone(userId: string, runId: string, milestone: string, title: string, body: string) {
    const { error } = await this.supabase.from('user_notifications').insert({
      user_id: userId,
      title,
      body,
      data: {
        type: 'agent_extension_milestone',
        milestone,
        run_id: runId,
      },
      sent_by: 'agent_extension',
      is_read: false,
    });
    if (error) console.warn('[SelfExtension] Could not persist user milestone:', error.message);
  }

  private async audit(
    userId: string | null,
    agentType: string | null,
    eventType: string,
    details: Record<string, unknown>,
    runId?: string,
    toolId?: string,
  ) {
    const { error } = await this.supabase.from('agent_extension_audit_log').insert({
      user_id: userId,
      actor_agent_type: agentType,
      event_type: eventType,
      subagent_run_id: runId || null,
      tool_id: toolId || null,
      details: sanitizeAgentContext(details),
    });
    if (error) console.warn('[SelfExtension] Audit write failed:', error.message);
  }

  private broadcast(event: string, data: Record<string, unknown>) {
    void import('../admin/adminRouter')
      .then(({ adminBroadcast }) => adminBroadcast(event, data))
      .catch(() => {});
  }

  async startWorker(): Promise<void> {
    if (this.timer) return;
    if (!await this.schemaAvailable()) return;
    await this.recoverStaleRuns();
    const parsedMs = Number.parseInt(process.env.AGENT_EXTENSION_POLL_MS || '5000', 10);
    const intervalMs = Number.isFinite(parsedMs) ? Math.max(1000, Math.min(60000, parsedMs)) : 5000;
    this.timer = setInterval(() => {
      void this.processNextRun();
    }, intervalMs);
    this.timer.unref?.();
    void this.processNextRun();
    console.log(`[SelfExtension] Sub-agent worker started (poll=${intervalMs}ms).`);
  }

  stopWorker(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async processNextRun(): Promise<void> {
    if (this.workerBusy) return;
    this.workerBusy = true;
    try {
      const configuredStaleMs = Number.parseInt(process.env.AGENT_EXTENSION_STALE_RUN_MS || '600000', 10);
      const staleMs = Number.isFinite(configuredStaleMs) ? Math.max(60000, configuredStaleMs) : 600000;
      if (Date.now() - this.lastRecoveryAt > Math.max(30000, staleMs / 2)) {
        this.lastRecoveryAt = Date.now();
        await this.recoverStaleRuns();
      }
      const { data: candidate, error } = await this.supabase
        .from('agent_subagent_runs')
        .select('*')
        .eq('status', 'queued')
        .lte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Could not read queued sub-agent work: ${error.message}`);
      if (!candidate) return;
      const { data: claimed, error: claimError } = await this.supabase
        .from('agent_subagent_runs')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', candidate.id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();
      if (claimError) throw new Error(`Could not claim sub-agent work: ${claimError.message}`);
      if (!claimed) return;
      const configuredHeartbeat = Number.parseInt(process.env.AGENT_EXTENSION_HEARTBEAT_MS || '15000', 10);
      const heartbeatMs = Number.isFinite(configuredHeartbeat) ? Math.max(5000, Math.min(60000, configuredHeartbeat)) : 15000;
      const heartbeat = setInterval(() => {
        void this.supabase.from('agent_subagent_runs').update({
          heartbeat_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', claimed.id).eq('status', 'running')
          .then(({ error: heartbeatError }) => {
            if (heartbeatError) console.warn('[SelfExtension] Sub-agent heartbeat update failed:', heartbeatError.message);
          });
      }, heartbeatMs);
      heartbeat.unref?.();
      try {
        await this.runSubagent(claimed);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error: any) {
      console.error('[SelfExtension] Worker cycle failed:', error.message);
    } finally {
      this.workerBusy = false;
    }
  }

  private async recoverStaleRuns(): Promise<void> {
    this.lastRecoveryAt = Date.now();
    const configuredStaleMs = Number.parseInt(process.env.AGENT_EXTENSION_STALE_RUN_MS || '600000', 10);
    const staleMs = Number.isFinite(configuredStaleMs) ? Math.max(60000, configuredStaleMs) : 600000;
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const { data: staleRuns, error } = await this.supabase
      .from('agent_subagent_runs')
      .select('id, user_id, agent_type, task_name')
      .eq('status', 'running')
      .lt('heartbeat_at', cutoff)
      .limit(100);
    if (error) {
      console.warn('[SelfExtension] Could not scan stale worker runs:', error.message);
      return;
    }
    for (const run of staleRuns || []) {
      const { data: updated } = await this.supabase.from('agent_subagent_runs').update({
        status: 'failed',
        error_message: 'The worker stopped reporting progress before this task completed.',
        termination_reason: 'Worker heartbeat expired; task marked failed during recovery.',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', run.id).eq('status', 'running').select('id').maybeSingle();
      if (!updated) continue;
      await this.audit(run.user_id, run.agent_type, 'subagent_worker_recovered', {
        task_name: run.task_name,
        stale_after_ms: staleMs,
      }, run.id);
      await this.createMilestone(run.user_id, run.id, 'work_failed', 'Adirum AI could not complete a work item', 'Your main campaign continues; the interrupted work item was recorded.');
    }
  }

  private async runSubagent(run: any): Promise<void> {
    const charge = await this.charge(run.user_id, {
      action: 'subagent_execution',
      agent_type: run.agent_type,
      subagent_run_id: run.id,
      parent_run_id: run.parent_run_id,
    });
    if (!charge.allowed) {
      await this.finishRun(run, 'failed', null, charge.reason || 'Credit policy blocked the sub-agent.');
      return;
    }
    await this.supabase.from('agent_subagent_runs').update({
      credits_charged: Number(run.credits_charged || 0) + charge.credits,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', run.id).eq('status', 'running');
    await this.audit(run.user_id, run.agent_type, 'subagent_started', {
      task_name: run.task_name,
      parent_run_id: run.parent_run_id,
      model: charge.model,
      credits_charged: charge.credits,
    }, run.id);
    await this.createMilestone(run.user_id, run.id, 'work_progress', 'Adirum AI is making progress', 'Your focused campaign work is being reviewed.');

    try {
      const subscription = await energyService.getSubscription(run.user_id);
      const tools = await this.getToolsForAgent(run.user_id, run.agent_type);
      const reports = run.parent_run_id ? await this.getChildReports(run.parent_run_id) : [];
      const prompt = `You are a temporary Adirum AI sub-agent. Complete the parent's focused task and return a concise report to the parent.

PARENT TASK:
Name: ${safeText(run.task_name, 120)}
Purpose: ${safeText(run.purpose, 1000)}
Scope: ${safeText(run.scope, 1500)}
Constraints: ${JSON.stringify(run.constraints || [])}
Completion criteria: ${safeText(run.completion_criteria, 1000)}
Task: ${safeText(run.task, 5000)}

Inherited sanitized context: ${JSON.stringify(sanitizeAgentContext(run.inherited_context || {})).slice(0, 9000)}
Available tools: ${JSON.stringify(tools.map((tool: any) => ({
        name: tool.tool_name,
        purpose: tool.purpose,
        input_schema: tool.input_schema,
        output_schema: tool.output_schema,
      }))).slice(0, 5000)}
Child reports already received: ${JSON.stringify(reports).slice(0, 4000)}

You cannot contact users/leads, publish, access credentials, access private data beyond this supplied context, or execute arbitrary code. If a tool is useful, request a call by name with JSON input. If a genuinely independent task is still needed, return a child_request; it will be checked against ancestry and resource policy before it is queued. Do not wait for child work.

Return JSON only:
{
  "report": "concise findings and what the parent should do next",
  "findings": [{"title":"...","detail":"..."}],
  "tool_calls": [{"name":"tool_name","input":{}}],
  "tool_proposal": null | {
    "name":"short tool name",
    "purpose":"reusable capability",
    "input_schema":{"type":"object","properties":{"...":{"type":"string"}}},
    "output_schema":{"type":"object","properties":{"...":{"type":"string"}}},
    "implementation":{"steps":[{"id":"step_id","operation":"normalize_text","path":"$input.field","output":"normalized"}],"output_path":"$results"},
    "test_cases":[{"input":{"field":" Example "},"expected":{"normalized":"example"}}],
    "grant_to_agent_types":[]
  },
  "child_request": null | {
    "task_name":"...",
    "purpose":"...",
    "scope":"...",
    "constraints":["..."],
    "completion_criteria":"...",
    "task":"...",
    "value_case":"..."
  }
}`;
      if (await this.wasTerminated(run.id)) return;
      const response = await this.generateForUser(run.user_id, subscription, prompt, charge.model);
      const output = parseJson(response) || {};
      const toolResults: Record<string, unknown> = {};
      const account = await energyService.getAccount(run.user_id);
      const availableToolCredits = Math.floor(
        Number(account?.balance_credits || 0) / Math.max(charge.credits, 0.01),
      );
      const seenToolCalls = new Set<string>();
      for (const call of (Array.isArray(output.tool_calls) ? output.tool_calls : []).slice(0, availableToolCredits)) {
        if (!call || !call.name) continue;
        if (await this.wasTerminated(run.id)) return;
        const callInput = sanitizeAgentContext(call.input);
        const callFingerprint = sha256({ name: normalizedName(call.name), input: callInput });
        if (seenToolCalls.has(callFingerprint)) continue;
        seenToolCalls.add(callFingerprint);
        try {
          const result = await this.runTool({
            userId: run.user_id,
            agentType: run.agent_type,
            toolName: call.name,
            input: callInput,
            subagentRunId: run.id,
          });
          toolResults[safeText(call.name, 80)] = result;
        } catch (error: any) {
          toolResults[safeText(call.name, 80)] = { error: safeText(error.message, 400) };
        }
      }
      if (await this.wasTerminated(run.id)) return;

      const result = sanitizeAgentContext({
        report: safeText(output.report || response?.text || 'The focused work is complete.', 5000),
        findings: Array.isArray(output.findings) ? output.findings.slice(0, 30) : [],
        tool_results: toolResults,
      });
      let createdTool: any = null;
      if (validToolProposal(output.tool_proposal)) {
        try {
          createdTool = await this.createTestedTool({
            userId: run.user_id,
            agentType: run.agent_type,
            proposal: output.tool_proposal,
            createdByRunId: run.id,
          });
        } catch (error: any) {
          await this.audit(run.user_id, run.agent_type, 'tool_creation_failed', {
            error: safeText(error.message, 500),
          }, run.id);
        }
      }
      await this.finishRun(run, 'completed', {
        ...(result as Record<string, unknown>),
        created_tool: createdTool?.status === 'active'
          ? { name: createdTool.tool_name, version: createdTool.version }
          : null,
      }, null);
      if (await this.wasTerminated(run.id)) return;
      await this.createMilestone(run.user_id, run.id, 'work_completed', 'Adirum AI finished focused work', 'A result is ready and can be used in your campaign.');
      this.broadcast('agent_subagent_completed', { run_id: run.id, root_run_id: run.root_run_id, user_id: run.user_id });

      if (validChildProposal(output.child_request)) {
        try {
          await this.enqueueSubagent({
            userId: run.user_id,
            agentType: run.agent_type,
            proposal: output.child_request,
            parentRunId: run.id,
            originType: 'subagent',
            originId: run.id,
            strategyId: null,
            inheritedContext: {
              parent_context: run.inherited_context || {},
              parent_result: result,
            },
          });
        } catch (error: any) {
          await this.audit(run.user_id, run.agent_type, 'subagent_child_queue_failed', {
            error: safeText(error.message, 500),
          }, run.id);
        }
      }
    } catch (error: any) {
      if (await this.wasTerminated(run.id)) return;
      await this.finishRun(run, 'failed', null, safeText(error.message, 1000));
      await this.createMilestone(run.user_id, run.id, 'work_failed', 'Adirum AI could not complete a work item', 'Your main campaign continues; the incomplete work item was recorded.');
      this.broadcast('agent_subagent_failed', { run_id: run.id, root_run_id: run.root_run_id });
    }
  }

  private async wasTerminated(runId: string): Promise<boolean> {
    const { data } = await this.supabase.from('agent_subagent_runs').select('status').eq('id', runId).maybeSingle();
    return data?.status === 'terminated';
  }

  private async finishRun(run: any, status: string, result: unknown, error: string | null): Promise<void> {
    const { data: current } = await this.supabase.from('agent_subagent_runs').select('status, credits_charged').eq('id', run.id).maybeSingle();
    if (current?.status === 'terminated') return;
    const { error: updateError } = await this.supabase.from('agent_subagent_runs').update({
      status,
      result: result ? sanitizeAgentContext(result) : null,
      error_message: error,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      credits_charged: Number(current?.credits_charged ?? run.credits_charged ?? 0),
    }).eq('id', run.id).eq('status', 'running');
    if (updateError) throw new Error(`Could not finish sub-agent work: ${updateError.message}`);
    await this.audit(run.user_id, run.agent_type, `subagent_${status}`, {
      task_name: run.task_name,
      error,
      credits_charged: Number(current?.credits_charged ?? run.credits_charged ?? 0),
    }, run.id);
  }

  async terminateRunTree(runId: string, reason = 'Terminated by administrator'): Promise<number> {
    const { data: root, error } = await this.supabase
      .from('agent_subagent_runs')
      .select('id, root_run_id, user_id, agent_type')
      .eq('id', runId)
      .maybeSingle();
    if (error || !root) throw new Error('Sub-agent run not found.');
    const ids = new Set<string>([runId]);
    let frontier = [runId];
    while (frontier.length) {
      const { data: children } = await this.supabase
        .from('agent_subagent_runs')
        .select('id')
        .in('parent_run_id', frontier)
        .in('status', ['queued', 'running']);
      frontier = (children || []).map((row: any) => row.id).filter((id: string) => !ids.has(id));
      frontier.forEach((id: string) => ids.add(id));
    }
    const { data: terminated, error: terminateError } = await this.supabase
      .from('agent_subagent_runs')
      .update({
        status: 'terminated',
        termination_reason: safeText(reason, 500),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', Array.from(ids))
      .in('status', ['queued', 'running'])
      .select('id');
    if (terminateError) throw new Error(`Could not terminate sub-agent tree: ${terminateError.message}`);
    await this.audit(root.user_id, root.agent_type, 'subagent_tree_terminated', {
      root_run_id: root.root_run_id || root.id,
      terminated_run_ids: (terminated || []).map((row: any) => row.id),
      reason: safeText(reason, 500),
    }, root.id);
    this.broadcast('agent_subagent_terminated', { run_id: runId, terminated_count: terminated?.length || 0 });
    return terminated?.length || 0;
  }

  async disableTool(toolId: string, reason = 'Disabled by administrator'): Promise<void> {
    const { data: tool, error: lookupError } = await this.supabase
      .from('agent_dynamic_tools')
      .select('id, user_id, owner_agent_type, tool_name')
      .eq('id', toolId)
      .maybeSingle();
    if (lookupError) throw new Error(`Could not load tool: ${lookupError.message}`);
    if (!tool) throw new Error('Active tool not found.');
    const { data: disabled, error } = await this.supabase
      .from('agent_dynamic_tools')
      .update({
        status: 'disabled',
        disabled_at: new Date().toISOString(),
        disabled_reason: safeText(reason, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', tool.user_id)
      .eq('owner_agent_type', tool.owner_agent_type)
      .eq('tool_name', tool.tool_name)
      .in('status', ['active', 'superseded', 'rejected'])
      .select('id');
    if (error) throw new Error(`Could not disable tool: ${error.message}`);
    await this.audit(tool.user_id, tool.owner_agent_type, 'tool_disabled', {
      tool_name: tool.tool_name,
      reason: safeText(reason, 500),
      versions_disabled: disabled?.length || 0,
    }, undefined, tool.id);
    this.broadcast('agent_dynamic_tool_disabled', { tool_id: tool.id, tool_name: tool.tool_name });
  }

  async rollbackTool(toolId: string, versionId: string): Promise<void> {
    const { data: target, error } = await this.supabase
      .from('agent_dynamic_tools')
      .select('*')
      .eq('id', versionId)
      .maybeSingle();
    if (error || !target) throw new Error('The requested tool version was not found.');
    const { data: current } = await this.supabase
      .from('agent_dynamic_tools')
      .select('id, user_id, owner_agent_type, tool_name')
      .eq('id', toolId)
      .maybeSingle();
    if (!current || current.user_id !== target.user_id || current.owner_agent_type !== target.owner_agent_type || current.tool_name !== target.tool_name) {
      throw new Error('The requested version does not belong to this tool.');
    }
    await this.supabase.from('agent_dynamic_tools').update({
      status: 'disabled',
      disabled_at: new Date().toISOString(),
      disabled_reason: `Rolled back in favor of version ${target.version}`,
      updated_at: new Date().toISOString(),
    }).eq('id', current.id);
    const { error: restoreError } = await this.supabase.from('agent_dynamic_tools').update({
      status: 'active',
      disabled_at: null,
      disabled_reason: null,
      updated_at: new Date().toISOString(),
    }).eq('id', target.id);
    if (restoreError) throw new Error(`Could not restore tool version: ${restoreError.message}`);
    await this.audit(current.user_id, current.owner_agent_type, 'tool_version_rollback', {
      tool_name: current.tool_name,
      from_tool_id: current.id,
      restored_tool_id: target.id,
      restored_version: target.version,
    }, undefined, target.id);
  }

  async getAdminSnapshot() {
    const [runs, tools, audit] = await Promise.all([
      this.supabase.from('agent_subagent_runs').select('*').order('created_at', { ascending: false }).limit(500),
      this.supabase.from('agent_dynamic_tools').select('*').order('created_at', { ascending: false }).limit(500),
      this.supabase.from('agent_extension_audit_log').select('*').order('created_at', { ascending: false }).limit(300),
    ]);
    const error = runs.error || tools.error || audit.error;
    if (error) throw new Error(`Could not load agent extension dashboard: ${error.message}`);
    return { runs: runs.data || [], tools: tools.data || [], audit: audit.data || [] };
  }
}

export const selfExtendingAgentSystem = new SelfExtendingAgentSystem();

export function requestAgentExtension(request: AgentExtensionRequest): void {
  void selfExtendingAgentSystem.consider(request).catch((error: any) => {
    console.error('[SelfExtension] Agent extension request failed:', error.message);
  });
}
