import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

export type CurrentUserRole = 'owner' | 'advisor' | 'foreman' | null;

export type UseCurrentUserRoleResult = {
  role: CurrentUserRole;
  loading: boolean;
};

/**
 * Fetches authenticated user's role from profiles once on mount.
 * Returns { role, loading }. Role is null when unauthenticated, not configured, or role unavailable.
 * loading is true until the first fetch completes (so you can avoid showing Unauthorized while resolving).
 */
export function useCurrentUserRole(): UseCurrentUserRoleResult {
  const [role, setRole] = useState<CurrentUserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (cancelled) return;
      setLoading(false);
      if (error) {
        setRole(null);
        return;
      }
      const rawRole = (data?.role as string | undefined)?.toLowerCase();
      if (rawRole === 'owner' || rawRole === 'advisor' || rawRole === 'foreman') {
        setRole(rawRole);
      } else {
        setRole(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { role, loading };
}

