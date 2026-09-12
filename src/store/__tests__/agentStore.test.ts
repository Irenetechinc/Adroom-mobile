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
});
