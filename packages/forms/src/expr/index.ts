import jsep, { type Expression } from 'jsep';

/**
 * Safe expression language of the forms (docs/modules/form.md, Technique).
 * jsep only parses; this module interprets an allowlist of nodes and
 * functions. No property access, no unknown call, no loop, bounded length and
 * depth. Never eval nor new Function.
 */
export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_DEPTH = 24;
export const MAX_NODES = 200;

export type ExprErrorCode =
  | 'FORM_EXPR_SYNTAX'
  | 'FORM_EXPR_TOO_LONG'
  | 'FORM_EXPR_TOO_DEEP'
  | 'FORM_EXPR_FORBIDDEN'
  | 'FORM_EXPR_UNKNOWN_FUNCTION'
  | 'FORM_EXPR_ARGUMENTS';

export class ExprError extends Error {
  constructor(readonly code: ExprErrorCode) {
    super(code);
  }
}

export type Value = number | string | boolean | null;

/** What an expression can read: the answers, the patient and the last vitals. */
export interface ExprEnv {
  value(fieldId: string): unknown;
  vital(code: string): number | null;
  ageYears(): number | null;
  ageMonths(): number | null;
  sex(): string;
  isPregnant(): boolean;
}

/** Function name to accepted argument counts [min, max]; arguments of value() and vital() are literals. */
const FUNCTIONS: Record<string, [number, number]> = {
  if: [3, 3],
  round: [1, 2],
  min: [1, 10],
  max: [1, 10],
  abs: [1, 1],
  sqrt: [1, 1],
  pow: [2, 2],
  ageYears: [0, 0],
  ageMonths: [0, 0],
  sex: [0, 0],
  isPregnant: [0, 0],
  value: [1, 1],
  vital: [1, 1],
  answered: [1, 1],
  selected: [2, 2],
};
const LITERAL_ARG = new Set(['value', 'vital', 'answered', 'selected']);
const BINARY = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '>',
  '<=',
  '>=',
  '&&',
  '||',
]);
const UNARY = new Set(['-', '+', '!']);

export type Compiled = {
  ast: Expression;
  /** Field ids read with value() or answered(), vital codes read with vital(). */
  fields: Set<string>;
  vitals: Set<string>;
};

/** Parses and checks an expression; throws ExprError with a stable code. */
export function compile(source: string): Compiled {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new ExprError('FORM_EXPR_TOO_LONG');
  let ast: Expression;
  try {
    ast = jsep(source);
  } catch {
    throw new ExprError('FORM_EXPR_SYNTAX');
  }
  const fields = new Set<string>();
  const vitals = new Set<string>();
  let nodes = 0;
  const visit = (node: Expression, depth: number): void => {
    if (depth > MAX_DEPTH) throw new ExprError('FORM_EXPR_TOO_DEEP');
    if (++nodes > MAX_NODES) throw new ExprError('FORM_EXPR_TOO_LONG');
    switch (node.type) {
      case 'Literal': {
        const v = node.value;
        if (v !== null && !['number', 'string', 'boolean'].includes(typeof v)) {
          throw new ExprError('FORM_EXPR_FORBIDDEN');
        }
        return;
      }
      case 'UnaryExpression':
        if (!UNARY.has(String(node.operator))) throw new ExprError('FORM_EXPR_FORBIDDEN');
        return visit(node.argument as Expression, depth + 1);
      case 'BinaryExpression':
        if (!BINARY.has(String(node.operator))) throw new ExprError('FORM_EXPR_FORBIDDEN');
        visit(node.left as Expression, depth + 1);
        return visit(node.right as Expression, depth + 1);
      case 'ConditionalExpression':
        visit(node.test as Expression, depth + 1);
        visit(node.consequent as Expression, depth + 1);
        return visit(node.alternate as Expression, depth + 1);
      case 'CallExpression': {
        const callee = node.callee as Expression;
        const args = (node.arguments ?? []) as Expression[];
        if (callee.type !== 'Identifier') throw new ExprError('FORM_EXPR_FORBIDDEN');
        const name = String(callee.name);
        const arity = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
        if (!arity) throw new ExprError('FORM_EXPR_UNKNOWN_FUNCTION');
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new ExprError('FORM_EXPR_ARGUMENTS');
        }
        if (LITERAL_ARG.has(name)) {
          const arg = args[0];
          if (
            args.some((a) => a.type !== 'Literal' || typeof a.value !== 'string') ||
            arg === undefined
          ) {
            throw new ExprError('FORM_EXPR_ARGUMENTS');
          }
          (name === 'vital' ? vitals : fields).add(String(arg.value));
          return;
        }
        for (const a of args) visit(a, depth + 1);
        return;
      }
      default:
        // Identifiers, member access, this, arrays, compounds: refused.
        throw new ExprError('FORM_EXPR_FORBIDDEN');
    }
  };
  visit(ast, 0);
  return { ast, fields, vitals };
}

const num = (v: Value): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const finite = (v: number): number | null => (Number.isFinite(v) ? v : null);
const truthy = (v: Value): boolean => v !== null && v !== false && v !== 0 && v !== '';

function toValue(v: unknown): Value {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  return null;
}

/**
 * Evaluates a compiled expression. Missing answers propagate as null:
 * arithmetic on null is null, a comparison with null is false.
 */
export function evaluate(compiled: Compiled, env: ExprEnv): Value {
  const run = (node: Expression): Value => {
    switch (node.type) {
      case 'Literal':
        return toValue(node.value);
      case 'UnaryExpression': {
        const v = run(node.argument as Expression);
        if (node.operator === '!') return !truthy(v);
        const n = num(v);
        if (n === null) return null;
        return node.operator === '-' ? -n : n;
      }
      case 'ConditionalExpression':
        return truthy(run(node.test as Expression))
          ? run(node.consequent as Expression)
          : run(node.alternate as Expression);
      case 'BinaryExpression': {
        const op = String(node.operator);
        if (op === '&&') {
          const l = run(node.left as Expression);
          return truthy(l) ? truthy(run(node.right as Expression)) : false;
        }
        if (op === '||') {
          const l = run(node.left as Expression);
          return truthy(l) ? true : truthy(run(node.right as Expression));
        }
        const l = run(node.left as Expression);
        const r = run(node.right as Expression);
        if (op === '==' || op === '===') return l === r;
        if (op === '!=' || op === '!==') return l !== r;
        const a = num(l);
        const b = num(r);
        if (op === '<' || op === '>' || op === '<=' || op === '>=') {
          if (a === null || b === null) return false;
          return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
        }
        if (a === null || b === null) return null;
        switch (op) {
          case '+':
            return finite(a + b);
          case '-':
            return finite(a - b);
          case '*':
            return finite(a * b);
          case '/':
            return b === 0 ? null : finite(a / b);
          case '%':
            return b === 0 ? null : finite(a % b);
          default:
            return null;
        }
      }
      case 'CallExpression': {
        const name = String((node.callee as Expression).name);
        const args = (node.arguments ?? []) as Expression[];
        const literal = () => String((args[0] as Expression).value);
        switch (name) {
          case 'value':
            return toValue(env.value(literal()));
          case 'answered': {
            const v = env.value(literal());
            return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);
          }
          case 'selected': {
            const v = env.value(literal());
            const code = String((args[1] as Expression).value);
            return Array.isArray(v) ? v.includes(code) : v === code;
          }
          case 'vital':
            return env.vital(literal());
          case 'ageYears':
            return env.ageYears();
          case 'ageMonths':
            return env.ageMonths();
          case 'sex':
            return env.sex();
          case 'isPregnant':
            return env.isPregnant();
          case 'if':
            return truthy(run(args[0] as Expression))
              ? run(args[1] as Expression)
              : run(args[2] as Expression);
        }
        const values = args.map((a) => num(run(a)));
        if (values.some((v) => v === null)) return null;
        const n = values as number[];
        const [x = 0, y = 0] = n;
        switch (name) {
          case 'round': {
            const digits = Math.max(0, Math.min(6, Math.trunc(y)));
            const f = 10 ** digits;
            return Math.round(x * f) / f;
          }
          case 'min':
            return Math.min(...n);
          case 'max':
            return Math.max(...n);
          case 'abs':
            return Math.abs(x);
          case 'sqrt':
            return x < 0 ? null : Math.sqrt(x);
          case 'pow':
            return finite(x ** y);
          default:
            return null;
        }
      }
      default:
        return null;
    }
  };
  return run(compiled.ast);
}

/** True when the expression compiles; the error code otherwise. */
export function checkExpression(source: string): ExprErrorCode | null {
  try {
    compile(source);
    return null;
  } catch (err) {
    return err instanceof ExprError ? err.code : 'FORM_EXPR_SYNTAX';
  }
}
