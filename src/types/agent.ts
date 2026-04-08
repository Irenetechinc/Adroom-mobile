
export interface CreativeAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO' | 'TEXT';
  url: string;
  prompt: string;
  purpose: 'AWARENESS' | 'CONVERSION' | 'RETARGETING';
}

export interface Strategy {
  id: string;
  title: string;
  description: string;
  targetAudience: string;
  brandVoice: string;
  lifespanWeeks: number;
  keyMessage: string;
  platforms: string[];
  estimatedReach: string;
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
    | 'completion_card' 
    | 'marketing_type_selection' 
    | 'facebook_credentials' 
    | 'attribute_editor' 
    | 'session_restore'
    | 'strategy_preview'
    // New Strategy Wizard Flow Types
    | 'product_intake_form'
    | 'website_intake_form'
    | 'service_intake_form'
    | 'brand_intake_form'
    | 'product_manual_form'
    | 'strategy_type_selection'
    | 'goal_selection'
    | 'duration_selection'
    | 'strategy_comparison'
    | 'retry_action'
    | 'create_strategy_prompt';
  uiData?: any; // Data for the custom UI
}

export interface ProductDetails {
  name: string;
  description: string;
  price?: string;
  currency?: string;
  targetAudience?: string;
  category?: string;
  baseImageUri?: string;
  marketingType?: 'PRODUCT' | 'BRAND' | 'SERVICE' | 'BRAND_PRODUCT';
  dimensions?: string;
  colorPalette?: string[];
  color?: string;
  sizes?: string[];
  quantity?: string;
  portfolioUrl?: string;
  mission?: string;
  values?: string;
  scanResult?: any;
  images?: { uri: string; base64: string | null }[];
}

export type ConnectionState = 'IDLE' | 'CONNECTING' | 'CONNECTING_FACEBOOK' | 'SELECTING_PAGE' | 'SELECTING_AD_ACCOUNT' | 'COMPLETED';

export type FlowState = 
  | 'IDLE' 
  | 'STRATEGY_TYPE_SELECTION' 
  | 'PRODUCT_INTAKE' 
  | 'SERVICE_INTAKE' 
  | 'BRAND_INTAKE' 
  | 'GOAL_SELECTION' 
  | 'DURATION_SELECTION' 
  | 'STRATEGY_GENERATION' 
  | 'COMPARISON' 
  | 'EXECUTION';
