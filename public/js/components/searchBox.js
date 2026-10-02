// The one search box (#13), in the site header on every page (owner, #31: "the search box should appear at
// header"; in a Schools page band from #26 to #31), for schools and events (#31 PR 2). An ARIA 1.2 editable combobox with list autocomplete: the box
// (role=combobox) owns a listbox of options; the active option is named by aria-activedescendant and has
// aria-selected="true". The hint is the box's aria-describedby; the single role=status region announces counts
// after a pause in typing. Matching lives in search.js.
// Phones: the header keeps one 56 px row with a search button; it opens the same box as a full-width bar under the
// header (#31 v4.1). Escape there: closes the list, then clears the text, then closes the bar (focus back to the
// button); "Close" closes the bar at once and keeps the text; a tap outside closes it without clearing.
import { api } from '../api.js';
import { buildIndex, enterTarget, keyStep, statusText, suggest, target } from '../search.js';
import { readHash } from '../state.js';
import { boxTextAfter, pageOf, resolveTab, slashAction } from '../nav.js';
import { optionId, panelHtml } from './searchPanel.js';
import { focusPageTitle } from './titleFocus.js';

const PHONE = matchMedia('(max-width: 768px)');
const ANNOUNCE_MS = 450;

export function initSearch({ getStatesIndex }) {
  const input = document.getElementById('search-input');
  const panel = document.getElementById('search-panel');
  const status = document.getElementById('search-status');
  const box = document.getElementById('search');
  const header = document.getElementById('header');
  const toggle = document.getElementById('search-toggle');
  const close = document.getElementById('search-close');
  let idx = null;
  let loading = null;
  let result = { mode: 'help', items: [] };
  let st = { open: false, active: -1 };
  let timer = null;
  let titleFocus = false;

  // The school list (Schools with st/q/city/view=list) is where the box filters the table.
  const onList = () => pageOf(resolveTab(readHash())) === 'schools';
  const empty = () => ({ rows: [], cities: [], states: [], ev: null });

  // The search index and the catalog (for the Events group), on the first focus: at most 1 of each per page
  // session (api.js keeps them; the Events page shares the catalog). Without the catalog, schools still work.
  function ensureIndex() {
    if (idx) return Promise.resolve(idx);
    if (!loading) {
      loading = Promise.all([api.searchIndex(), api.catalog().catch(() => null)])
        .then(([si, catalog]) => { idx = buildIndex(si, getStatesIndex(), catalog); return idx; })
        .catch(() => { loading = null; return null; });
    }
    return loading;
  }

  function draw() {
    const statesIndex = getStatesIndex();
    result = statesIndex ? suggest(idx || empty(), input.value, { phone: PHONE.matches }) : { mode: 'help', items: [] };
    if (st.active >= result.items.length) st.active = -1;
    panel.innerHTML = panelHtml(result, { active: st.active, raw: input.value, idx, statesIndex, phone: PHONE.matches });
    const show = st.open && result.items.length > 0;
    panel.hidden = !show;
    input.setAttribute('aria-expanded', String(show));
    if (show && st.active >= 0) {
      input.setAttribute('aria-activedescendant', optionId(st.active));
      document.getElementById(optionId(st.active))?.scrollIntoView?.({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  // Counts are announced once typing pauses, not on every key or on focus (the hint is aria-describedby).
  function announce() {
    clearTimeout(timer);
    timer = setTimeout(() => { status.textContent = statusText(result, input.value, { list: onList() }); }, ANNOUNCE_MS);
  }

  // On the school list, the box is the table's filter (q=).
  function emitQuery() {
    if (onList()) window.dispatchEvent(new CustomEvent('hs-query', { detail: input.value }));
  }

  // ----- The phone bar -----
  const barOpen = () => header.classList.contains('search-open');
  function openBar() {
    header.classList.add('search-open');
    document.body.classList.add('search-open');   // the bottom bar stays hidden while the bar is open
    toggle?.setAttribute('aria-expanded', 'true');
  }
  function closeBar({ restore = true } = {}) {
    if (!barOpen()) return;
    header.classList.remove('search-open');
    document.body.classList.remove('search-open');
    toggle?.setAttribute('aria-expanded', 'false');
    st = { open: false, active: -1 };
    draw();
    if (restore) toggle?.focus({ preventScroll: true });
  }
  toggle?.addEventListener('click', () => {
    if (barOpen()) { closeBar(); return; }
    openBar();
    input.focus();
  });
  close?.addEventListener('click', () => closeBar());   // Close: at once, keeping the text
  // A tap outside the open bar closes it without clearing; focus stays where the tap put it.
  document.addEventListener('pointerdown', (e) => {
    if (!barOpen() || box.contains(e.target) || toggle?.contains(e.target)) return;
    closeBar({ restore: false });
  });

  function go(t) {
    st = { open: false, active: -1 };
    if (t.stay) {
      draw();
      if (PHONE.matches) input.blur();
      return;
    }
    // The box shows what the next page filters by: q= on the school list, nothing anywhere else.
    input.value = new URLSearchParams(t.hash.slice(1)).get('q') || '';
    if (t.focusTitle) titleFocus = true;
    draw();
    if (PHONE.matches) { input.blur(); closeBar({ restore: false }); }   // the keyboard drops, the bar closes
    if (location.hash === t.hash) {
      if (titleFocus) { titleFocus = false; focusPageTitle(); }
    } else {
      location.hash = t.hash;
    }
  }

  function choose(item) {
    const t = item && target(item);
    if (!t) return;
    if (t.fill) {   // a chip fills the box and shows its suggestions
      input.value = t.fill;
      st = { open: true, active: -1 };
      draw();
      announce();
      emitQuery();
      input.focus();
      return;
    }
    go(t);
  }

  // Phones: the bottom nav hides while the box has focus or the bar is open, so the fixed bar can't ride above the
  // on-screen keyboard and cover the suggestions (#20). CSS does it with :has(); these classes are the fallback.
  input.addEventListener('focus', () => document.body.classList.add('search-focus'));
  input.addEventListener('blur', () => document.body.classList.remove('search-focus'));
  input.addEventListener('focus', async () => {
    sizePanel();
    await ensureIndex();
    st = { open: true, active: -1 };
    draw();
  });
  input.addEventListener('input', async () => {
    st = { open: true, active: -1 };
    emitQuery();
    await ensureIndex();
    draw();
    announce();
  });
  input.addEventListener('blur', () => {
    st = { open: false, active: -1 };
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(e.key)) return;
    const next = keyStep(st, e.key, { alt: e.altKey, bar: barOpen(), empty: !input.value }, result.items.length);
    if (e.key !== 'Tab') e.preventDefault();
    st = { open: next.open, active: next.active };
    if (next.action === 'choose') { choose(result.items[next.index]); return; }
    if (next.action === 'enter') {
      const t = enterTarget(result, { list: onList() });
      if (t) go(t); else draw();
      return;
    }
    if (next.action === 'closeBar') { closeBar(); return; }
    if (next.action === 'clear') {
      input.value = '';
      status.textContent = '';
      emitQuery();
    }
    draw();
  });
  // mousedown keeps focus in the box, so its blur doesn't close the list before the click lands.
  panel.addEventListener('mousedown', (e) => {
    if (e.target.closest('[role="option"]')) e.preventDefault();
  });
  panel.addEventListener('click', (e) => {
    const o = e.target.closest('[role="option"]');
    if (o) choose(result.items[Number(o.dataset.i)]);
  });
  // "Clear search" in the Schools subtitle.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-clear-search]')) return;
    input.value = '';
    emitQuery();
    input.focus();
  });
  // "/" focuses the header box on every page (on phones it opens the bar first). nav.js slashAction ignores it
  // while typing in a field and with Ctrl, Meta or Alt.
  document.addEventListener('keydown', (e) => {
    const act = slashAction(resolveTab(readHash()), e);
    if (!act) return;
    e.preventDefault();
    if (PHONE.matches) openBar();
    input.focus();
  });
  // After each page render: the box keeps its text only between the Schools landing and the list, and shows q= on
  // the list unless you're typing in it (nav.js boxTextAfter). A school chosen from search focuses the new page's
  // title. app.js sends hs-rendered before its own title-focus step, which leaves focus in the box when it has it.
  window.addEventListener('hs-rendered', () => {
    const state = resolveTab(readHash());
    input.value = boxTextAfter({ state, focused: document.activeElement === input, text: input.value });
    if (titleFocus) { titleFocus = false; focusPageTitle(); }
  });
  // Phones: size the panel from the visual viewport and the box's position, so it stays above the keyboard.
  function sizePanel() {
    const bottom = Math.round(input.getBoundingClientRect?.().bottom || 0);
    document.documentElement.style.setProperty('--qpanel-top', `${bottom}px`);
  }
  const vv = window.visualViewport;
  if (vv) {
    const size = () => { document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`); sizePanel(); };
    vv.addEventListener('resize', size);
    size();
  }
}
