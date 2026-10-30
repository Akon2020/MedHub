/**
 * Password policy (docs/03-multitenant-securite.md section 2): a minimum length
 * (10 by default, configurable upwards), a check against an embedded list of
 * common passwords, and no mandatory composition rule.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'contains_identity';

/**
 * Widely published lists of the most used passwords, plus French and local
 * variants. Matching ignores case, separators and trailing digits, so that
 * "Azerty2024!" counts as "azerty".
 */
const COMMON_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  '0123456789',
  '987654321',
  '0987654321',
  '111111',
  '000000',
  '121212',
  '123123',
  '654321',
  '666666',
  '696969',
  '777777',
  '888888',
  '112233',
  '147258369',
  '159753',
  'password',
  'passw0rd',
  'pass',
  'passpass',
  'password1',
  'qwerty',
  'qwertyuiop',
  'qwerty123',
  'azerty',
  'azertyuiop',
  'azerty123',
  'abc123',
  'abcdef',
  'abcdefgh',
  'abcd1234',
  'aaaaaa',
  'admin',
  'administrator',
  'administrateur',
  'root',
  'toor',
  'user',
  'utilisateur',
  'guest',
  'test',
  'testtest',
  'welcome',
  'bienvenue',
  'letmein',
  'login',
  'master',
  'secret',
  'iloveyou',
  'jetaime',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'soccer',
  'sunshine',
  'princess',
  'shadow',
  'superman',
  'batman',
  'trustno1',
  'starwars',
  'whatever',
  'freedom',
  'hello',
  'bonjour',
  'salut',
  'soleil',
  'loulou',
  'doudou',
  'chouchou',
  'nicolas',
  'marseille',
  'motdepasse',
  'mdp',
  'changeme',
  'changezmoi',
  'default',
  'motdepasse1',
  'zaq12wsx',
  '1q2w3e4r',
  '1q2w3e4r5t',
  '1qaz2wsx',
  'q1w2e3r4',
  'asdfgh',
  'asdfghjkl',
  'zxcvbnm',
  'computer',
  'ordinateur',
  'internet',
  'samsung',
  'google',
  'facebook',
  'whatsapp',
  'jesus',
  'jesuschrist',
  'dieu',
  'dieuestbon',
  'merci',
  'congo',
  'kinshasa',
  'lubumbashi',
  'goma',
  'rdc',
  'drc',
  'hopital',
  'hospital',
  'clinique',
  'clinic',
  'pharmacie',
  'pharmacy',
  'docteur',
  'doctor',
  'medecin',
  'infirmier',
  'infirmiere',
  'sante',
  'health',
  'medhub',
]);

function core(password: string): string {
  return password
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isCommon(password: string): boolean {
  const normalized = core(password);
  if (normalized.length === 0) return true;
  if (COMMON_PASSWORDS.has(normalized)) return true;
  const withoutTrailingDigits = normalized.replace(/\d+$/, '');
  if (withoutTrailingDigits.length > 0 && COMMON_PASSWORDS.has(withoutTrailingDigits)) return true;
  if (/^(.)\1+$/.test(normalized)) return true;
  return false;
}

/** Every problem of a candidate password; an empty list means it is accepted. */
export function passwordProblems(
  password: string,
  options: { minLength?: number; identity?: readonly (string | null | undefined)[] } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  const minLength = Math.max(options.minLength ?? PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH);
  const length = [...password].length;
  if (length < minLength) problems.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) problems.push('too_long');
  if (isCommon(password)) problems.push('common');
  const lowered = core(password);
  const identity = (options.identity ?? [])
    .flatMap((v) => (v ? v.split(/[\s._@+-]+/) : []))
    .map(core)
    .filter((v) => v.length >= 4);
  if (identity.some((v) => lowered.includes(v))) problems.push('contains_identity');
  return problems;
}
