"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction } from "@/modules/identity/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

interface LoginFormProps {
  redirectTo?: string;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    <Card className="w-full max-w-md shadow-lg border-border">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl font-bold tracking-tight text-center">
          Iniciar Sesión
        </CardTitle>
        <CardDescription className="text-center text-muted-foreground">
          Accede a tu plataforma de estudio clínico y preparación médica
        </CardDescription>
      </CardHeader>
      <form action={formAction}>
        <CardContent className="space-y-4">
          {redirectTo && (
            <input type="hidden" name="redirectTo" value={redirectTo} />
          )}

          {state?.error && (
            <div
              role="alert"
              className="p-3 text-sm rounded-md bg-destructive/15 text-destructive border border-destructive/20"
            >
              {state.error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Correo Electrónico</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="estudiante@medicina.edu.pe"
              autoComplete="email"
              required
              disabled={isPending}
            />
            {state?.fieldErrors?.email && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.email.join(", ")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Contraseña</Label>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
              disabled={isPending}
            />
            {state?.fieldErrors?.password && (
              <p className="text-xs text-destructive">
                {state.fieldErrors.password.join(", ")}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            className="w-full font-medium"
            disabled={isPending}
          >
            {isPending ? "Iniciando sesión..." : "Ingresar"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            ¿No tienes una cuenta?{" "}
            <Link
              href="/auth/signup"
              className="font-medium text-primary hover:underline underline-offset-4"
            >
              Regístrate aquí
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
