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
