import { Conjugator, type ResultTable } from '@jirimracek/conjugate-esp';
import referenceLicenses from '../../data/language/conjugation-licenses.json' with { type: 'json' };

export type ConjugationReference = {
  status: 'available';
  tense: string;
  forms: { person: string; form: string }[];
  source: { label: string; url: string; license: string; licenseText?: string };
} | { status: 'unavailable'; reason: string };

const source = {
  label: 'conjugate-esp 2.3.6 · rule-based reference',
  url: 'https://www.npmjs.com/package/@jirimracek/conjugate-esp/v/2.3.6',
  license: 'MIT; fast-diff dependency: Apache-2.0',
  licenseText: referenceLicenses.text,
};
const persons = ['yo', 'tú', 'él / ella / usted', 'nosotros / nosotras', 'ellos / ellas / ustedes'];
const conjugator = new Conjugator('2010');
conjugator.useHighlight(false);
const knownVerbs = new Set(conjugator.getVerbListSync());
const selectors: Record<string, (table: ResultTable) => string[]> = {
  present: table => table.Indicativo.Presente, preterite: table => table.Indicativo.PreteritoIndefinido,
  imperfect: table => table.Indicativo.PreteritoImperfecto, future: table => table.Indicativo.FuturoImperfecto,
  conditional: table => table.Indicativo.CondicionalSimple, present_subjunctive: table => table.Subjuntivo.Presente,
  imperfect_subjunctive_ra: table => table.Subjuntivo.PreteritoImperfectoRa,
  imperfect_subjunctive_se: table => table.Subjuntivo.PreteritoImperfectoSe,
};
const tenses = [
  { key: 'present', label: 'Presente de indicativo', aliases: ['present', 'presente', 'present indicative', 'presente de indicativo', 'presente del indicativo', 'indicative present'] },
  { key: 'preterite', label: 'Pretérito perfecto simple', aliases: ['preterite', 'pretérito', 'preterito indefinido', 'pretérito perfecto simple', 'pretérito (perfecto simple)', 'pretérito simple', 'preterite (completed past)', 'preterite indicative', 'simple past'] },
  { key: 'imperfect', label: 'Pretérito imperfecto de indicativo', aliases: ['imperfect', 'imperfecto', 'pretérito imperfecto', 'pretérito imperfecto de indicativo', 'imperfect indicative', 'imperfecto de indicativo'] },
  { key: 'future', label: 'Futuro simple de indicativo', aliases: ['future', 'simple future', 'futuro', 'futuro simple', 'futuro de indicativo', 'futuro simple de indicativo', 'future indicative'] },
  { key: 'conditional', label: 'Condicional simple', aliases: ['conditional', 'simple conditional', 'condicional', 'condicional simple', 'pospretérito'] },
  { key: 'present_subjunctive', label: 'Presente de subjuntivo', aliases: ['present_subjunctive', 'present subjunctive', 'presente de subjuntivo', 'presente del subjuntivo', 'subjunctive present'] },
  { key: 'imperfect_subjunctive_ra', label: 'Imperfecto de subjuntivo (-ra)', aliases: ['imperfect_subjunctive_ra', 'imperfect subjunctive', 'imperfect subjunctive (-ra)', 'imperfecto de subjuntivo', 'pretérito imperfecto de subjuntivo', 'imperfecto de subjuntivo (-ra)'] },
  { key: 'imperfect_subjunctive_se', label: 'Imperfecto de subjuntivo (-se)', aliases: ['imperfect_subjunctive_se', 'imperfect subjunctive (-se)', 'imperfecto de subjuntivo (-se)', 'pretérito imperfecto de subjuntivo (-se)'] },
];
const normalizeTense = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ');
const tenseAliases = new Map(tenses.flatMap(tense => tense.aliases.map(alias => [normalizeTense(alias), tense] as const)));

/** Lookup only: unknown names never fall through to a guessed mood or paradigm.
 * Provider IDs are arbitrary anchors, not tense identifiers. Use tense.name.
 * Matching does not change the learner's source, review payload, or verb spelling.
 */
export function lookupConjugation(verb: string, tenseName: string): ConjugationReference {
  const tense = tenseAliases.get(normalizeTense(tenseName));
  if (!tense) return { status: 'unavailable', reason: 'This tense is not covered by the bundled reference. No forms were guessed.' };
  const unavailable = { status: 'unavailable' as const, reason: 'This verb and tense do not have a complete, unambiguous table in the bundled reference. No forms were guessed.' };
  if (!/^[a-záéíóúüñ]{1,60}$/.test(verb) || !knownVerbs.has(verb)) return unavailable;
  let results: ReturnType<Conjugator['conjugateSync']>;
  try { results = conjugator.conjugateSync(verb, 'canarias'); } catch { return unavailable; }
  if (!Array.isArray(results)) return unavailable;
  const candidates = results.filter(result => !result.info.defective).map(result => selectors[tense.key](result.conjugation));
  // canarias is the package's tú + ustedes setting, not a geographic claim.
  // Both plural slots must agree before combining ellos/ellas/ustedes.
  if (!candidates.length || candidates.some(forms => !Array.isArray(forms) || forms.length !== 6 || forms[4] !== forms[5] || forms.some(form => !/^[a-záéíóúüñ]+(?: [a-záéíóúüñ]+){0,3}$/.test(form)))) return unavailable;
  const variants = candidates as string[][];
  if (new Set(variants.map(forms => forms.join('\0'))).size !== 1) return unavailable;
  const forms = [0, 1, 2, 3, 5].map(index => variants[0][index]);
  return {
    status: 'available', tense: tense.label, source: { ...source },
    forms: forms.map((form, index) => ({ person: persons[index], form })),
  };
}
