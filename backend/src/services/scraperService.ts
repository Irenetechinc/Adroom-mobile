import { getServiceSupabaseClient } from '../config/supabase';
import { AIEngine } from '../config/ai-models';

export interface ScrapedProduct {
    name: string;
    description: string;
    price?: string;
    images: string[];
    url: string;
    category?: string;
    metadata?: any;
}

const JINA_TIMEOUT_MS = 20000;
const MAX_PRODUCT_PAGES = 6;

/**
 * Fetches clean, LLM-ready text from any URL using Jina AI Reader.
 * Handles JavaScript-rendered pages, avoids bot detection, works on SPAs.
 */
async function fetchWithJina(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
        const res = await fetch(jinaUrl, {
            headers: {
                'Accept': 'text/plain',
                'X-With-Images-Summary': 'true',
                'X-Return-Format': 'text',
            },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Jina returned ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Direct fetch fallback for Jina failures — uses realistic browser headers.
 */
async function fetchDirect(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Cache-Control': 'no-cache',
            },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Direct fetch returned ${res.status}`);
        const html = await res.text();
        // Strip HTML tags for LLM use
        return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s{2,}/g, ' ')
                   .trim()
                   .substring(0, 8000);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Gets readable page content — tries Jina first, falls back to direct fetch.
 */
async function getPageContent(url: string): Promise<string> {
    try {
        console.log(`[Scraper] Fetching via Jina: ${url}`);
        const text = await fetchWithJina(url);
        if (text && text.length > 100) return text.substring(0, 10000);
        throw new Error('Jina returned too little content');
    } catch (jinaErr: any) {
        console.warn(`[Scraper] Jina failed (${jinaErr.message}), trying direct fetch: ${url}`);
        return await fetchDirect(url);
    }
}

export class ScraperService {
    private supabase;
    private ai: AIEngine;

    constructor() {
        this.supabase = getServiceSupabaseClient();
        this.ai = AIEngine.getInstance();
    }

    async scrapeWebsite(url: string, userId: string): Promise<ScrapedProduct[]> {
        console.log(`[Scraper] Starting scrape for: ${url} (user: ${userId})`);

        // 1. Get the homepage content
        const homepageContent = await getPageContent(url);

        // 2. Use AI to extract products directly from homepage + discover product links
        const discoveryPrompt = `
You are analyzing the text content of an e-commerce or business website homepage.

URL: ${url}
CONTENT:
${homepageContent}

Your tasks:
1. Extract any products/services already visible on this page.
2. Find all product page URLs mentioned in the content (look for links to /product/, /p/, /item/, /shop/, /collections/, /catalog/, etc.)

OUTPUT STRICT JSON (no extra text):
{
  "homepage_products": [
    {
      "name": "string",
      "description": "string",
      "price": "string or null",
      "image_url": "string or null",
      "category": "string",
      "usp": ["unique selling point 1", "unique selling point 2"]
    }
  ],
  "product_links": ["absolute url 1", "absolute url 2"]
}

Rules:
- All URLs must be absolute (start with http). Resolve relative URLs against: ${url}
- Only include real products/services, not navigation items or blog posts.
- Maximum 6 product_links.
- If no products found, return empty arrays.
`;

        let discoveryResult: any = { homepage_products: [], product_links: [] };
        try {
            const aiResult = await this.ai.generateStrategy({}, discoveryPrompt);
            if (aiResult.parsedJson) {
                discoveryResult = aiResult.parsedJson;
            }
        } catch (err: any) {
            console.error('[Scraper] AI discovery failed:', err.message);
        }

        const products: ScrapedProduct[] = [];

        // 3. Add homepage products
        for (const hp of (discoveryResult.homepage_products || [])) {
            if (hp.name && hp.description) {
                const product: ScrapedProduct = {
                    name: hp.name,
                    description: hp.description,
                    price: hp.price || undefined,
                    images: hp.image_url ? [hp.image_url] : [],
                    url,
                    category: hp.category || undefined,
                    metadata: { usp: hp.usp || [] },
                };
                products.push(product);
                await this.storeScrapedProduct(product, userId);
            }
        }

        // 4. Scrape individual product pages concurrently
        const productLinks: string[] = (discoveryResult.product_links || [])
            .filter((l: string) => typeof l === 'string' && l.startsWith('http'))
            .slice(0, MAX_PRODUCT_PAGES);

        if (productLinks.length > 0) {
            console.log(`[Scraper] Scraping ${productLinks.length} product pages`);
            const pageTasks = productLinks.map((productUrl: string) =>
                this.scrapeProductPage(productUrl, url).then(async (product) => {
                    if (product) {
                        await this.storeScrapedProduct(product, userId);
                        products.push(product);
                    }
                }).catch((e: any) => {
                    console.warn(`[Scraper] Product page failed (${productUrl}):`, e.message);
                })
            );
            await Promise.all(pageTasks);
        }

        // 5. Update last_scraped_at on the product_memory row for this site
        await this.supabase
            .from('product_memory')
            .update({ last_scraped_at: new Date().toISOString() })
            .eq('website_url', url)
            .eq('user_id', userId);

        console.log(`[Scraper] Done — found ${products.length} products from ${url}`);
        return products;
    }

    private async scrapeProductPage(productUrl: string, baseUrl: string): Promise<ScrapedProduct | null> {
        const content = await getPageContent(productUrl);

        const extractPrompt = `
You are extracting a single product's details from the text of an e-commerce product page.

PRODUCT PAGE URL: ${productUrl}
SITE URL: ${baseUrl}
CONTENT:
${content}

Extract the product shown on this specific page.

OUTPUT STRICT JSON (no extra text):
{
  "name": "string",
  "description": "string (2-3 sentences, marketing-ready)",
  "price": "string or null",
  "image_url": "string or null (absolute URL)",
  "category": "string",
  "usp": ["unique selling point 1", "unique selling point 2", "unique selling point 3"],
  "target_audience": "string"
}

Rules:
- name must be the actual product name, not the site name.
- description must be real, from the page content.
- Do NOT invent or hallucinate data. If not found, use null.
`;

        try {
            const aiResult = await this.ai.generateStrategy({}, extractPrompt);
            const refined = aiResult.parsedJson;

            if (!refined?.name || !refined?.description) {
                console.warn(`[Scraper] AI could not extract product from ${productUrl}`);
                return null;
            }

            return {
                name: refined.name,
                description: refined.description,
                price: refined.price || undefined,
                images: refined.image_url ? [refined.image_url] : [],
                url: productUrl,
                category: refined.category || undefined,
                metadata: {
                    usp: refined.usp || [],
                    target_audience: refined.target_audience || null,
                },
            };
        } catch (err: any) {
            console.error(`[Scraper] Product extraction failed for ${productUrl}:`, err.message);
            return null;
        }
    }

    private async storeScrapedProduct(product: ScrapedProduct, userId: string) {
        const { error } = await this.supabase.from('product_memory').upsert(
            {
                user_id: userId,
                name: product.name,
                description: product.description,
                price: product.price || null,
                category: product.category || null,
                baseImageUri: product.images[0] || null,
                website_url: product.url,
                conversation_context: {
                    usp: product.metadata?.usp || [],
                    target_audience: product.metadata?.target_audience || null,
                },
                last_scraped_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,name' }
        );

        if (error) {
            console.error(`[Scraper] Failed to store product "${product.name}":`, error.message);
        } else {
            console.log(`[Scraper] Stored product: "${product.name}"`);
        }
    }
}
