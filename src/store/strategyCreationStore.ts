
import { create } from 'zustand';

interface ProductData {
  imageUri: string | null;
  scanResult: any | null; // Detailed scan result from Gemini
  name: string;
  description: string;
  price: string;
  category: string;
  targetAudience: string;
}

interface StrategyCreationState {
  // Step 1: Product Intake
  productData: ProductData;
  setProductData: (data: Partial<ProductData>) => void;
  
  // Step 2: Goal Selection
  selectedGoal: string | null;
  setSelectedGoal: (goal: string) => void;
  
  // Step 3: Duration Selection
  selectedDuration: number | null;
  setSelectedDuration: (days: number) => void;
  
  // Step 4: Generation
  isGenerating: boolean;
  generatedStrategies: {
    free: any;
    paid: any;
    comparison: any;
  } | null;
  setGeneratedStrategies: (strategies: any) => void;
  setIsGenerating: (isGenerating: boolean) => void;

  reset: () => void;
}

export const useStrategyCreationStore = create<StrategyCreationState>((set) => ({
  productData: {
    imageUri: null,
    scanResult: null,
    name: '',
    description: '',
    price: '',
    category: '',
    targetAudience: '',
  },
  setProductData: (data) => 
    set((state) => ({ productData: { ...state.productData, ...data } })),

  selectedGoal: null,
  setSelectedGoal: (goal) => set({ selectedGoal: goal }),

  selectedDuration: null,
  setSelectedDuration: (days) => set({ selectedDuration: days }),

  isGenerating: false,
  generatedStrategies: null,
  setGeneratedStrategies: (strategies) => set({ generatedStrategies: strategies }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),

  reset: () => set({
    productData: {
      imageUri: null,
      scanResult: null,
      name: '',
      description: '',
      price: '',
      category: '',
      targetAudience: '',
    },
    selectedGoal: null,
    selectedDuration: null,
    generatedStrategies: null,
    isGenerating: false,
  }),
}));
