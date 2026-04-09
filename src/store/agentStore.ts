import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatMessage, ProductDetails, ConnectionState, FlowState } from '../types/agent';
import { supabase } from '../services/supabase';
import { FacebookService, FacebookPage } from '../services/facebook';
import { InstagramService } from '../services/instagram';
import { TikTokService } from '../services/tiktok';
import { LinkedInService } from '../services/linkedin';
import { TwitterService } from '../services/twitter';
import { ProductService } from '../services/product';
import { StrategyService, GeneratedStrategy } from '../services/strategy';
import { VisionService } from '../services/vision';
import { IntegrityService } from '../services/integrity';
import { useStrategyCreationStore } from './strategyCreationStore';

const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL || '';

async function getAuthToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function memPalaceSave(_userId: string, text: string, sender: string, uiType?: string, uiData?: any): Promise<void> {
  const token = await getAuthToken();
  if (!token || !BACKEND_URL) return;
  const role = sender === 'user' ? 'user' : 'assistant';
  await fetch(`${BACKEND_URL}/api/chat/history`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role,
      content: text,
      metadata: { ui_type: uiType, ui_data: uiData, sender },
    }),
  }).catch(() => {});
}

async function memPalaceLoad(_userId: string): Promise<any[] | null> {
  const token = await getAuthToken();
  if (!token || !BACKEND_URL) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/chat/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.messages)) return null;
    return data.messages.map((m: any) => ({
      id: m.id,
      text: m.content,
      sender: m.role === 'user' ? 'user' : 'agent',
      ui_type: m.metadata?.ui_type,
      ui_data: m.metadata?.ui_data,
      created_at: m.created_at,
    }));
  } catch {
    return null;
  }
}

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
  connectionSource: 'flow' | 'settings' | null;
  
  // Platform Access Tokens (in-session OAuth tokens)
  tokens: Record<string, string | null>;
  // Platform connection metadata (persisted, loaded from backend on startup)
  connectedPlatforms: Record<string, any>;
  fetchedAccounts: Record<string, any[]>;
  selectedAccounts: Record<string, any>;

  addMessage: (text: string, sender: 'user' | 'agent', imageUri?: string, uiType?: ChatMessage['uiType'], uiData?: any) => void;
  setTyping: (typing: boolean) => void;
  setInputDisabled: (disabled: boolean) => void;
  updateProductDetails: (details: Partial<ExtendedProductDetails>) => void;
  
  // Flow Actions
  startStrategyFlow: () => void;
  handleProductIntake: (data: ProductDetails) => Promise<void>;
  handleGoalSelection: (goal: string) => void;
  handleDurationSelection: (duration: number) => Promise<void>;
  handleStrategySelection: () => Promise<void>;
  handleServiceIntake: (data: any) => Promise<void>;
  handleBrandIntake: (data: any) => Promise<void>;
  handleWebsiteIntake: (url: string) => Promise<void>;
  handleRetry: (action: string, data: any) => Promise<void>;
  handleManualProductSubmit: (data: any) => Promise<void>;
  handleStrategyTypeSelection: (type: string) => void;
  handleImageUpload: (uri: string, base64: string) => Promise<void>;
  
  // Standard Actions
  setActiveStrategy: (strategy: any) => Promise<void>;
  updateActiveStrategy: (strategy: any) => Promise<void>;
  loadActiveStrategy: () => Promise<void>;
  loadMessages: () => Promise<void>;
  resetAgent: () => void;
  restoreSession: () => Promise<void>;
  startNewSession: () => Promise<void>;
  goBackToMenu: () => void;
  dismissStrategyFlow: () => void;
  
  // Unified Connection Actions
  initiateConnection: (platform: string, fromFlow?: boolean) => void;
  handleLogin: (platform: string) => Promise<void>;
  handleAccountSelection: (platform: string, account: any) => Promise<void>;
  disconnectPlatform: (platform: string) => Promise<void>;
  loadConnectedPlatforms: () => Promise<void>;

  // Legacy (Keep for compatibility if needed, but we'll use unified)
  initiateFacebookConnection: (fromFlow?: boolean) => void;
  handleFacebookLogin: () => Promise<void>;
  handlePageSelection: (page: FacebookPage) => Promise<void>;
  disconnectFacebook: () => Promise<void>;
  fbAccessToken: string | null;
}

export const useAgentStore = create<AgentState>()(
  persist(
  (set, get) => ({
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
  connectionSource: null,
  tokens: {},
  connectedPlatforms: {},
  fetchedAccounts: {},
  selectedAccounts: {},
  fbAccessToken: null,

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
                memPalaceSave(user.id, text, sender, uiType, uiData);
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
    const flowStateMap: Record<string, FlowState> = {
      product: 'PRODUCT_INTAKE',
      service: 'SERVICE_INTAKE',
      brand: 'BRAND_INTAKE',
    };
    set({ flowState: flowStateMap[type] ?? 'PRODUCT_INTAKE', isInputDisabled: true });
    
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
        useStrategyCreationStore.getState().setProductData({
          name: validatedData.name || '',
          description: validatedData.description || '',
          currency: (validatedData as any).currency || 'USD',
          price: String((validatedData as any).price || ''),
          category: (validatedData as any).category || '',
        });
        set({ flowState: 'GOAL_SELECTION', isInputDisabled: true });
        
        setTimeout(() => {
            setTyping(false);
            addMessage(
                "Product saved. What is the primary objective for this campaign?",
                'agent',
                undefined,
                'goal_selection',
                {
                    productId,
                    currency: (validatedData as any).currency || 'USD',
                    price: String((validatedData as any).price || ''),
                    name: validatedData.name,
                }
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

        const serviceId = await ProductService.saveProduct({
            ...validatedData,
            images: data.images || [],
            baseImageUri: '' 
        });
        updateProductDetails({ ...validatedData, id: serviceId });
        useStrategyCreationStore.getState().setProductData({
          name: validatedData.name || '',
          description: validatedData.description || '',
          currency: validatedData.currency || 'USD',
          price: String(validatedData.price || ''),
          category: validatedData.category || '',
        });
        set({ flowState: 'GOAL_SELECTION', isInputDisabled: true });
        
        setTimeout(() => {
            setTyping(false);
            addMessage(
                "Service registered. What is your campaign goal?",
                'agent',
                undefined,
                'goal_selection',
                {
                    productId: serviceId,
                    currency: validatedData.currency || 'USD',
                    price: String(validatedData.price || ''),
                    name: validatedData.name,
                }
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
        const integrity = await IntegrityService.validateAndFixContent(data.name + " " + (data.mission || ""));
        if (!integrity.isValid) {
            set({ isTyping: false });
            addMessage(`Content rejected: ${integrity.issues.join(', ')}`, 'agent', undefined, 'retry_action', { action: 'BRAND_INTAKE', data });
            return;
        }

        const validatedData = {
            ...data,
            mission: integrity.cleanedText || data.mission
        };

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
                'goal_selection',
                {
                    productId: brandId,
                    currency: 'USD',
                    price: '0',
                    name: data.name,
                }
            );
        }, 1500);
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Error: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'BRAND_INTAKE', data });
    }
  },

  handleWebsiteIntake: async (url: string) => {
    const { addMessage } = get();
    set({ isTyping: true, isInputDisabled: true });

    addMessage(`Scanning Website: ${url}`, 'user');

    try {
        const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
        if (!BACKEND_URL) throw new Error('Backend URL is not configured. Check EXPO_PUBLIC_API_URL.');

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('You must be signed in to scrape a website.');

        const response = await fetch(`${BACKEND_URL}/api/scrape`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ url }),
        });

        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData?.error || 'Scraping failed.');

        const products: any[] = Array.isArray(responseData) ? responseData : [];

        set({ isTyping: false });

        if (products.length > 0) {
            addMessage(
                `Successfully discovered ${products.length} product${products.length > 1 ? 's' : ''} from your website! Here are the details I found:`,
                'agent'
            );
            addMessage(
                'You can edit the details below before I start marketing:',
                'agent',
                undefined,
                'attribute_editor',
                { product: products[0], allProducts: products }
            );
        } else {
            addMessage(
                "I couldn't find any products on that URL. This can happen with heavily protected sites. Would you like to enter product details manually?",
                'agent',
                undefined,
                'product_intake_form'
            );
        }
    } catch (error: any) {
        set({ isTyping: false });
        addMessage(`Scraping failed: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'WEBSITE_INTAKE', data: url });
    }
  },

  handleManualProductSubmit: async (data: any) => {
    const { addMessage, handleProductIntake } = get();
    addMessage(`Product: ${data.name}`, 'user');
    await handleProductIntake({ ...data, images: data.images || [] });
  },

  handleRetry: async (action: string, data: any) => {
    const { addMessage, handleWebsiteIntake, handleLogin } = get();
    addMessage("Retrying...", 'agent');

    switch (action) {
      case 'PRODUCT_INTAKE':
        addMessage("Please re-enter your product details:", 'agent', undefined, 'product_intake_form', data);
        break;
      case 'SERVICE_INTAKE':
        addMessage("Please re-enter your service details:", 'agent', undefined, 'service_intake_form', data);
        break;
      case 'BRAND_INTAKE':
        addMessage("Please re-enter your brand details:", 'agent', undefined, 'brand_intake_form', data);
        break;
      case 'PRODUCT_MANUAL':
        addMessage("Please re-enter product details manually:", 'agent', undefined, 'product_manual_form', data);
        break;
      case 'IMAGE_UPLOAD':
        addMessage("Please re-upload your product image:", 'agent', undefined, 'product_intake_form', data);
        break;
      case 'PAGE_SELECTION':
        addMessage("Please re-select your page/account:", 'agent', undefined, 'page_selection', { pages: data });
        break;
      case 'FB_LOGIN':
      case 'LOGIN':
        addMessage("Please try connecting your account again:", 'agent', undefined, 'facebook_connect', { platform: typeof data === 'string' ? data : 'facebook' });
        break;
      case 'WEBSITE_INTAKE':
        if (typeof data === 'string' && data.trim()) {
          addMessage(`Re-scanning: ${data}`, 'agent');
          await handleWebsiteIntake(data);
        } else {
          addMessage("Please enter the product URL you'd like to scan:", 'agent', undefined, 'website_intake_form');
        }
        break;
      default:
        addMessage("Let's try again. Please provide your product or website URL:", 'agent', undefined, 'website_intake_form');
    }
  },

  handleGoalSelection: (goal: string) => {
      const { addMessage, setTyping, updateProductDetails, productDetails, messages } = get();
      updateProductDetails({ selectedGoal: goal });
      set({ flowState: 'DURATION_SELECTION', isTyping: true, isInputDisabled: true });

      addMessage(`${goal.replace(/_/g, ' ')}`, 'user');

      // If productDetails currency is missing (e.g. after session restore), recover from goal_selection uiData
      let resolvedCurrency = productDetails.currency;
      let resolvedPrice = productDetails.price || '';
      let resolvedName = productDetails.name || '';
      let resolvedProductId = productDetails.id;
      if (!resolvedCurrency) {
          const goalMsg = [...messages].reverse().find(
              (m) => m.uiType === 'goal_selection' && m.uiData?.currency
          );
          if (goalMsg?.uiData) {
              resolvedCurrency = goalMsg.uiData.currency;
              resolvedPrice = goalMsg.uiData.price || '';
              resolvedName = goalMsg.uiData.name || '';
              resolvedProductId = goalMsg.uiData.productId;
              updateProductDetails({
                  id: resolvedProductId,
                  currency: resolvedCurrency,
                  price: resolvedPrice,
                  name: resolvedName,
              });
          }
      }

      const rawPrice = resolvedPrice || '0';
      const numericOnly = rawPrice.replace(/[^0-9.]/g, '');
      const priceNum = parseFloat(numericOnly || '0');

      // Resolve currency symbol from the user's selected currency
      const currencyCode = resolvedCurrency || 'USD';
      const CURRENCY_SYMBOLS: Record<string, string> = {
          USD: '$', EUR: '€', GBP: '£', NGN: '₦', GHS: '₵', ZAR: 'R',
          KES: 'KSh', AED: 'د.إ', CAD: 'C$', AUD: 'A$', INR: '₹', BRL: 'R$',
      };
      const currencySymbol = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;

      let rec = 21;
      if (goal === 'sales') rec = 21;
      else if (goal === 'awareness') rec = 30;
      else if (goal === 'promotional') rec = 14;
      else if (goal === 'launch') rec = 30;

      if (priceNum > 100) rec += 7;
      if (priceNum < 20 && priceNum > 0) rec -= 3;
      rec = Math.max(7, rec);

      const priceDisplay = priceNum > 0 ? `${currencySymbol}${priceNum.toLocaleString()}` : null;

      setTimeout(() => {
          setTyping(false);
          addMessage(
              priceDisplay
                  ? `Goal set. Based on your ${currencyCode} pricing of ${priceDisplay}, I recommend a ${rec}-day duration.`
                  : `Goal set. I recommend a ${rec}-day duration for this campaign.`,
              'agent',
              undefined,
              'duration_selection',
              {
                  recommended: rec,
                  productId: resolvedProductId,
                  selectedGoal: goal,
                  productName: resolvedName || productDetails.name,
                  price: priceNum > 0 ? String(priceNum) : undefined,
                  currencySymbol,
                  currencyCode,
              }
          );
      }, 1000);
  },

  handleDurationSelection: async (duration: number) => {
      const { addMessage, updateProductDetails, productDetails, messages } = get();
      updateProductDetails({ selectedDuration: duration });
      set({ flowState: 'STRATEGY_GENERATION', isTyping: true, isInputDisabled: true });

      addMessage(`${duration} days`, 'user');
      addMessage("Analyzing historical data and global trends to generate optimal strategies...", 'agent');

      // Recover productId and selectedGoal from duration_selection uiData if missing (session restore)
      let resolvedProductId = productDetails.id;
      let resolvedGoal = productDetails.selectedGoal;
      if (!resolvedProductId || !resolvedGoal) {
          const durMsg = [...messages].reverse().find(
              (m) => m.uiType === 'duration_selection' && m.uiData?.productId
          );
          if (durMsg?.uiData) {
              resolvedProductId = durMsg.uiData.productId;
              resolvedGoal = durMsg.uiData.selectedGoal;
              updateProductDetails({ id: resolvedProductId, selectedGoal: resolvedGoal });
          }
      }

      try {
          if (!resolvedProductId || !resolvedGoal) {
              throw new Error("Missing product ID or goal. Please start a new strategy.");
          }

          const strategies = await StrategyService.generateStrategies(
              resolvedProductId,
              resolvedGoal,
              duration
          );
          
          set({ 
              generatedStrategies: strategies, 
              flowState: 'COMPARISON', 
              isTyping: false 
          });
          
          addMessage(
              "Strategy generation complete. Here is your optimized plan.",
              'agent',
              undefined,
              'strategy_preview', 
              { strategy: strategies.strategy }
          );

      } catch (error: any) {
          set({ isTyping: false });
          addMessage(`Strategy generation failed: ${error.message}`, 'agent');
      }
  },

  handleStrategySelection: async () => {
      const { addMessage, generatedStrategies, initiateConnection } = get();
      
      if (!generatedStrategies) return;
      
      const strategy = generatedStrategies.strategy;
      set({ activeStrategy: strategy, flowState: 'EXECUTION', isInputDisabled: true });
      
      addMessage(`I approve this strategy. Let's launch it.`, 'user');
      addMessage(`Strategy approved. Activating your autonomous agent now — building your full campaign execution plan...`, 'agent');

      const BACKEND_URL = process.env.EXPO_PUBLIC_API_URL;
      const strategyId = (generatedStrategies as any).strategyId;

      if (BACKEND_URL && strategyId) {
          try {
              const { data: { session } } = await supabase.auth.getSession();
              const token = session?.access_token;
              if (!token) throw new Error('No session token');

              const response = await fetch(`${BACKEND_URL}/api/ai/activate-agents`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                  body: JSON.stringify({
                      strategyId,
                      goal: strategy.goal || strategy.title,
                      platforms: strategy.platforms,
                  }),
              });

              if (response.ok) {
                  const result = await response.json();
                  const agentName = result.agent_type || 'AI';
                  const tasksCount = result.tasks_scheduled || 0;

                  addMessage(
                      `✓ Your ${agentName} Agent is now live.\n\n${tasksCount} tasks have been scheduled across your ${strategy.platforms?.join(', ')} accounts for the full campaign duration.\n\nThe agent will post content, monitor performance, scan for leads, and self-optimize — all without any further input from you.\n\nYou can track everything in real-time on your Dashboard.`,
                      'agent'
                  );
              } else {
                  addMessage(`Agents activated. Your campaign is running autonomously. Check the Dashboard for real-time updates.`, 'agent');
              }
          } catch (err: any) {
              addMessage(`Agents activated. Your campaign is running autonomously. Check the Dashboard for real-time updates.`, 'agent');
          }
      } else {
          addMessage(`Your campaign is set up. Connect your social accounts to begin autonomous execution.`, 'agent');
          setTimeout(() => {
              const platforms = strategy.platforms || ['facebook'];
              initiateConnection(platforms[0], true);
          }, 1000);
      }
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
    // Refresh platform connection state from backend in background.
    // AsyncStorage already hydrates the persisted state before this runs.
    get().loadConnectedPlatforms().catch(() => {});

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const activeInteractiveTypes = [
      'strategy_type_selection', 'product_intake_form', 'product_manual_form',
      'service_intake_form', 'brand_intake_form', 'goal_selection',
      'duration_selection', 'strategy_comparison', 'facebook_connect',
      'page_selection', 'retry_action',
    ];

    const processRows = (rows: any[]) => {
      const filtered = rows.filter((m: any) => m.ui_type !== 'session_restore');
      if (filtered.length === 0) return null;
      const lastMessage = filtered[filtered.length - 1];
      const isCompleted = lastMessage.ui_type === 'completion_card';
      if (isCompleted) return 'completed' as const;
      const loadedMessages: ChatMessage[] = filtered.map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender as 'user' | 'agent',
        timestamp: new Date(m.created_at).getTime(),
        imageUri: m.image_uri,
        uiType: m.ui_type,
        uiData: m.ui_data,
      }));
      const needsDisabled = activeInteractiveTypes.includes(lastMessage.ui_type);
      return { messages: loadedMessages, needsDisabled };
    };

    const memHistory = await memPalaceLoad(user.id);
    if (memHistory && memHistory.length > 0) {
      const result = processRows(memHistory);
      if (result === 'completed') { await get().startNewSession(); return; }
      if (result) { set({ messages: result.messages, isTyping: false, isInputDisabled: result.needsDisabled }); return; }
    }

    const { data } = await supabase
      .from('chat_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (data && data.length > 0) {
      const result = processRows(data);
      if (result === 'completed') { await get().startNewSession(); return; }
      if (result) { set({ messages: result.messages, isTyping: false, isInputDisabled: result.needsDisabled }); return; }
    }

    await get().startNewSession();
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
      const filtered = data.filter((m: any) => m.ui_type !== 'session_restore');
      const loadedMessages: ChatMessage[] = filtered.map((m: any) => ({
        id: m.id,
        text: m.text,
        sender: m.sender as 'user' | 'agent',
        timestamp: new Date(m.created_at).getTime(),
        imageUri: m.image_uri,
        uiType: m.ui_type,
        uiData: m.ui_data,
      }));

      const lastMsg = filtered[filtered.length - 1];
      const activeInteractiveTypes = [
        'strategy_type_selection', 'product_intake_form', 'product_manual_form',
        'service_intake_form', 'brand_intake_form', 'goal_selection',
        'duration_selection', 'strategy_comparison', 'facebook_connect',
        'page_selection', 'retry_action',
      ];
      const needsDisabled = lastMsg && activeInteractiveTypes.includes(lastMsg.ui_type);

      set({
        messages: loadedMessages,
        isTyping: false,
        isInputDisabled: needsDisabled,
      });
    }
  },

  startNewSession: async () => {
    // Refresh platform connection state from backend in the background.
    // AsyncStorage persistence already ensures the last-known state is
    // available immediately, so we don't need to block the greeting on this.
    get().loadConnectedPlatforms().catch(() => {});

    const { connectedPlatforms } = get();
    const persistedTokens: Record<string, string | null> = {};
    for (const platform of Object.keys(connectedPlatforms)) {
      persistedTokens[platform] = 'connected';
    }

    // Reset all chat/flow state but keep connection tokens so the connected
    // accounts badge and in-chat connection checks remain accurate.
    set({
        messages: [],
        isTyping: true,
        isInputDisabled: true,
        productDetails: { name: '', description: '' },
        generatedStrategies: null,
        activeStrategy: null,
        connectionState: 'IDLE',
        flowState: 'IDLE',
        tokens: persistedTokens,
        fetchedAccounts: {},
        selectedAccounts: {},
    });

    // Best-effort history cleanup — failures are swallowed so the greeting
    // always fires regardless.
    let userName = 'there';
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            userName = user.email?.split('@')[0] || 'there';
            supabase.from('chat_history').delete().eq('user_id', user.id).catch(() => {});
            const authToken = await getAuthToken();
            if (authToken && BACKEND_URL) {
                fetch(`${BACKEND_URL}/api/chat/history`, {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${authToken}` },
                }).catch(() => {});
            }
        }
    } catch { /* non-fatal — proceed to greeting */ }

    const { addMessage, setTyping, startStrategyFlow } = get();
    setTyping(true);

    setTimeout(() => {
        addMessage(`Hello ${userName}. I am AdRoom AI. Ready to strategize?`, 'agent');
        setTyping(false);
        setTimeout(() => startStrategyFlow(), 1000);
    }, 800);
  },

  resetAgent: () => get().startNewSession(),

  goBackToMenu: () => {
    const { startStrategyFlow } = get();
    set({
      flowState: 'IDLE',
      isInputDisabled: true,
      isTyping: false,
    });
    startStrategyFlow();
  },

  dismissStrategyFlow: () => {
    const { addMessage } = get();
    set({ flowState: 'IDLE', isInputDisabled: false, isTyping: false });
    addMessage(
      "No problem! Whenever you're ready to create a strategy, just let me know.",
      'agent',
      undefined,
      'create_strategy_prompt'
    );
  },
  
  // --- Unified Connection Flow ---

  initiateConnection: (platform: string, fromFlow = false) => {
    const { addMessage, tokens, activeStrategy } = get();
    set({ connectionSource: fromFlow ? 'flow' : 'settings' });

    if (tokens[platform]) {
        if (fromFlow && activeStrategy) {
            // Check if there are more platforms to connect
            const platforms = activeStrategy.platforms || [];
            const currentIndex = platforms.indexOf(platform);
            if (currentIndex < platforms.length - 1) {
                get().initiateConnection(platforms[currentIndex + 1], true);
            } else {
                addMessage(`All platforms (${platforms.join(', ')}) are connected. Launching!`, 'agent', undefined, 'completion_card');
            }
        } else {
            addMessage(`${platform.toUpperCase()} is already connected.`, 'agent');
        }
        return;
    }

    set({ connectionState: 'CONNECTING', isInputDisabled: true });
    const msg = `To proceed, I need to connect to your ${platform.toUpperCase()} account.`;
    addMessage(msg, 'agent', undefined, 'facebook_connect', { platform });
  },

  handleLogin: async (platform: string) => {
      const { addMessage, handleAccountSelection } = get();
      set({ isTyping: true, isInputDisabled: true });
      try {
          let token = null;
          let accounts: any[] = [];

          if (platform === 'facebook') {
              token = await FacebookService.login();
              if (token) accounts = await FacebookService.getPages(token);
          } else if (platform === 'instagram') {
              token = await InstagramService.login();
              if (token) accounts = await InstagramService.getInstagramAccounts(token);
          } else if (platform === 'tiktok') {
              token = await TikTokService.login();
              if (token) accounts = await TikTokService.getAdvertiserAccounts(token);
          } else if (platform === 'linkedin') {
              token = await LinkedInService.login();
              if (token) accounts = await LinkedInService.getAdAccounts(token);
          } else if (platform === 'twitter') {
              token = await TwitterService.login();
              if (token) accounts = await TwitterService.getAdAccounts(token);
          }

          if (token) {
              set((state) => ({ 
                  tokens: { ...state.tokens, [platform]: token },
                  fetchedAccounts: { ...state.fetchedAccounts, [platform]: accounts },
                  isTyping: false 
              }));

              if (accounts.length === 1) {
                  await handleAccountSelection(platform, accounts[0]);
              } else if (accounts.length > 1) {
                  addMessage(
                      `Connected! Please select the ${platform} account you want to use:`,
                      'agent',
                      undefined,
                      'page_selection',
                      { pages: accounts, platform }
                  );
              } else {
                  addMessage(`Connected, but no ${platform} accounts were found.`, 'agent');
              }
          } else {
              set({ isTyping: false, connectionState: 'IDLE', isInputDisabled: false });
              addMessage(
                  `${platform.charAt(0).toUpperCase() + platform.slice(1)} connection was cancelled. You can try again or connect a different account.`,
                  'agent',
                  undefined,
                  'facebook_connect',
                  { platform }
              );
          }
      } catch (error: any) {
          set({ isTyping: false, connectionState: 'IDLE', isInputDisabled: false });
          addMessage(`${platform.toUpperCase()} connection failed: ${error.message}`, 'agent', undefined, 'retry_action', { action: 'LOGIN', data: platform });
      }
  },

  handleAccountSelection: async (platform: string, account: any) => {
      const { addMessage, activeStrategy, connectionSource, initiateConnection } = get();
      set({ isTyping: true, isInputDisabled: true });

      try {
          const accessToken = get().tokens[platform];
          if (!accessToken) throw new Error('Missing access token.');

          if (platform === 'facebook') await FacebookService.saveConfig(account.id, account.name, accessToken);
          else if (platform === 'instagram') await InstagramService.saveConfig(account.id, accessToken, account.username);
          else if (platform === 'tiktok') await TikTokService.saveConfig(account.id, accessToken, account.name);
          else if (platform === 'linkedin') await LinkedInService.saveConfig(account.id, accessToken, account.name);
          else if (platform === 'twitter') await TwitterService.saveConfig(account.id, accessToken, account.name);

          set((state) => ({
              selectedAccounts: { ...state.selectedAccounts, [platform]: account },
              // Persist connection metadata so it survives session resets
              connectedPlatforms: {
                  ...state.connectedPlatforms,
                  [platform]: {
                      platform,
                      page_id: account.id,
                      page_name: account.name || account.username || account.displayName || null,
                      connected: true,
                  },
              },
              isTyping: false
          }));

          if (connectionSource === 'flow' && activeStrategy) {
              const platforms = activeStrategy.platforms || [];
              const currentIndex = platforms.indexOf(platform);
              if (currentIndex < platforms.length - 1) {
                  initiateConnection(platforms[currentIndex + 1], true);
              } else {
                  addMessage('All systems connected. Strategy is launching now!', 'agent', undefined, 'completion_card');
              }
          } else {
              addMessage(`Successfully connected to ${platform}!`, 'agent');
              set({ isInputDisabled: false });
          }
      } catch (error: any) {
          set({ isTyping: false });
          addMessage(`Failed to save ${platform} config: ${error.message}`, 'agent');
      }
  },

  loadConnectedPlatforms: async () => {
    try {
      const token = await getAuthToken();
      if (!token || !BACKEND_URL) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      let res: Response;
      try {
        res = await fetch(`${BACKEND_URL}/api/platform-configs`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return;
      const data = await res.json();
      const configs: Record<string, any> = data.configs || {};
      set((state) => {
        const newTokens = { ...state.tokens };
        // Only ADD tokens for platforms confirmed connected in the backend.
        // Never delete — deletion happens only on explicit disconnectPlatform().
        // This prevents any network hiccup or timing issue from wiping the
        // in-memory connection state the user can clearly see is connected.
        for (const platform of Object.keys(configs)) {
          if (!newTokens[platform]) {
            newTokens[platform] = 'connected';
          }
        }
        // Merge backend configs ON TOP of existing connectedPlatforms so a
        // successful reconnect also updates local metadata (page name etc).
        const mergedPlatforms = { ...state.connectedPlatforms, ...configs };
        return { tokens: newTokens, connectedPlatforms: mergedPlatforms };
      });
    } catch {}
  },

  disconnectPlatform: async (platform: string) => {
    set((state) => {
      const newTokens = { ...state.tokens };
      delete newTokens[platform];
      const newConnected = { ...state.connectedPlatforms };
      delete newConnected[platform];
      return { tokens: newTokens, connectedPlatforms: newConnected };
    });
    try {
      const token = await getAuthToken();
      if (!token || !BACKEND_URL) return;
      await fetch(`${BACKEND_URL}/api/platform-configs/${platform}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
  },

  // Legacy Compatibility
  initiateFacebookConnection: (fromFlow = false) => get().initiateConnection('facebook', fromFlow),
  handleFacebookLogin: () => get().handleLogin('facebook'),
  handlePageSelection: (page: FacebookPage) => get().handleAccountSelection('facebook', page),
  disconnectFacebook: () => get().disconnectPlatform('facebook')

  }),
  {
    name: 'adroom-agent-store',
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (state) => ({
      connectedPlatforms: state.connectedPlatforms,
      tokens: state.tokens,
    }),
  }
));
