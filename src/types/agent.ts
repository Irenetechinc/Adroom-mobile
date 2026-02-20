
export interface CreativeAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT';
  url: string;
  prompt: string;
  purpose: 'AWARENESS' | 'CONVERSION' | 'RETARGETING';
}

export interface Strategy {
  id: string;
  type: 'FREE' | 'PAID';
  title: string;
  description: string;
  targetAudience: string;
  brandVoice: string;
  lifespanWeeks: number;
  keyMessage: string;
  platforms: string[];
  estimatedReach: string;
  cost: string;
  budget: number; // Numeric budget in NGN
  assets: CreativeAsset[];
  actions: string[];
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: number;
  imageUri?: string;
  // Custom UI Types for Interactive Elements
  uiType?: 
    | 'standard' 
    | 'facebook_connect' 
    | 'page_selection' 
    | 'ad_account_selection' 
    | 'completion_card' 
    | 'marketing_type_selection' 
    | 'facebook_credentials' 
    | 'attribute_editor' 
    | 'session_restore'
    // New Strategy Wizard Flow Types
    | 'product_intake_form'
    | 'goal_selection'
    | 'duration_selection'
    | 'strategy_comparison';
  uiData?: any; // Data for the custom UI
}

export interface ProductDetails {
  name: string;
  description: string;
  price?: string;
  targetAudience?: string;
  category?: string;
  baseImageUri?: string;
  marketingType?: 'PRODUCT' | 'BRAND' | 'SERVICE' | 'BRAND_PRODUCT';
  dimensions?: string;
  colorPalette?: string[];
  // New fields
  scanResult?: any;
}

export type ConnectionState = 'IDLE' | 'CONNECTING_FACEBOOK' | 'SELECTING_PAGE' | 'SELECTING_AD_ACCOUNT' | 'COMPLETED';

export type FlowState = 'IDLE' | 'PRODUCT_INTAKE' | 'GOAL_SELECTION' | 'DURATION_SELECTION' | 'STRATEGY_GENERATION' | 'COMPARISON' | 'EXECUTION';
