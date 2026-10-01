// Page shell (collegedash layout): sidebar toggle, the phone drawer, and "Data updated" in the header.
// Kept out of app.js so routing there stays as it was.
import { api } from './api.js';
import { readHash } from './state.js';
import { resolveTab } from './nav.js';

const PHONE = matchMedia('(max-width: 768px)');
const layout = document.getElementById('layout');
const sidebar = document.getElementById('sidebar');
const toggle = document.getElementById('sidebar-toggle');
const overlay = document.getElementById('sidebar-overlay');
const done = document.getElementById('drawer-done');
const behind = [document.getElementById('main'), document.querySelector('.header-search'), document.querySelector('.header-right')];
let lastFocus = null;

const DONE = { states: 'Show states', playoffs: 'Show bracket', results: 'Show results', champions: 'Show champions',
  schools: 'Show schools', school: 'Show school', about: 'Close filters' };

function drawerOpen() { return layout.classList.contains('drawer'); }

function sync() {
  const phone = PHONE.matches;
  const open = phone ? drawerOpen() : !layout.classList.contains('collapsed');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Hide filters' : 'Show filters');
  // Phone: the drawer is modal while open (page behind is inert, body does not scroll).
  const modal = phone && drawerOpen();
  overlay.hidden = !modal;
  document.body.classList.toggle('no-scroll', modal);
  for (const el of behind) if (el) el.inert = modal;
  sidebar.inert = phone && !drawerOpen();   // a closed drawer is off screen: keep it out of the tab order
  if (phone && drawerOpen()) sidebar.setAttribute('aria-modal', 'true'); else sidebar.removeAttribute('aria-modal');
  sidebar.setAttribute('role', modal ? 'dialog' : 'complementary');
}

function openDrawer() {
  lastFocus = document.activeElement;
  layout.classList.add('drawer');
  sync();
  // preventScroll: the drawer is still sliding in, and scrolling it into view would shift the page.
  (sidebar.querySelector('[aria-current="true"]') || sidebar.querySelector('a, select, button, input') || sidebar).focus({ preventScroll: true });
}

export function closeDrawer({ restore = true } = {}) {
  if (!drawerOpen()) return;
  layout.classList.remove('drawer');
  sync();
  if (restore) (lastFocus && document.contains(lastFocus) ? lastFocus : toggle).focus({ preventScroll: true });
}

toggle.addEventListener('click', () => {
  if (PHONE.matches) {
    if (drawerOpen()) closeDrawer(); else openDrawer();
  } else {
    layout.classList.toggle('collapsed');
    sync();
  }
});
overlay.addEventListener('click', () => closeDrawer());
done.addEventListener('click', () => closeDrawer());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawerOpen()) { e.preventDefault(); closeDrawer(); }
});
// Growing past 768 px with the drawer open: drop the drawer state (the sidebar is inline again).
// (resize as well as the media-query change event, which not every browser or emulator fires.)
function reset() {
  if (!PHONE.matches && drawerOpen()) layout.classList.remove('drawer');
  sync();
}
PHONE.addEventListener('change', reset);
window.addEventListener('resize', reset);

function label() {
  done.textContent = DONE[resolveTab(readHash()).tab] || 'Done';
}
window.addEventListener('hashchange', label);
label();
sync();

api.status().then((s) => {
  if (s?.updatedAt) {
    document.getElementById('data-updated').textContent =
      `Data updated ${new Date(s.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
}).catch(() => {});
