import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

export type CurrentUserRole = 'owner' | 'advisor' | 'foreman' | null;

/**
 * Fetches authenticated user's role from profiles once on mount.
 * Returns null when unauthenticated, not configured, or role unavailable.
 */
export function useCurrentUserRole(): CurrentUserRole {
  const [role, setRole] = useState<CurrentUserRole>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!supabase) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (cancelled || error) return;
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

  return role;
}

