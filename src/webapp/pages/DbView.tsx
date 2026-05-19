// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";

interface Props {
  id: string;
  onBack: () => void;
}

export function DbView({ id, onBack }: Props) {
  const tablesQ = useQuery({
    queryKey: ["tables", id],
    queryFn: () => api.tables(id),
  });
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4">
      <aside className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-2"
        >
          ← All databases
        </button>
        <h2 className="font-medium text-sm uppercase tracking-wide text-slate-500 mb-2">
          Tables
        </h2>
        {tablesQ.isLoading && (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
        {tablesQ.isError && (
          <p className="text-sm text-red-600">
            {(tablesQ.error as Error).message}
          </p>
        )}
        {tablesQ.data && tablesQ.data.length === 0 && (
          <p className="text-sm text-slate-500">No tables.</p>
        )}
        <ul className="space-y-1">
          {tablesQ.data?.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => setSelected(t.name)}
                className={`w-full text-left px-2 py-1.5 rounded font-mono text-sm flex justify-between gap-2 ${
                  selected === t.name
                    ? "bg-slate-200 dark:bg-slate-800"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800/50"
                }`}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-xs text-slate-500">{t.rowCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section>
        {selected ? (
          <TableDetails dbId={id} table={selected} />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500">
            Select a table to inspect.
          </div>
        )}
      </section>
    </div>
  );
}

function TableDetails({ dbId, table }: { dbId: string; table: string }) {
  const schemaQ = useQuery({
    queryKey: ["schema", dbId, table],
    queryFn: () => api.tableSchema(dbId, table),
  });
  const rowsQ = useQuery({
    queryKey: ["rows", dbId, table],
    queryFn: () => api.tableRows(dbId, table, 50, 0),
  });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h3 className="font-medium mb-2">Schema</h3>
        {schemaQ.isLoading && (
          <p className="text-sm text-slate-500">Loading…</p>
        )}
        {schemaQ.isError && (
          <p className="text-sm text-red-600">
            {(schemaQ.error as Error).message}
          </p>
        )}
        {schemaQ.data && (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Column</th>
                <th className="py-1 pr-3 font-medium">Type</th>
                <th className="py-1 pr-3 font-medium">Flags</th>
                <th className="py-1 font-medium">Default</th>
              </tr>
            </thead>
            <tbody>
              {schemaQ.data.columns.map((c) => (
                <tr
                  key={c.cid}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="py-1 pr-3 font-mono">{c.name}</td>
                  <td className="py-1 pr-3 font-mono">{c.type || "—"}</td>
                  <td className="py-1 pr-3 text-xs text-slate-500">
                    {[c.primaryKey ? "PK" : null, c.notNull ? "NOT NULL" : null]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </td>
                  <td className="py-1 text-slate-500">
                    {c.defaultValue ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {schemaQ.data && schemaQ.data.indexes.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="font-medium mb-1">Indexes</p>
            <ul className="space-y-0.5 text-slate-600 dark:text-slate-400">
              {schemaQ.data.indexes.map((i) => (
                <li key={i.name} className="font-mono">
                  {i.unique ? "UNIQUE " : ""}
                  {i.name} ({i.columns.join(", ")})
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <h3 className="font-medium mb-2">
          Rows{" "}
          {rowsQ.data && (
            <span className="text-sm text-slate-500">
              ({rowsQ.data.rows.length} of {rowsQ.data.total})
            </span>
          )}
        </h3>
        {rowsQ.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {rowsQ.isError && (
          <p className="text-sm text-red-600">
            {(rowsQ.error as Error).message}
          </p>
        )}
        {rowsQ.data && rowsQ.data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  {rowsQ.data.columns.map((c) => (
                    <th key={c} className="py-1 pr-3 font-medium font-mono">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsQ.data.rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="border-t border-slate-100 dark:border-slate-800"
                  >
                    {row.map((cell, cidx) => (
                      <td
                        key={cidx}
                        className="py-1 pr-3 font-mono whitespace-nowrap"
                      >
                        {formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rowsQ.data && rowsQ.data.rows.length === 0 && (
          <p className="text-sm text-slate-500">Empty.</p>
        )}
      </section>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return `<blob ${v.byteLength}B>`;
  return JSON.stringify(v);
}
