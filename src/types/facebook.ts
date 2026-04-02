export interface FacebookConfig {
  id: string;
  user_id: string;
  ad_account_id?: string | null;
  access_token: string;
  page_id: string;
  page_name?: string;
  created_at: string;
  updated_at: string;
}

export interface FacebookConfigInput {
  access_token: string;
  page_id: string;
  page_name?: string;
}

export interface FacebookPage {
  id: string;
  name: string;
  access_token?: string;
  category?: string;
}

export interface AuthResponse {
  type: string;
  params?: {
    access_token?: string;
    expires_in?: string;
  };
  error?: any;
}
