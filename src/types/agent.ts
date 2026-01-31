import { CreativeAsset, Strategy } from './agent';

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: number;
  imageUri?: string;
  // Custom UI Types for Interactive Elements
  uiType?: 'standard' | 'facebook_connect' | 'page_selection' | 'ad_account_selection' | 'completion_card';
  uiData?: any; // Data for the custom UI (e.g. list of pages)
}

export interface ProductDetails {
  name: string;
  description: string;
  price?: string;
  targetAudience?: string;
  category?: string;
  baseImageUri?: string;
}

export type ConnectionState = 'IDLE' | 'CONNECTING_FACEBOOK' | 'SELECTING_PAGE' | 'SELECTING_AD_ACCOUNT' | 'COMPLETED';

export { Strategy, CreativeAsset };
