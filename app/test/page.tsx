"use client";

import { useEffect, useState } from "react";

export default function TestPage() {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch("/api/api-proxy/api/test", {
          credentials: "include",
          cache: "no-store",
        });
        if (!alive) return;
        if (res.status === 404) {
          setValue(null);
          setError(null);
          return;
        }
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        const v =
          typeof (data as { test?: unknown })?.test === "string"
            ? (data as { test: string }).test
            : typeof (data as { Test?: unknown })?.Test === "string"
              ? (data as unknown as { Test: string }).Test
              : JSON.stringify(data);
        setValue(v);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      }
    };

    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>/test</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {!error && value === null && <p>No test record yet.</p>}
      {!error && value !== null && <p>{value}</p>}
    </main>
  );
}
