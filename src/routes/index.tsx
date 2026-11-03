import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    if (hash.get("type") === "recovery" || query.has("code")) {
      // Dashboard-generated recovery emails can use the Supabase Site URL ("/").
      // Preserve the token while sending the browser to the password form.
      window.location.replace(
        `${window.location.origin}/reset-password${window.location.search}${window.location.hash}`,
      );
      return;
    }
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth" });
  },
  component: () => null,
});
