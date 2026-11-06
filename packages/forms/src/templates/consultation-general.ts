import type { FormDefinition } from '../schema';

/**
 * Starting template "Consultation générale" (S9 decision: the only template
 * shipped for the pilot). A structure copies it, adapts it and publishes its
 * own version; nothing here is a national protocol.
 */
export const consultationGeneral: FormDefinition = {
  schemaVersion: 1,
  code: 'consultation_generale',
  title: { fr: 'Consultation générale', en: 'General consultation' },
  step: 'consultation',
  sections: [
    {
      id: 'reason',
      title: { fr: 'Motif', en: 'Reason for visit' },
      fields: [
        {
          id: 'reason_text',
          type: 'text',
          label: { fr: 'Motif de consultation', en: 'Reason for visit' },
          required: true,
        },
        {
          id: 'duration_days',
          type: 'number',
          label: { fr: 'Depuis combien de jours', en: 'For how many days' },
          unit: 'j',
          decimals: 0,
          min: 0,
          max: 3650,
        },
        {
          id: 'symptoms',
          type: 'multi_choice',
          label: { fr: 'Signes associés', en: 'Associated signs' },
          display: 'buttons',
          options: [
            { code: 'fever', label: { fr: 'Fièvre', en: 'Fever' } },
            { code: 'cough', label: { fr: 'Toux', en: 'Cough' } },
            { code: 'diarrhoea', label: { fr: 'Diarrhée', en: 'Diarrhoea' } },
            { code: 'vomiting', label: { fr: 'Vomissements', en: 'Vomiting' } },
            { code: 'headache', label: { fr: 'Céphalées', en: 'Headache' } },
            { code: 'abdominal_pain', label: { fr: 'Douleur abdominale', en: 'Abdominal pain' } },
            { code: 'rash', label: { fr: 'Éruption cutanée', en: 'Rash' } },
            { code: 'other', label: { fr: 'Autre', en: 'Other' } },
          ],
        },
        {
          id: 'other_symptom',
          type: 'text',
          label: { fr: 'Autre signe', en: 'Other sign' },
          visibleIf: "selected('symptoms', 'other')",
          requiredIf: "selected('symptoms', 'other')",
        },
      ],
    },
    {
      id: 'vitals',
      title: { fr: 'Constantes', en: 'Vital signs' },
      fields: [
        {
          id: 'temp',
          type: 'vital',
          vital: 'temp',
          label: { fr: 'Température', en: 'Temperature' },
          unit: '°C',
        },
        {
          id: 'weight',
          type: 'vital',
          vital: 'weight',
          label: { fr: 'Poids', en: 'Weight' },
          unit: 'kg',
        },
        {
          id: 'height',
          type: 'vital',
          vital: 'height',
          label: { fr: 'Taille', en: 'Height' },
          unit: 'cm',
        },
        {
          id: 'bmi',
          type: 'calculation',
          label: { fr: 'IMC', en: 'BMI' },
          unit: 'kg/m²',
          decimals: 1,
          expression: "vital('weight') / pow(vital('height') / 100, 2)",
          visibleIf: '!(ageYears() < 18)',
        },
        {
          id: 'sbp',
          type: 'vital',
          vital: 'sbp',
          label: { fr: 'TA systolique', en: 'Systolic BP' },
          unit: 'mmHg',
        },
        {
          id: 'dbp',
          type: 'vital',
          vital: 'dbp',
          label: { fr: 'TA diastolique', en: 'Diastolic BP' },
          unit: 'mmHg',
        },
      ],
    },
    {
      id: 'pregnancy',
      title: { fr: 'Grossesse', en: 'Pregnancy' },
      visibleIf: "sex() == 'F' && ageYears() >= 12 && ageYears() <= 50",
      fields: [
        {
          id: 'pregnant',
          type: 'yes_no',
          label: { fr: 'Grossesse en cours', en: 'Currently pregnant' },
        },
        {
          id: 'last_period',
          type: 'date',
          label: { fr: 'Date des dernières règles', en: 'Last menstrual period' },
          visibleIf: "value('pregnant') == true",
        },
      ],
    },
    {
      id: 'examination',
      title: { fr: 'Examen', en: 'Examination' },
      fields: [
        {
          id: 'general_state',
          type: 'choice',
          label: { fr: 'État général', en: 'General condition' },
          display: 'buttons',
          options: [
            { code: 'good', label: { fr: 'Bon', en: 'Good' } },
            { code: 'altered', label: { fr: 'Altéré', en: 'Altered' } },
            { code: 'poor', label: { fr: 'Mauvais', en: 'Poor' } },
          ],
        },
        {
          id: 'examination_text',
          type: 'textarea',
          label: { fr: 'Examen physique', en: 'Physical examination' },
        },
      ],
    },
    {
      id: 'outcome',
      title: { fr: 'Conclusion', en: 'Outcome' },
      fields: [
        {
          id: 'orientation',
          type: 'choice',
          label: { fr: 'Orientation', en: 'Disposition' },
          required: true,
          display: 'buttons',
          options: [
            { code: 'home', label: { fr: 'Retour à domicile', en: 'Home' } },
            { code: 'observation', label: { fr: 'Mise en observation', en: 'Observation' } },
            { code: 'admission', label: { fr: 'Hospitalisation', en: 'Admission' } },
            { code: 'referral', label: { fr: 'Référence', en: 'Referral' } },
          ],
        },
        {
          id: 'follow_up_days',
          type: 'number',
          label: { fr: 'Revoir dans (jours)', en: 'Follow-up in (days)' },
          unit: 'j',
          decimals: 0,
          min: 1,
          max: 365,
        },
        {
          id: 'diagnosis_hint',
          type: 'info',
          label: {
            fr: 'Les diagnostics codés se saisissent dans le panneau Diagnostics.',
            en: 'Coded diagnoses are entered in the Diagnoses panel.',
          },
        },
      ],
    },
  ],
};
