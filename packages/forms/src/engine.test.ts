import { describe, expect, it } from 'vitest';
import { checkDefinition, evaluateForm, vitalAnswers, type FormContext } from './engine';
import { formDefinition, type FormDefinition } from './schema';
import { consultationGeneral } from './templates/consultation-general';

const NOW = new Date('2026-11-06T09:00:00.000Z');
const woman: FormContext = {
  birthDate: '1992-03-10',
  sex: 'F',
  pregnant: false,
  vitals: {},
  now: NOW,
};
const child: FormContext = {
  birthDate: '2020-01-01',
  sex: 'M',
  pregnant: false,
  vitals: {},
  now: NOW,
};

/** Diabetes follow-up of the acceptance criterion: one condition, one calculation. */
const diabetes: FormDefinition = formDefinition.parse({
  code: 'suivi_diabete',
  title: { fr: 'Suivi diabète' },
  step: 'chronic_followup',
  sections: [
    {
      id: 'follow',
      title: { fr: 'Suivi' },
      fields: [
        {
          id: 'glucose',
          type: 'vital',
          vital: 'glucose',
          label: { fr: 'Glycémie' },
          unit: 'mmol/L',
        },
        {
          id: 'hypo',
          type: 'yes_no',
          label: { fr: 'Hypoglycémie depuis la dernière visite' },
          required: true,
        },
        {
          id: 'hypo_count',
          type: 'number',
          label: { fr: 'Nombre d’épisodes' },
          visibleIf: "value('hypo') == true",
          requiredIf: "value('hypo') == true",
          min: 1,
          max: 50,
          rangeMessage: { fr: 'Entre 1 et 50 épisodes' },
        },
        {
          id: 'insulin_units',
          type: 'number',
          label: { fr: 'Insuline (UI/kg)' },
          min: 0,
          max: 5,
        },
        {
          id: 'daily_dose',
          type: 'calculation',
          label: { fr: 'Dose quotidienne' },
          unit: 'UI',
          decimals: 0,
          expression: "value('insulin_units') * vital('weight')",
        },
      ],
    },
  ],
});

describe('form engine', () => {
  it('ships a valid consultation template', () => {
    expect(formDefinition.parse(consultationGeneral)).toBeTruthy();
    expect(checkDefinition(consultationGeneral)).toEqual([]);
  });

  it('applies conditions, obligations, ranges and calculations', () => {
    const empty = evaluateForm(diabetes, {}, { ...woman, vitals: { weight: 80 } });
    expect(empty.visible.hypo_count).toBe(false);
    expect(empty.errors).toEqual({ hypo: { code: 'FORM_REQUIRED' } });

    const filled = evaluateForm(
      diabetes,
      { hypo: true, hypo_count: 60, insulin_units: 0.5, glucose: 7.2 },
      { ...woman, vitals: { weight: 80 } },
    );
    expect(filled.visible.hypo_count).toBe(true);
    expect(filled.errors.hypo_count).toEqual({
      code: 'FORM_RANGE',
      message: { fr: 'Entre 1 et 50 épisodes' },
    });
    expect(filled.values.daily_dose).toBe(40);

    const done = evaluateForm(diabetes, { hypo: true, hypo_count: 2 }, woman);
    expect(done.complete).toBe(true);
    expect(done.values).toEqual({ hypo: true, hypo_count: 2 });
  });

  it('drops the answers of hidden fields', () => {
    const state = evaluateForm(diabetes, { hypo: false, hypo_count: 3 }, woman);
    expect(state.values).toEqual({ hypo: false });
    expect(state.complete).toBe(true);
  });

  it('shows the pregnancy section and the adult BMI according to the patient', () => {
    const adult = evaluateForm(consultationGeneral, { weight: 70, height: 175 }, woman);
    expect(adult.sectionVisible.pregnancy).toBe(true);
    expect(adult.values.bmi).toBe(22.9);
    const boy = evaluateForm(consultationGeneral, { weight: 20, height: 110 }, child);
    expect(boy.sectionVisible.pregnancy).toBe(false);
    expect(boy.visible.bmi).toBe(false);
  });

  it('reports the vitals to record from a response', () => {
    const state = evaluateForm(
      consultationGeneral,
      { reason_text: 'Fièvre', orientation: 'home', temp: 38.4, weight: 61 },
      woman,
    );
    expect(state.complete).toBe(true);
    expect(vitalAnswers(consultationGeneral, state.values)).toEqual([
      { fieldId: 'temp', code: 'temp', value: 38.4 },
      { fieldId: 'weight', code: 'weight', value: 61 },
    ]);
  });

  it('checks shapes only on the server side', () => {
    const state = evaluateForm(diabetes, { hypo: 'yes', unknown_field: 1 }, woman, {
      structural: true,
    });
    expect(state.errors).toEqual({
      hypo: { code: 'FORM_CHOICE' },
      unknown_field: { code: 'FORM_UNKNOWN_FIELD' },
    });
    expect(evaluateForm(diabetes, {}, woman, { structural: true }).complete).toBe(true);
  });

  it('refuses to publish invalid expressions, cycles and type changes', () => {
    const broken = formDefinition.parse({
      ...diabetes,
      sections: [
        {
          id: 'follow',
          title: { fr: 'Suivi' },
          fields: [
            { id: 'a', type: 'calculation', label: { fr: 'A' }, expression: "value('b') + 1" },
            { id: 'b', type: 'calculation', label: { fr: 'B' }, expression: "value('a') + 1" },
            { id: 'c', type: 'text', label: { fr: 'C' }, visibleIf: "value('nope') == 1" },
            { id: 'd', type: 'text', label: { fr: 'D' }, visibleIf: 'x.constructor' },
            { id: 'hypo', type: 'text', label: { fr: 'Changé' } },
          ],
        },
      ],
    });
    const codes = checkDefinition(broken, diabetes).map((i) => `${i.fieldId}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'a:FORM_EXPR_CYCLE',
        'b:FORM_EXPR_CYCLE',
        'c:FORM_EXPR_UNKNOWN_FIELD',
        'd:FORM_EXPR_FORBIDDEN',
        'hypo:FORM_FIELD_TYPE_CHANGED',
      ]),
    );
  });
});
