import { useEffect, useState } from "react";
import { Navigate, Outlet, useOutletContext } from "react-router";
import type { User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

type AuthState =
  { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; user: User };

export type AuthContext = { user: User };

/**
 * Client-only gate for signed-in pages: verifies the session with Supabase and
 * redirects to /signin when there is no user. Re-checks on auth state changes
 * so signing out in another tab bounces this one too.
 */
export function RequireAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      setState(data.user ? { status: "signed-in", user: data.user } : { status: "signed-out" });
    }

    void check();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") void check();
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  if (state.status === "loading") return null;
  if (state.status === "signed-out") return <Navigate to="/signin" replace />;
  return <Outlet context={{ user: state.user } satisfies AuthContext} />;
}

export function useAuthUser(): User {
  return useOutletContext<AuthContext>().user;
}
