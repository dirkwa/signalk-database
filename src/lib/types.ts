// SPDX-License-Identifier: Apache-2.0
import Type, { type Static } from "typebox";

// =============================================================================
// Public library types — exported via `signalk-database`
// =============================================================================

export const MigrationSchema = Type.Object({
  version: Type.Integer(),
  sql: Type.String(),
});
export type Migration = Static<typeof MigrationSchema>;

export const RunResultSchema = Type.Object({
  changes: Type.Integer(),
  lastInsertRowid: Type.Union([Type.Integer(), Type.BigInt()]),
});
export type RunResult = Static<typeof RunResultSchema>;

export interface PluginDb {
  migrate(migrations: Migration[]): Promise<void>;
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  transaction<T>(fn: (db: PluginDb) => Promise<T>): Promise<T>;
}

// =============================================================================
// Admin-API response shapes (internal to the plugin, but exported because the
// webapp imports them for type-safety)
// =============================================================================

export const PluginDbInfoSchema = Type.Object({
  id: Type.String(),
  path: Type.String(),
  sizeBytes: Type.Integer(),
  modifiedAt: Type.String({ format: "date-time" }),
});
export type PluginDbInfo = Static<typeof PluginDbInfoSchema>;

export const TableInfoSchema = Type.Object({
  name: Type.String(),
  rowCount: Type.Integer(),
});
export type TableInfo = Static<typeof TableInfoSchema>;

export const ColumnInfoSchema = Type.Object({
  cid: Type.Integer(),
  name: Type.String(),
  type: Type.String(),
  notNull: Type.Boolean(),
  defaultValue: Type.Union([Type.String(), Type.Null()]),
  primaryKey: Type.Boolean(),
});
export type ColumnInfo = Static<typeof ColumnInfoSchema>;

export const IndexInfoSchema = Type.Object({
  name: Type.String(),
  unique: Type.Boolean(),
  columns: Type.Array(Type.String()),
});
export type IndexInfo = Static<typeof IndexInfoSchema>;

export const ForeignKeyInfoSchema = Type.Object({
  id: Type.Integer(),
  seq: Type.Integer(),
  table: Type.String(),
  from: Type.String(),
  to: Type.String(),
  onUpdate: Type.String(),
  onDelete: Type.String(),
});
export type ForeignKeyInfo = Static<typeof ForeignKeyInfoSchema>;

export const TableSchemaSchema = Type.Object({
  table: Type.String(),
  columns: Type.Array(ColumnInfoSchema),
  indexes: Type.Array(IndexInfoSchema),
  foreignKeys: Type.Array(ForeignKeyInfoSchema),
});
export type TableSchema = Static<typeof TableSchemaSchema>;

export const RowsPageSchema = Type.Object({
  table: Type.String(),
  columns: Type.Array(Type.String()),
  rows: Type.Array(Type.Array(Type.Unknown())),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
});
export type RowsPage = Static<typeof RowsPageSchema>;
