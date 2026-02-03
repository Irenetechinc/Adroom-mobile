import { create } from 'zustand';
import { ChatMessage, ProductDetails, Strategy, CreativeAsset, ConnectionState } from '../types/agent';
import { CreativeService } from '../services/creative';
import { supabase } from '../services/supabase';
import { FacebookService, FacebookPage, FacebookAdAccount } from '../services/facebook';
import { AutonomousService } from '../services/autonomous';

// Helper to access OpenAI for chat analysis
const analyzeChatIntent = async (messages: ChatMessage[], productDetails: ProductDetails): Promise<Partial<ProductDetails>> => {
  const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return {}; 

  try {
    const conversation = messages.map(m => `${m.sender}: ${m.text}`).join('\n');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: "Analyze the conversation to extract product details. Return JSON: { \"category\": \"...\", \"targetAudience\": \"...\", \"name\": \"...\" (if mentioned) }. If unknown, leave blank."
          },
          {
            role: "user",
            content: `Current Details: ${JSON.stringify(productDetails)}\n\nConversation:\n${conversation}`
          }
        ],
        response_format: { type: "json_object" }
      })
    });
    
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  } catch (e) {
    console.error("Chat analysis failed", e);
    return {};
  }
};

interface AgentState {
  messages: ChatMessage[];
  isTyping: boolean;
  isInputDisabled: boolean;
  productDetails: ProductDetails;
  generatedStrategies: Strategy[];
  activeStrategy: Strategy | null;
  connectionState: ConnectionState;
  
  // Facebook Flow Data
  fbAccessToken: string | null;
  fetchedPages: FacebookPage[];
  fetchedAdAccounts: FacebookAdAccount[];
  selectedPage: FacebookPage | null;
  selectedAdAccount: FacebookAdAccount | null;

  addMessage: (text: string, sender: 'user' | 'agent', imageUri?: string, uiType?: ChatMessage['uiType'], uiData?: any) => void;
  setTyping: (typing: boolean) => void;
  setInputDisabled: (disabled: boolean) => void;
  updateProductDetails: (details: Partial<ProductDetails>) => void;
  generateStrategies: () => Promise<void>;
  analyzeContext: () => Promise<void>; 
  setActiveStrategy: (strategy: Strategy) => Promise<void>;
  updateActiveStrategy: (strategy: Strategy) => Promise<void>;
  loadActiveStrategy: () => Promise<void>; // Load from DB on app start
  loadMessages: () => Promise<void>; // Load chat history from DB
  resetAgent: () => void;
  
  // Interaction Handlers
  handleMarketingTypeSelection: (type: 'PRODUCT' | 'BRAND' | 'SERVICE' | 'BRAND_PRODUCT' | 'CUSTOM') => void;

  // Facebook Flow Actions
  initiateFacebookConnection: () => void;
  handleFacebookLogin: () => Promise<void>;
  handlePageSelection: (page: FacebookPage) => void;
  handleAdAccountSelection: (account: FacebookAdAccount) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isTyping: false,
  isInputDisabled: false,
  productDetails: {
    name: '',
    description: '',
  },
  generatedStrategies: [],
  activeStrategy: null,
  connectionState: 'IDLE',
  fbAccessToken: null,
  fetchedPages: [],
  fetchedAdAccounts: [],
  selectedPage: null,
  selectedAdAccount: null,

  addMessage: (text, sender, imageUri, uiType, uiData) => {
    const newMessage: ChatMessage = {
        id: Date.now().toString(),
        text,
        sender,
        timestamp: Date.now(),
        imageUri,
        uiType,
        uiData
    };

    set((state) => ({
      messages: [
        ...state.messages,
        newMessage,
      ],
    }));

    // Async persistence
    (async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await supabase.from('chat_history').insert({
                    user_id: user.id,
                    text,
                    sender,
                    image_uri: imageUri,
                    ui_type: uiType,
                    ui_data: uiData
                });
            }
        } catch (e) {
            console.error('Failed to save message:', e);
        }
    })();
  },

  setTyping: (typing) => set({ isTyping: typing }),
  setInputDisabled: (disabled) => set({ isInputDisabled: disabled }),

  updateProductDetails: (details) => {
    set((state) => ({
      productDetails: { ...state.productDetails, ...details },
    }));
  },

  analyzeContext: async () => {
    const { messages, productDetails, updateProductDetails } = get();
    if (messages.length > 0) {
      const extracted = await analyzeChatIntent(messages, productDetails);
      if (Object.keys(extracted).length > 0) {
        updateProductDetails(extracted);
      }
    }
  },

  generateStrategies: async () => {
    set({ isTyping: true });
    const { productDetails } = get();
    
    const brandVoice = productDetails.category === 'Fashion' || productDetails.category === 'Lifestyle' ? 'Playful' : 'Professional';
    const targetAudience = productDetails.targetAudience || 'General Audience';

    const baseImage = productDetails.baseImageUri || ''; 
    
    const [awarenessImage, conversionImage] = await Promise.all([
      CreativeService.generateCreative(baseImage, `Lifestyle shot of ${productDetails.name}`, "Modern"),
      CreativeService.generateCreative(baseImage, `Close-up product shot of ${productDetails.name}`, "Clean Studio")
    ]);

    const commonDetails = {
      title: `${productDetails.name || 'Product'} Launch`,
      description: `Market ${productDetails.name} to ${targetAudience}.`,
      lifespanWeeks: 4,
      targetAudience,
      brandVoice,
      keyMessage: `Discover ${productDetails.name}.`,
    };

    const strategies: Strategy[] = [
      {
        id: 'free_strategy',
        type: 'FREE',
        ...commonDetails,
        title: 'Organic Growth',
        description: 'Build community trust through authentic content.',
        platforms: ['Facebook Page', 'Instagram'],
        estimatedReach: '500 - 2k',
        cost: '$0.00',
        assets: [
          {
             id: 'asset_1',
             type: 'IMAGE',
             url: awarenessImage,
             prompt: 'Lifestyle shot',
             purpose: 'AWARENESS'
          }
        ],
        actions: ['Daily Post', 'Reply to Comments']
      },
      {
        id: 'paid_strategy',
        type: 'PAID',
        ...commonDetails,
        title: 'Sales Booster',
        description: 'Drive immediate conversions with targeted ads.',
        platforms: ['Facebook Ads'],
        estimatedReach: '10k - 50k',
        cost: '$500/mo',
        assets: [
          {
             id: 'asset_2',
             type: 'IMAGE',
             url: conversionImage,
             prompt: 'Product close-up',
             purpose: 'CONVERSION'
          }
        ],
        actions: ['Conversion Ads', 'Retargeting']
      }
    ];

    set({ 
      generatedStrategies: strategies,
      isTyping: false 
    });
  },

  setActiveStrategy: async (strategy) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Deactivate any existing strategies
    await supabase
      .from('strategies')
      .update({ is_active: false })
      .eq('user_id', user.id);

    // 2. Insert new active strategy
    const { data, error } = await supabase
      .from('strategies')
      .insert({
        user_id: user.id,
        type: strategy.type,
        title: strategy.title,
        description: strategy.description,
        target_audience: strategy.targetAudience,
        brand_voice: strategy.brandVoice,
        lifespan_weeks: strategy.lifespanWeeks,
        key_message: strategy.keyMessage,
        platforms: strategy.platforms,
        estimated_reach: strategy.estimatedReach,
        cost: strategy.cost,
        actions: strategy.actions,
        assets: strategy.assets,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to save strategy:', error);
    } else {
      // Map back to local Strategy type if needed, but for now we just keep the object in memory
      set({ activeStrategy: strategy });
    }
  },
  
  updateActiveStrategy: async (strategy) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Update the currently active strategy in DB
    // Assuming we can find it by is_active=true for this user
    await supabase
      .from('strategies')
      .update({
        actions: strategy.actions,
        description: strategy.description,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
      .eq('is_active', true);

    set({ activeStrategy: strategy });
  },

  loadActiveStrategy: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('strategies')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (data) {
      // Map DB snake_case to CamelCase
      const strategy: Strategy = {
        id: data.id,
        type: data.type as 'FREE' | 'PAID',
        title: data.title,
        description: data.description,
        targetAudience: data.target_audience,
        brandVoice: data.brand_voice,
        lifespanWeeks: data.lifespan_weeks,
        keyMessage: data.key_message,
        platforms: data.platforms,
        estimatedReach: data.estimated_reach,
        cost: data.cost,
        actions: data.actions,
        assets: data.assets,
      };
      set({ activeStrategy: strategy });
    }
  },

  loadMessages: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('chat_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (data) {
      const loadedMessages: ChatMessage[] = data.map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender as 'user' | 'agent',
        timestamp: new Date(m.created_at).getTime(),
        imageUri: m.image_uri,
        uiType: m.ui_type,
        uiData: m.ui_data
      }));
      set({ messages: loadedMessages });
    }
  },

  resetAgent: () => set({
    messages: [],
    isTyping: false,
    productDetails: { name: '', description: '' },
    generatedStrategies: []
  }),

  // --- Interaction Handlers ---
  handleMarketingTypeSelection: (type) => {
    const { addMessage, updateProductDetails, setInputDisabled, setTyping } = get();
    
    if (type === 'CUSTOM') {
      setInputDisabled(false);
      addMessage("Understood. Please describe what we are marketing today.", 'agent');
    } else {
      updateProductDetails({ marketingType: type as any });
      addMessage(`Selected: ${type.replace('_', ' + ')}`, 'user');
      setInputDisabled(false);
      
      setTyping(true);
      setTimeout(() => {
        addMessage(`Excellent choice. To begin, please upload a photo of your ${type.toLowerCase().replace('_', ' and ')}.`, 'agent');
        setTyping(false);
      }, 1000);
    }
  },

  // --- Facebook Flow Actions ---

  initiateFacebookConnection: () => {
    const { addMessage } = get();
    set({ connectionState: 'CONNECTING_FACEBOOK' });
    addMessage(
      "To execute this strategy, I need permission to manage your Facebook Ads. Please connect your account below.",
      'agent',
      undefined,
      'facebook_connect'
    );
  },

  handleFacebookLogin: async () => {
    const { addMessage } = get();
    set({ isTyping: true });
    
    try {
      const accessToken = await FacebookService.login();
      if (accessToken) {
        set({ fbAccessToken: accessToken });
        
        // Fetch Pages immediately
        const pages = await FacebookService.getPages(accessToken);
        set({ fetchedPages: pages, connectionState: 'SELECTING_PAGE', isTyping: false });
        
        addMessage(
          "Connection successful! Which Facebook Page should we use for this campaign?",
          'agent',
          undefined,
          'page_selection',
          { pages }
        );
      } else {
        set({ isTyping: false });
        addMessage("Connection cancelled. Please try again to proceed.", 'agent');
      }
    } catch (error) {
      console.error(error);
      set({ isTyping: false });
      addMessage("An error occurred during connection. Please try again.", 'agent');
    }
  },

  handlePageSelection: async (page: FacebookPage) => {
    const { addMessage, fbAccessToken } = get();
    set({ selectedPage: page, isTyping: true });
    
    addMessage(`Selected page: ${page.name}`, 'user');

    if (!fbAccessToken) return;

    try {
      const adAccounts = await FacebookService.getAdAccounts(fbAccessToken);
      set({ fetchedAdAccounts: adAccounts, connectionState: 'SELECTING_AD_ACCOUNT', isTyping: false });
      
      addMessage(
        "Great. Now, please select the Ad Account to use for billing and management.",
        'agent',
        undefined,
        'ad_account_selection',
        { adAccounts }
      );
    } catch (error) {
      set({ isTyping: false });
      addMessage("Failed to fetch ad accounts. Please ensure your permissions are correct.", 'agent');
    }
  },

  handleAdAccountSelection: async (account: FacebookAdAccount) => {
    const { addMessage, selectedPage, fbAccessToken, activeStrategy, productDetails } = get();
    set({ selectedAdAccount: account, isTyping: true });
    
    addMessage(`Selected Ad Account: ${account.name} (${account.account_id})`, 'user');

    if (selectedPage && fbAccessToken && activeStrategy) {
      try {
        await FacebookService.saveConfig(selectedPage.id, selectedPage.name, account.account_id, fbAccessToken);
        
        // Execute the strategy autonomously
        addMessage("Configuration saved. Initializing autonomous execution protocols...", 'agent');
        
        await AutonomousService.executeStrategy(activeStrategy, productDetails.baseImageUri);

        set({ connectionState: 'COMPLETED', isTyping: false });
        
        addMessage(
          "Configuration complete! I have everything I need.",
          'agent'
        );
        addMessage(
            "I have launched your campaign. You can monitor its performance in the Dashboard.",
            'agent',
            undefined,
            'completion_card'
        );

      } catch (error) {
        console.error("Execution failed:", error);
        set({ isTyping: false });
        addMessage("Failed to execute strategy. Please check your ad account permissions.", 'agent');
      }
    } else {
        set({ isTyping: false });
        if (!activeStrategy) addMessage("Error: No active strategy found to execute.", 'agent');
    }
  }

}));
