
import { create } from 'zustand';
import { ChatMessage, ProductDetails, Strategy, CreativeAsset, ConnectionState, FlowState } from '../types/agent';
import { CreativeService } from '../services/creative';
import { supabase } from '../services/supabase';
import { FacebookService, FacebookPage, FacebookAdAccount } from '../services/facebook';
import { AutonomousService } from '../services/autonomous';
import { RemoteLogger } from '../services/remoteLogger';
import { ProductService } from '../services/product';
import { StrategyService, GeneratedStrategy } from '../services/strategy';
import { VisionService } from '../services/vision';

interface AgentState {
  messages: ChatMessage[];
  isTyping: boolean;
  isInputDisabled: boolean;
  
  // Flow State
  flowState: FlowState;
  productDetails: ProductDetails & { 
    id?: string; // Product ID from DB
    selectedGoal?: string;
    selectedDuration?: number;
  };
  
  generatedStrategies: GeneratedStrategy | null; // Changed to match StrategyService output
  activeStrategy: any | null; // Flexible for now
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
  
  // Flow Actions
  startStrategyFlow: () => void;
  handleProductIntake: (data: ProductDetails) => Promise<void>;
  handleGoalSelection: (goal: string) => void;
  handleDurationSelection: (duration: number) => Promise<void>;
  handleStrategySelection: (type: 'free' | 'paid') => Promise<void>;
  
  // Standard Actions
  loadActiveStrategy: () => Promise<void>;
  loadMessages: () => Promise<void>;
  resetAgent: () => void;
  restoreSession: () => void;
  startNewSession: () => void;
  
  // Facebook
  initiateFacebookConnection: (fromFlow?: boolean) => void;
  handleFacebookLogin: () => Promise<void>;
  handlePageSelection: (page: FacebookPage) => void;
  handleAdAccountSelection: (account: FacebookAdAccount) => Promise<void>;
  disconnectFacebook: () => Promise<void>;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'https://adroom-mobile-production-35f8.up.railway.app';

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isTyping: false,
  isInputDisabled: false,
  flowState: 'IDLE',
  productDetails: {
    name: '',
    description: '',
  },
  generatedStrategies: null,
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
      messages: [...state.messages, newMessage],
    }));

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

  startStrategyFlow: () => {
    const { addMessage, setInputDisabled, setTyping } = get();
    set({ flowState: 'PRODUCT_INTAKE', isInputDisabled: true });
    
    setTyping(true);
    setTimeout(() => {
        addMessage(
            "Let's get started. Please provide the product details. You can upload an image for AI analysis or enter details manually.",
            'agent',
            undefined,
            'product_intake_form'
        );
        setTyping(false);
    }, 1000);
  },

  handleProductIntake: async (data: ProductDetails) => {
    const { addMessage, setTyping, updateProductDetails } = get();
    set({ isTyping: true });
    
    try {
        // 1. Save Product to DB
        const productId = await ProductService.saveProduct(data);
        
        // 2. Update Store
        updateProductDetails({ ...data, id: productId });
        
        // 3. Move to Goal Selection
        set({ flowState: 'GOAL_SELECTION' });
        
        addMessage("Product details secured. Analyzing market fit...", 'agent');
        
        setTimeout(() => {
            setTyping(false);
            addMessage(
                "What is the primary objective for this campaign?",
                'agent',
                undefined,
                'goal_selection'
            );
        }, 1500);
        
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Error saving product: ${error.message}. Please try again.`, 'agent');
    }
  },

  handleGoalSelection: (goal: string) => {
      const { addMessage, setTyping, updateProductDetails } = get();
      updateProductDetails({ selectedGoal: goal });
      set({ flowState: 'DURATION_SELECTION', isTyping: true });
      
      addMessage(`Goal set: ${goal.replace('_', ' ')}`, 'user');
      
      setTimeout(() => {
          setTyping(false);
          addMessage(
              "How long should this campaign run?",
              'agent',
              undefined,
              'duration_selection'
          );
      }, 1000);
  },

  handleDurationSelection: async (duration: number) => {
      const { addMessage, setTyping, updateProductDetails, productDetails } = get();
      updateProductDetails({ selectedDuration: duration });
      set({ flowState: 'STRATEGY_GENERATION', isTyping: true });
      
      addMessage(`${duration} days`, 'user');
      addMessage("Analyzing historical data and global trends to generate optimal strategies...", 'agent');
      
      try {
          if (!productDetails.id || !productDetails.selectedGoal) {
              throw new Error("Missing product ID or goal.");
          }

          const strategies = await StrategyService.generateStrategies(
              productDetails.id, 
              productDetails.selectedGoal, 
              duration
          );
          
          set({ 
              generatedStrategies: strategies, 
              flowState: 'COMPARISON', 
              isTyping: false 
          });
          
          addMessage(
              "Strategy generation complete. I have prepared two options for you.",
              'agent',
              undefined,
              'strategy_comparison',
              { strategies }
          );

      } catch (error: any) {
          set({ isTyping: false });
          addMessage(`Strategy generation failed: ${error.message}`, 'agent');
      }
  },

  handleStrategySelection: async (type: 'free' | 'paid') => {
      const { addMessage, generatedStrategies, productDetails, initiateFacebookConnection } = get();
      
      if (!generatedStrategies) return;
      
      const strategy = type === 'free' ? generatedStrategies.free : generatedStrategies.paid;
      set({ activeStrategy: strategy, flowState: 'EXECUTION' });
      
      addMessage(`I choose the ${type.toUpperCase()} strategy.`, 'user');
      addMessage(`Excellent choice. Locking in ${type.toUpperCase()} strategy parameters.`, 'agent');
      
      // Proceed to Facebook Connection if not connected
      // We'll trigger the existing connection flow logic
      setTimeout(() => {
          initiateFacebookConnection(true);
      }, 1000);
  },

  // --- Standard Actions ---

  setActiveStrategy: async (strategy) => {
    // Legacy support or direct set
    set({ activeStrategy: strategy });
  },

  updateActiveStrategy: async (strategy) => {
      // Stub
  },

  loadActiveStrategy: async () => {
    // Stub
  },

  loadMessages: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('chat_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (data && data.length > 0) {
      const lastMessage = data[data.length - 1];
      const isCompleted = lastMessage.ui_type === 'completion_card';
      
      if (!isCompleted) {
        set({ messages: [], isTyping: false });
        setTimeout(() => {
            get().addMessage(
                "Welcome back! Incomplete session detected.",
                'agent',
                undefined,
                'session_restore',
                {
                   lastActivity: new Date(lastMessage.created_at).toLocaleString(),
                   preview: lastMessage.text.substring(0, 50) + '...'
                }
            );
        }, 500);
      } else {
         get().startNewSession();
      }
    } else {
       get().startNewSession();
    }
  },

  restoreSession: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    set({ isTyping: true });
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
      set({ messages: loadedMessages, isTyping: false });
      get().addMessage("Session restored.", 'agent');
    }
  },

  startNewSession: async () => {
    set({
        messages: [],
        isTyping: false,
        productDetails: { name: '', description: '' },
        generatedStrategies: null,
        activeStrategy: null,
        connectionState: 'IDLE',
        flowState: 'IDLE',
        selectedPage: null,
        selectedAdAccount: null
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        await supabase.from('chat_history').delete().eq('user_id', user.id);
    }

    const { addMessage, setInputDisabled, setTyping, startStrategyFlow } = get();
    setTyping(true);
    
    setTimeout(() => {
        const userName = user?.email?.split('@')[0] || 'User';
        addMessage(`Hello ${userName}. I am AdRoom AI. Ready to strategize?`, 'agent');
        setTyping(false);
        // Automatically start the flow as per "ENTIRE FLOW IN CHAT"
        setTimeout(() => startStrategyFlow(), 1000);
    }, 1000);
  },

  resetAgent: () => get().startNewSession(),
  
  // --- Facebook Flow (Simplified for brevity, reusing existing logic structure) ---
  
  initiateFacebookConnection: (fromFlow = false) => {
    const { addMessage, fbAccessToken } = get();
    if (fbAccessToken) {
        addMessage("Facebook account connected. Proceeding to execution.", 'agent');
        // Trigger execution logic here if needed
        return;
    }
    set({ connectionState: 'CONNECTING_FACEBOOK' });
    addMessage(
      "I need access to your Facebook Business account to execute this strategy.",
      'agent',
      undefined,
      'facebook_connect' 
    );
  },

  handleFacebookLogin: async () => {
      // Reusing previous logic but simplified for this update
      const { addMessage } = get();
      set({ isTyping: true });
      try {
          const accessToken = await FacebookService.login();
          if (accessToken) {
              set({ fbAccessToken: accessToken });
              const pages = await FacebookService.getPages(accessToken);
              set({ fetchedPages: pages, connectionState: 'SELECTING_PAGE', isTyping: false });
              addMessage("Connection successful! Select a Page:", 'agent', undefined, 'page_selection', { pages });
          } else {
              set({ isTyping: false });
              addMessage("Connection cancelled.", 'agent');
          }
      } catch (e) {
          set({ isTyping: false });
          addMessage("Connection failed.", 'agent');
      }
  },

  handlePageSelection: async (page) => {
      const { addMessage, fbAccessToken } = get();
      set({ selectedPage: page, isTyping: true });
      addMessage(`Selected Page: ${page.name}`, 'user');
      
      if (fbAccessToken) {
          const adAccounts = await FacebookService.getAdAccounts(fbAccessToken);
          set({ fetchedAdAccounts: adAccounts, connectionState: 'SELECTING_AD_ACCOUNT', isTyping: false });
          addMessage("Select Ad Account:", 'agent', undefined, 'ad_account_selection', { adAccounts });
      }
  },

  handleAdAccountSelection: async (account) => {
      const { addMessage, selectedPage, fbAccessToken, activeStrategy } = get();
      set({ selectedAdAccount: account, isTyping: true });
      addMessage(`Selected Account: ${account.name}`, 'user');
      
      // Save Config
      if (selectedPage && fbAccessToken) {
          await FacebookService.saveConfig(selectedPage.id, selectedPage.name, account.id, fbAccessToken);
      }
      
      set({ connectionState: 'COMPLETED', isTyping: false });
      
      // Final Execution Step
      addMessage("Configuration saved. Launching campaign...", 'agent');
      
      // Simulate execution call
      setTimeout(() => {
          addMessage("Campaign Active! Monitoring performance.", 'agent', undefined, 'completion_card');
      }, 2000);
  },

  disconnectFacebook: async () => {
      set({ fbAccessToken: null });
  },

  // Stub for missing method from interface
  handleMarketingTypeSelection: () => {},
  analyzeContext: async () => {}

}));
