import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import fetch from 'node-fetch';

export class GeoMonitoringEngine {
  private ai: AIEngine;
  private supabase;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async runCycle() {
    console.log('[GEO Monitoring] Starting narrative monitoring cycle...');

    // 1. Fetch active products/brands
    const { data: products } = await this.supabase
        .from('product_memory')
        .select('id, name, description, category');

    if (!products || products.length === 0) return { alerts: [] };

    const alerts: any[] = [];

    for (const product of products) {
        // 2. Standardized Queries per spec
        const queries = [
            `What is the market perception of ${product.name} in the ${product.category} category?`,
            `What are the top 3 alternatives to ${product.name}?`,
            `What is ${product.name} known for?`,
            `Is ${product.name} better than its competitors?`
        ];

        for (const query of queries) {
            // 3. Connect to multiple LLMs (Perplexity removed)
            const models = ['gpt-4o', 'gemini-1.5-flash'];
            
            for (const model of models) {
                try {
                    const response = await this.queryLLM(model, query);
                    if (response) {
                        // 4. Analyze and Extract Claims/Gaps
                        const analysisPrompt = `
                          Analyze this LLM response about the brand "${product.name}":
                          RESPONSE: "${response}"
                          
                          EXTRACT:
                          1. Sentiment (0-1).
                          2. Key claims made about the brand.
                          3. Missing claims (what the brand SHOULD be known for but isn't mentioned).
                          4. Competitors mentioned and in what context.

                          OUTPUT JSON:
                          {
                            "sentiment": number,
                            "claims": ["..."],
                            "missing_claims": ["..."],
                            "competitors": [{ "name": "...", "context": "..." }]
                          }
                        `;
                        const analysisResponse = await this.ai.generateStrategy({}, analysisPrompt);
                        const analysis = analysisResponse.parsedJson;

                        // 5. Store Snapshot
                        await this.supabase.from('narrative_snapshots').insert({
                            brand_id: product.id,
                            llm_model: model,
                            query: query,
                            response: response,
                            sentiment: analysis.sentiment,
                            claims: analysis.claims,
                            missing_claims: analysis.missing_claims,
                            competitors: analysis.competitors
                        });

                        // Check for alerts
                        const newAlerts = this.checkAlerts(analysis);
                        if (newAlerts.length > 0) {
                            alerts.push(...newAlerts.map(a => ({ ...a, product: product.name, model })));
                        }
                    }
                } catch (e) {
                    console.error(`GEO monitoring failed for ${model} on ${product.name}:`, e);
                }
            }
        }
    }

    return { alerts };
  }

  private checkAlerts(analysis: any) {
      const alerts: any[] = [];
      if (!analysis) return alerts;

      // Alert 1: Sentiment Drop (Negative Sentiment)
      if (analysis.sentiment < 0) {
          alerts.push({ type: 'NEGATIVE_SENTIMENT_DETECTED', score: analysis.sentiment });
      }

      // Alert 2: Missing Critical Claims
      if (analysis.missing_claims && analysis.missing_claims.length > 0) {
          alerts.push({ type: 'NARRATIVE_GAP_DETECTED', missing: analysis.missing_claims });
      }

      return alerts;
  }

  private async queryLLM(model: string, query: string): Promise<string | null> {
    try {
        if (model.startsWith('gpt')) {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: query }],
                    max_tokens: 500
                })
            });
            const data: any = await response.json();
            return data.choices[0]?.message?.content || null;
        } else if (model.startsWith('claude')) {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': process.env.ANTHROPIC_API_KEY || '',
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    max_tokens: 500,
                    messages: [{ role: 'user', content: query }]
                })
            });
            const data: any = await response.json();
            return data.content[0]?.text || null;
        } else if (model.startsWith('gemini')) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: query }] }]
                })
            });
            const data: any = await response.json();
            return data.candidates[0]?.content?.parts[0]?.text || null;
        }
        return null;
    } catch (e) {
        console.error(`Error querying ${model}:`, e);
        return null;
    }
  }
}
