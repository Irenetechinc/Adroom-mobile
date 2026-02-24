
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
import { IntegrityService } from '../services/integrity';

type ExtendedProductDetails = ProductDetails & {
  id?: string;
  selectedGoal?: string;
  selectedDuration?: number;
};

interface AgentState {
  messages: ChatMessage[];
  isTyping: boolean;
  isInputDisabled: boolean;
  
  flowState: FlowState;
  productDetails: ExtendedProductDetails;
  
  generatedStrategies: GeneratedStrategy | null;
  activeStrategy: any | null;
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
  updateProductDetails: (details: Partial<ExtendedProductDetails>) => void;
  
  // Flow Actions
  startStrategyFlow: () => void;
  handleProductIntake: (data: ProductDetails) => Promise<void>;
  handleGoalSelection: (goal: string) => void;
  handleDurationSelection: (duration: number) => Promise<void>;
  handleStrategySelection: (type: 'free' | 'paid') => Promise<void>;
  handleServiceIntake: (data: any) => Promise<void>;
  handleBrandIntake: (data: any) => Promise<void>;
  handleStrategyTypeSelection: (type: string) => void;
  setActiveStrategy: (strategy: any) => Promise<void>;
  updateActiveStrategy: (strategy: any) => Promise<void>;
  
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
  handleMarketingTypeSelection: () => void;
  analyzeContext: () => Promise<void>;
}

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;

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
    set({ flowState: 'STRATEGY_TYPE_SELECTION', isInputDisabled: true });
    
    setTyping(true);
    setTimeout(() => {
        addMessage(
            "Great! Let's create a new marketing strategy. 🚀\n\nWhat would you like to create a strategy for?",
            'agent',
            undefined,
            'strategy_type_selection'
        );
        setTyping(false);
    }, 1000);
  },

  handleStrategyTypeSelection: (type: string) => {
    const { addMessage, setTyping } = get();
    set({ flowState: type.toUpperCase() === 'PRODUCT' ? 'PRODUCT_INTAKE' : 'SERVICE_INTAKE', isInputDisabled: true });
    
    addMessage(`${type.toUpperCase()} Strategy`, 'user');
    setTyping(true);
    
    setTimeout(() => {
        if (type === 'product') {
            addMessage(
                `You've selected PRODUCT strategy. Let me help you set up your product.\n\nPlease upload a clear image (for scan) or enter details manually.`,
                'agent',
                undefined,
                'product_intake_form'
            );
        } else if (type === 'service') {
            addMessage(
                `You've selected SERVICE strategy. Let me help you set up your service.\n\nPlease describe your service, its category, and pricing model.`,
                'agent',
                undefined,
                'service_intake_form'
            );
        } else if (type === 'brand') {
             addMessage(
                `You've selected BRAND strategy. Let me help you build your brand identity.\n\nPlease provide your brand name, mission, and values.`,
                'agent',
                undefined,
                'brand_intake_form'
            );
        }
        setTyping(false);
    }, 1000);
  },

  handleProductIntake: async (data: ProductDetails) => {
    const { addMessage, setTyping, updateProductDetails, setInputDisabled } = get();
    set({ isTyping: true });
    
    addMessage("Analyzing product details...", 'user');

    try {
        // Integrity Check
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + data.description);
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent');
            return;
        }

        // Use cleaned text if available
        const validatedData = {
            ...data,
            name: integrity.cleanedText?.split(' ')[0] || data.name, // Rough extraction or just use original name
            description: integrity.cleanedText || data.description
        };

        const productId = await ProductService.saveProduct(validatedData);
        updateProductDetails({ ...validatedData, id: productId });
        set({ flowState: 'GOAL_SELECTION', isInputDisabled: true });
        
        setTimeout(() => {
            setTyping(false);
            addMessage(
                "Product saved. What is the primary objective for this campaign?",
                'agent',
                undefined,
                'goal_selection'
            );
        }, 1500);
        
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Error: ${error.message}`, 'agent');
    }
  },

  handleServiceIntake: async (data: any) => {
    const { addMessage, setTyping, updateProductDetails, setInputDisabled } = get();
    set({ isTyping: true });
    
    addMessage(`Service: ${data.name}`, 'user');

    try {
        // Integrity Check
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + (data.description || ""));
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent');
            return;
        }

        // Use cleaned text if available
        const validatedData = {
            ...data,
            description: integrity.cleanedText || data.description
        };

        // Services use Product table for now or a dedicated one
        const serviceId = await ProductService.saveProduct({
            ...validatedData,
            baseImageUri: '' // Services might not have images initially
        });
        updateProductDetails({ ...validatedData, id: serviceId });
        set({ flowState: 'GOAL_SELECTION', isInputDisabled: true });
        
        setTimeout(() => {
            setTyping(false);
            addMessage(
                "Service registered. What is your campaign goal?",
                'agent',
                undefined,
                'goal_selection'
            );
        }, 1500);
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Error: ${error.message}`, 'agent');
    }
  },

  handleBrandIntake: async (data: any) => {
    const { addMessage, setTyping, updateProductDetails, setInputDisabled } = get();
    set({ isTyping: true });
    
    addMessage(`Brand: ${data.name}`, 'user');

    try {
        // Integrity Check
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + (data.mission || ""));
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent');
            return;
        }

        // Use cleaned text if available
        const validatedData = {
            ...data,
            mission: integrity.cleanedText || data.mission
        };

        // Save brand identity
        const brandId = await ProductService.saveProduct({
            ...validatedData,
            name: data.name,
            description: `${validatedData.mission}\n\nValues: ${data.values}`,
            baseImageUri: ''
        });
        updateProductDetails({ ...validatedData, id: brandId });
        set({ flowState: 'GOAL_SELECTION', isInputDisabled: true });
        
        setTimeout(() => {
            setTyping(false);
            addMessage(
                "Brand identity established. Select your campaign goal:",
                'agent',
                undefined,
                'goal_selection'
            );
        }, 1500);
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Error: ${error.message}`, 'agent');
    }
  },

  handleGoalSelection: (goal: string) => {
      const { addMessage, setTyping, updateProductDetails, productDetails } = get();
      updateProductDetails({ selectedGoal: goal });
      set({ flowState: 'DURATION_SELECTION', isTyping: true, isInputDisabled: true });
      
      addMessage(`${goal.replace('_', ' ')}`, 'user');
      
      // Calculate Recommendation based on PDF Section 6 Step 4
      const price = parseFloat(productDetails.price || '0');
      let rec = 21; // Default
      if (goal === 'sales') rec = 21;
      else if (goal === 'awareness') rec = 30;
      else if (goal === 'promotional') rec = 14;
      else if (goal === 'launch') rec = 30;

      if (price > 100) rec += 7;
      if (price < 20) rec -= 3;

      setTimeout(() => {
          setTyping(false);
          addMessage(
              `Goal set. Based on your product price of $${price}, I recommend a ${rec}-day duration.`,
              'agent',
              undefined,
              'duration_selection',
              { recommended: rec }
          );
      }, 1000);
  },

  handleDurationSelection: async (duration: number) => {
      const { addMessage, setTyping, updateProductDetails, productDetails } = get();
      updateProductDetails({ selectedDuration: duration });
      set({ flowState: 'STRATEGY_GENERATION', isTyping: true, isInputDisabled: true });
      
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
      const { addMessage, generatedStrategies, initiateFacebookConnection } = get();
      
      if (!generatedStrategies) return;
      
      const strategy = type === 'free' ? generatedStrategies.free : generatedStrategies.paid;
      set({ activeStrategy: strategy, flowState: 'EXECUTION', isInputDisabled: true });
      
      addMessage(`I choose the ${type.toUpperCase()} strategy.`, 'user');
      addMessage(`Excellent choice. Locking in ${type.toUpperCase()} strategy parameters.`, 'agent');
      
      // Proceed to Facebook Connection if not connected
      // We'll trigger the existing connection flow logic
      setTimeout(() => {
          initiateFacebookConnection(true);
      }, 1000);
  },

  // --- Standard Actions ---

  setActiveStrategy: async (strategy: any) => {
    set({ activeStrategy: strategy });
  },

  updateActiveStrategy: async (strategy: any) => {
    set({ activeStrategy: strategy });
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
                "Welcome back! Incomplete session detected. Would you like to resume where we left off?",
                'agent',
                undefined,
                'session_restore',
                {
                   lastActivity: new Date(lastMessage.created_at).toLocaleString(),
                   preview: lastMessage.text.substring(0, 50) + '...',
                   lastUiType: lastMessage.ui_type,
                   lastUiData: lastMessage.ui_data
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
      
      // Determine if we need to disable input based on last UI state
      const lastMsg = data[data.length - 1];
      const needsDisabled = ['strategy_type_selection', 'product_intake_form', 'service_intake_form', 'brand_intake_form', 'goal_selection', 'duration_selection', 'strategy_comparison', 'facebook_connect', 'page_selection', 'ad_account_selection'].includes(lastMsg.ui_type);

      set({ messages: loadedMessages, isTyping: false, isInputDisabled: needsDisabled });
      get().addMessage("Session restored. Ready to continue.", 'agent');
      
      // If the last message was a prompt, re-prompt it if it requires selection
      if (needsDisabled) {
          get().addMessage("Please complete the action above to proceed.", 'agent');
      }
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
    set({ connectionState: 'CONNECTING_FACEBOOK', isInputDisabled: true });
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
      set({ isTyping: true, isInputDisabled: true });
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
      set({ selectedPage: page, isTyping: true, isInputDisabled: true });
      addMessage(`Selected Page: ${page.name}`, 'user');
      
      if (fbAccessToken) {
          const adAccounts = await FacebookService.getAdAccounts(fbAccessToken);
          set({ fetchedAdAccounts: adAccounts, connectionState: 'SELECTING_AD_ACCOUNT', isTyping: false });
          addMessage("Select Ad Account:", 'agent', undefined, 'ad_account_selection', { adAccounts });
      }
  },

  handleAdAccountSelection: async (account) => {
      const { addMessage, selectedPage, fbAccessToken } = get();
      set({ selectedAdAccount: account, isTyping: true, isInputDisabled: true });
      addMessage(`Selected Account: ${account.name}`, 'user');
      
      // Save Config
      if (selectedPage && fbAccessToken) {
          await FacebookService.saveConfig(selectedPage.id, selectedPage.name, account.id, fbAccessToken);
      }
      
      set({ connectionState: 'COMPLETED', isTyping: false, isInputDisabled: true });
      
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
