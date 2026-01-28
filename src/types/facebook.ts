export interface FacebookConfig {
  id: string;
  user_id: string;
  ad_account_id: string;
  access_token: string;
  page_id: string;
  created_at: string;
  updated_at: string;
}

export interface FacebookConfigInput {
  ad_account_id: string;
  access_token: string;
  page_id: string;
}
