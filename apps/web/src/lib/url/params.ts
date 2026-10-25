/** A query string's parameters; a repeated key keeps its last value. */
export function paramsOf(queryString: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(queryString));
}

/**
 * A query string with `:` and `,` left readable (`submitters=GENCC:000102,GENCC:000104`), as the
 * current site writes them. Both are allowed in a query; URLSearchParams encodes them anyway.
 */
export function readableQuery(queryString: string): string {
  return queryString.replace(/%3A/gi, ':').replace(/%2C/gi, ',');
}
