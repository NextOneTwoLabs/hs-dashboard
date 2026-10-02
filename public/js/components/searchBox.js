// The one search box (#13), on the Schools page since #26 (the #school-search band in index.html, shown on the
// landing and the list; this module owns it and no view writes into it). An ARIA 1.2 editable combobox with list
// autocomplete: the box (role=combobox) owns a listbox of options; the active option is named by
// aria-activedescendant and has aria-selected="true". The hint is the box's aria-describedby; the single
// role=status region announces counts after a pause in typing. Matching lives in search.js.
import { api } from '../api.js';
import { buildIndex, enterTarget, keyStep, statusText, suggest, target } from '../search.js';
import { readHash } from '../state.js';
import { boxTextAfter, hasSchoolSearch, pageOf, resolveTab, slashAction } from '../nav.js';
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
  let focusAfterRender = false;   // "/" from another page: focus the box once Schools has rendered (#26)

  // The school list (Schools with st/q/view=list) is where the box filters the table.
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

  // The landing's example chips, under the box (#26): fill it, focus it and show the suggestions, as the panel's
  // own chips do.
  document.getElementById('school-search-chips')?.addEventListener('click', async (e) => {
    const chip = e.target.closest('[data-fill]');
    if (!chip) return;
    choose({ kind: 'chip', text: chip.dataset.fill });
    await ensureIndex();
    if (document.activeElement === input) { st = { open: true, active: -1 }; draw(); announce(); }
  });

  // Phones: the bottom nav hides while the box has focus, so the fixed bar can't ride above the on-screen
  // keyboard and cover the suggestions (#20). CSS does it with :has(); this class is the fallback.
  input.addEventListener('focus', () => document.body.classList.add('search-focus'));
  input.addEventListener('blur', () => document.body.classList.remove('search-focus'));
  input.addEventListener('focus', async () => {
    // Phones: bring the band to the top of the content column, so the suggestions open into the space above the
    // on-screen keyboard (the panel's height is --vvh minus the box's bottom edge, app.css).
    if (PHONE.matches) document.getElementById('school-search')?.scrollIntoView?.({ block: 'start' });
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
  // "/" (#26): on a Schools page it focuses the box; elsewhere it opens Schools, and the box gets focus once that
  // page has rendered (hs-rendered, which app.js sends before its title-focus step). nav.js slashAction ignores
  // it while typing in a field and with Ctrl, Meta or Alt.
  document.addEventListener('keydown', (e) => {
    const act = slashAction(resolveTab(readHash()), e);
    if (!act) return;
    e.preventDefault();
    if (act.hash) { focusAfterRender = true; location.hash = act.hash; } else { input.focus(); }
  });
  // After each page render: leaving Schools clears the box; on the list it shows q= (unless you're typing in it);
  // within Schools (landing ↔ list) it keeps your text (nav.js boxTextAfter). A school chosen from search focuses
  // the new page's title; "/" from another page focuses the box.
  window.addEventListener('hs-rendered', () => {
    const state = resolveTab(readHash());
    input.value = boxTextAfter({ state, focused: document.activeElement === input, text: input.value });
    if (focusAfterRender) {
      focusAfterRender = false;
      if (hasSchoolSearch(state)) input.focus({ preventScroll: true });
    }
    if (titleFocus) { titleFocus = false; focusTitle(); }
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
