import { type Review } from '../review/schema';
import { validateReview } from '../review/validate';
import { renderFeedbackHtml, validatedExportReview, validateExportRevision, type ExportEnvelope, type ExportProvenance } from './render-feedback-html';

export const REVIEW_EXPORT_FILENAME = 'codazo-review.html';
export const REVIEW_JSON_FILENAME = 'codazo-review.json';

export function validatedReviewForExport(input: unknown, expectedSource: unknown): Review | null {
  const parsed = validateReview(input, expectedSource);
  return parsed.ok ? parsed.value : null;
}

export function reviewJson(input: unknown, revisionInput?: unknown): string {
  const review = validatedExportReview(input);
  const revision = validateExportRevision(revisionInput);
  const envelope: ExportEnvelope = {
    format: 'codazo.review.export', format_version: 1, review,
    provenance: { generated_by: 'Codazo offline exporter', methodology: 'Codazo review methodology: source-preserving, learner-controlled feedback; alternatives are optional, not errors.', application_schema: 'codazo.review/1', upstream_contract: 'review-contract-v2', compatibility: 'semantic derivation only; not wire compatibility' },
    ...(revision === undefined ? {} : { revision }),
  };
  return JSON.stringify(envelope, null, 2);
}

export function reviewHtml(input: unknown, provenance: ExportProvenance, revisionInput?: unknown): string {
  return renderFeedbackHtml(input, provenance, revisionInput);
}
