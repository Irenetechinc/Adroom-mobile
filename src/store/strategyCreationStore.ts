import { create } from 'zustand';

interface ProductData {
  imageUri: string | null;
  videoUri: string | null;
  websiteUrl: string;
  scanResult: any | null;
  name: string;
  description: string;
  price: string;
  currency: string;
  category: string;
  targetAudience: string;
}

interface StrategyCreationState {
  productData: ProductData;
  setProductData: (data: Partial<ProductData>) => void;

  selectedGoal: string | null;
  setSelectedGoal: (goal: string) => void;

  selectedDuration: number | null;
  setSelectedDuration: (days: number) => void;

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

const defaultProductData: ProductData = {
  imageUri: null,
  videoUri: null,
  websiteUrl: '',
  scanResult: null,
  name: '',
  description: '',
  price: '',
  currency: 'USD',
  category: '',
  targetAudience: '',
};

export const useStrategyCreationStore = create<StrategyCreationState>((set) => ({
  productData: { ...defaultProductData },
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
    productData: { ...defaultProductData },
    selectedGoal: null,
    selectedDuration: null,
    generatedStrategies: null,
    isGenerating: false,
  }),
}));
