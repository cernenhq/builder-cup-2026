// Prompts for the two readers. Reader A follows the prototype's prompt. Reader B is told it is an
// independent second reader and to look for what would contradict the claim first, so the two
// readings are not just the same call twice.
const LABEL = { supported: 'supported', contradicted: 'contradicted', not_assessable: "can't tell" };

function correctionsText(corrections) {
  if (!corrections || !corrections.length) return '';
  return (
    '\nReviewer corrections from earlier periods on this project (guidance about where readers were wrong):\n' +
    corrections
      .slice(-12)
      .map((c) => `- ${c.lineLabel}: the readers said ${LABEL[c.ai] || c.ai}, the reviewer decided ${LABEL[c.decision] || c.decision}${c.reason ? ` (${String(c.reason).slice(0, 200)})` : ''}`)
      .join('\n')
  );
}

function linesText(claims) {
  return claims.map((c) => `${c.id}: "${c.statement}" (question to check: ${c.question})`).join('\n');
}

const COMMON_RULES = `Quantities, percentages and hidden work (waterproofing, interior work, buried work, anything inside the building) cannot be established by photos: answer not_assessable for those.
Answer only: supported, contradicted, or not_assessable (hidden, out of frame, too dark, too low resolution, weather, reflections).
Give box_2d [ymin, xmin, ymax, xmax] normalised to 0-1000 around the evidence when there is any, and photo_index (0 for the first photo) for the photo the box is on.
Describe only what is visible. Do not comment on anyone's honesty or intent. A photo can only support or contradict what is visible, and "no visible change" does not mean no work was done.`;

function promptFor(reader, { periodLabel, claims, corrections, photoLabels }) {
  const photos = photoLabels.map((l, i) => `Photo ${i}: ${l}`).join('\n');
  if (reader === 'B') {
    return `You are the second, independent reader for a municipal engineering office. Another reader has looked at the same photos; do not try to agree with anyone.
The contractor's progress claim for ${periodLabel} lists line items below. For each line, first look for anything in the photos that would contradict the claim, then for anything that supports it.
Restate each line as one question a photo can answer about plainly visible features.
${COMMON_RULES}${correctionsText(corrections)}
${photos}
Claim lines:
${linesText(claims)}`;
  }
  return `You are helping a municipal engineering office compare a contractor's progress claim with site photos for ${periodLabel}.
For each line item below:
1. Turn it into one question a photo can answer about plainly visible features.
2. Answer the question from the photos.
${COMMON_RULES}${correctionsText(corrections)}
${photos}
Claim lines:
${linesText(claims)}`;
}

module.exports = { promptFor, correctionsText };
