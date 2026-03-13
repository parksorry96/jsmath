// QTI 2.1 XML templates

export const QTI_XMLNS = {
  xmlns: "http://www.imsglobal.org/xsd/imsqti_v2p1",
  "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "xsi:schemaLocation":
    "http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/imsqti_v2p1.xsd",
};

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wrap LaTeX in a MathML-compatible annotation. For full MathML conversion a
 * dedicated library (mathjax-node, etc.) would be needed; here we embed LaTeX
 * as an annotation so downstream renderers can process it.
 */
export function latexToMathmlAnnotation(latex: string): string {
  return `<math xmlns="http://www.w3.org/1998/Math/MathML">
    <semantics>
      <annotation encoding="application/x-tex">${escapeXml(latex)}</annotation>
    </semantics>
  </math>`;
}

export function buildAssessmentItemXml(opts: {
  id: string;
  title: string;
  stemHtml: string;
  responseDeclaration: string;
  interaction: string;
  outcomeDeclaration: string;
  responseProcessing: string;
  metadata: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem
  xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/imsqti_v2p1.xsd"
  identifier="${escapeXml(opts.id)}"
  title="${escapeXml(opts.title)}"
  adaptive="false"
  timeDependent="false">
${opts.responseDeclaration}
${opts.outcomeDeclaration}
  <itemBody>
${opts.stemHtml}
${opts.interaction}
  </itemBody>
${opts.responseProcessing}
${opts.metadata}
</assessmentItem>`;
}

export function buildAssessmentTestXml(opts: {
  id: string;
  title: string;
  itemRefs: string[];
}): string {
  const refs = opts.itemRefs
    .map((ref) => `    <assessmentItemRef identifier="${escapeXml(ref)}" href="${escapeXml(ref)}.xml" required="true" fixed="false"/>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest
  xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_v2p1 http://www.imsglobal.org/xsd/imsqti_v2p1.xsd"
  identifier="${escapeXml(opts.id)}"
  title="${escapeXml(opts.title)}">
  <testPart identifier="testPart1" navigationMode="linear" submissionMode="individual">
    <assessmentSection identifier="section1" title="Questions" visible="true">
${refs}
    </assessmentSection>
  </testPart>
</assessmentTest>`;
}
