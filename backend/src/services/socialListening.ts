import { AIEngine } from '../config/ai-models';
import { getServiceSupabaseClient } from '../config/supabase';
import crypto from 'crypto';
import fetch from 'node-fetch';

export class SocialListeningEngine {
  private ai: AIEngine;
  private supabase;

  constructor() {
    this.ai = AIEngine.getInstance();
    this.supabase = getServiceSupabaseClient();
  }

  async runCycle() {
    console.log('[Social Listening] Starting autonomous collection cycle...');

    // 1. Fetch products/brands
    const { data: products } = await this.supabase
        .from('product_memory')
        .select('id, name, description, category');

    if (!products || products.length === 0) return { conversations: [], alerts: [] };

    const allConversations: any[] = [];
    const alerts: any[] = [];

    for (const product of products) {
        // 2. Search for relevant conversations
        const queries = [
            product.name,
            product.category,
            ...(product.description ? product.description.split(' ').slice(0, 3) : [])
        ];

        const conversations = await this.searchAllSources(queries, 10);
        allConversations.push(...conversations);
        
        for (const convo of conversations) {
            // 3. Process each conversation through NLP Pipeline
            const nlpPrompt = `
              Process this social conversation for the brand "${product.name}":
              CONTENT: "${convo.content}"
              
              EXTRACT:
              1. Entities (Brands, People, Places).
              2. Sentiment (-1 to 1).
              3. Intent (Question, Praise, Complaint, Tag, Spam).
              4. User Behavior (How they interact with the product/promotion).
              5. Reaction (Emotional response to recent launches/awareness campaigns).
              6. Topics mentioned.

              OUTPUT JSON:
              {
                "entities": ["..."],
                "sentiment": number,
                "intent": "...",
                "behavior": "...",
                "reaction": "...",
                "topics": ["..."]
              }
            `;
            
            try {
                const nlpResponse = await this.ai.generateStrategy({}, nlpPrompt);
                const nlp = nlpResponse.parsedJson;

                // 4. Store in database
                await this.supabase.from('social_conversations').upsert({
                    source: convo.source,
                    source_id: convo.id,
                    content: convo.content,
                    author: convo.author,
                    posted_at: convo.posted_at,
                    category: product.category,
                    entities: nlp.entities,
                    sentiment: nlp.sentiment,
                    intent: nlp.intent,
                    behavior: nlp.behavior,
                    reaction: nlp.reaction,
                    topics: nlp.topics,
                    product_id: product.id
                }, { onConflict: 'source_id' });

            } catch (e) {
                console.error(`NLP Processing failed for ${convo.id}:`, e);
            }
        }
        
        // Check for alerts based on new conversations
        if (conversations.length > 0) {
            alerts.push({ type: 'NEW_CONVERSATIONS_FOUND', product: product.name, count: conversations.length });
        }
    }

    return { conversations: allConversations, alerts };
  }

  private async searchAllSources(queries: string[], maxPerSource: number): Promise<any[]> {
      const results: any[] = [];
      const queryStr = queries.join(' ');

      // 1. Reddit (using Reddit API)
      if (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET) {
          try {
              const tokenResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
                  method: 'POST',
                  headers: {
                      'Authorization': 'Basic ' + Buffer.from(process.env.REDDIT_CLIENT_ID + ':' + process.env.REDDIT_CLIENT_SECRET).toString('base64'),
                      'Content-Type': 'application/x-www-form-urlencoded'
                  },
                  body: 'grant_type=client_credentials'
              });
              const { access_token } = await tokenResponse.json();
              
              const searchResponse = await fetch(`https://oauth.reddit.com/r/all/search?q=${encodeURIComponent(queryStr)}&limit=${maxPerSource}&sort=relevance`, {
                  headers: { 'Authorization': `Bearer ${access_token}`, 'User-Agent': 'AdRoomBot/1.0' }
              });
              const data: any = await searchResponse.json();
              
              if (data.data?.children) {
                  results.push(...data.data.children.map((c: any) => ({
                      id: c.data.id,
                      source: 'reddit',
                      content: `${c.data.title} ${c.data.selftext}`,
                      author: c.data.author,
                      posted_at: new Date(c.data.created_utc * 1000).toISOString()
                  })));
              }
          } catch (e) {
              console.error('Reddit search failed:', e);
          }
      }
      
      // 2. YouTube (using YouTube Data API)
      if (process.env.YOUTUBE_API_KEY) {
          try {
              const response = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(queryStr)}&maxResults=${maxPerSource}&key=${process.env.YOUTUBE_API_KEY}`);
              const data: any = await response.json();
              
              if (data.items) {
                  results.push(...data.items.map((item: any) => ({
                      id: item.id.videoId || item.id.channelId,
                      source: 'youtube',
                      content: `${item.snippet.title} ${item.snippet.description}`,
                      author: item.snippet.channelTitle,
                      posted_at: item.snippet.publishedAt
                  })));
              }
          } catch (e) {
              console.error('YouTube search failed:', e);
          }
      }

      // 3. Twitter/X (using Twitter API v2)
      if (process.env.TWITTER_BEARER_TOKEN) {
          try {
              const response = await fetch(`https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(queryStr)}&max_results=${maxPerSource}&tweet.fields=created_at,author_id`, {
                  headers: { 'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}` }
              });
              const data: any = await response.json();
              
              if (data.data) {
                  results.push(...data.data.map((tweet: any) => ({
                      id: tweet.id,
                      source: 'twitter',
                      content: tweet.text,
                      author: tweet.author_id,
                      posted_at: tweet.created_at
                  })));
              }
          } catch (e) {
              console.error('Twitter search failed:', e);
          }
      }

      return this.dedupe(results);
  }

  private dedupe(conversations: any[]) {
      const seen = new Set();
      return conversations.filter(c => {
          const key = c.id || c.content_hash || crypto.createHash('md5').update(c.content).digest('hex');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
      });
  }
}
