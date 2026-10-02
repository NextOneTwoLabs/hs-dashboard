// The one search box, in the header (#13): an ARIA 1.2 editable combobox with list autocomplete.
// The box (role=combobox) owns a listbox of options; the active option is named by
// aria-activedescendant and has aria-selected="true". The hint is the box's aria-describedby; the
// single role=status region announces counts after a pause in typing. Matching lives in search.js.
import { api } from '../api.js';
import { buildIndex, enterTarget, keyStep, statusText, suggest, target } from '../search.js';
import { readHash } from '../state.js';
import { pageOf, resolveTab } from '../nav.js';
import { optionId, panelHtml } from './searchPanel.js';

const PHONE = matchMedia('(max-width: 768px)');
const ANNOUNCE_MS = 450;

export function initSearch({ getStatesIndex }) {
  const input = document.getElementById('search-input');
  const panel = document.getElementById('search-panel');
  const status = document.getElementById('search-status');
  let idx = null;
  let loading = null;
  let result = { mode: 'help', items: [] };
  let st = { open: false, active: -1 };
  let timer = null;
  let titleFocus = false;
  let lastList = false;

  // The school list (Teams with st/q/view=list, #20) is where the box filters the table.
  const onList = () => pageOf(resolveTab(readHash())) === 'schools';
  const empty = () => ({ rows: [], cities: [], states: [] });

  function ensureIndex() {
    if (idx) return Promise.resolve(idx);
    if (!loading) {
      loading = api.searchIndex()
        .then((si) => { idx = buildIndex(si, getStatesIndex()); return idx; })
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

  function focusTitle() {
    const h = document.querySelector('.content-title');
    if (h) h.focus({ preventScroll: true });
  }

  function go(t) {
    st = { open: false, active: -1 };
    if (t.stay) {
      draw();
      if (PHONE.matches) input.blur();
      return;
    }
    // The box shows what the next page filters by: q= on Schools, nothing anywhere else.
    input.value = new URLSearchParams(t.hash.slice(1)).get('q') || '';
    if (t.focusTitle) titleFocus = true;
    draw();
    if (PHONE.matches) input.blur();   // a phone's keyboard drops
    if (location.hash === t.hash) {
      if (titleFocus) { titleFocus = false; focusTitle(); }
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

  // Phones: the bottom nav hides while the box has focus, so the fixed bar can't ride above the on-screen
  // keyboard and cover the suggestions (#20). CSS does it with :has(); this class is the fallback.
  input.addEventListener('focus', () => document.body.classList.add('search-focus'));
  input.addEventListener('blur', () => document.body.classList.remove('search-focus'));
  input.addEventListener('focus', async () => {
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
    const next = keyStep(st, e.key, { alt: e.altKey }, result.items.length);
    if (e.key !== 'Tab') e.preventDefault();
    st = { open: next.open, active: next.active };
    if (next.action === 'choose') { choose(result.items[next.index]); return; }
    if (next.action === 'enter') {
      const t = enterTarget(result, { list: onList() });
      if (t) go(t); else draw();
      return;
    }
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
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, select, textarea')) { e.preventDefault(); input.focus(); }
  });
  // After each page render: on the school list the box shows q=; leaving it clears it (q drops out of the
  // next tab link, as before). A school chosen from search focuses the new page's title.
  window.addEventListener('hs-rendered', () => {
    const now = onList();
    if (now) {
      if (document.activeElement !== input) input.value = readHash().q || '';
    } else if (lastList) {
      input.value = '';   // leaving the list drops its filter text
    }
    lastList = now;
    if (titleFocus) { titleFocus = false; focusTitle(); }
  });
  // Phones: size the panel from the visual viewport, so it stays above the on-screen keyboard.
  const vv = window.visualViewport;
  if (vv) {
    const size = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    vv.addEventListener('resize', size);
    size();
  }
}
