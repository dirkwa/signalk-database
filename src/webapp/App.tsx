// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { DbList } from "./pages/DbList.js";
import { DbView } from "./pages/DbView.js";

type Route = { name: "list" } | { name: "db"; id: string };

export function App() {
  const [route, setRoute] = useState<Route>({ name: "list" });

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setRoute({ name: "list" })}
            className="flex items-baseline gap-2 hover:underline"
          >
            <span className="font-semibold text-lg">Database</span>
            <span className="text-xs text-slate-500 font-mono">
              v{__APP_VERSION__}
            </span>
          </button>
          {route.name === "db" && (
            <div className="text-sm text-slate-500">
              <span className="font-mono">{route.id}</span>
            </div>
          )}
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {route.name === "list" && (
          <DbList onOpen={(id) => setRoute({ name: "db", id })} />
        )}
        {route.name === "db" && (
          <DbView id={route.id} onBack={() => setRoute({ name: "list" })} />
        )}
      </main>
    </div>
  );
}
