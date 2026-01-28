export interface CreativeAsset {
  id: string;
  type: 'IMAGE' | 'VIDEO';
  url: string; // Generated URL or Local Path
  prompt: string; // The prompt used to generate it
  purpose: 'AWARENESS' | 'CONVERSION' | 'RETARGETING';
}

export interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: number;
  imageUri?: string; // Support for user uploading an image in chat
}

export interface ProductDetails {
  name: string;
  description: string;
  price?: string;
  targetAudience?: string;
  category?: string;
  baseImageUri?: string; // The user's uploaded product image
}

export interface Strategy {
  id: string;
  type: 'FREE' | 'PAID';
  title: string;
  description: string;
  
  // Enhanced Strategy Details
  lifespanWeeks: number;
  targetAudience: string;
  brandVoice: string; // e.g., "Professional", "Playful", "Urgent"
  keyMessage: string;
  
  // Materials needed/generated
  assets: CreativeAsset[];
  
  platforms: string[];
  estimatedReach: string;
  cost: string;
  actions: string[]; // List of actions the bot will take
}
