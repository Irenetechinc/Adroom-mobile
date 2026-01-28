export interface Campaign {
  id: string;
  user_id: string;
  facebook_campaign_id: string;
  name: string;
  objective: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignInput {
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  special_ad_categories?: string[];
}

export enum CampaignObjective {
  OUTCOME_SALES = 'OUTCOME_SALES',
  OUTCOME_LEADS = 'OUTCOME_LEADS',
  OUTCOME_ENGAGEMENT = 'OUTCOME_ENGAGEMENT',
  OUTCOME_TRAFFIC = 'OUTCOME_TRAFFIC',
  OUTCOME_AWARENESS = 'OUTCOME_AWARENESS',
  OUTCOME_APP_PROMOTION = 'OUTCOME_APP_PROMOTION',
}

export enum CampaignStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
}
