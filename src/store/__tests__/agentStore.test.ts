import { useAgentStore } from '../agentStore';
import { Strategy } from '../../types/agent';

// Mock CreativeService since it's used in generateStrategies
jest.mock('../../services/creative', () => ({
  CreativeService: {
    generateCreative: jest.fn().mockResolvedValue('https://mock-creative.com/image.png')
  }
}));

describe('useAgentStore', () => {
  beforeEach(() => {
    useAgentStore.setState({
      messages: [],
      isTyping: false,
      productDetails: { name: '', description: '' },
      generatedStrategies: [],
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
    const { generateStrategies } = useAgentStore.getState();
    await generateStrategies();
    
    const { generatedStrategies } = useAgentStore.getState();
    expect(generatedStrategies).toHaveLength(2);
    expect(generatedStrategies[0].type).toBe('FREE');
    expect(generatedStrategies[1].type).toBe('PAID');
    // Verify enhanced fields
    expect(generatedStrategies[0].assets).toBeDefined();
    expect(generatedStrategies[0].lifespanWeeks).toBeDefined();
  });
});
