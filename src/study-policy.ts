import { REVIEW_POLICY, type ReviewPolicy } from '../shared/lib/review/prompt';

/**
 * Study-guide mode: the same codazo.review/1 contract and validation, but the
 * model is asked for study material only. Annotations and practice come back
 * empty; vocabulary holds words above the requested level; verbs hold the
 * verbs actually used. Nothing about the contract or its limits changes.
 */
export const STUDY_ADDENDUM = 'STUDY GUIDE MODE: the learner asked for study material only, not a review of their writing. Return annotations, strengths, next_focus, and exercises as empty arrays and omit alignment. vocabulary: choose up to 5 words or phrases from the source that are above the requested learner level; skip anything a learner at that level should already know; set is_new to true; give the meaning and the reason in English and one or two short Spanish examples each. verbs: choose up to 3 verbs from the source, each with the tense actually used in the source and, when useful, one contrasting tense; keep conjugation.status unavailable as instructed. Copy every anchor quote exactly from the source. Prefer empty lists to invented material.';
export const STUDY_POLICY: ReviewPolicy = Object.freeze({ ...REVIEW_POLICY, instruction: `${REVIEW_POLICY.instruction}\n${STUDY_ADDENDUM}` });
