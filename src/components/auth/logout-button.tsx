"use client";

import { useTransition } from "react";
import { logoutAction } from "@/modules/identity/actions";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const [isPending, startTransition] = useTransition();

  const handleLogout = () => {
    startTransition(async () => {
      await logoutAction();
    });
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleLogout}
      disabled={isPending}
      className="text-xs"
    >
      {isPending ? "Cerrando..." : "Cerrar Sesión"}
    </Button>
  );
}
