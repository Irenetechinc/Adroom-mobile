import { useAgentStore } from '../agentStore';
import { useStrategyCreationStore } from '../strategyCreationStore';
import { Strategy } from '../../types/agent';

// Mock CreativeService since it's used in generateStrategies
jest.mock('../../services/strategy', () => ({
  StrategyService: {
    generateStrategies: jest.fn().mockResolvedValue({
      strategy: { title: 'Organic Plan', assets: [], lifespanWeeks: 4 },
    }),
  },
}));

jest.mock('../../services/product', () => ({
  ProductService: {
    saveProduct: jest.fn().mockResolvedValue('prod_test'),
  },
}));

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.setState({
      messages: [],
      isTyping: false,
      productDetails: { name: '', description: '', id: 'prod_1', selectedGoal: 'sales' },
      generatedStrategies: null,
    });
    useStrategyCreationStore.setState({
      productData: {
        imageUri: null,
        videoUri: null,
        websiteUrl: '',
        scanResult: null,
        name: 'Test Product',
        description: 'Test',
        price: '10',
        currency: 'USD',
        category: '',
        targetAudience: '',
        productType: 'physical',
        dispatchAddress: '',
        selectedAccounts: ['twitter'],
      },
      selectedGoal: 'sales',
      selectedDuration: 7,
      generatedStrategies: null,
    });
  });

  it('should add messages', () => {
    const { addMessage } = useAgentStore.getState();
    addMessage('Hello', 'user');
    
    const { messages } = useAgentStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('Hello');
    expect(messages[0].sender).toBe('user');
  });

  it('should update product details', () => {
    const { updateProductDetails } = useAgentStore.getState();
    // 'imageUri' was removed from ProductDetails, it uses 'baseImageUri' now
    updateProductDetails({ name: 'Test Product', baseImageUri: 'https://example.com/image.png' });
    
    const { productDetails } = useAgentStore.getState();
    expect(productDetails.name).toBe('Test Product');
    expect(productDetails.baseImageUri).toBe('https://example.com/image.png');
  });

  it('should stop and request social account selection before generating when none are selected', async () => {
    useAgentStore.setState({
      connectedPlatforms: {},
      productDetails: { id: 'prod_1', selectedGoal: 'sales', selectedDuration: 7, name: 'Test Product', description: 'Test', price: '10', currency: 'USD' },
      messages: [],
      generatedStrategies: null,
    });

    const { handleDurationSelection } = useAgentStore.getState();
    await handleDurationSelection(7);

    const { generatedStrategies, messages } = useAgentStore.getState();
    expect(generatedStrategies).toBeNull();
    expect(messages.some((m) => m.uiType === 'strategy_account_selection')).toBe(true);
  });

  it('should generate strategies', async () => {
    useAgentStore.setState({
      connectedPlatforms: { twitter: { platform: 'twitter', page_name: 'My X account' } },
      productDetails: { id: 'prod_1', selectedGoal: 'sales', selectedDuration: 7, name: 'Test Product', description: 'Test', price: '10', currency: 'USD' },
      generatedStrategies: null,
    });

    useStrategyCreationStore.setState({
      productData: { ...useStrategyCreationStore.getState().productData, selectedAccounts: ['twitter'] },
    });

    const { handleDurationSelection } = useAgentStore.getState();
    await handleDurationSelection(7);
    
    const { generatedStrategies } = useAgentStore.getState();
    expect(generatedStrategies).toBeTruthy();
    expect((generatedStrategies as any)!.strategy).toBeTruthy();
    expect((generatedStrategies as any)!.strategy.title).toBe('Organic Plan');
  });

  it('should carry product dispatch address into strategy creation', async () => {
    await useAgentStore.getState().handleProductIntake({
      name: 'Test Product',
      description: 'A product',
      category: 'Home',
      price: '$20',
      currency: 'USD',
      productType: 'physical',
      deliveryAddress: '12 Test Street',
    } as any);

    expect(useStrategyCreationStore.getState().productData.dispatchAddress).toBe('12 Test Street');
    expect(useStrategyCreationStore.getState().productData.productType).toBe('physical');
  });

  it('should move service and brand intake into the shared strategy model', async () => {
    await useAgentStore.getState().handleServiceIntake({
      name: 'Design Service',
      description: 'Design work',
      category: 'Creative',
      price: '100',
      currency: 'USD',
    });
    expect(useStrategyCreationStore.getState().productData.name).toBe('Design Service');

    await useAgentStore.getState().handleBrandIntake({
      name: 'Test Brand',
      mission: 'Make useful things',
      values: 'Quality',
    });
    expect(useStrategyCreationStore.getState().productData.name).toBe('Test Brand');
    expect(useStrategyCreationStore.getState().productData.category).toBe('Brand');
  });

  it('should expose a retry action when strategy generation fails', async () => {
    const strategyService = require('../../services/strategy').StrategyService;
    strategyService.generateStrategies.mockRejectedValueOnce(new Error('Temporary AI failure'));
    useAgentStore.setState({
      connectedPlatforms: { twitter: { platform: 'twitter', page_name: 'My X account' } },
      productDetails: { id: 'prod_1', selectedGoal: 'sales', selectedDuration: 7, name: 'Test Product', description: 'Test' },
    });

    await useAgentStore.getState().handleDurationSelection(7);
    const message = useAgentStore.getState().messages.at(-1);
    expect(message?.uiType).toBe('retry_action');
    expect(message?.uiData?.action).toBe('STRATEGY_GENERATION');
    expect(useAgentStore.getState().flowState).toBe('DURATION_SELECTION');
  });

  it('should not mark service or brand strategies as physical-product flows', async () => {
    await useAgentStore.getState().handleServiceIntake({
      name: 'Design Service',
      description: 'Branding service',
      category: 'Creative',
      price: '100',
      currency: 'USD',
    });
    expect(useStrategyCreationStore.getState().productData.productType).toBe('digital');

    await useAgentStore.getState().handleBrandIntake({
      name: 'Test Brand',
      mission: 'Make useful things',
      values: 'Quality',
    });
    expect(useStrategyCreationStore.getState().productData.productType).toBe('digital');
  });

  it('should include selected social accounts in the activation request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ agent_type: 'SALESMAN', tasks_scheduled: 2 }),
    } as any);
    const supabase = require('../../services/supabase').supabase;
    jest.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'token_123' } },
    } as any);

    useAgentStore.setState({
      generatedStrategies: {
        strategy: { title: 'Organic Plan', goal: 'sales', platforms: ['twitter'] },
        strategyId: 'strategy_123',
      },
      productDetails: { id: 'prod_1', selectedGoal: 'sales', selectedDuration: 7, name: 'Test Product', description: 'Test' },
    });

    await useAgentStore.getState().handleStrategySelection();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai/activate-agents'),
      expect.objectContaining({
        body: expect.stringContaining('"selectedAccounts":["twitter"]'),
      })
    );

    fetchSpy.mockRestore();
  });

  it('should not force dispatch-address validation on service and brand strategies', async () => {
    await useAgentStore.getState().handleServiceIntake({
      name: 'Design Service',
      description: 'Design work',
      category: 'Creative',
      price: '100',
      currency: 'USD',
    });

    expect(useStrategyCreationStore.getState().productData.productType).toBe('digital');
    expect(useStrategyCreationStore.getState().productData.dispatchAddress).toBe('');

    await useAgentStore.getState().handleBrandIntake({
      name: 'Test Brand',
      mission: 'Make useful things',
      values: 'Quality',
    });

    expect(useStrategyCreationStore.getState().productData.productType).toBe('digital');
    expect(useStrategyCreationStore.getState().productData.dispatchAddress).toBe('');
  });
});
