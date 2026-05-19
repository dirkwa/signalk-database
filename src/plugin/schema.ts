// SPDX-License-Identifier: Apache-2.0
import type {
  ColumnInfo,
  ForeignKeyInfo,
  IndexInfo,
  RowsPage,
  TableInfo,
  TableSchema,
} from "../lib/types.js";

type DatabaseSync = any;

const SQLITE_INTERNAL_PREFIX = "sqlite_";

function isUserTable(name: string): boolean {
  return !name.startsWith(SQLITE_INTERNAL_PREFIX);
}

function quoteIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    throw new Error(`Invalid identifier: ${ident}`);
  }
  return `"${ident}"`;
}

export function listTables(db: DatabaseSync): TableInfo[] {
  const rows: { name: string }[] = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all();
  return rows
    .filter((r) => isUserTable(r.name))
    .map((r) => {
      const countRow = db
        .prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(r.name)}`)
        .get();
      return { name: r.name, rowCount: Number(countRow?.c ?? 0) };
    });
}

export function getTableSchema(db: DatabaseSync, table: string): TableSchema {
  const tableIdent = quoteIdent(table);

  const columns: ColumnInfo[] = db
    .prepare(`PRAGMA table_info(${tableIdent})`)
    .all()
    .map(
      (r: {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }) => ({
        cid: r.cid,
        name: r.name,
        type: r.type,
        notNull: r.notnull === 1,
        defaultValue: r.dflt_value,
        primaryKey: r.pk > 0,
      }),
    );

  const indexRows: { name: string; unique: number }[] = db
    .prepare(`PRAGMA index_list(${tableIdent})`)
    .all();
  const indexes: IndexInfo[] = indexRows.map((ir) => {
    const cols: { name: string }[] = db
      .prepare(`PRAGMA index_info(${quoteIdent(ir.name)})`)
      .all();
    return {
      name: ir.name,
      unique: ir.unique === 1,
      columns: cols.map((c) => c.name),
    };
  });

  const foreignKeys: ForeignKeyInfo[] = db
    .prepare(`PRAGMA foreign_key_list(${tableIdent})`)
    .all()
    .map(
      (r: {
        id: number;
        seq: number;
        table: string;
        from: string;
        to: string;
        on_update: string;
        on_delete: string;
      }) => ({
        id: r.id,
        seq: r.seq,
        table: r.table,
        from: r.from,
        to: r.to,
        onUpdate: r.on_update,
        onDelete: r.on_delete,
      }),
    );

  return { table, columns, indexes, foreignKeys };
}

export function getRowsPage(
  db: DatabaseSync,
  table: string,
  limit: number,
  offset: number,
): RowsPage {
  const tableIdent = quoteIdent(table);
  const colsInfo: { name: string }[] = db
    .prepare(`PRAGMA table_info(${tableIdent})`)
    .all();
  const columns = colsInfo.map((c) => c.name);
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM ${tableIdent}`).get();
  const total = Number(totalRow?.c ?? 0);
  const rawRows: Record<string, unknown>[] = db
    .prepare(`SELECT * FROM ${tableIdent} LIMIT ? OFFSET ?`)
    .all(limit, offset);
  const rows = rawRows.map((r) => columns.map((c) => r[c] ?? null));
  return { table, columns, rows, total, limit, offset };
}
