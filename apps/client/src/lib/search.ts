/** "Dupont-Hélène" and "dupont helene" match: accents, case and dashes are ignored. */
export function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .toLowerCase();
}

/** Every word typed must appear somewhere in `text`, in any order. An empty query matches everything. */
export function matchesSearch(query: string, text: string): boolean {
  const haystack = searchable(text);
  return searchable(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}
