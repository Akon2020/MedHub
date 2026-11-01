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

export type PatientQuery = {
  /** Normalized words, without the year, the phone or the record number. */
  text: string;
  phoneticKey: string;
  /** Last nine digits of a phone number typed in the query. */
  phoneTail: string | null;
  /** Record number as typed, upper case, when the query looks like one. */
  mrn: string | null;
  year: number | null;
};

const MRN_LIKE = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;

/**
 * What a front desk types to find a patient (docs/modules/pat.md, capability 6):
 * a name, a phone number, a record number, a birth year, or a mix of them.
 */
export function parsePatientQuery(
  input: string,
  currentYear = new Date().getFullYear(),
): PatientQuery {
  const words: string[] = [];
  let phoneTail: string | null = null;
  let mrn: string | null = null;
  let year: number | null = null;
  // "+243 991 234 567": a number typed in groups becomes one token again.
  const tokens: string[] = [];
  for (const raw of input.trim().split(/\s+/).filter(Boolean)) {
    const previous = tokens.at(-1);
    if (previous && /^(?:\+|0)\d*$/.test(previous) && /^\d+$/.test(raw)) {
      tokens[tokens.length - 1] = `${previous}${raw}`;
    } else {
      tokens.push(raw);
    }
  }
  for (const raw of tokens) {
    const digits = raw.replace(/[^\d]/g, '');
    if (MRN_LIKE.test(raw) && /\d/.test(raw) && /[A-Za-z]/.test(raw)) {
      mrn = raw.toUpperCase();
    } else if (/^\d{4}$/.test(raw) && Number(raw) >= 1900 && Number(raw) <= currentYear) {
      year = Number(raw);
    } else if (/^[+\d][\d ]*$/.test(raw) && digits.length >= 6) {
      phoneTail = digits.slice(-9);
    } else {
      words.push(raw);
    }
  }
  const text = normalizeSearchText(words.join(' '));
  return { text, phoneticKey: phoneticKey(text), phoneTail, mrn, year };
}
