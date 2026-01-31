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

export interface FacebookPage {
  id: string;
  name: string;
  access_token?: string;
  category?: string;
}

export interface AdAccount {
  id: string;
  name: string;
  account_id: string;
  currency?: string;
}

export interface AuthResponse {
  type: string;
  params?: {
    access_token?: string;
    expires_in?: string;
  };
  error?: any;
}
