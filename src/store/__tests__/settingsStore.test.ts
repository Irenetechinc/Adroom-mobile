import { useSettingsStore } from '../settingsStore';
import { FacebookService } from '../../services/facebook';

// Mock FacebookService
jest.mock('../../services/facebook', () => ({
  FacebookService: {
    getConfig: jest.fn(),
    saveConfig: jest.fn(),
    validateCredentials: jest.fn(),
  },
}));

describe('useSettingsStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettingsStore.setState({
      facebookConfig: null,
      isLoading: false,
      error: null,
    });
  });

  it('should have initial state', () => {
    const state = useSettingsStore.getState();
    expect(state.facebookConfig).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('fetchConfig', () => {
    it('should fetch config successfully', async () => {
      const mockConfig = { 
        id: '1', 
        user_id: 'user1', 
        ad_account_id: 'act_123', 
        access_token: 'token', 
        page_id: '123' 
      };
      (FacebookService.getConfig as jest.Mock).mockResolvedValue(mockConfig);

      await useSettingsStore.getState().fetchConfig();

      const state = useSettingsStore.getState();
      expect(state.facebookConfig).toEqual(mockConfig);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle fetch errors', async () => {
      (FacebookService.getConfig as jest.Mock).mockRejectedValue(new Error('Fetch failed'));

      await useSettingsStore.getState().fetchConfig();

      const state = useSettingsStore.getState();
      expect(state.facebookConfig).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Fetch failed');
    });
  });

  describe('saveConfig', () => {
    const input = { 
      ad_account_id: 'act_123', 
      access_token: 'token', 
      page_id: '123' 
    };

    it('should validate and save config successfully', async () => {
      const mockConfig = { ...input, id: '1', user_id: 'user1' };
      (FacebookService.validateCredentials as jest.Mock).mockResolvedValue(true);
      (FacebookService.saveConfig as jest.Mock).mockResolvedValue(mockConfig);

      await useSettingsStore.getState().saveConfig(input);

      const state = useSettingsStore.getState();
      expect(FacebookService.validateCredentials).toHaveBeenCalledWith(input);
      expect(FacebookService.saveConfig).toHaveBeenCalledWith(input);
      expect(state.facebookConfig).toEqual(mockConfig);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should handle validation errors', async () => {
      (FacebookService.validateCredentials as jest.Mock).mockRejectedValue(new Error('Invalid credentials'));

      await expect(useSettingsStore.getState().saveConfig(input)).rejects.toThrow('Invalid credentials');

      const state = useSettingsStore.getState();
      expect(FacebookService.saveConfig).not.toHaveBeenCalled();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });

    it('should handle save errors', async () => {
      (FacebookService.validateCredentials as jest.Mock).mockResolvedValue(true);
      (FacebookService.saveConfig as jest.Mock).mockRejectedValue(new Error('Save failed'));

      await expect(useSettingsStore.getState().saveConfig(input)).rejects.toThrow('Save failed');

      const state = useSettingsStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Save failed');
    });
  });
});
