/** Routes onboarding and experimental investigation workspaces. */
import { Onboarding } from './features/onboarding/Onboarding';
import { InvestigationApp } from './InvestigationApp';
export function App() {
  const query = new URLSearchParams(window.location.search);
  return query.has('investigation') || query.get('view') === 'investigation' ? (
    <InvestigationApp />
  ) : (
    <Onboarding />
  );
}
