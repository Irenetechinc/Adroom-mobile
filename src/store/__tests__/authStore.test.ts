import { useAuthStore } from '../authStore';
import { supabase } from '../../services/supabase';

// Mock Supabase client
jest.mock('../../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
  },
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      session: null,
      user: null,
      isLoading: true,
    });
  });

  it('should have initial state', () => {
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(true);
  });

  it('should initialize successfully with a session', async () => {
    const mockSession = { user: { id: '123', email: 'test@example.com' } };
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: mockSession },
    });
    (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback) => {
      // Simulate auth state change
      callback('SIGNED_IN', mockSession);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.session).toEqual(mockSession);
    expect(state.user).toEqual(mockSession.user);
    expect(state.isLoading).toBe(false);
  });

  it('should initialize successfully without a session', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: null },
    });
    (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation(() => {
        return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    await useAuthStore.getState().initialize();

    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it('should handle signOut', async () => {
    // Set initial state as logged in
    useAuthStore.setState({
        session: { user: { id: '123' } } as any,
        user: { id: '123' } as any,
        isLoading: false
    });

    await useAuthStore.getState().signOut();

    expect(supabase.auth.signOut).toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
  });
});
