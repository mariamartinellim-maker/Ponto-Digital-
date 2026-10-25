"use client";

import { TriangleAlert } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
        <TriangleAlert className="size-6" />
      </div>
      <h1 className="text-lg font-semibold">Não foi possível concluir a ação</h1>
      <p className="mt-1 text-sm text-slate-500">
        {process.env.NODE_ENV === "development" ? error.message : "Tente novamente. Se o problema continuar, fale com o administrador."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Código: {error.digest}</p>}
      <Button className="mt-5" onClick={reset}>Tentar novamente</Button>
    </Card>
  );
}
