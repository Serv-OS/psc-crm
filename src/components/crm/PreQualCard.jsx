import QuestionnaireCard from './QuestionnaireCard.jsx';
import { SECTIONS, PREQUAL_KIND, summarize, missingRequired } from '../../lib/preQualification';

// The intro call, in the order it is asked on the phone. This is what decides
// whether anyone drives out at all, so it comes FIRST on the lead, above the
// scope of work.
export default function PreQualCard({ leadId, leadName, profile }) {
  return (
    <QuestionnaireCard
      leadId={leadId} leadName={leadName} profile={profile}
      sections={SECTIONS} kind={PREQUAL_KIND}
      missingFn={missingRequired} summarizeFn={summarize}
      title="Intro call"
      subtitle="the questions asked on the phone, before anyone drives out."
      emptyHint="No intro call recorded. Five questions decide whether this lead is worth a visit."
    />
  );
}
