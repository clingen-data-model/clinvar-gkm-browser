// A SQL fragment builder with positional parameters ($1, $2, ...). Values never go into the SQL
// text; every one becomes a parameter. Identifiers come only from the registries, never from input.

export type SqlValue = string | number | boolean | null;

export class SqlParams {
  readonly values: SqlValue[] = [];

  /** Adds a value and returns its placeholder. */
  add(value: SqlValue): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }

  /** Placeholders for a list of values, for IN (...). An empty list matches nothing. */
  list(values: readonly SqlValue[]): string {
    if (values.length === 0) return 'NULL';
    return values.map((v) => this.add(v)).join(', ');
  }
}

/**
 * A select list of a table's columns under their own names: `s.scv_id AS scv_id, ...`. Every
 * column is aliased, so result names never depend on how an engine names a qualified column
 * (some keep the qualifier in joins).
 */
export function qualifiedColumns(table: string, columns: readonly string[]): string {
  return columns.map((c) => `${table}.${c} AS ${c}`).join(', ');
}
