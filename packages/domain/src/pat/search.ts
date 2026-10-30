/**
 * Search normalization shared by the server (search_text column), the offline
 * hashed index and the duplicate detector, so all three agree on matches.
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function trigrams(input: string): string[] {
  const out = new Set<string>();
  for (const word of normalizeSearchText(input).split(' ')) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return [...out];
}

/**
 * Phonetic key tuned for French spelling and Congolese names: spelling variants
 * such as "Kabwe/Cabwe", "Mbuyi/Mbouyi", "Philippe/Filip" share the same key.
 */
export function phoneticKey(input: string): string {
  return normalizeSearchText(input)
    .split(' ')
    .filter(Boolean)
    .map(phoneticWord)
    .filter(Boolean)
    .join(' ');
}

function phoneticWord(word: string): string {
  let w = word;
  w = w.replace(/ph/g, 'f');
  w = w.replace(/ou/g, 'u');
  w = w.replace(/qu/g, 'k');
  w = w.replace(/[cq]/g, 'k');
  w = w.replace(/y/g, 'i');
  w = w.replace(/w/g, 'u');
  w = w.replace(/h/g, '');
  w = w.replace(/z/g, 's');
  w = w.replace(/(.)\1+/g, '$1');
  if (w.length > 3) {
    w = w.replace(/[stdx]$/, '');
  }
  if (w.length > 3) {
    w = w.replace(/e$/, '');
  }
  return w;
}
