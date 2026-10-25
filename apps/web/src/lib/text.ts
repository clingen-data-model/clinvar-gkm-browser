/** "1 SCV", "2 SCVs", with the count formatted for the locale. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
}
