/**
 * Product Manager Agent — Capability 1
 *
 * Runs autonomously. Monitors the User's product, brand, or service.
 * - Pulls live feedback from social_conversations (already populated by SocialListeningEngine)
 * - Monitors competitors from radar_agent data and social signals
 * - AI Brain generates specific, actionable improvements
 * - Auto-implements simple text changes (descriptions, taglines, feature bullets)
 * - Sends push notification for any change requiring user awareness (e.g. price changes)
 * - NEVER asks for approval except for price changes (Capability 7 rule)
 *
 * No hardcoded templates, no fixed improvement lists.
 * AI Brain generates everything from live data.
 */

import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import { pushService } from './pushService';
import { dynamicProblemSolver } from './dynamicProblemSolver';

export class ProductManagerAgent {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async runCycle(): Promise<void> {
    console.log('[ProductManager] Running autonomous product monitoring cycle...');

    const { data: activeStrategies } = await this.supabase
      .from('strategies')
      .select('id, user_id, product_id, title, goal, platforms, current_execution_plan, estimated_outcomes, created_at')
      .eq('is_active', true)
      .eq('status', 'active')
      .not('product_id', 'is', null)
      .limit(30);

    if (!activeStrategies?.length) return;

    for (const strategy of activeStrategies) {
      try {
        const { data: product } = await this.supabase
          .from('product_memory')
          .select('*')
          .eq('product_id', strategy.product_id)
          .eq('user_id', strategy.user_id)
          .single();
        if (product) await this.analyzeAndImprove(product, strategy);
      } catch (err) {
        await dynamicProblemSolver.solve({
          error: err,
          agentType: 'PRODUCT_MANAGER',
          userId: strategy.user_id,
          operation: 'analyzeAndImprove',
          additionalContext: { productId: strategy.product_id, strategyId: strategy.id },
        });
      }
    }
  }

  private async analyzeAndImprove(product: any, strategy: any): Promise<void> {
    const userId = product.user_id;
    if (!userId) return;

    // 1. Gather live intelligence (all from existing tables)
    const [feedback, competitors, performance] = await Promise.all([
      this.getFeedback(product),
      this.getCompetitorSignals(product),
      this.getPerformanceSignals(userId, product, strategy),
    ]);

    const totalSignals = feedback.length + competitors.length + (performance.signalCount || 0);
    if (totalSignals === 0) return; // Nothing to act on yet

    // 2. AI Brain generates improvements from live data
    const analysisPrompt = `You are the AdRoom Product Manager AI. Analyze live data for this product and generate specific, actionable improvements.

PRODUCT:
Name: ${product.name}
Description: ${product.description || 'Not set'}
Category: ${product.category || 'Unknown'}
Price: ${product.price || 'Not set'} ${product.currency || ''}
Current tagline: ${product.tagline || 'None'}

LIVE FEEDBACK (${feedback.length} signals):
${feedback.map(f => `- [${f.intent}] "${(f.content || '').slice(0, 150)}" (sentiment: ${f.sentiment})`).join('\n').slice(0, 2000)}

COMPETITOR SIGNALS (${competitors.length}):
${competitors.map(c => `- ${(c.content || '').slice(0, 100)}`).join('\n').slice(0, 1000)}

ACTIVE STRATEGY PROGRESS:
${JSON.stringify({
  strategyId: strategy.id,
  title: strategy.title,
  goal: strategy.goal,
  platforms: strategy.platforms,
  currentExecutionPlan: strategy.current_execution_plan || {},
  expectedOutcomes: strategy.estimated_outcomes || {},
}).slice(0, 1500)}

PERFORMANCE:
${JSON.stringify(performance).slice(0, 500)}

Based on this LIVE data only (not assumptions), generate improvements that would increase conversion, engagement, or reach.

Return JSON:
{
  "improvements": [
    {
      "type": "description_update | tagline_update | feature_bullet | price_suggestion | positioning_shift | physical_refinement | brand_asset_refinement | service_process_refinement",
      "current": "what it is now (or null)",
      "suggested": "the exact new text or value",
      "rationale": "specific reason from the live data above",
      "requiresApproval": true | false,
      "approvalReason": "why approval needed (only for price changes)",
      "autoImplement": true | false
      ,"requiresUserAction": true | false
      ,"userAction": { "title": "what the user must do", "instructions": "where and when to do it", "submissionType": "text|image|video|document" }
    }
  ],
  "summary": "one-sentence summary of what the AI found and is doing about it"
}

RULES:
- Only suggest improvements backed by the live data above
- description_update, tagline_update, feature_bullet, positioning_shift: autoImplement=true, requiresApproval=false, requiresUserAction=false
- price_suggestion: autoImplement=false, requiresApproval=true always
- physical_refinement, brand_asset_refinement, service_process_refinement: autoImplement=false, requiresUserAction=true; use these only when physical user action or a new asset/process input is genuinely required
- Limit to 3 highest-impact improvements max
- If no meaningful improvements found, return { "improvements": [], "summary": "Product is performing well" }`;

    const res = await this.ai.generateStrategyEconomy({}, analysisPrompt);
    const analysis = res.parsedJson;

    if (!analysis?.improvements?.length) return;

    for (const improvement of analysis.improvements) {
      if (improvement.requiresApproval) {
        // Only price changes require approval — send notification with approve button
        await this.requestPriceApproval(userId, product, improvement, strategy);
      } else if (improvement.requiresUserAction) {
        await this.requestUserRefinement(userId, product, strategy, improvement);
      } else if (improvement.autoImplement) {
        // Auto-implement text changes immediately
        await this.autoImplement(userId, product, strategy, improvement, analysis.summary);
      }
    }
  }

  /**
   * Auto-implement text improvements without asking the user.
   * Logs what was changed so the user can see in the admin/campaign view.
   */
  private async autoImplement(userId: string, product: any, strategy: any, improvement: any, summary: string): Promise<void> {
    const updates: Record<string, any> = {};

    if (improvement.type === 'description_update' && improvement.suggested) {
      updates.description = improvement.suggested;
    } else if (improvement.type === 'tagline_update' && improvement.suggested) {
      updates.tagline = improvement.suggested;
    } else if (improvement.type === 'feature_bullet' && improvement.suggested) {
      const current = product.feature_bullets || [];
      if (Array.isArray(current) && !current.includes(improvement.suggested)) {
        updates.feature_bullets = [...current, improvement.suggested].slice(0, 10);
      }
    } else if (improvement.type === 'positioning_shift' && improvement.suggested) {
      updates.positioning = improvement.suggested;
    }

    if (!Object.keys(updates).length) return;

    await this.supabase
      .from('product_memory')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', product.id);

    const appliedAt = new Date().toISOString();
    const executionPlan = strategy.current_execution_plan || {};
    const refinements = Array.isArray(executionPlan.product_manager_refinements)
      ? executionPlan.product_manager_refinements
      : [];
    await this.supabase.from('strategies').update({
      current_execution_plan: {
        ...executionPlan,
        product_manager_refinements: [...refinements, {
          type: improvement.type,
          updates,
          rationale: improvement.rationale,
          applied_at: appliedAt,
          source: 'product_manager',
        }].slice(-20),
        refinement_updated_at: appliedAt,
      },
      updated_at: appliedAt,
    }).eq('id', strategy.id).eq('user_id', userId);

    // Log the change as an agent task completion for visibility
    await this.supabase.from('agent_tasks').insert({
      user_id: userId,
      strategy_id: strategy.id,
      agent_type: 'PRODUCT_MANAGER',
      task_type: 'PRODUCT_UPDATE',
      platform: 'internal',
      status: 'done',
      scheduled_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      content: { body: `Product Manager AI updated ${improvement.type}: ${improvement.rationale}` },
      result: { updated: updates, rationale: improvement.rationale, summary },
    });

    console.log(`[ProductManager] Auto-implemented ${improvement.type} for product ${product.id}`);

    // Notify user about the auto-change
    const notifPrompt = `Adirum AI just improved your product "${product.name}". 
Change: ${improvement.type.replace(/_/g, ' ')}
Reason: ${improvement.rationale}

Write a SHORT push notification (max 2 sentences, plain language, no technical terms) telling the user what was improved and why. Sound confident, not apologetic.
Return JSON: { "title": "max 6 words", "body": "max 2 sentences" }`;

    try {
      const nr = await this.ai.generateStrategyEconomy({}, notifPrompt);
      const n = nr.parsedJson;
      if (n?.title && n?.body) {
        await pushService.send(userId, {
          title: n.title,
          body: n.body,
          data: { type: 'product_improvement', productId: product.id, changeType: improvement.type },
        });
      }
    } catch { /* notification failure doesn't block the update */ }
  }

  /**
   * Request user approval for price changes.
   * Sends push notification with approval context.
   * Creates a pending approval record in agent_interventions.
   */
  private async requestPriceApproval(userId: string, product: any, improvement: any, strategy: any): Promise<void> {
    // Check if we already have a pending approval for this product
    const { data: existing } = await this.supabase
      .from('agent_interventions')
      .select('id, context')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('intervention_type', 'price_approval')
      .contains('context', { strategy_id: strategy.id })
      .contains('context', { product_id: product.id })
      .limit(1);

    if (existing?.length) return; // Already waiting for approval

    // AI Brain writes the notification dynamically
    const notifPrompt = `Adirum AI wants to suggest a price change for "${product.name}".
Current price: ${product.price || 'not set'} ${product.currency || ''}
Suggested: ${improvement.suggested}
Reason from live market data: ${improvement.rationale}

Write a SHORT push notification asking the user to approve this price change. Plain language. Explain the benefit clearly.
Return JSON: { "title": "max 6 words", "body": "max 2 sentences including the suggested new price" }`;

    try {
      const nr = await this.ai.generateStrategyEconomy({}, notifPrompt);
      const n = nr.parsedJson;

      // Create approval record
      await this.supabase.from('agent_interventions').insert({
        user_id: userId,
        strategy_id: strategy.id,
        agent_type: 'PRODUCT_MANAGER',
        intervention_type: 'price_approval',
        status: 'pending',
        context: {
          product_id: product.id,
          strategy_id: strategy.id,
          product_name: product.name,
          current_price: product.price,
          suggested_price: improvement.suggested,
          rationale: improvement.rationale,
          currency: product.currency,
        },
        created_at: new Date().toISOString(),
      });

      if (n?.title && n?.body) {
        await pushService.send(userId, {
          title: n.title,
          body: n.body,
          data: { type: 'price_approval_required', productId: product.id, strategyId: strategy.id, actionScreen: 'Notifications' },
        });
      }
    } catch (err) {
      await dynamicProblemSolver.solve({ error: err, agentType: 'PRODUCT_MANAGER', userId, operation: 'requestPriceApproval' });
    }
  }

  private async requestUserRefinement(userId: string, product: any, strategy: any, improvement: any): Promise<void> {
    const { data: existing } = await this.supabase
      .from('agent_interventions')
      .select('id, context')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('intervention_type', 'product_refinement_required')
      .contains('context', { strategy_id: strategy.id, type: improvement.type });
    if (existing?.length) {
      const pending = existing[0];
      const lastReminder = pending.context?.last_reminded_at ? new Date(pending.context.last_reminded_at).getTime() : 0;
      if (Date.now() - lastReminder < 24 * 60 * 60 * 1000) return;
      const remindedAt = new Date().toISOString();
      await this.supabase.from('agent_interventions').update({
        context: { ...(pending.context || {}), last_reminded_at: remindedAt },
      }).eq('id', pending.id);
      await pushService.send(userId, {
        title: improvement.userAction?.title || 'Refinement still needed',
        body: `${improvement.userAction?.instructions || improvement.rationale} Open Agent Chat to submit it.`,
        data: { type: 'product_refinement_required', interventionId: pending.id, strategyId: strategy.id, actionScreen: 'AgentChat' },
        channelId: 'alerts',
      });
      return;
    }

    const context = {
      strategy_id: strategy.id,
      product_id: product.id,
      product_name: product.name || product.product_name,
      type: improvement.type,
      title: improvement.userAction?.title || 'Product refinement required',
      instructions: improvement.userAction?.instructions || improvement.rationale,
      submission_type: improvement.userAction?.submissionType || 'text',
      rationale: improvement.rationale,
      created_at: new Date().toISOString(),
    };
    const { data: intervention, error } = await this.supabase
      .from('agent_interventions')
      .insert({ user_id: userId, strategy_id: strategy.id, agent_type: 'PRODUCT_MANAGER', intervention_type: 'product_refinement_required', status: 'pending', context })
      .select('id')
      .single();
    if (error || !intervention) throw error || new Error('Could not create product refinement task.');

    const now = new Date().toISOString();
    await this.supabase.from('chat_history').insert({
      user_id: userId,
      sender: 'agent',
      message: context.instructions,
      ui_type: 'product_refinement_task',
      ui_data: { interventionId: intervention.id, ...context },
      created_at: now,
    });
    await pushService.send(userId, {
      title: context.title,
      body: `${context.instructions} Open Agent Chat to submit the required update.`,
      data: { type: 'product_refinement_required', interventionId: intervention.id, strategyId: strategy.id, actionScreen: 'AgentChat' },
      channelId: 'alerts',
    });
  }

  // ── Data fetchers ──────────────────────────────────────────────────────────

  private async getFeedback(product: any): Promise<any[]> {
    const { data } = await this.supabase
      .from('social_conversations')
      .select('content, sentiment, intent, topics')
      .eq('category', product.category || 'general')
      .order('collected_at', { ascending: false })
      .limit(20);
    return data || [];
  }

  private async getCompetitorSignals(product: any): Promise<any[]> {
    const { data } = await this.supabase
      .from('social_conversations')
      .select('content, sentiment')
      .ilike('content', `%competitor%`)
      .order('collected_at', { ascending: false })
      .limit(10);
    return data || [];
  }

  private async getPerformanceSignals(userId: string, product: any, strategy: any): Promise<any> {
    const [{ data }, { data: tasks }] = await Promise.all([
      this.supabase
      .from('agent_performance')
      .select('platform, reach, likes, comments, shares, fetched_at')
      .eq('user_id', userId)
      .eq('strategy_id', strategy.id)
      .order('fetched_at', { ascending: false })
      .limit(10),
      this.supabase
        .from('agent_tasks')
        .select('status')
        .eq('strategy_id', strategy.id)
        .gte('created_at', strategy.created_at || new Date(0).toISOString()),
    ]);

    const completedTasks = (tasks || []).filter((task: any) => ['done', 'completed'].includes(task.status)).length;
    const totalTasks = (tasks || []).length;
    const taskProgress = {
      completed: completedTasks,
      total: totalTasks,
      completionRate: totalTasks ? completedTasks / totalTasks : 0,
    };
    if (!data?.length) return {
      reach: 0,
      engagement: 0,
      trend: 'insufficient_data',
      signalCount: 0,
      taskProgress,
      progressStatus: totalTasks > 0 && completedTasks === 0 ? 'behind' : 'insufficient_data',
    };

    const totalReach = data.reduce((s: number, r: any) => s + (r.reach || 0), 0);
    const totalEng = data.reduce((s: number, r: any) => s + (r.likes || 0) + (r.comments || 0) + (r.shares || 0), 0);

    return {
      reach: totalReach,
      engagement: totalEng,
      engagementRate: totalReach > 0 ? ((totalEng / totalReach) * 100).toFixed(2) + '%' : '0%',
      platformCount: [...new Set(data.map((r: any) => r.platform))].length,
      signalCount: data.length,
      taskProgress,
      progressStatus: totalReach === 0 && completedTasks > 0 ? 'behind' : 'measured',
    };
  }

  async applyUserRefinement(userId: string, intervention: any, submission: { submission: string; assetUri?: string | null; submittedAt: string }): Promise<void> {
    const context = intervention.context || {};
    const { data: product } = await this.supabase
      .from('product_memory')
      .select('*')
      .eq('product_id', context.product_id)
      .eq('user_id', userId)
      .single();
    if (!product) throw new Error('The product connected to this refinement was not found.');

    const prompt = `You are updating a real product, brand, or service after its owner submitted a required refinement.

CURRENT INFORMATION:
${JSON.stringify({ name: product.name || product.product_name, description: product.description, tagline: product.tagline, category: product.category, positioning: product.positioning }).slice(0, 3000)}

REQUIRED REFINEMENT:
${JSON.stringify(context)}

OWNER SUBMISSION:
${JSON.stringify(submission)}

Return JSON with only the fields that should change. Do not invent facts. Use null for no change:
{
  "description": "string or null",
  "tagline": "string or null",
  "positioning": "string or null",
  "refinement_note": "short factual note"
}`;
    const result = await this.ai.generateStrategyEconomy({}, prompt);
    const proposed = result.parsedJson || {};
    const updates: Record<string, any> = { updated_at: submission.submittedAt };
    for (const field of ['description', 'tagline', 'positioning']) {
      if (typeof proposed[field] === 'string' && proposed[field].trim()) updates[field] = proposed[field].trim();
    }
    if (submission.assetUri) updates.latest_refinement_asset_uri = submission.assetUri;
    if (proposed.refinement_note) updates.latest_refinement_note = String(proposed.refinement_note).slice(0, 1000);
    await this.supabase.from('product_memory').update(updates).eq('product_id', context.product_id).eq('user_id', userId);

    const { data: strategy } = await this.supabase.from('strategies').select('current_execution_plan').eq('id', context.strategy_id).eq('user_id', userId).single();
    const plan = strategy?.current_execution_plan || {};
    await this.supabase.from('strategies').update({
      current_execution_plan: { ...plan, product_refinement_status: 'applied', product_refinement_applied_at: submission.submittedAt, product_refinement_note: proposed.refinement_note || context.rationale },
      updated_at: submission.submittedAt,
    }).eq('id', context.strategy_id).eq('user_id', userId);
  }
}

export const productManagerAgent = new ProductManagerAgent();
