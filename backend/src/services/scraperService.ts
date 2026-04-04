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

const JINA_TIMEOUT_MS = 22000;
const DIRECT_TIMEOUT_MS = 15000;
const MAX_PRODUCT_PAGES = 8;

function scraperLog(msg: string, extra?: any) {
    const ts = new Date().toISOString();
    if (extra) {
        console.log(`[Scraper] [${ts}] ${msg}`, typeof extra === 'object' ? JSON.stringify(extra).slice(0, 500) : extra);
    } else {
        console.log(`[Scraper] [${ts}] ${msg}`);
    }
}

async function fetchWithJina(url: string): Promise<string> {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);
    try {
        scraperLog(`Jina fetch: ${url}`);
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
        scraperLog(`Jina OK: ${text.length} chars from ${url}`);
        return text;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchRawHtml(url: string): Promise<{ text: string; rawHtml: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
    try {
        scraperLog(`Raw HTML fetch: ${url}`);
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
            },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rawHtml = await res.text();
        const text = rawHtml
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .substring(0, 10000);
        scraperLog(`Raw HTML OK: ${text.length} cleaned chars`);
        return { text, rawHtml };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchWithFirecrawl(url: string): Promise<string> {
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) throw new Error('No Firecrawl key');
    scraperLog(`Firecrawl fetch: ${url}`);
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'] }),
        signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
    const data: any = await res.json();
    const text = data?.data?.markdown || '';
    scraperLog(`Firecrawl OK: ${text.length} chars`);
    return text;
}

async function getPageContent(url: string): Promise<{ text: string; rawHtml?: string }> {
    // Method 1: Jina AI reader (best for clean text extraction)
    try {
        const text = await fetchWithJina(url);
        if (text && text.length > 300) return { text: text.substring(0, 14000) };
    } catch (e: any) {
        scraperLog(`Jina failed: ${e.message}`);
    }
    // Method 2: Firecrawl (handles JS-heavy sites)
    try {
        const text = await fetchWithFirecrawl(url);
        if (text && text.length > 300) return { text: text.substring(0, 14000) };
    } catch (e: any) {
        scraperLog(`Firecrawl failed: ${e.message}`);
    }
    // Method 3: Raw HTML with our own cleaning
    try {
        const result = await fetchRawHtml(url);
        if (result.text && result.text.length > 50) return result;
    } catch (e: any) {
        scraperLog(`Raw HTML failed: ${e.message}`);
    }
    return { text: `Website: ${url}` };
}

/**
 * Extracts all internal href links from raw HTML.
 * Fully dynamic — no pre-listed paths.
 */
function extractAllLinksFromHtml(rawHtml: string, origin: string): string[] {
    const hrefs = new Set<string>();
    const hrefRegex = /href=["']([^"'#?]+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(rawHtml)) !== null) {
        const href = match[1].trim();
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
        try {
            const resolved = new URL(href, origin);
            if (resolved.hostname === new URL(origin).hostname) {
                hrefs.add(resolved.pathname);
            }
        } catch {}
    }
    return Array.from(hrefs).slice(0, 100);
}

/**
 * AI classifies extracted links to identify product/collection pages.
 * No pre-listed assumptions — fully adaptive to any site structure.
 */
async function discoverProductPagesAI(paths: string[], origin: string, ai: AIEngine): Promise<string[]> {
    if (paths.length === 0) return [];
    scraperLog(`AI classifying ${paths.length} paths from ${origin}`);
    const prompt = `
You are a web scraping intelligence engine. A website at "${origin}" has these URL paths.
Identify paths that are: product listing pages, shop pages, category pages, collection pages, catalog pages, or individual product pages.

EXCLUDE: home, about, contact, blog, news, faq, terms, privacy, login, cart, checkout, account, wishlist, search, 404, cookie-policy, sitemap.

PATHS:
${paths.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Return ONLY a JSON array of path strings (no markdown, no explanation):
["path1", "path2"]
If none qualify, return: []
`;
    try {
        const resp = await ai.generateStrategy({}, prompt);
        const found: string[] = Array.isArray(resp.parsedJson) ? resp.parsedJson : [];
        scraperLog(`AI discovered ${found.length} product paths`, found.slice(0, 5));
        return found.slice(0, MAX_PRODUCT_PAGES);
    } catch (e: any) {
        scraperLog(`AI discovery failed: ${e.message}`);
        return [];
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
        scraperLog(`\n══════════════════════════════════`);
        scraperLog(`Starting scrape — URL: ${url} | User: ${userId}`);

        const parsedUrl = (() => {
            try { return new URL(url.startsWith('http') ? url : `https://${url}`); } catch { return null; }
        })();

        if (!parsedUrl) {
            const fb = this.buildFallback(url, 'Invalid URL');
            await this.storeProduct(fb, userId);
            return [fb];
        }

        const origin = parsedUrl.origin;

        // ── STEP 1: Fetch homepage ─────────────────────────────────────────────
        scraperLog(`STEP 1: Fetching homepage at ${origin}`);
        const { text: homepageText, rawHtml } = await getPageContent(origin);

        // ── STEP 2: Extract all links from raw HTML ────────────────────────────
        let productPageUrls: string[] = [parsedUrl.href];

        if (rawHtml) {
            scraperLog(`STEP 2: Extracting all internal links from homepage HTML`);
            const allPaths = extractAllLinksFromHtml(rawHtml, origin);
            scraperLog(`Found ${allPaths.length} unique internal paths`);

            // ── STEP 3: AI classifies which paths are product/collection pages ──
            scraperLog(`STEP 3: AI identifying product/collection pages`);
            const productPaths = await discoverProductPagesAI(allPaths, origin, this.ai);
            const productUrls = productPaths.map(p => `${origin}${p.startsWith('/') ? p : '/' + p}`);

            // Always include the original URL the user gave us
            if (!productUrls.includes(parsedUrl.href)) {
                productUrls.unshift(parsedUrl.href);
            }
            productPageUrls = productUrls;
        }

        scraperLog(`STEP 4: Scraping ${productPageUrls.length} product page(s)`, productPageUrls);

        // ── STEP 4: Scrape each discovered product page ────────────────────────
        const pageContents: string[] = [];
        for (const pageUrl of productPageUrls.slice(0, MAX_PRODUCT_PAGES)) {
            try {
                const { text } = await getPageContent(pageUrl);
                if (text && text.length > 100) {
                    pageContents.push(`\n\n─── PAGE: ${pageUrl} ───\n${text.substring(0, 5000)}`);
                }
            } catch (e: any) {
                scraperLog(`Failed to scrape ${pageUrl}: ${e.message}`);
            }
        }

        const combinedContent = (pageContents.join('\n') || homepageText).substring(0, 22000);

        // ── STEP 5: AI extracts product data ──────────────────────────────────
        scraperLog(`STEP 5: AI extracting product data from ${combinedContent.length} chars`);
        const products = await this.extractProductsWithAI(combinedContent, url, origin);

        // ── STEP 6: Store and return ──────────────────────────────────────────
        if (products.length === 0) {
            scraperLog(`No products extracted — building fallback from homepage context`);
            const fallback = await this.extractSingleProductWithAI(homepageText, url);
            await this.storeProduct(fallback, userId);
            scraperLog(`══════════════════════════════════\n`);
            return [fallback];
        }

        for (const p of products) {
            await this.storeProduct(p, userId);
        }
        scraperLog(`Scrape complete — ${products.length} product(s) found`);
        scraperLog(`══════════════════════════════════\n`);
        return products;
    }

    private async extractProductsWithAI(content: string, originalUrl: string, origin: string): Promise<ScrapedProduct[]> {
        const prompt = `
You are a product extraction engine analyzing e-commerce website content.
Extract ALL distinct products or the primary product/service.

WEBSITE CONTENT (may span multiple pages):
${content}

For each product found, provide:
- name: exact product name (not brand, not site name)
- description: 2-3 sentence marketing-ready description
- price: price string with currency symbol, or null
- category: specific category (Fashion, Electronics, Beauty, Food, Furniture, etc.)
- image_url: first absolute image URL found or null
- target_audience: who buys this

Return STRICT JSON array (no markdown):
[
  {
    "name": "string",
    "description": "string",
    "price": "string or null",
    "category": "string",
    "image_url": "absolute URL or null",
    "target_audience": "string"
  }
]

Rules:
- Max 5 products. Pick the most prominent/primary ones.
- name must be a real product name, NOT the website/brand name.
- If this is a service-based business, treat the service as the "product".
- Return ONLY the JSON array.
`;
        try {
            const resp = await this.ai.generateStrategy({}, prompt);
            const extracted: any[] = Array.isArray(resp.parsedJson) ? resp.parsedJson : [];
            return extracted
                .filter((p: any) => p?.name && p?.description)
                .map((p: any) => ({
                    name: p.name,
                    description: p.description,
                    price: p.price || undefined,
                    images: (p.image_url && typeof p.image_url === 'string' && p.image_url.startsWith('http')) ? [p.image_url] : [],
                    url: originalUrl,
                    category: p.category || 'General',
                    metadata: { target_audience: p.target_audience || '', scraped_from: origin },
                }));
        } catch (e: any) {
            scraperLog(`extractProductsWithAI error: ${e.message}`);
            return [];
        }
    }

    private async extractSingleProductWithAI(content: string, url: string): Promise<ScrapedProduct> {
        const prompt = `
Extract the primary product/service from this website content.

CONTENT: ${content.substring(0, 8000)}

Return ONLY JSON (no markdown):
{
  "name": "product name",
  "description": "2-3 sentences",
  "price": "price or null",
  "category": "category",
  "image_url": "absolute URL or null",
  "target_audience": "who buys this"
}
`;
        try {
            const resp = await this.ai.generateStrategy({}, prompt);
            const p = resp.parsedJson;
            if (p?.name && p.name.length > 2) {
                return {
                    name: p.name,
                    description: p.description || '',
                    price: p.price || undefined,
                    images: (p.image_url && typeof p.image_url === 'string' && p.image_url.startsWith('http')) ? [p.image_url] : [],
                    url,
                    category: p.category || 'General',
                    metadata: { target_audience: p.target_audience || '' },
                };
            }
        } catch (e: any) {
            scraperLog(`extractSingleProductWithAI error: ${e.message}`);
        }
        return this.buildFallback(url, 'AI extraction returned no usable data');
    }

    private buildFallback(url: string, reason: string): ScrapedProduct {
        scraperLog(`Fallback product built. Reason: ${reason}`);
        const hostname = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
        const brand = hostname.split('.')[0];
        const name = brand.charAt(0).toUpperCase() + brand.slice(1);
        return {
            name: `${name} Product`,
            description: `Products and services from ${name}. Please review and edit the details to accurately represent your offering.`,
            price: undefined,
            images: [],
            url,
            category: 'General',
            metadata: { fallback: true, reason },
        };
    }

    private async storeProduct(product: ScrapedProduct, userId: string): Promise<void> {
        try {
            const { error } = await this.supabase.from('product_memory').upsert(
                {
                    user_id: userId,
                    product_name: product.name,
                    description: product.description,
                    price: product.price ? parseFloat(product.price.replace(/[^0-9.]/g, '')) || null : null,
                    category: product.category || null,
                    images: product.images || [],
                    website_url: product.url,
                    conversation_context: { target_audience: product.metadata?.target_audience || '' },
                    original_scan_data: product.metadata || null,
                    last_scraped_at: new Date().toISOString(),
                },
                { onConflict: 'user_id,product_name' }
            );
            if (error) scraperLog(`DB store failed for "${product.name}": ${error.message}`);
            else scraperLog(`Stored product: "${product.name}"`);
        } catch (e: any) {
            scraperLog(`storeProduct exception: ${e.message}`);
        }
    }

    async refreshStaleProducts(): Promise<void> {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: stale } = await this.supabase
            .from('product_memory')
            .select('product_id, website_url, user_id')
            .not('website_url', 'is', null)
            .lt('last_scraped_at', oneHourAgo)
            .limit(5);

        if (!stale || stale.length === 0) return;
        for (const product of stale) {
            if (!product.website_url) continue;
            try {
                const products = await this.scrapeWebsite(product.website_url, product.user_id);
                if (products.length > 0) {
                    scraperLog(`Refreshed product ${product.product_id} — ${products[0].name}`);
                }
            } catch (e: any) {
                scraperLog(`Failed to refresh ${product.product_id}: ${e.message}`);
            }
        }
    }
}
