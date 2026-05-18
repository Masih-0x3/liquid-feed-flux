import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin' | 'viewer';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: AppRole | null;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<AppRole | null>(null);

  const loadUserRole = useCallback(async (userId: string): Promise<AppRole> => {
    try {
      const raceResult = await Promise.race([
        supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
      ]);

      if (!raceResult || 'error' in raceResult && raceResult.error) {
        console.warn('Could not load user role:', raceResult && 'error' in raceResult ? raceResult.error?.message : 'timeout');
        return 'viewer';
      }

      if ('data' in raceResult) {
        return (raceResult.data?.role as AppRole) ?? 'viewer';
      }
    } catch (err) {
      console.error('Failed to load role:', err);
    }
    return 'viewer';
  }, []);

  useEffect(() => {
    let active = true;
    let loadId = 0;

    const applySession = async (nextSession: Session | null, deferRoleLoad = false) => {
      if (!active) return;
      const currentLoadId = ++loadId;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setRole(null);
        setLoading(false);
        return;
      }

      setRole(null);
      setLoading(true);

      const loadRole = async () => {
        const nextRole = await loadUserRole(nextSession.user.id);
        if (!active || currentLoadId !== loadId) return;
        setRole(nextRole);
        setLoading(false);
      };

      if (deferRoleLoad) {
        setTimeout(() => {
          void loadRole();
        }, 0);
        return;
      }

      await loadRole();
    };

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // Defer role loading to avoid Supabase client deadlock.
        void applySession(session, true);
      }
    );

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      void applySession(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadUserRole]);

  const signIn = async (email: string, password: string) => {
    const timeoutError = {
      name: 'AuthTimeoutError',
      message: 'Supabase Auth is not responding. Please try again after the backend recovers.',
      status: 504,
    } as AuthError;

    return Promise.race([
      supabase.auth.signInWithPassword({
        email,
        password,
      }),
      new Promise<{ error: AuthError }>((resolve) => {
        setTimeout(() => resolve({ error: timeoutError }), 15000);
      }),
    ]).then(({ error }) => ({ error }));
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    setRole(null);
    return { error };
  };

  const value: AuthContextType = {
    user,
    session,
    loading,
    role,
    isAdmin: role === 'admin',
    signIn,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
