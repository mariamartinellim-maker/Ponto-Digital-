"use client";

import { useEffect } from "react";

/** Registra o service worker do PWA (somente em produção, para não interferir no desenvolvimento). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
