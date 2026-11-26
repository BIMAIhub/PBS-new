import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookOpen } from 'lucide-react';
import { WorkspaceChrome, type WorkspaceNavGroup } from '../src/components/student-dashboard/WorkspaceChrome.js';
import { AppAppearanceContext } from '../src/live/AppAppearance.js';

const page = (id: string, label: string) => ({ id, label, icon: BookOpen });
function screen(admin: boolean, appLayout: boolean, activePage: string) {
  const groups: WorkspaceNavGroup<string>[] = [{ label: admin ? 'Administration' : 'Learning', pages: [
    page('overview', admin ? 'Academy overview' : 'Overview'), ...(admin ? [page('students', 'Students')] : []),
    page('courses', admin ? 'Courses & videos' : 'My courses'), page('sessions', 'Live sessions'),
    ...(!admin ? [page('roadmap', 'My learning roadmap'), page('fees', 'Fees & payments')] : [page('payments', 'Payments & receipts')]),
    page('mobile-app', 'PBS app & alerts'), page('messages', 'Messages'),
  ] }];
  return renderToStaticMarkup(createElement(AppAppearanceContext.Provider, { value: {
    appLayout, textSize: 'large', layoutChoice: 'auto', setTextSize: () => {}, setLayoutChoice: () => {},
  } }, createElement(WorkspaceChrome<string>, { groups, activePage, onNavigate: () => {}, searchActions: [], accountActions: [],
    onHelp: () => {}, userName: 'Isolated layout check', workspaceLabel: admin ? 'Administration' : undefined,
    notifications: createElement('button', { 'aria-label': 'Notifications' }, 'Alerts'), children: createElement('p', {}, 'Existing workspace content'),
  })));
}
const bottomBar = (html: string) => html.match(/<nav class="pbs-app-tabs"[\s\S]*?<\/nav>/)?.[0] || '';

test('the student app uses a full-width shell and learning tabs instead of the desktop sidebar', () => {
  const html = screen(false, true, 'courses'), bar = bottomBar(html);
  assert.ok(html.includes('pbs-workspace pbs-app-shell'));
  assert.ok(!html.includes('<aside class="pbs-sidebar"'));
  assert.ok(!html.includes('class="pbs-search-trigger"'));
  assert.ok(html.includes('Existing workspace content'));
  for (const label of ['Home','Courses','Live','Progress','More']) assert.ok(bar.includes(`>${label}</span>`));
  assert.equal((bar.match(/<button /g) || []).length, 5);
  assert.match(bar, /aria-current="page"[^>]*>[\s\S]*?Courses<\/span>/);
  assert.ok(html.includes('aria-label="Notifications"'));
});

test('the administrator app has roster access and marks More for tools outside the primary tabs', () => {
  const bar = bottomBar(screen(true, true, 'payments'));
  for (const label of ['Home','Students','Courses','Live','More']) assert.ok(bar.includes(`>${label}</span>`));
  assert.ok(!bar.includes('>Progress</span>'));
  assert.match(bar, /aria-label="More tools" aria-expanded="false" aria-current="page"/);
  assert.equal((bar.match(/aria-current="page"/g) || []).length, 1);
});

test('the wider browser workspace retains its existing sidebar, search and all page links', () => {
  const html = screen(false, false, 'courses');
  assert.ok(html.includes('<aside class="pbs-sidebar"'));
  assert.ok(html.includes('class="pbs-search-trigger"'));
  assert.ok(html.includes('>Fees &amp; payments</span>'));
  assert.ok(html.includes('>PBS app &amp; alerts</span>'));
  assert.equal(bottomBar(html), '');
});
