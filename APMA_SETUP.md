# APMA Setup Guide — Autonomous Political Marketing Agent

> **Important:** APMA is a completely isolated system. It is accessible only through the admin panel and the Electron desktop app. The AdRoom mobile app has no routes, no UI, and no awareness of APMA.

---

## 1. Database Migration

Run `backend/apma_migration.sql` in your Supabase SQL Editor **after** all other AdRoom migrations:

```sql
-- Supabase SQL Editor → New Query → Paste backend/apma_migration.sql → Run
```

This creates 12 tables:
`apma_clients`, `apma_campaigns`, `political_conversations`, `political_strategies`,
`apma_personas`, `apma_actions`, `apma_blog_sites`, `apma_blog_articles`,
`apma_social_groups`, `apma_sentiment_history`, `apma_recommendations`, `apma_self_improvement_logs`

---

## 2. Required Environment Variables

Add these to your Replit (dev) and Railway (prod) environment:

### Social Listening (Perception Layer)
| Variable | Description |
|----------|-------------|
| `NEWSAPI_KEY` | NewsAPI.org key — for political news monitoring |
| `REDDIT_CLIENT_ID` | Reddit app client ID — for Reddit monitoring |
| `REDDIT_CLIENT_SECRET` | Reddit app client secret |
| `TWITTER_BEARER_TOKEN` | Twitter API v2 bearer token — for Twitter monitoring |

### Action Execution (Publishing)
| Variable | Description |
|----------|-------------|
| `TWITTER_APMA_OAUTH_TOKEN` | Twitter OAuth access token for APMA publishing account |
| `TWITTER_APMA_OAUTH_SECRET` | Twitter OAuth access secret |
| `FB_APMA_PAGE_TOKEN` | Facebook Page access token for APMA publishing |
| `FB_APMA_PAGE_ID` | Facebook Page ID |
| `REDDIT_APMA_ACCESS_TOKEN` | Reddit OAuth token for APMA posting account |
| `REDDIT_APMA_SUBREDDIT` | Default subreddit to post to (e.g. `r/Nigeria`) |

---

## 3. Create Your First APMA Client

Via the admin panel (`https://your-backend.com/admin` → login):

```http
POST /admin/api/apma/clients
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "name": "Candidate John Doe",
  "country": "NG",
  "goal": "improve",
  "target_entities": ["rival candidate name", "negative hashtags"],
  "target_score": 0.6
}
```

**Response includes `api_key`** — show it to the client ONCE, it is not retrievable.

---

## 4. Create a Campaign

```http
POST /admin/api/apma/clients/:clientId/campaigns
Authorization: Bearer <admin-jwt>

{
  "name": "2027 Governorship Campaign",
  "platforms": ["twitter", "facebook", "reddit"],
  "keywords": ["John Doe", "Lagos Governor", "infrastructure", "development"],
  "target_score": 0.65,
  "end_date": "2027-03-01"
}
```

---

## 5. How the Autonomous Cycle Works

Every 15 minutes, APMA:

1. **Perception** — Scans Twitter, Reddit, and NewsAPI for the campaign keywords
2. **Sentiment Analysis** — Uses Gemini 2.0 Flash to score every conversation
3. **Score Update** — Weighted-average narrative score written to DB
4. **Daily Plan** (once per day) — GPT-4o generates a full daily action plan
5. **Execution** — Humanizer picks personas, content is generated and published
6. **Blog Creation** — If the plan includes blog tasks, articles are auto-written
7. **Self-Improvement** — Every 6 hours, GPT-4o analyses the system and logs new skill suggestions

---

## 6. Persona Database

100+ Nigerian personas are seeded automatically when a client is created. Personas have:
- Name, age, occupation, location
- Writing style: formal / casual / slang / academic
- Emoji usage: none / low / medium / high
- Political lean: left / centre / right

Each persona rotates on a least-recently-used basis so no single identity is overused.

---

## 7. Admin API Reference

All admin routes require `Authorization: Bearer <admin-jwt>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/apma/stats` | System-wide APMA stats |
| GET | `/admin/api/apma/clients` | List all clients |
| POST | `/admin/api/apma/clients` | Create client |
| PATCH | `/admin/api/apma/clients/:id` | Update client |
| POST | `/admin/api/apma/clients/:id/rotate-key` | Rotate API key |
| POST | `/admin/api/apma/clients/:clientId/campaigns` | Create campaign |
| GET | `/admin/api/apma/clients/:clientId/campaigns` | List campaigns |
| GET | `/admin/api/apma/campaigns/:id/overview` | Full campaign data |
| POST | `/admin/api/apma/campaigns/:id/trigger` | Manual cycle trigger |
| GET | `/admin/api/apma/clients/:clientId/personas` | List personas |
| PATCH | `/admin/api/apma/personas/:id` | Enable/disable persona |
| GET | `/admin/api/apma/self-improvement` | Self-improvement logs |
| POST | `/admin/api/apma/self-improvement/:id/deploy` | Mark skill as deployed |

---

## 8. Client Desktop App

See `apma-desktop/README.md` for build and distribution instructions.

The client receives only their **API key** and the **backend URL** — no code, no admin access.
