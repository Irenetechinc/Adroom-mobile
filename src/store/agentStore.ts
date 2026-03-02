import { create } from 'zustand';
import { ChatMessage, ProductDetails, ConnectionState, FlowState } from '../types/agent';
import { supabase } from '../services/supabase';
import { FacebookService, FacebookPage, FacebookAdAccount } from '../services/facebook';
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
  handleRetry: (action: string, data: any) => Promise<void>;
  handleManualProductSubmit: (data: any) => Promise<void>;
  handleStrategyTypeSelection: (type: string) => void;
  handleImageUpload: (uri: string) => Promise<void>;
  
  // Standard Actions
  setActiveStrategy: (strategy: any) => Promise<void>;
  updateActiveStrategy: (strategy: any) => Promise<void>;
  loadActiveStrategy: () => Promise<void>;
  loadMessages: () => Promise<void>;
  resetAgent: () => void;
  restoreSession: () => Promise<void>;
  startNewSession: () => Promise<void>;
  
  // Facebook
  initiateFacebookConnection: (fromFlow?: boolean) => void;
  handleFacebookLogin: () => Promise<void>;
  fetchPages: () => Promise<void>;
  handlePageSelection: (page: FacebookPage) => Promise<void>;
  handleAdAccountSelection: (account: FacebookAdAccount) => Promise<void>;
  disconnectFacebook: () => Promise<void>;
  handleMarketingTypeSelection: () => void;
  analyzeContext: () => Promise<void>;
}

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
    const { addMessage, setTyping } = get();
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
    set({ flowState: type.toUpperCase() === 'PRODUCT' ? 'PRODUCT_INTAKE' : 'SERVICE_INTAKE' as any, isInputDisabled: true });
    
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
    const { addMessage, setTyping, updateProductDetails } = get();
    set({ isTyping: true });
    
    addMessage(data.baseImageUri ? "Analyzing product image..." : "Saving product details...", 'user');

    try {
        // Integrity Check
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + (data.description || ""));
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent', undefined, 'retry_action', { action: 'PRODUCT_INTAKE', data });
            return;
        }

        const validatedData = {
            ...data,
            name: integrity.cleanedText?.split(' ')[0] || data.name,
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
        addMessage(`Error: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'PRODUCT_INTAKE', data });
    }
  },

  handleServiceIntake: async (data: any) => {
    const { addMessage, setTyping, updateProductDetails } = get();
    set({ isTyping: true });
    
    addMessage(`Service: ${data.name}`, 'user');

    try {
        // Integrity Check
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + (data.description || ""));
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent', undefined, 'retry_action', { action: 'SERVICE_INTAKE', data });
            return;
        }

        const validatedData = {
            ...data,
            description: integrity.cleanedText || data.description
        };

        // Services use Product table for now or a dedicated one
        const serviceId = await ProductService.saveProduct({
            ...validatedData,
            images: data.images || [],
            baseImageUri: '' 
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
        addMessage(`Error: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'SERVICE_INTAKE', data });
    }
  },

  handleBrandIntake: async (data: any) => {
    const { addMessage, setTyping, updateProductDetails } = get();
    set({ isTyping: true });
    
    addMessage(`Brand: ${data.name}`, 'user');

    try {
        // Integrity Check
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + (data.mission || ""));
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent', undefined, 'retry_action', { action: 'BRAND_INTAKE', data });
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
            images: data.images || [],
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
        addMessage(`Error: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'BRAND_INTAKE', data });
    }
  },

  handleManualProductSubmit: async (data: any) => {
    const { addMessage, handleProductIntake } = get();
    addMessage(`Product: ${data.name}`, 'user');
    await handleProductIntake({ ...data, images: data.images || [] });
  },

  handleRetry: async (action: string, data: any) => {
    const { handleProductIntake, handleServiceIntake, handleBrandIntake, handleManualProductSubmit, handleImageUpload, handlePageSelection, handleFacebookLogin, addMessage } = get();
    addMessage("Retrying last action...", 'agent');
    
    switch(action) {
        case 'PRODUCT_INTAKE': 
            addMessage("Please re-enter product details:", 'agent', undefined, 'product_intake_form', data);
            break;
        case 'SERVICE_INTAKE': 
            addMessage("Please re-enter service details:", 'agent', undefined, 'service_intake_form', data);
            break;
        case 'BRAND_INTAKE': 
            addMessage("Please re-enter brand details:", 'agent', undefined, 'brand_intake_form', data);
            break;
        case 'PRODUCT_MANUAL': 
            addMessage("Please re-enter product details manually:", 'agent', undefined, 'product_manual_form', data);
            break;
        case 'IMAGE_UPLOAD': 
            addMessage("Please re-upload image:", 'agent', undefined, 'product_intake_form', data);
            break;
        case 'PAGE_SELECTION': 
            addMessage("Please re-select your Facebook page:", 'agent', undefined, 'page_selection', { pages: data });
            break;
        case 'FB_LOGIN': 
            addMessage("Please try connecting to Facebook again:", 'agent', undefined, 'facebook_connect');
            break;
        default: addMessage("I'm not sure what to retry. Let's try starting over.", 'agent');
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
      const { addMessage, updateProductDetails, productDetails } = get();
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

  handleImageUpload: async (uri: string, base64: string) => {
    const { addMessage, setTyping, handleProductIntake } = get();
    set({ isTyping: true });
    
    try {
        const attributes = await VisionService.analyzeProductImage(base64);
        
        await handleProductIntake({
            name: attributes.name,
            description: attributes.description,
            baseImageUri: uri,
            scanResult: attributes,
            targetAudience: attributes.suggested_target_audience,
            price: attributes.estimatedPrice,
            category: attributes.category
        });
        
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Analysis failed: ${error.message}. Would you like to try uploading again?`, 'agent', undefined, 'retry_action', { action: 'IMAGE_UPLOAD', data: { uri, base64 } });
    }
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
                "Welcome back! You have an incomplete session. Would you like to resume your last action?",
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
         await get().startNewSession();
      }
    } else {
       await get().startNewSession();
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

    if (data && data.length > 0) {
      const loadedMessages: ChatMessage[] = data.map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender as 'user' | 'agent',
        timestamp: new Date(m.created_at).getTime(),
        imageUri: m.image_uri,
        uiType: m.ui_type,
        uiData: m.ui_data
      }));
      
      const lastMsg = data[data.length - 1];
      const needsDisabled = ['strategy_type_selection', 'product_intake_form', 'product_manual_form', 'service_intake_form', 'brand_intake_form', 'goal_selection', 'duration_selection', 'strategy_comparison', 'facebook_connect', 'page_selection', 'ad_account_selection', 'retry_action'].includes(lastMsg.ui_type);

      set({ 
        messages: loadedMessages, 
        isTyping: false, 
        isInputDisabled: needsDisabled,
        flowState: lastMsg.ui_type === 'completion_card' ? 'IDLE' : lastMsg.ui_type.toUpperCase().replace('_FORM', '_INTAKE').replace('_SELECTION', '_SELECTION') as FlowState,
      });

      get().addMessage(
          `Welcome back! We were right here:`, 
          'agent', 
          undefined, 
          lastMsg.ui_type, 
          lastMsg.ui_data
      );
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

    const { addMessage, setTyping, startStrategyFlow } = get();
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
  
  // --- Facebook Flow ---
  
  initiateFacebookConnection: (fromFlow = false) => {
    const { addMessage, fbAccessToken, activeStrategy } = get();
    
    // Check if connected
    if (fbAccessToken) {
        if (activeStrategy) {
            addMessage("Facebook is already connected. Proceeding with your strategy execution...", 'agent');
            // Continue flow
        } else {
            addMessage("Facebook is connected. Since you don't have an active strategy yet, let's create one!", 'agent');
            get().startStrategyFlow();
        }
        return;
    }

    set({ connectionState: 'CONNECTING_FACEBOOK', isInputDisabled: true });
    
    const msg = fromFlow 
        ? "To launch this strategy, I need to connect to your Facebook Business account."
        : "Let's connect your Facebook account so I can manage your ads autonomously.";

    addMessage(msg, 'agent', undefined, 'facebook_connect');
  },

  handleFacebookLogin: async () => {
      const { addMessage, handlePageSelection } = get();
      set({ isTyping: true, isInputDisabled: true });
      try {
          const token = await FacebookService.login();
          if (token) {
              set({ fbAccessToken: token, connectionState: 'SELECTING_PAGE' });
              const pages = await FacebookService.getPages(token);
              set({ fetchedPages: pages, isTyping: false });
              
              if (pages.length === 1) {
                  // Auto-select if only one page
                  addMessage(`Connected! Found 1 page: ${pages[0].name}. Selecting it automatically...`, 'agent');
                  await handlePageSelection(pages[0]);
              } else if (pages.length > 1) {
                  addMessage(
                      "Successfully connected to Facebook! Please select the page you want to use for this strategy:",
                      'agent',
                      undefined,
                      'page_selection',
                      { pages }
                  );
              } else {
                  addMessage("Successfully connected, but no Facebook pages were found. Please ensure you are an admin of at least one page.", 'agent');
              }
          }
      } catch (error: any) {
          set({ isTyping: false });
          addMessage(`Facebook connection failed: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'FB_LOGIN', data: null });
      }
  },

  fetchPages: async () => {
      const { fbAccessToken } = get();
      if (fbAccessToken) {
          const pages = await FacebookService.getPages(fbAccessToken);
          set({ fetchedPages: pages });
      }
  },

  handlePageSelection: async (page: FacebookPage) => {
      const { addMessage, fbAccessToken } = get();
      set({ selectedPage: page, isTyping: true, isInputDisabled: true });
      addMessage(`Selected Page: ${page.name}`, 'user');
      
      if (fbAccessToken) {
          try {
              const accounts = await FacebookService.getAdAccounts(fbAccessToken);
              set({ fetchedAdAccounts: accounts, connectionState: 'SELECTING_AD_ACCOUNT', isTyping: false });
              
              if (accounts.length > 0) {
                  addMessage(
                      `Great. Now select the Ad Account for ${page.name}:`,
                      'agent',
                      undefined,
                      'ad_account_selection',
                      { adAccounts: accounts }
                  );
              } else {
                  addMessage("No Ad Accounts found. Please ensure you have an active Ad Account linked to your Business Manager.", 'agent');
              }
          } catch (error: any) {
              set({ isTyping: false });
              addMessage(`Error fetching accounts: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'PAGE_SELECTION', data: page });
          }
      }
  },

  handleAdAccountSelection: async (account: FacebookAdAccount) => {
      const { addMessage, selectedPage, fbAccessToken } = get();
      set({ selectedAdAccount: account, isTyping: true, isInputDisabled: true });
      addMessage(`Selected Account: ${account.name}`, 'user');
      
      // Save Config
      if (selectedPage && selectedPage.access_token) { // Use selectedPage.access_token
          await FacebookService.saveConfig(selectedPage.id, selectedPage.name, account.id, selectedPage.access_token);
      }
      
      set({ connectionState: 'COMPLETED', isTyping: false, isInputDisabled: true });
      
      addMessage("Configuration saved. Launching campaign...", 'agent');
      
      const { activeStrategy, generatedStrategies, setActiveStrategy, updateActiveStrategy } = get();

      if (activeStrategy) {
          // If there's an active strategy, update it
          await updateActiveStrategy(activeStrategy);
      } else if (generatedStrategies) {
          // If a strategy was just generated, set it as active
          const strategyToActivate = generatedStrategies.free || generatedStrategies.paid; // Assuming one is selected
          if (strategyToActivate) {
              await setActiveStrategy(strategyToActivate);
          }
      }
      
      addMessage("Campaign Active! Monitoring performance.", 'agent', undefined, 'completion_card');
  },

  disconnectFacebook: async () => {
      set({ fbAccessToken: null });
  },

  handleMarketingTypeSelection: () => {},
  analyzeContext: async () => {}

}));
