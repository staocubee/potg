// Module 6's verification checklist is genuinely country/market-specific
// (see the blueprint's note that "verified" means different things in
// different jurisdictions). This is a placeholder default for a single
// market so the skill has something real to check against — swap or
// extend per-country before relying on it for actual verification.
export const DEFAULT_DOCUMENT_CHECKLIST = [
  'title_document',
  'survey_plan',
  'certificate_of_occupancy',
  'building_approval',
];

export function labelDocumentType(documentType: string): string {
  return documentType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
