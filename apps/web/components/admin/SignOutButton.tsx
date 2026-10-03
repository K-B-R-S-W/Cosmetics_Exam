"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function signOut() {
    setLoading(true);
    await createBrowserSupabaseClient().auth.signOut({ scope: "local" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <Button variant="quiet" loading={loading} onClick={signOut}>
      Sign out
    </Button>
  );
}
