/** Shared top-level workflow navigation; switching views never starts a request. */
export function WorkspaceNavigation({ active }: { active: 'onboarding' | 'investigation' }) {
  return (
    <nav className="workspace-navigation" aria-label="Workspaces">
      <a href="/" aria-current={active === 'onboarding' ? 'page' : undefined}>
        Onboarding
      </a>
      <a href="/?view=investigation" aria-current={active === 'investigation' ? 'page' : undefined}>
        Investigating <span className="experimental-label">(experimental)</span>
      </a>
    </nav>
  );
}
