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

    const { data: products } = await this.supabase
      .from('product_memory')
      .select('*')
      .limit(30);

    if (!products?.length) return;

    for (const product of products) {
      try {
        await this.analyzeAndImprove(product);
      } catch (err) {
        await dynamicProblemSolver.solve({
          error: err,
          agentType: 'PRODUCT_MANAGER',
          userId: product.user_id,
          operation: 'analyzeAndImprove',
          additionalContext: { productId: product.id },
        });
      }
    }
  }

  private async analyzeAndImprove(product: any): Promise<void> {
    const userId = product.user_id;
    if (!userId) return;

    // 1. Gather live intelligence (all from existing tables)
    const [feedback, competitors, performance] = await Promise.all([
      this.getFeedback(product),
      this.getCompetitorSignals(product),
      this.getPerformanceSignals(userId, product),
    ]);

    const totalSignals = feedback.length + competitors.length;
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

PERFORMANCE:
${JSON.stringify(performance).slice(0, 500)}

Based on this LIVE data only (not assumptions), generate improvements that would increase conversion, engagement, or reach.

Return JSON:
{
  "improvements": [
    {
      "type": "description_update | tagline_update | feature_bullet | price_suggestion | positioning_shift",
      "current": "what it is now (or null)",
      "suggested": "the exact new text or value",
      "rationale": "specific reason from the live data above",
      "requiresApproval": true | false,
      "approvalReason": "why approval needed (only for price changes)",
      "autoImplement": true | false
    }
  ],
  "summary": "one-sentence summary of what the AI found and is doing about it"
}

RULES:
- Only suggest improvements backed by the live data above
- description_update, tagline_update, feature_bullet: autoImplement=true, requiresApproval=false
- price_suggestion: autoImplement=false, requiresApproval=true always
- Limit to 3 highest-impact improvements max
- If no meaningful improvements found, return { "improvements": [], "summary": "Product is performing well" }`;

    const res = await this.ai.generateStrategyEconomy({}, analysisPrompt);
    const analysis = res.parsedJson;

    if (!analysis?.improvements?.length) return;

    for (const improvement of analysis.improvements) {
      if (improvement.requiresApproval) {
        // Only price changes require approval — send notification with approve button
        await this.requestPriceApproval(userId, product, improvement);
      } else if (improvement.autoImplement) {
        // Auto-implement text changes immediately
        await this.autoImplement(userId, product, improvement, analysis.summary);
      }
    }
  }

  /**
   * Auto-implement text improvements without asking the user.
   * Logs what was changed so the user can see in the admin/campaign view.
   */
  private async autoImplement(userId: string, product: any, improvement: any, summary: string): Promise<void> {
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

    // Log the change as an agent task completion for visibility
    await this.supabase.from('agent_tasks').insert({
      user_id: userId,
      agent_type: 'SALESMAN',
      task_type: 'PRODUCT_UPDATE',
      platform: 'internal',
      status: 'completed',
      scheduled_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      content: { body: `Product Manager AI updated ${improvement.type}: ${improvement.rationale}` },
      result: { updated: updates, rationale: improvement.rationale, summary },
    });

    console.log(`[ProductManager] Auto-implemented ${improvement.type} for product ${product.id}`);

    // Notify user about the auto-change
    const notifPrompt = `AdRoom AI just improved your product "${product.name}". 
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
  private async requestPriceApproval(userId: string, product: any, improvement: any): Promise<void> {
    // Check if we already have a pending approval for this product
    const { data: existing } = await this.supabase
      .from('agent_interventions')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('intervention_type', 'price_approval')
      .contains('context', { product_id: product.id })
      .limit(1);

    if (existing?.length) return; // Already waiting for approval

    // AI Brain writes the notification dynamically
    const notifPrompt = `AdRoom AI wants to suggest a price change for "${product.name}".
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
        intervention_type: 'price_approval',
        status: 'pending',
        context: {
          product_id: product.id,
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
          data: { type: 'price_approval_required', productId: product.id, actionScreen: 'Notifications' },
        });
      }
    } catch (err) {
      await dynamicProblemSolver.solve({ error: err, agentType: 'PRODUCT_MANAGER', userId, operation: 'requestPriceApproval' });
    }
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

  private async getPerformanceSignals(userId: string, product: any): Promise<any> {
    const { data } = await this.supabase
      .from('agent_performance')
      .select('platform, reach, likes, comments, shares, fetched_at')
      .eq('user_id', userId)
      .order('fetched_at', { ascending: false })
      .limit(10);

    if (!data?.length) return { reach: 0, engagement: 0, trend: 'insufficient_data' };

    const totalReach = data.reduce((s: number, r: any) => s + (r.reach || 0), 0);
    const totalEng = data.reduce((s: number, r: any) => s + (r.likes || 0) + (r.comments || 0) + (r.shares || 0), 0);

    return {
      reach: totalReach,
      engagement: totalEng,
      engagementRate: totalReach > 0 ? ((totalEng / totalReach) * 100).toFixed(2) + '%' : '0%',
      platformCount: [...new Set(data.map((r: any) => r.platform))].length,
    };
  }
}

export const productManagerAgent = new ProductManagerAgent();
