import { CampaignStatus } from './campaign';

export interface Ad {
  id: string;
  user_id: string;
  ad_set_id: string;
  facebook_ad_id: string;
  name: string;
  status: CampaignStatus;
  creative_id?: string;
  preview_shareable_link?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAdInput {
  ad_set_id: string; // Supabase ID
  facebook_ad_set_id: string; // Facebook ID
  name: string;
  status: CampaignStatus;
  creative: {
    title: string;
    body: string;
    image_url: string; // URL to the image resource
  };
}
