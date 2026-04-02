import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
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

export class ScraperService {
    private supabase;
    private ai: AIEngine;

    constructor() {
        this.supabase = getServiceSupabaseClient();
        this.ai = AIEngine.getInstance();
    }

    /**
     * Scrapes a website for products and stores them in the database.
     */
    async scrapeWebsite(url: string, userId: string): Promise<ScrapedProduct[]> {
        console.log(`[Scraper] Starting scrape for: ${url}`);
        
        try {
            const response = await fetch(url);
            const html = await response.text();
            const $ = cheerio.load(html);
            
            const products: ScrapedProduct[] = [];
            
            // 1. Comprehensive product link discovery
            const links: string[] = [];
            $('a').each((_: number, el: cheerio.Element) => {
                const href = $(el).attr('href');
                if (href) {
                    const fullUrl = href.startsWith('http') ? href : new URL(href, url).toString();
                    const isProduct = 
                        fullUrl.includes('/product/') || 
                        fullUrl.includes('/p/') || 
                        fullUrl.includes('/item/') ||
                        fullUrl.includes('/shop/');
                    
                    if (isProduct && !links.includes(fullUrl)) links.push(fullUrl);
                }
            });

            // 2. Concurrent product page scraping
            const scrapeTasks = links.slice(0, 15).map(async (productUrl) => {
                const product = await this.scrapeProductPage(productUrl);
                if (product) {
                    await this.storeScrapedProduct(product, userId);
                    return product;
                }
                return null;
            });
            
            const results = await Promise.all(scrapeTasks);
            products.push(...results.filter((p): p is ScrapedProduct => p !== null));

            // 3. Update last_scraped_at
            await this.supabase.from('product_memory').update({
                last_scraped_at: new Date().toISOString()
            }).eq('website_url', url);

            return products;
        } catch (e) {
            console.error(`[Scraper] Website scrape failed for ${url}:`, e);
            throw e;
        }
    }

    private async scrapeProductPage(url: string): Promise<ScrapedProduct | null> {
        try {
            const response = await fetch(url);
            const html = await response.text();
            const $ = cheerio.load(html);

            // Extract basic data
            const name = $('h1').first().text().trim() || $('title').text().trim();
            const description = $('meta[name="description"]').attr('content') || $('.product-description').text().trim();
            const price = $('.price, .product-price, [itemprop="price"]').first().text().trim();
            
            const images: string[] = [];
            $('img').each((_: number, el: cheerio.Element) => {
                const src = $(el).attr('src');
                if (src && (src.includes('product') || src.includes('main'))) {
                    const fullSrc = src.startsWith('http') ? src : new URL(src, url).toString();
                    if (!images.includes(fullSrc)) images.push(fullSrc);
                }
            });

            if (!name) return null;

            // 4. Use AI to clean and categorize data
            const aiPrompt = `
                Analyze this scraped product data and refine it for marketing.
                NAME: ${name}
                DESCRIPTION: ${description}
                PRICE: ${price}
                
                OUTPUT JSON:
                {
                    "refined_name": "string",
                    "refined_description": "string",
                    "category": "string",
                    "target_audience": "string",
                    "usp": ["unique selling points"]
                }
            `;
            const aiResult = await this.ai.generateStrategy({}, aiPrompt);
            const refined = aiResult.parsedJson;

            return {
                name: refined?.refined_name || name,
                description: refined?.refined_description || description,
                price,
                images: images.slice(0, 5),
                url,
                category: refined?.category,
                metadata: refined
            };
        } catch (e) {
            console.warn(`[Scraper] Failed to scrape product page ${url}:`, e);
            return null;
        }
    }

    private async storeScrapedProduct(product: ScrapedProduct, userId: string) {
        await this.supabase.from('product_memory').upsert({
            user_id: userId,
            name: product.name,
            description: product.description,
            price: product.price,
            category: product.category,
            baseImageUri: product.images[0],
            website_url: product.url,
            conversation_context: { usp: product.metadata?.usp }
        }, { onConflict: 'user_id, name' });
    }
}
