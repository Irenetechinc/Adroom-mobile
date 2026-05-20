export type NarrativeGoal = 'improve' | 'damage';
export type CampaignStatus = 'active' | 'paused' | 'completed';
export type CampaignType =
  | 'presidential' | 'gubernatorial' | 'senate' | 'house'
  | 'city_council' | 'mayoral' | 'public_perception';
export type CampaignSubtype =
  | 'build' | 'defend' | 'offensive' | 'defensive' | 'general';
export type ActionType =
  | 'post' | 'comment' | 'reply' | 'dm'
  | 'blog_create' | 'blog_article'
  | 'group_create' | 'group_post'
  | 'share' | 'like' | 'retweet';

export interface APMAClient {
  id: string;
  name: string;
  slug: string;
  country: string;
  goal: NarrativeGoal;
  target_entities: string[];
  status: string;
  api_key: string;
  narrative_score: number;
  baseline_score: number;
  target_score: number;
  created_at: string;
}

export interface APMACampaign {
  id: string;
  client_id: string;
  name: string;
  goal: NarrativeGoal;
  campaign_type: CampaignType;
  campaign_subtype: CampaignSubtype;
  duration_months: 6 | 12 | 18 | 24;
  status: CampaignStatus;
  start_date: string;
  end_date?: string;
  narrative_score_current: number;
  narrative_score_target: number;
  platforms: string[];
  keywords: string[];
  total_posts: number;
  total_comments: number;
  total_blogs: number;
  total_groups: number;
  config: Record<string, unknown>;
}

export interface APMAPersona {
  id: string;
  client_id?: string;
  name: string;
  age: number;
  gender: string;
  occupation: string;
  location: string;
  country: string;
  writing_style: 'formal' | 'casual' | 'slang' | 'academic';
  emoji_usage: 'none' | 'low' | 'medium' | 'high';
  political_lean: 'left' | 'centre' | 'right';
  bio?: string;
  avatar_url?: string;
  platforms: string[];
  platform_handles: Record<string, string>;
  active: boolean;
  usage_count?: number;
  last_used_at?: string;
}

export interface DailyPlan {
  date: string;
  objective: string;
  target_narrative: string;
  sentiment_shift_target: number;
  actions: PlanAction[];
  blog_tasks?: BlogTask[];
  group_tasks?: GroupTask[];
}

export interface PlanAction {
  type: ActionType;
  platform: string;
  count: number;
  narrative_angle: string;
  keywords: string[];
  persona_style?: string;
  priority: 'low' | 'medium' | 'high';
}

export interface BlogTask {
  domain: string;
  article_count: number;
  topics: string[];
  seo_keywords: string[];
}

export interface GroupTask {
  platform: string;
  name: string;
  description: string;
  initial_posts: number;
}

export interface PerceptionSnapshot {
  client_id: string;
  campaign_id: string;
  overall_sentiment: number;
  sample_size: number;
  dominant_topic: string;
  top_narratives: Array<{ topic: string; sentiment: number; volume: number }>;
  trending_keywords: string[];
  threat_signals: string[];
  opportunity_signals: string[];
}

export interface HumanizedContent {
  text: string;
  persona: APMAPersona;
  delay_ms: number;
  platform: string;
}

export interface ClientDashboardData {
  client: {
    name: string;
    goal: string;
    status: string;
  };
  campaign: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    narrative_score_current: number;
    narrative_score_target: number;
    score_delta: number;
  };
  sentiment_trend: Array<{ date: string; score: number }>;
  top_themes: Array<{ theme: string; sentiment: 'positive' | 'negative'; volume: number }>;
  actions_24h: {
    posts: number;
    comments: number;
    blog_articles: number;
    group_engagements: number;
    total: number;
  };
  recommendations: Array<{
    id: string;
    text: string;
    priority: string;
    status: string;
    created_at: string;
  }>;
}
