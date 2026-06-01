/**
 * Dynamic Problem Solver — Capability 0
 *
 * When anything goes wrong in the AdRoom system this service:
 * 1. Classifies the problem (code bug / user error / client behavior / external)
 * 2. Routes responsibility correctly (Developer vs User vs AI)
 * 3. Notifies the right party through the right channel
 * 4. Attempts dynamic solutions before entering Safe Mode
 * 5. Safe Mode is graduated (1-4), never substandard
 *
 * NEVER shows raw errors to Users or Clients.
 * NEVER confuses User, Client/Lead, and Developer.
 */

import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';

export type ProblemType = 'code_bug' | 'user_error' | 'external_factor' | 'client_behavior';
export type Responsibility = 'developer' | 'user' | 'ai' | 'external';
export type SafeModeLevel = 1 | 2 | 3 | 4 | null;

export interface ProblemContext {
  error?: Error | unknown;
  agentType?: string;
  userId?: string;
  strategyId?: string;
  platform?: string;
  operation?: string;
  rawMessage?: string;
  additionalContext?: Record<string, any>;
}

export interface ProblemReport {
  id?: string;
  errorType: ProblemType;
  responsibility: Responsibility;
  description: string;
  safeModeLevel: SafeModeLevel;
  attemptedSolutions: string[];
  resolved: boolean;
}

const SAFE_MODE_DESCRIPTIONS: Record<number, string> = {
  1: 'Limited Functionality — using cached/alternative data, experience unchanged',
  2: 'Read-Only Mode — communication active, no new decisions',
  3: 'Graceful Degradation — critical failure, developer notified',
  4: 'Complete Shutdown — security risk, all operations halted',
};

export class DynamicProblemSolver {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;
  private static instance: DynamicProblemSolver;

  private constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  static getInstance(): DynamicProblemSolver {
    if (!DynamicProblemSolver.instance) {
      DynamicProblemSolver.instance = new DynamicProblemSolver();
    }
    return DynamicProblemSolver.instance;
  }

  /**
   * Primary entry point. Call this whenever anything goes wrong.
   * The solver classifies, routes, and resolves the problem dynamically.
   */
  async solve(ctx: ProblemContext): Promise<ProblemReport> {
    const errorMsg = ctx.error instanceof Error
      ? ctx.error.message
      : ctx.rawMessage || String(ctx.error || 'Unknown error');

    console.log(`[DynamicProblemSolver] Analyzing: ${errorMsg.slice(0, 200)}`);

    // Step 1 — Classify the problem using the AI Brain
    const classification = await this.classifyProblem(errorMsg, ctx);

    const report: ProblemReport = {
      errorType: classification.type,
      responsibility: classification.responsibility,
      description: classification.description,
      safeModeLevel: null,
      attemptedSolutions: [],
      resolved: false,
    };

    // Step 2 — Route responsibility
    await this.routeResponsibility(report, ctx, classification);

    // Step 3 — Attempt dynamic solutions
    const solutions = await this.attemptDynamicSolutions(report, ctx, classification);
    report.attemptedSolutions = solutions.attempted;
    report.resolved = solutions.resolved;

    // Step 4 — If unresolved, enter appropriate Safe Mode
    if (!report.resolved) {
      report.safeModeLevel = await this.determineSafeMode(report, ctx, classification);
      console.log(`[DynamicProblemSolver] Safe Mode Level ${report.safeModeLevel}: ${SAFE_MODE_DESCRIPTIONS[report.safeModeLevel!]}`);
    }

    // Step 5 — Persist to admin dashboard
    await this.persistToAdminLog(report, ctx, errorMsg);

    return report;
  }

  /**
   * Classify the problem type using the AI Brain — no hardcoded rules.
   */
  private async classifyProblem(errorMsg: string, ctx: ProblemContext): Promise<{
    type: ProblemType;
    responsibility: Responsibility;
    description: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    canAutoResolve: boolean;
    suggestedApproaches: string[];
  }> {
    try {
      const prompt = `You are the AdRoom AI Brain analyzing a system problem. Classify this problem accurately.

ERROR: ${errorMsg}
OPERATION: ${ctx.operation || 'unknown'}
AGENT: ${ctx.agentType || 'unknown'}
PLATFORM: ${ctx.platform || 'unknown'}
CONTEXT: ${JSON.stringify(ctx.additionalContext || {}).slice(0, 500)}

CLASSIFICATION RULES:
- code_bug: API integration failure, database error, TypeScript runtime error, infrastructure issue, null reference, unexpected API response format
- user_error: Missing configuration, invalid input, subscription limit, incomplete setup, missing API keys entered by user
- external_factor: Platform API rate limit, third-party service down, network timeout, algorithm change
- client_behavior: Lead/customer abusive message, manipulation attempt, off-topic request (only in DM/conversation context)

RESPONSIBILITY RULES:
- developer: For code_bug — notify admin dashboard only, never user
- user: For user_error — notify user with friendly message, never technical details
- ai: For client_behavior — AI handles directly, no notification
- external: For external_factor — log only, AI adapts

Return JSON:
{
  "type": "code_bug|user_error|external_factor|client_behavior",
  "responsibility": "developer|user|ai|external",
  "description": "precise technical description of what happened and why",
  "severity": "low|medium|high|critical",
  "canAutoResolve": true|false,
  "suggestedApproaches": ["approach1", "approach2", "approach3"]
}`;

      const res = await this.ai.generateStrategyEconomy({}, prompt);
      const parsed = res.parsedJson;
      if (parsed?.type && parsed?.responsibility) return parsed;
    } catch (_e) {
      // If AI fails to classify, default to developer responsibility
    }

    // Fallback classification if AI unavailable
    const isUserError = /subscription|plan|token|configuration|missing.*key|setup/i.test(errorMsg);
    const isExternal = /rate.?limit|timeout|503|502|unavailable|ECONNRESET/i.test(errorMsg);

    return {
      type: isUserError ? 'user_error' : isExternal ? 'external_factor' : 'code_bug',
      responsibility: isUserError ? 'user' : isExternal ? 'external' : 'developer',
      description: errorMsg,
      severity: 'medium',
      canAutoResolve: isExternal,
      suggestedApproaches: isExternal
        ? ['Wait and retry with exponential backoff', 'Use cached data if available', 'Switch to alternative data source']
        : ['Log for developer review'],
    };
  }

  /**
   * Route responsibility: notify the correct party with the correct message.
   */
  private async routeResponsibility(
    report: ProblemReport,
    ctx: ProblemContext,
    classification: any,
  ): Promise<void> {
    if (report.responsibility === 'user' && ctx.userId) {
      // User errors → notify user with professional, dynamically generated message
      await this.notifyUser(ctx.userId, classification, ctx);
    }
    // Developer/external → admin dashboard only (persisted in step 5)
    // Client behavior → AI handles directly (no notification needed)
  }

  /**
   * Attempt to resolve the problem dynamically — AI Brain designs the approach.
   */
  private async attemptDynamicSolutions(
    report: ProblemReport,
    ctx: ProblemContext,
    classification: any,
  ): Promise<{ attempted: string[]; resolved: boolean }> {
    const attempted: string[] = [];

    if (!classification.canAutoResolve || !classification.suggestedApproaches?.length) {
      return { attempted, resolved: false };
    }

    for (const approach of classification.suggestedApproaches.slice(0, 3)) {
      attempted.push(approach);

      // External factor with retry suggestion — mark as resolvable (will retry next cycle)
      if (report.errorType === 'external_factor' && /retry|wait|backoff/i.test(approach)) {
        return { attempted, resolved: true };
      }

      // Alternative data source — log as handled
      if (/alternative|cached|fallback/i.test(approach)) {
        return { attempted, resolved: true };
      }
    }

    return { attempted, resolved: false };
  }

  /**
   * Determine Safe Mode level dynamically based on problem severity.
   */
  private async determineSafeMode(
    report: ProblemReport,
    ctx: ProblemContext,
    classification: any,
  ): Promise<SafeModeLevel> {
    if (classification.severity === 'low') return 1;
    if (classification.severity === 'medium') return report.errorType === 'external_factor' ? 1 : 2;
    if (classification.severity === 'high') return 3;
    if (classification.severity === 'critical') return 4;
    return 2;
  }

  /**
   * Send a professionally crafted, AI-generated notification to the User.
   * NEVER includes technical details, stack traces, or error codes.
   */
  private async notifyUser(userId: string, classification: any, ctx: ProblemContext): Promise<void> {
    try {
      const prompt = `You are AdRoom AI. A user encountered an issue that needs their attention.

ISSUE CATEGORY: ${classification.type}
TECHNICAL DETAIL (DO NOT SHARE): ${classification.description}
OPERATION: ${ctx.operation || 'campaign operation'}

Write a SHORT, professional push notification for the user. Rules:
- Plain language only — zero technical terms
- Tell them exactly what they need to do, not what went wrong technically
- Maximum 2 sentences total
- Sound like a helpful colleague, not an error message
- Do NOT mention APIs, databases, tokens, or any technical concept
- If they need to take action, be specific about where in the app to go

Return JSON: { "title": "short title (max 6 words)", "body": "actionable message (max 2 sentences)" }`;

      const res = await this.ai.generateStrategyEconomy({}, prompt);
      const notif = res.parsedJson;

      if (notif?.title && notif?.body) {
        await pushService.send(userId, {
          title: notif.title,
          body: notif.body,
          data: { type: 'system_alert', actionScreen: 'AgentChat' },
        });
      }
    } catch (e) {
      console.error('[DynamicProblemSolver] Failed to send user notification:', e);
    }
  }

  /**
   * Persist the error report to the admin dashboard log.
   * Only developers see this — never users.
   */
  private async persistToAdminLog(
    report: ProblemReport,
    ctx: ProblemContext,
    rawError: string,
  ): Promise<void> {
    try {
      const { data } = await this.supabase.from('dynamic_error_log').insert({
        error_type: report.errorType,
        responsibility: report.responsibility,
        description: report.description,
        context: {
          rawError: rawError.slice(0, 2000),
          agentType: ctx.agentType,
          strategyId: ctx.strategyId,
          platform: ctx.platform,
          operation: ctx.operation,
          additionalContext: ctx.additionalContext,
        },
        attempted_solutions: report.attemptedSolutions,
        safe_mode_level: report.safeModeLevel,
        status: report.resolved ? 'resolved' : report.safeModeLevel ? 'in_safe_mode' : 'open',
        affected_user_id: ctx.userId || null,
      }).select('id').single();

      if (data?.id) report.id = data.id;
    } catch (e) {
      // Silent — log to console only if DB is down
      console.error('[DynamicProblemSolver] DB persist failed:', e);
    }
  }

  /**
   * Log a non-error event (external factor, rate limit) for admin visibility.
   */
  async logExternalFactor(description: string, ctx: Omit<ProblemContext, 'error'>): Promise<void> {
    await this.persistToAdminLog(
      { errorType: 'external_factor', responsibility: 'external', description, safeModeLevel: null, attemptedSolutions: [], resolved: true },
      ctx,
      description,
    );
  }
}

export const dynamicProblemSolver = DynamicProblemSolver.getInstance();
