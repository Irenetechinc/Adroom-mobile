import { CampaignStatus } from './campaign';

export interface AdSet {
  id: string;
  user_id: string;
  campaign_id: string;
  facebook_ad_set_id: string;
  name: string;
  daily_budget: number;
  billing_event: BillingEvent;
  optimization_goal: OptimizationGoal;
  status: CampaignStatus; // Reusing active/paused
  start_time: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAdSetInput {
  campaign_id: string; // Supabase ID
  facebook_campaign_id: string; // Facebook ID
  name: string;
  daily_budget: number; // In cents
  billing_event: BillingEvent;
  optimization_goal: OptimizationGoal;
  status: CampaignStatus;
}

export enum BillingEvent {
  IMPRESSIONS = 'IMPRESSIONS',
  LINK_CLICKS = 'LINK_CLICKS',
}

export enum OptimizationGoal {
  REACH = 'REACH',
  LINK_CLICKS = 'LINK_CLICKS',
  IMPRESSIONS = 'IMPRESSIONS',
  OFFSITE_CONVERSIONS = 'OFFSITE_CONVERSIONS',
}
