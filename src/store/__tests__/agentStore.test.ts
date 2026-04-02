import { useAgentStore } from '../agentStore';
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

  it('should generate strategies', async () => {
    const { handleDurationSelection } = useAgentStore.getState();
    await handleDurationSelection(7);
    
    const { generatedStrategies } = useAgentStore.getState();
    expect(generatedStrategies).toBeTruthy();
    expect((generatedStrategies as any)!.strategy).toBeTruthy();
    expect((generatedStrategies as any)!.strategy.title).toBe('Organic Plan');
  });
});
