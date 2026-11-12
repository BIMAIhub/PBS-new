import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, ChevronDown, ChevronRight, CircleHelp,
  Menu, Search, type LucideIcon
} from 'lucide-react';
import { PortalBrand, PortalDialog } from './PortalUI';
import type { DashboardTabType } from './StudentDashboard';

export interface WorkspaceAction {
  label: string;
  icon: LucideIcon;
  run: () => void;
  detail?: string;
}

export interface WorkspacePage {
  id: DashboardTabType;
  label: string;
  icon: LucideIcon;
}

export interface WorkspaceNavGroup {
  label: string;
  pages: WorkspacePage[];
}

interface WorkspaceChromeProps {
  groups: WorkspaceNavGroup[];
  activePage: DashboardTabType;
  onNavigate: (page: DashboardTabType) => void;
  searchActions: WorkspaceAction[];
  accountActions: WorkspaceAction[];
  onHelp: () => void;
  userName: string;
  children: ReactNode;
}

function WorkspaceNav({ groups, activePage, onNavigate }: Pick<WorkspaceChromeProps, 'groups' | 'activePage' | 'onNavigate'>) {
  return (
    <nav className="pbs-navigation" aria-label="Student workspace">
      {groups.map((group) => (
        <div className="pbs-nav-group" key={group.label}>
          <p>{group.label}</p>
          {group.pages.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={activePage === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
              <Icon /> <span>{label}</span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

export function WorkspaceActionRow({ action }: { action: WorkspaceAction }) {
  const Icon = action.icon;
  return (
    <button type="button" className="pbs-action-row" onClick={action.run}>
      <span className="pbs-row-icon"><Icon /></span>
      <span><strong>{action.label}</strong>{action.detail && <small>{action.detail}</small>}</span>
      <ChevronRight className="pbs-row-end" />
    </button>
  );
}

export function WorkspaceChrome({
  groups, activePage, onNavigate, searchActions, accountActions, onHelp, userName, children
}: WorkspaceChromeProps) {
  const [dialog, setDialog] = useState<'navigation' | 'search' | 'account' | null>(null);
  const [query, setQuery] = useState('');
  const pages = groups.flatMap(group => group.pages);
  const pageName = pages.find(page => page.id === activePage)?.label ?? 'Overview';
  const initials = userName.trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase()).join('');
  const terms = query.trim().toLowerCase().split(/\s+/);
  const searchResults = [
    ...pages.map(page => ({ ...page, run: () => onNavigate(page.id), detail: 'Workspace page' })),
    ...searchActions
  ].filter(action => terms.every(term => `${action.label} ${action.detail ?? ''}`.toLowerCase().includes(term)));

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      event.preventDefault();
      setQuery('');
      setDialog('search');
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  function runAction(action: WorkspaceAction) {
    setDialog(null);
    action.run();
  }

  return (
    <div className="pbs-workspace">
      <a href="#workspace-content" className="pbs-skip-link">Skip to content</a>
      <aside className="pbs-sidebar">
        <PortalBrand workspace />
        <WorkspaceNav groups={groups} activePage={activePage} onNavigate={onNavigate} />
        <button className="pbs-sidebar-help" type="button" onClick={onHelp}>
          <CircleHelp /> <span>Help and FAQs</span> <ArrowUpRight />
        </button>
      </aside>

      <div className="pbs-workspace-body">
        <header className="pbs-topbar">
          <div className="pbs-breadcrumb">
            <button type="button" className="pbs-icon-button pbs-mobile-menu" onClick={() => setDialog('navigation')} aria-label="Open navigation">
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight />
            <strong>{pageName}</strong>
          </div>
          <div className="pbs-topbar-controls">
            <button type="button" className="pbs-search-trigger" aria-label="Search workspace" onClick={() => {
              setQuery('');
              setDialog('search');
            }}>
              <Search /> <span>Search workspace</span> <kbd>Ctrl K</kbd>
            </button>
            <button type="button" className="pbs-account-trigger" aria-label="Open account menu" onClick={() => setDialog('account')}>
              <span className="pbs-account-avatar" aria-hidden="true">{initials || 'S'}</span>
              <span className="pbs-account-name">{userName}</span>
              <ChevronDown />
            </button>
          </div>
        </header>

        <main id="workspace-content" className="pbs-workspace-main" tabIndex={-1}>
          <h1 className="pbs-page-title">{pageName}</h1>
          {children}
        </main>
      </div>

      {dialog === 'navigation' && (
        <PortalDialog title="Workspace navigation" onClose={() => setDialog(null)} className="pbs-navigation-dialog">
          <WorkspaceNav groups={groups} activePage={activePage} onNavigate={(page) => {
            setDialog(null);
            onNavigate(page);
          }} />
          <button type="button" className="pbs-sidebar-help" onClick={() => {
            setDialog(null);
            onHelp();
          }}>
            <CircleHelp /> <span>Help and FAQs</span> <ArrowUpRight />
          </button>
        </PortalDialog>
      )}

      {dialog === 'search' && (
        <PortalDialog title="Search workspace" onClose={() => setDialog(null)}>
          <div className="pbs-dialog-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Search pages and tools"
              placeholder="Find a page or tool"
              data-dialog-focus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchResults[0]) runAction(searchResults[0]);
              }}
            />
          </div>
          <div className="pbs-dialog-list">
            {searchResults.length === 0 && <p className="pbs-empty" role="status">No matching pages or tools.</p>}
            {searchResults.map(action => (
              <WorkspaceActionRow key={action.label} action={{ ...action, run: () => runAction(action) }} />
            ))}
          </div>
        </PortalDialog>
      )}

      {dialog === 'account' && (
        <PortalDialog title={userName} onClose={() => setDialog(null)}>
          <div className="pbs-dialog-list">
            {accountActions.map(action => (
              <WorkspaceActionRow key={action.label} action={{ ...action, run: () => runAction(action) }} />
            ))}
          </div>
        </PortalDialog>
      )}
    </div>
  );
}
