/**
 * Critic Agent — Output Quality Assurance
 *
 * Analyses every AI output from AdRoom agents and assigns a quality score.
 * Runs asynchronously (fire-and-forget) so it never slows down the pipeline.
 *
 * Scoring dimensions (25 pts each → max 100):
 *   1. Completeness  — does the output fully address what was asked?
 *   2. Factual safety — no hallucination signals ("I think", unverifiable claims)
 *   3. Relevance      — on-topic, no tangents or filler text
 *   4. Actionability  — is the content specific and usable (not generic fluff)?
 *
 * Verdicts:
 *   approved  ≥ 75
 *   flagged   50–74
 *   rejected  < 50
 *
 * Admin: GET /api/admin/critic/stats | GET /api/admin/critic/logs
 */

import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

export interface CriticResult {
  quality_score: number;
  issues: string[];
  verdict: 'approved' | 'flagged' | 'rejected';
}

interface CriticParams {
  output:      string;
  agentType:   string;
  taskType:    string;
  userId?:     string;
  operation?:  string;
}

// Patterns that strongly suggest hallucination or low quality
const HALLUCINATION_SIGNALS = [
  /\bI (think|believe|assume|imagine|suppose)\b/i,
  /\bprobably\b.{0,30}(true|correct|accurate)/i,
  /\bI'm not (sure|certain|100%)\b/i,
  /\bAs of my (knowledge|training) cut(off|-off)?\b/i,
  /\bI (cannot|can't) (verify|confirm|guarantee)\b/i,
  /\bhallucin/i,
  /\bI (don't|do not) have (real-time|live|up-to-date) (data|information|access)\b/i,
];

const GENERIC_FLUFF_SIGNALS = [
  /\bIn today's (digital|competitive|fast-paced) world\b/i,
  /\bAs an AI language model\b/i,
  /\bCertainly! Here is\b/i,
  /\bAbsolutely! I'd be happy to\b/i,
  /\bGreat question!\b/i,
  /^(Sure|Certainly|Absolutely|Of course)[!,]/i,
];

class CriticAgentService {
  private ai: AIEngine;
  private supabase: ReturnType<typeof getServiceSupabaseClient>;
  private analysisQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  // ── Quick local pre-check (no AI call) ────────────────────────────────────
  private quickCheck(output: string): { score: number; issues: string[] } {
    const issues: string[] = [];
    let penalty = 0;

    if (!output || output.trim().length < 20) {
      return { score: 5, issues: ['Output is empty or too short'] };
    }

    // Hallucination signals
    for (const pattern of HALLUCINATION_SIGNALS) {
      if (pattern.test(output)) {
        issues.push('Contains hallucination signal: uncertainty language detected');
        penalty += 15;
        break;
      }
    }

    // Generic fluff
    let fluffCount = 0;
    for (const pattern of GENERIC_FLUFF_SIGNALS) {
      if (pattern.test(output)) { fluffCount++; }
    }
    if (fluffCount > 0) {
      issues.push(`Generic/filler language detected (${fluffCount} instance${fluffCount > 1 ? 's' : ''})`);
      penalty += 10 * Math.min(fluffCount, 2);
    }

    // Repetition detection (same sentence block repeated)
    const sentences = output.split(/[.!?]\s+/);
    const uniqueSentences = new Set(sentences.map(s => s.toLowerCase().trim().slice(0, 60)));
    const repetitionRatio = 1 - (uniqueSentences.size / Math.max(sentences.length, 1));
    if (repetitionRatio > 0.3) {
      issues.push(`High repetition ratio (${Math.round(repetitionRatio * 100)}% of sentences are duplicates)`);
      penalty += 20;
    }

    // Very short output (may be incomplete)
    if (output.trim().length < 100) {
      issues.push('Output may be incomplete — very short');
      penalty += 10;
    }

    const score = Math.max(0, 100 - penalty);
    return { score, issues };
  }

  // ── Full AI analysis ───────────────────────────────────────────────────────
  private async aiAnalyze(params: CriticParams): Promise<CriticResult> {
    const { output, agentType, taskType } = params;
    const truncated = output.slice(0, 1500);

    const prompt = `You are the AdRoom Critic Agent — a quality assurance system that scores AI-generated marketing outputs.

AGENT TYPE:   ${agentType}
TASK TYPE:    ${taskType}
OUTPUT:
"""
${truncated}
"""

Score this output across 4 dimensions (0–25 each):

1. Completeness   — Does it fully address a typical marketing task for this agent/task type?
2. Factual safety — No hallucination signals, no unverifiable claims, no hedging ("I think", "I believe")?
3. Relevance      — On-topic, no generic filler, directly useful?
4. Actionability  — Specific, concrete actions/content (not vague platitudes)?

Also list up to 3 specific issues found (empty array if none).

Return JSON only:
{
  "completeness": 0-25,
  "factual_safety": 0-25,
  "relevance": 0-25,
  "actionability": 0-25,
  "issues": ["issue1", "issue2"]
}`;

    try {
      const res = await this.ai.generateStrategyEconomy({}, prompt);
      const j = res.parsedJson;
      if (j && typeof j.completeness === 'number') {
        const total = (j.completeness || 0) + (j.factual_safety || 0) + (j.relevance || 0) + (j.actionability || 0);
        const score = Math.min(100, Math.max(0, total));
        const issues: string[] = Array.isArray(j.issues) ? j.issues.slice(0, 3) : [];
        const verdict: CriticResult['verdict'] = score >= 75 ? 'approved' : score >= 50 ? 'flagged' : 'rejected';
        return { quality_score: score, issues, verdict };
      }
    } catch {
      // Fall through to quick-check
    }

    // Fallback to quick check
    const qc = this.quickCheck(output);
    const verdict: CriticResult['verdict'] = qc.score >= 75 ? 'approved' : qc.score >= 50 ? 'flagged' : 'rejected';
    return { quality_score: qc.score, issues: qc.issues, verdict };
  }

  // ── Public: fire-and-forget async analysis ─────────────────────────────────
  analyze(params: CriticParams): void {
    // Queue analyses so we don't spam the DB with parallel writes
    this.analysisQueue = this.analysisQueue.then(async () => {
      try {
        // Run quick local check first — if it's clearly fine, skip AI call
        const quick = this.quickCheck(params.output);
        let result: CriticResult;

        if (quick.score >= 90) {
          // Output passes quick checks — no need for full AI analysis
          result = { quality_score: quick.score, issues: [], verdict: 'approved' };
        } else {
          result = await this.aiAnalyze(params);
        }

        await this.supabase.from('critic_agent_logs').insert({
          user_id:       params.userId,
          agent_type:    params.agentType,
          task_type:     params.taskType,
          operation:     params.operation,
          output_text:   params.output.slice(0, 2000),
          quality_score: result.quality_score,
          issues:        result.issues,
          verdict:       result.verdict,
        });

        if (result.verdict === 'rejected') {
          console.warn(`[CriticAgent] REJECTED output — agent=${params.agentType} task=${params.taskType} score=${result.quality_score}`);
          if (result.issues.length) {
            console.warn(`[CriticAgent] Issues: ${result.issues.join(' | ')}`);
          }
        } else if (result.verdict === 'flagged') {
          console.log(`[CriticAgent] FLAGGED output — agent=${params.agentType} score=${result.quality_score}`);
        }
      } catch (err: any) {
        console.error('[CriticAgent] Analysis failed:', err.message);
      }
    });
  }

  // ── Admin: aggregate stats ─────────────────────────────────────────────────
  async getStats(): Promise<{
    total: number;
    approved: number;
    flagged: number;
    rejected: number;
    avgScore: number;
    byAgent: Record<string, { total: number; avg: number }>;
    last24h: { total: number; rejected: number };
  }> {
    const { data: logs } = await this.supabase
      .from('critic_agent_logs')
      .select('agent_type, quality_score, verdict, created_at')
      .order('created_at', { ascending: false })
      .limit(5000);

    const all = logs || [];
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = all.filter((r: any) => r.created_at >= cutoff);

    const approved = all.filter((r: any) => r.verdict === 'approved').length;
    const flagged  = all.filter((r: any) => r.verdict === 'flagged').length;
    const rejected = all.filter((r: any) => r.verdict === 'rejected').length;
    const avgScore = all.length
      ? Math.round(all.reduce((s: number, r: any) => s + (r.quality_score || 0), 0) / all.length)
      : 0;

    const byAgent: Record<string, { total: number; avg: number; sum: number }> = {};
    for (const r of all as any[]) {
      if (!r.agent_type) continue;
      if (!byAgent[r.agent_type]) byAgent[r.agent_type] = { total: 0, avg: 0, sum: 0 };
      byAgent[r.agent_type].total++;
      byAgent[r.agent_type].sum += r.quality_score || 0;
    }
    for (const k of Object.keys(byAgent)) {
      byAgent[k].avg = Math.round(byAgent[k].sum / byAgent[k].total);
      delete (byAgent[k] as any).sum;
    }

    return {
      total:    all.length,
      approved, flagged, rejected,
      avgScore,
      byAgent,
      last24h: {
        total:    recent.length,
        rejected: recent.filter((r: any) => r.verdict === 'rejected').length,
      },
    };
  }

  // ── Admin: recent logs ─────────────────────────────────────────────────────
  async getLogs(options: { limit?: number; verdict?: string; agentType?: string } = {}): Promise<any[]> {
    let query = this.supabase
      .from('critic_agent_logs')
      .select('id, agent_type, task_type, operation, quality_score, issues, verdict, created_at')
      .order('created_at', { ascending: false })
      .limit(options.limit ?? 50);

    if (options.verdict)   query = query.eq('verdict', options.verdict);
    if (options.agentType) query = query.eq('agent_type', options.agentType);

    const { data } = await query;
    return data || [];
  }
}

export const criticAgentService = new CriticAgentService();
