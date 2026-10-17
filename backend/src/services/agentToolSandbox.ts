export interface DeclarativeToolStep {
  id: string;
  operation: string;
  path?: string;
  fields?: string[];
  values?: string[];
  separator?: string;
  tool_name?: string;
  input_path?: string;
  output?: string;
}

export interface DeclarativeToolImplementation {
  steps: DeclarativeToolStep[];
  output_path?: string;
}

export interface ToolInvocationOptions {
  invokeTool?: (toolName: string, input: unknown, stack: string[]) => Promise<unknown>;
  stack?: string[];
}

const SAFE_OPERATIONS = new Set([
  'pick_fields',
  'normalize_text',
  'count',
  'sum',
  'average',
  'unique',
  'join',
  'filter_non_empty',
  'call_tool',
]);

const SENSITIVE_KEY = /(token|api.?key|password|secret|credential|cookie|authorization|private.?key|session.?id|user.?id|lead.?id|recipient.?id)/i;
const SENSITIVE_TEXT = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\+?\d[\d\s().-]{7,}\d/g,
];

export function redactAgentText(value: string): string {
  return SENSITIVE_TEXT.reduce((text, pattern) => text.replace(pattern, '[redacted]'), value).slice(0, 5000);
}

export function sanitizeAgentContext(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (depth > 7) return '[context depth limited]';
  if (typeof value === 'string') return redactAgentText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeAgentContext(item, '', depth + 1));
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 80);
    return Object.fromEntries(entries.map(([childKey, childValue]) => [
      childKey,
      sanitizeAgentContext(childValue, childKey, depth + 1),
    ]));
  }
  return String(value).slice(0, 500);
}

function getPath(root: any, path = '$input'): any {
  const normalized = String(path || '$input')
    .replace(/^\$\.?/, '')
    .replace(/^(input|results)(?=\.|$)/, '$1');
  if (!normalized || normalized === 'input') return root.input;
  if (normalized === 'results') return root.results;
  const [base, ...segments] = normalized.split('.');
  let value = base === 'results' ? root.results : base === 'input' ? root.input : undefined;
  for (const segment of segments) {
    if (value == null) return undefined;
    const match = segment.match(/^([^[]+)|\[(\d+)\]$/);
    const key = match?.[1] ?? match?.[2];
    value = key == null ? undefined : value[key];
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const sorted = Object.keys(value as Record<string, unknown>).sort();
    return `{${sorted.map((key) => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function validateToolSchema(schema: any, value: any): { valid: boolean; error?: string } {
  if (!schema || schema.type !== 'object' || !schema.properties || typeof schema.properties !== 'object') {
    return { valid: false, error: 'Tool schemas must declare an object type and properties.' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: 'Tool input must be an object.' };
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (!(key in value)) return { valid: false, error: `Missing required input: ${key}` };
  }
  for (const [key, expected] of Object.entries(schema.properties as Record<string, any>)) {
    if (!(key in value) || value[key] == null) continue;
    const actual = Array.isArray(value[key]) ? 'array' : typeof value[key];
    if (expected?.type && actual !== expected.type) {
      return { valid: false, error: `Input "${key}" must be ${expected.type}.` };
    }
  }
  return { valid: true };
}

export function validateToolImplementation(implementation: any): { valid: boolean; error?: string } {
  if (!implementation || !Array.isArray(implementation.steps) || implementation.steps.length === 0) {
    return { valid: false, error: 'A tool needs at least one declarative step.' };
  }
  if (implementation.steps.length > 40) {
    return { valid: false, error: 'The implementation contains too many steps.' };
  }
  const ids = new Set<string>();
  for (const step of implementation.steps) {
    if (!step || typeof step.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/.test(step.id)) {
      return { valid: false, error: 'Every tool step needs a valid unique id.' };
    }
    if (ids.has(step.id)) return { valid: false, error: `Duplicate step id: ${step.id}` };
    ids.add(step.id);
    if (!SAFE_OPERATIONS.has(step.operation)) {
      return { valid: false, error: `Unsupported operation: ${String(step.operation || '')}` };
    }
    if (step.operation === 'call_tool' && !/^[a-zA-Z0-9_ -]{1,80}$/.test(String(step.tool_name || ''))) {
      return { valid: false, error: `Step ${step.id} needs a valid tool_name.` };
    }
    if (step.operation === 'pick_fields' && (!Array.isArray(step.fields) || step.fields.some((field: unknown) => typeof field !== 'string'))) {
      return { valid: false, error: `Step ${step.id} needs a fields list.` };
    }
    if (step.operation === 'join' && (!Array.isArray(step.values) || step.values.some((field: unknown) => typeof field !== 'string'))) {
      return { valid: false, error: `Step ${step.id} needs a values list.` };
    }
  }
  return { valid: true };
}

/**
 * Runs a JSON-only tool recipe. There is no eval, filesystem, process, network,
 * credential, or environment-variable access in this interpreter.
 */
export async function runDeclarativeTool(
  input: unknown,
  implementation: DeclarativeToolImplementation,
  options: ToolInvocationOptions = {},
): Promise<unknown> {
  const validation = validateToolImplementation(implementation);
  if (!validation.valid) throw new Error(validation.error);

  const stack = options.stack || [];
  const root = { input, results: {} as Record<string, unknown> };

  for (const step of implementation.steps) {
    const source = getPath(root, step.path || '$input');
    let result: unknown;
    switch (step.operation) {
      case 'pick_fields': {
        const fields = step.fields || [];
        result = Object.fromEntries(fields.map((field) => [field, source?.[field]]));
        break;
      }
      case 'normalize_text':
        result = String(source ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
        break;
      case 'count':
        result = Array.isArray(source) || typeof source === 'string'
          ? source.length
          : source && typeof source === 'object' ? Object.keys(source).length : 0;
        break;
      case 'sum':
      case 'average': {
        if (!Array.isArray(source)) throw new Error(`Step ${step.id} expects an array.`);
        const numbers = source.map(Number);
        if (numbers.some((number) => !Number.isFinite(number))) throw new Error(`Step ${step.id} contains a non-numeric value.`);
        const total = numbers.reduce((sum, number) => sum + number, 0);
        result = step.operation === 'sum' ? total : numbers.length ? total / numbers.length : 0;
        break;
      }
      case 'unique':
        if (!Array.isArray(source)) throw new Error(`Step ${step.id} expects an array.`);
        result = Array.from(new Map(source.map((item) => [stableJson(item), item])).values());
        break;
      case 'join': {
        const values = (step.values || []).map((path) => getPath(root, path));
        result = values.filter((value) => value != null).map(String).join(step.separator ?? ' ');
        break;
      }
      case 'filter_non_empty':
        if (!Array.isArray(source)) throw new Error(`Step ${step.id} expects an array.`);
        result = source.filter((item) => item != null && String(item).trim() !== '');
        break;
      case 'call_tool': {
        if (!options.invokeTool) throw new Error(`Tool composition is unavailable for ${step.tool_name}.`);
        const nestedInput = step.input_path ? getPath(root, step.input_path) : root.input;
        result = await options.invokeTool(String(step.tool_name), nestedInput, [...stack, String(step.tool_name)]);
        break;
      }
      default:
        throw new Error(`Unsupported operation: ${step.operation}`);
    }
    root.results[step.output || step.id] = result;
  }

  return implementation.output_path ? getPath(root, implementation.output_path) : root.results;
}

export function toolTestMatches(actual: unknown, expected: unknown): boolean {
  return stableJson(actual) === stableJson(expected);
}
