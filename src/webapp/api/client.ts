// SPDX-License-Identifier: Apache-2.0
import type {
  PluginDbInfo,
  RowsPage,
  TableInfo,
  TableSchema,
} from "../../lib/types.js";

function apiBase(): string {
  // SignalK serves plugin webapps under /<plugin-id>/ but plugin routes
  // (mounted via registerWithRouter) under /plugins/<plugin-id>/. The webapp
  // and the API live at different paths, so the API base is fixed.
  return "/plugins/signalk-database/api";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error ?? "";
    } catch {
      // ignore
    }
    throw new Error(
      `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

export const api = {
  databases: () => getJson<PluginDbInfo[]>("/databases"),
  tables: (id: string) =>
    getJson<TableInfo[]>(`/databases/${encodeURIComponent(id)}/tables`),
  tableSchema: (id: string, table: string) =>
    getJson<TableSchema>(
      `/databases/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/schema`,
    ),
  tableRows: (id: string, table: string, limit: number, offset: number) =>
    getJson<RowsPage>(
      `/databases/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/rows?limit=${limit}&offset=${offset}`,
    ),
};
