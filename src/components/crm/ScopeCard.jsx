import QuestionnaireCard from './QuestionnaireCard.jsx';
import { SECTIONS, SCOPE_KIND, summarize, missingRequired } from '../../lib/scopeQuestionnaire';

// The estimator's document: what is actually being built, priced and excluded.
// Asked on site with a tape measure, NOT on the intro call — see PreQualCard.
export default function ScopeCard({ leadId, leadName, profile }) {
  return (
    <QuestionnaireCard
      leadId={leadId} leadName={leadName} profile={profile}
      sections={SECTIONS} kind={SCOPE_KIND}
      missingFn={missingRequired} summarizeFn={summarize}
      title="Scope of work"
      subtitle="establishes expectations and separates included work from allowances and exclusions."
      emptyHint="No scope of work yet. This is the on-site survey, filled in once someone has seen the property."
    />
  );
}
