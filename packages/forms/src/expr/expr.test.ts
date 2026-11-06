import { describe, expect, it } from 'vitest';
import { checkExpression, compile, evaluate, type ExprEnv } from './index';

const env = (
  answers: Record<string, unknown> = {},
  vitals: Record<string, number> = {},
): ExprEnv => ({
  value: (id) => answers[id] ?? null,
  vital: (code) => vitals[code] ?? null,
  ageYears: () => 34,
  ageMonths: () => 34 * 12 + 2,
  sex: () => 'F',
  isPregnant: () => false,
});
const run = (source: string, e: ExprEnv = env()) => evaluate(compile(source), e);

describe('expression language', () => {
  it('computes arithmetic, comparisons, logic and the allowed functions', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(
      run(
        "round(vital('weight') / pow(vital('height') / 100, 2), 1)",
        env({}, { weight: 70, height: 175 }),
      ),
    ).toBe(22.9);
    expect(run('if(ageYears() >= 18, 1, 0)')).toBe(1);
    expect(run("sex() == 'F' && !isPregnant()")).toBe(true);
    expect(run('max(1, 5, 3) - min(4, 2) + abs(-1) + sqrt(16)')).toBe(8);
    expect(run("value('score') > 3 ? 'high' : 'low'", env({ score: 5 }))).toBe('high');
    expect(run("selected('signs', 'cough')", env({ signs: ['fever', 'cough'] }))).toBe(true);
    expect(run("answered('signs')", env({ signs: [] }))).toBe(false);
  });

  it('propagates missing answers as null, never as a wrong number', () => {
    expect(run("value('weight') * 2")).toBeNull();
    expect(run("value('weight') > 2")).toBe(false);
    expect(run('1 / 0')).toBeNull();
    expect(run('sqrt(-1)')).toBeNull();
  });

  it('refuses anything outside the allowlist', () => {
    const refused = [
      'constructor',
      "value('x').constructor",
      '__proto__',
      "this['constructor']",
      'x.y',
      '[1, 2]',
      'a = 1',
      'eval(1)',
      'Function(1)',
      'toString()',
      'value(x)',
      'abs()',
      '1; 2',
    ];
    for (const source of refused) expect(checkExpression(source), source).not.toBeNull();
    expect(checkExpression('1 +')).toBe('FORM_EXPR_SYNTAX');
    expect(checkExpression('hasOwnProperty(1)')).toBe('FORM_EXPR_UNKNOWN_FUNCTION');
  });

  it('bounds the length and the depth', () => {
    expect(checkExpression('1+'.repeat(300) + '1')).toBe('FORM_EXPR_TOO_LONG');
    expect(checkExpression('('.repeat(40) + '1' + ')'.repeat(40))).toBeNull();
    expect(checkExpression('-'.repeat(40) + '1')).toBe('FORM_EXPR_TOO_DEEP');
  });

  it('lists the fields and vitals an expression reads', () => {
    const c = compile("value('a') + vital('weight') + (selected('b', 'x') ? 1 : 0)");
    expect([...c.fields].sort()).toEqual(['a', 'b']);
    expect([...c.vitals]).toEqual(['weight']);
  });
});
