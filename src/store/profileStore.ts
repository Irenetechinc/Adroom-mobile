import { create } from 'zustand';
import { supabase } from '../services/supabase';

interface ProfileState {
  displayName: string;
  initial: string;
  loaded: boolean;
  load: (userId?: string | null, email?: string | null) => Promise<void>;
  setDisplayName: (name: string) => void;
  reset: () => void;
}

const computeInitial = (name?: string, email?: string | null): string => {
  const src = (name || email || 'U').toString().trim();
  return (src.charAt(0) || 'U').toUpperCase();
};

export const useProfileStore = create<ProfileState>((set) => ({
  displayName: '',
  initial: 'U',
  loaded: false,

  load: async (userId, email) => {
    if (!userId) {
      set({ displayName: '', initial: 'U', loaded: false });
      return;
    }

    let name = '';

    try {
      const { data } = await supabase.auth.getUser();
      const m: any = data?.user?.user_metadata ?? {};
      name = (m.display_name || m.full_name || m.name || m.username || '').toString().trim();
    } catch { /* ignore */ }

    if (!name) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('username, full_name')
          .eq('id', userId)
          .maybeSingle();
        name = (data?.full_name || data?.username || '').toString().trim();
      } catch { /* ignore */ }
    }

    if (!name && email) name = email.split('@')[0];

    const finalName = name || 'User';
    set({ displayName: finalName, initial: computeInitial(finalName, email), loaded: true });
  },

  setDisplayName: (name) => {
    const trimmed = (name || '').trim() || 'User';
    set({ displayName: trimmed, initial: computeInitial(trimmed) });
  },

  reset: () => set({ displayName: '', initial: 'U', loaded: false }),
}));
