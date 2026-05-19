// SPDX-License-Identifier: Apache-2.0
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface Props {
  onOpen: (id: string) => void;
}

export function DbList({ onOpen }: Props) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["databases"],
    queryFn: () => api.databases(),
  });

  if (isLoading) {
    return <p className="text-slate-500">Loading databases…</p>;
  }
  if (isError) {
    return (
      <p className="text-red-600">
        Failed to load databases: {(error as Error).message}
      </p>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500">
        <p className="font-medium">No plugin databases yet.</p>
        <p className="text-sm mt-1">
          Plugin databases appear here once a plugin requests one via the
          DatabaseAPI.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {data.map((db) => (
        <button
          key={db.id}
          type="button"
          onClick={() => onOpen(db.id)}
          className="text-left rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-slate-400 dark:hover:border-slate-600 transition"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-medium truncate">
              {db.id}
            </span>
            {db.isServerDb && (
              <span className="text-xs uppercase tracking-wide bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 px-1.5 py-0.5 rounded">
                server
              </span>
            )}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">Size</dt>
            <dd className="text-right">{formatBytes(db.sizeBytes)}</dd>
            <dt className="text-slate-500">Modified</dt>
            <dd className="text-right">{formatDate(db.modifiedAt)}</dd>
          </dl>
        </button>
      ))}
    </div>
  );
}
