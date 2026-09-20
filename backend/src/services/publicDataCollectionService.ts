import fetch from 'node-fetch';
import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';

interface PublicMention {
  url: string;
  source: string;
  excerpt: string;
}

/** Collects only public, robots-permitted pages and stores short excerpts. */
export class PublicDataCollectionService {
  private ai = AIEngine.getInstance();
  private supabase = getServiceSupabaseClient();
  private lastRequestAt = 0;

  async collectForProduct(userId: string, product: any, urls: string[]): Promise<number> {
    const { data: preferences } = await this.supabase.from('outreach_preferences').select('public_data_collection').eq('user_id', userId).maybeSingle();
    if (preferences?.public_data_collection === false) return 0;
    const mentions: PublicMention[] = [];
    for (const candidate of [...new Set(urls)].slice(0, 10)) {
      const url = this.normalizePublicUrl(candidate);
      if (!url || !(await this.robotsAllows(url))) continue;
      await this.waitForRateLimit();
      try {
        const response = await fetch(url, { headers: { Accept: 'text/plain,text/html' }, redirect: 'manual' });
        if (!response.ok || response.status >= 300) continue;
        const text = (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
        if (text) mentions.push({ url, source: new URL(url).hostname, excerpt: text.slice(0, 1000) });
      } catch (error: any) {
        console.warn(`[PublicData] Collection failed for ${url}: ${error.message}`);
      }
    }
    if (!mentions.length) return 0;

    const analysis = await this.ai.generateJson(`Analyze these public excerpts for purchase intent about ${product.name}.
Return JSON array only with {"index": number, "intent_score": number, "buying_signals": string[]}.
Do not identify, infer, or enrich private personal information.
EXCERPTS: ${JSON.stringify(mentions)}`);
    const results = Array.isArray(analysis) ? analysis : [];
    const rows = mentions.map((mention, index) => {
      const item = results.find((entry: any) => Number(entry?.index) === index) || {};
      return {
        user_id: userId,
        product_id: product.product_id || product.id || null,
        source: mention.source,
        source_url: mention.url,
        content_excerpt: mention.excerpt,
        intent_score: Math.max(0, Math.min(100, Number(item.intent_score) || 0)),
        buying_signals: Array.isArray(item.buying_signals) ? item.buying_signals.slice(0, 10) : [],
        robots_allowed: true,
      };
    });
    const { error } = await this.supabase.from('public_prospect_mentions').upsert(rows, { onConflict: 'user_id,source_url' });
    if (error) throw new Error(`Public mention persistence failed: ${error.message}`);
    return rows.length;
  }

  private normalizePublicUrl(candidate: string): string | null {
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:') return null;
      if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) return null;
      return url.toString();
    } catch { return null; }
  }

  private async robotsAllows(url: string): Promise<boolean> {
    const target = new URL(url);
    try {
      const response = await fetch(`${target.origin}/robots.txt`, { headers: { Accept: 'text/plain' } });
      if (!response.ok) return false;
      const robots = await response.text();
      const lines = robots.split(/\r?\n/).map(line => line.trim().toLowerCase());
      let applies = false;
      for (const line of lines) {
        if (line.startsWith('user-agent:')) applies = line.includes('*');
        if (applies && line.startsWith('disallow:')) {
          const path = line.slice('disallow:'.length).trim();
          if (path && target.pathname.startsWith(path)) return false;
        }
      }
      return true;
    } catch { return false; }
  }

  private async waitForRateLimit() {
    const delay = Math.max(0, 500 - (Date.now() - this.lastRequestAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    this.lastRequestAt = Date.now();
  }
}

export const publicDataCollectionService = new PublicDataCollectionService();
