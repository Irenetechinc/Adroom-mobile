/**
 * Google Maps / Places Business Discovery Service
 * ------------------------------------------------
 * Searches nearby businesses using the Google Places API, fetches their
 * reviews, scores outreach potential, and returns structured prospects
 * ready for WhatsApp or email outreach.
 *
 * Required env vars:
 *   GOOGLE_MAPS_API_KEY  — a key with Places API (New) + Maps JavaScript API enabled
 */

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

export interface PlaceBusiness {
  place_id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  rating?: number;
  total_ratings?: number;
  business_status?: string;
  types?: string[];
  reviews?: PlaceReview[];
  outreach_score?: number;
  outreach_reason?: string;
}

export interface PlaceReview {
  author_name: string;
  rating: number;
  text: string;
  time: number;
}

export interface BusinessDiscoveryParams {
  location: string;
  keyword?: string;
  category?: string;
  radius?: number;
  maxResults?: number;
}

export interface DiscoveryResult {
  businesses: PlaceBusiness[];
  total_found: number;
  search_location: string;
}

function apiKey(): string {
  return process.env.GOOGLE_MAPS_API_KEY || '';
}

/**
 * Geocode a plain-text location into lat/lng.
 */
async function geocodeLocation(location: string): Promise<{ lat: number; lng: number } | null> {
  const key = apiKey();
  if (!key) return null;

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${key}`;
  try {
    const res = await fetch(url);
    const data: any = await res.json();
    if (data.status === 'OK' && data.results?.[0]) {
      return data.results[0].geometry.location;
    }
  } catch (e: any) {
    console.error('[GoogleMaps] Geocode error:', e.message);
  }
  return null;
}

/**
 * Search businesses using Places Nearby Search.
 */
async function searchNearbyBusinesses(
  lat: number,
  lng: number,
  keyword: string,
  radius: number,
  maxResults: number,
): Promise<PlaceBusiness[]> {
  const key = apiKey();
  if (!key) return [];

  const url =
    `${PLACES_BASE}/nearbysearch/json` +
    `?location=${lat},${lng}` +
    `&radius=${radius}` +
    `&keyword=${encodeURIComponent(keyword)}` +
    `&key=${key}`;

  try {
    const res = await fetch(url);
    const data: any = await res.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error('[GoogleMaps] Places search error:', data.status, data.error_message);
      return [];
    }

    const results: any[] = (data.results || []).slice(0, maxResults);

    return results.map((r: any) => ({
      place_id: r.place_id,
      name: r.name,
      address: r.vicinity || r.formatted_address || '',
      rating: r.rating,
      total_ratings: r.user_ratings_total,
      business_status: r.business_status,
      types: r.types || [],
    }));
  } catch (e: any) {
    console.error('[GoogleMaps] Nearby search error:', e.message);
    return [];
  }
}

/**
 * Fetch detailed info (phone, website, reviews) for a single place.
 */
async function getPlaceDetails(placeId: string): Promise<Partial<PlaceBusiness>> {
  const key = apiKey();
  if (!key) return {};

  const fields = 'formatted_phone_number,website,reviews,opening_hours';
  const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=${fields}&key=${key}`;

  try {
    const res = await fetch(url);
    const data: any = await res.json();
    const r = data.result || {};

    const reviews: PlaceReview[] = (r.reviews || []).slice(0, 5).map((rv: any) => ({
      author_name: rv.author_name,
      rating: rv.rating,
      text: rv.text,
      time: rv.time,
    }));

    return {
      phone: r.formatted_phone_number,
      website: r.website,
      reviews,
    };
  } catch (e: any) {
    console.error('[GoogleMaps] Place details error:', e.message);
    return {};
  }
}

/**
 * Score a business's outreach potential based on ratings + review sentiment.
 * Score 0-1:  0.8+ = hot prospect, 0.5–0.8 = warm, <0.5 = low priority.
 *
 * Heuristic (no AI call needed):
 *   - Rating 3.5-4.3 → actively improving, receptive to help (high score)
 *   - Rating < 3.5   → pain point, needs marketing support
 *   - Rating > 4.5   → already doing well, harder pitch but still viable
 *   - Few reviews (< 20) → hungry for visibility → high score
 *   - Recent negative reviews → pain, receptive
 */
function scoreOutreachPotential(biz: PlaceBusiness): { score: number; reason: string } {
  const rating = biz.rating ?? 4.0;
  const total = biz.total_ratings ?? 50;

  let score = 0.5;
  let reason = 'Standard prospect.';

  if (total < 20) {
    score += 0.25;
    reason = 'Few reviews — hungry for more visibility.';
  } else if (total < 50) {
    score += 0.1;
    reason = 'Growing business, still building their online presence.';
  }

  if (rating < 3.5) {
    score += 0.2;
    reason = 'Below-average rating — may need marketing to rebuild trust.';
  } else if (rating >= 3.5 && rating <= 4.3) {
    score += 0.15;
    reason = 'Good but not top-rated — actively seeking growth.';
  } else if (rating > 4.5) {
    score -= 0.05;
    reason = 'High-rated business — pitch value-add, not rescue.';
  }

  const negativeReviews = (biz.reviews || []).filter(r => r.rating <= 2).length;
  if (negativeReviews >= 2) {
    score += 0.1;
    reason += ' Has recent negative reviews — pain point identified.';
  }

  return { score: Math.min(1, Math.max(0, score)), reason: reason.trim() };
}

/**
 * Main entry point — discovers businesses, enriches with details, scores them.
 */
export async function discoverBusinesses(
  params: BusinessDiscoveryParams,
): Promise<DiscoveryResult> {
  const key = apiKey();
  if (!key) {
    console.warn('[GoogleMaps] GOOGLE_MAPS_API_KEY not set — returning empty result.');
    return { businesses: [], total_found: 0, search_location: params.location };
  }

  const radius = params.radius ?? 5000;
  const maxResults = Math.min(params.maxResults ?? 10, 20);
  const keyword = params.keyword || params.category || 'business';

  const coords = await geocodeLocation(params.location);
  if (!coords) {
    return { businesses: [], total_found: 0, search_location: params.location };
  }

  const businesses = await searchNearbyBusinesses(
    coords.lat,
    coords.lng,
    keyword,
    radius,
    maxResults,
  );

  const enriched: PlaceBusiness[] = await Promise.all(
    businesses.map(async (biz) => {
      const details = await getPlaceDetails(biz.place_id);
      const full: PlaceBusiness = { ...biz, ...details };
      const { score, reason } = scoreOutreachPotential(full);
      return { ...full, outreach_score: score, outreach_reason: reason };
    }),
  );

  enriched.sort((a, b) => (b.outreach_score ?? 0) - (a.outreach_score ?? 0));

  return {
    businesses: enriched,
    total_found: enriched.length,
    search_location: params.location,
  };
}

/**
 * Build a synchronous fallback outreach message (no AI — used as a last resort).
 */
export function buildOutreachMessage(biz: PlaceBusiness, senderName: string, productOrService: string): string {
  const firstName = biz.name.split(' ')[0];
  const reviewHint =
    (biz.reviews || []).length > 0
      ? `I noticed your recent reviews mention ${biz.reviews![0].text.slice(0, 60).replace(/\n/g, ' ')}…`
      : '';

  const ratingNote =
    biz.rating && biz.rating < 4
      ? `I can see there's room to grow your online presence`
      : `Your business already has a great reputation`;

  return (
    `Hi ${firstName}, I'm ${senderName} — I help local businesses like yours grow faster with AI-powered marketing. ` +
    `${ratingNote}${reviewHint ? ' and ' + reviewHint : '.'} ` +
    `I'd love to show you how ${productOrService} could bring in more customers this month. ` +
    `Would you be open to a quick chat?`
  ).replace(/\s+/g, ' ').trim();
}

/**
 * Build an AI-driven, psychologically-crafted outreach message using the
 * business's real review data, rating, and category combined with the
 * user's actual campaign goal / product / brand context.
 *
 * Falls back to the synchronous buildOutreachMessage() if the AI call fails.
 */
export async function buildOutreachMessageAI(
  biz: PlaceBusiness,
  senderName: string,
  productOrService: string,
  campaignContext?: {
    goal?: string;
    product?: string;
    brand?: string;
    targetAudience?: string;
    uniqueValue?: string;
  },
): Promise<string> {
  try {
    const { AIEngine } = await import('../config/ai-models');
    const ai = AIEngine.getInstance();

    const reviewSamples = (biz.reviews || []).slice(0, 3).map(r => ({
      rating: r.rating,
      text: r.text.slice(0, 200),
    }));

    const painSignals = [];
    if (biz.rating && biz.rating < 3.5) painSignals.push('below-average rating — likely needs more customers');
    if ((biz.total_ratings ?? 0) < 20) painSignals.push('very few reviews — hungry for visibility');
    if (reviewSamples.some(r => r.rating <= 2)) painSignals.push('has recent negative reviews — may need marketing help');

    const prompt = `You are a professional consultant named ${senderName} reaching out to a local business owner for the first time via WhatsApp or email. Your goal is NOT to sell — it is to start a genuine, human conversation that builds trust.

ABOUT YOU:
- Name: ${senderName}
- You offer: ${productOrService}
${campaignContext?.goal ? `- Your goal: ${campaignContext.goal}` : ''}

ABOUT THIS BUSINESS:
- Name: ${biz.name}
- Type: ${(biz.types || []).slice(0, 3).join(', ') || 'local business'}
- Rating: ${biz.rating ?? 'N/A'} / 5 (${biz.total_ratings ?? 0} reviews)
- Signals: ${painSignals.length ? painSignals.join('; ') : 'growing business'}
- Recent reviews: ${JSON.stringify(reviewSamples)}

RULES FOR THIS FIRST MESSAGE:
1. Start with something genuine and specific about THEIR business — a real observation, not a generic compliment.
2. Show you understand a real challenge they may be facing (based on the data above).
3. Ask ONE low-pressure, open-ended question — something any business owner would actually want to answer.
4. Do NOT mention your product or service in this first message. Do NOT pitch.
5. Sound like a real person — casual, direct, and warm. 2-3 short sentences maximum.
6. No bullet points. No emojis. No "I hope this message finds you well." Nothing corporate.
7. This is a WhatsApp message, not an email. Write like a human texting another human.
8. NEVER reference AI, automation, or software tools. You are a human consultant.

Return ONLY the message text — no quotes, no labels, no explanation.`;

    const response = await ai.generateStrategy({}, prompt);
    const text = (response.text || '').trim();
    if (text && text.length > 30) return text;
  } catch (e: any) {
    console.warn('[GoogleMaps] AI outreach message failed, using fallback:', e.message);
  }
  return buildOutreachMessage(biz, senderName, productOrService);
}
