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
const DIRECT_TIMEOUT_MS = 15000;
const MAX_PRODUCT_PAGES = 6;

function scraperLog(msg: string, extra?: any) {
    const ts = new Date().toISOString();
    if (extra) {
        console.log(`[Scraper] [${ts}] ${msg}`, extra);
    } else {
        console.log(`[Scraper] [${ts}] ${msg}`);
    }
}

async function fetchWithJina(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
        scraperLog(`Fetching via Jina: ${url}`);
        const res = await fetch(jinaUrl, {
            headers: {
                'Accept': 'text/plain',
                'X-With-Images-Summary': 'true',
                'X-Return-Format': 'text',
            },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Jina returned ${res.status}`);
        const text = await res.text();
        scraperLog(`Jina fetched ${text.length} chars for ${url}`);
        return text;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchDirect(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);

    try {
        scraperLog(`Direct fetch fallback: ${url}`);
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
            },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Direct fetch returned ${res.status}`);
        const html = await res.text();
        const cleaned = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .substring(0, 8000);
        scraperLog(`Direct fetch returned ${cleaned.length} cleaned chars`);
        return cleaned;
    } finally {
        clearTimeout(timer);
    }
}

async function getPageContent(url: string): Promise<string> {
    try {
        const text = await fetchWithJina(url);
        if (text && text.length > 100) return text.substring(0, 12000);
        throw new Error('Jina returned too little content');
    } catch (jinaErr: any) {
        scraperLog(`Jina failed (${jinaErr.message}), trying direct fetch`);
        try {
            return await fetchDirect(url);
        } catch (directErr: any) {
            scraperLog(`Direct fetch also failed: ${directErr.message}`);
            return `Website: ${url}`;
        }
    }
}

function buildFallbackProduct(url: string): ScrapedProduct {
    const hostname = (() => {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
    })();
    const brandName = hostname.split('.')[0];
    const brandCapitalized = brandName.charAt(0).toUpperCase() + brandName.slice(1);

    return {
        name: `${brandCapitalized} Product`,
        description: `Products and services from ${brandCapitalized}. Please review and edit the details below to accurately represent your offering.`,
        price: undefined,
        images: [],
        url,
        category: 'General',
        metadata: {
            usp: ['Quality products', 'Customer satisfaction', 'Competitive pricing'],
            target_audience: 'General consumers',
            fallback: true,
        },
    };
}

export class ScraperService {
    private supabase;
    private ai: AIEngine;

    constructor() {
        this.supabase = getServiceSupabaseClient();
        this.ai = AIEngine.getInstance();
    }

    async scrapeWebsite(url: string, userId: string): Promise<ScrapedProduct[]> {
        scraperLog(`Starting scrape — URL: ${url} | User: ${userId}`);

        let homepageContent = '';
        try {
            homepageContent = await getPageContent(url);
        } catch (err: any) {
            scraperLog(`Could not fetch page, using AI inference from URL alone`);
            homepageContent = `URL: ${url}`;
        }

        const discoveryPrompt = `
You are analyzing the text content of an e-commerce or business website.
Your job: extract products/services and find product page URLs.

URL: ${url}
CONTENT:
${homepageContent}

OUTPUT STRICT JSON (no markdown, no extra text):
{
  "homepage_products": [
    {
      "name": "string",
      "description": "string (2-3 sentences, marketing-ready)",
      "price": "string or null",
      "image_url": "absolute image URL or null",
      "category": "string",
      "usp": ["key benefit 1", "key benefit 2"]
    }
  ],
  "product_links": ["absolute url 1", "absolute url 2"]
}

Rules:
- All URLs must be absolute (start with http). Resolve relative URLs against: ${url}
- Only include real products/services, NOT navigation, blog posts, or footer links.
- Maximum 6 product_links.
- If no products found on page, still try to infer at least 1 product from the site domain and content.
- Never return empty arrays if you can reasonably infer a product from context.
`;

        scraperLog('Running AI discovery pass...');
        let discoveryResult: any = { homepage_products: [], product_links: [] };
        try {
            const aiResult = await this.ai.generateStrategy({}, discoveryPrompt);
            if (aiResult.parsedJson) {
                discoveryResult = aiResult.parsedJson;
                scraperLog(`AI discovery found ${discoveryResult.homepage_products?.length || 0} homepage products, ${discoveryResult.product_links?.length || 0} product links`);
            } else {
                scraperLog('AI discovery returned no parsedJson — will try product links only');
            }
        } catch (err: any) {
            scraperLog(`AI discovery error: ${err.message}`);
        }

        const products: ScrapedProduct[] = [];

        for (const hp of (discoveryResult.homepage_products || [])) {
            if (hp?.name && hp?.description) {
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
                scraperLog(`Added homepage product: "${product.name}"`);
            }
        }

        const productLinks: string[] = (discoveryResult.product_links || [])
            .filter((l: any) => typeof l === 'string' && l.startsWith('http'))
            .slice(0, MAX_PRODUCT_PAGES);

        if (productLinks.length > 0) {
            scraperLog(`Scraping ${productLinks.length} individual product pages...`);
            const pageTasks = productLinks.map((productUrl: string) =>
                this.scrapeProductPage(productUrl, url).then(async (product) => {
                    if (product) {
                        await this.storeScrapedProduct(product, userId);
                        products.push(product);
                        scraperLog(`Added product page: "${product.name}" from ${productUrl}`);
                    }
                }).catch((e: any) => {
                    scraperLog(`Product page failed (${productUrl}): ${e.message}`);
                })
            );
            await Promise.all(pageTasks);
        }

        if (products.length === 0) {
            scraperLog('No products found — using fallback product');
            const fallback = buildFallbackProduct(url);
            products.push(fallback);
            await this.storeScrapedProduct(fallback, userId);
        }

        scraperLog(`Scrape complete — ${products.length} products found from ${url}`);
        return products;
    }

    private async scrapeProductPage(productUrl: string, baseUrl: string): Promise<ScrapedProduct | null> {
        let content = '';
        try {
            content = await getPageContent(productUrl);
        } catch {
            return null;
        }

        const extractPrompt = `
You are extracting a single product's details from an e-commerce product page.

PRODUCT PAGE URL: ${productUrl}
SITE URL: ${baseUrl}
CONTENT:
${content}

OUTPUT STRICT JSON (no markdown):
{
  "name": "string",
  "description": "string (2-3 sentences, marketing-ready)",
  "price": "string or null",
  "image_url": "absolute image URL or null",
  "category": "string",
  "usp": ["benefit 1", "benefit 2", "benefit 3"],
  "target_audience": "string"
}

Rules:
- name must be the ACTUAL product name, not the site name.
- description must be real from the content, not invented.
- If name/description cannot be found, use the URL path as the name hint.
`;

        try {
            const aiResult = await this.ai.generateStrategy({}, extractPrompt);
            const refined = aiResult.parsedJson;

            if (!refined?.name) {
                scraperLog(`AI could not extract product from ${productUrl}`);
                return null;
            }

            return {
                name: refined.name,
                description: refined.description || `Product from ${productUrl}`,
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
            scraperLog(`Product extraction failed for ${productUrl}: ${err.message}`);
            return null;
        }
    }

    private async storeScrapedProduct(product: ScrapedProduct, userId: string) {
        try {
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
                scraperLog(`Failed to store product "${product.name}": ${error.message}`);
            } else {
                scraperLog(`Stored product: "${product.name}"`);
            }
        } catch (e: any) {
            scraperLog(`storeScrapedProduct exception: ${e.message}`);
        }
    }
}
