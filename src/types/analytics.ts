export interface InsightMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  ctr: number;
  conversions: number;
  date_start: string;
  date_stop: string;
}

export interface CampaignInsights {
  campaign_id: string;
  campaign_name: string;
  metrics: InsightMetrics;
}

export interface OptimizationAction {
  id: string;
  campaign_id: string;
  type: 'PAUSE_AD' | 'INCREASE_BUDGET' | 'DECREASE_BUDGET' | 'CHANGE_BID_STRATEGY';
  reason: string;
  status: 'PENDING' | 'EXECUTED' | 'FAILED';
  timestamp: number;
}
