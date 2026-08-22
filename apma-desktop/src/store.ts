import { create } from 'zustand';

interface AuthState {
  isAuthenticated: boolean;
  baseUrl: string;
  setAuth: (baseUrl: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  baseUrl: '',
  setAuth: (baseUrl) => set({ isAuthenticated: true, baseUrl }),
  clearAuth: () => set({ isAuthenticated: false, baseUrl: '' }),
}));

interface DashboardState {
  dashboard: any | null;
  loading: boolean;
  lastUpdated: Date | null;
  setDashboard: (d: any) => void;
  setLoading: (l: boolean) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboard: null,
  loading: false,
  lastUpdated: null,
  setDashboard: (dashboard) => set({ dashboard, lastUpdated: new Date() }),
  setLoading: (loading) => set({ loading }),
}));
