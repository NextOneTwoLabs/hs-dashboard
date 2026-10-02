import { api, errorHtml } from '../api.js';
import { bindControls, genderSeg } from '../components/controls.js';
import { bindFilters, compSelect, patchFor, seasonSelect } from '../components/filters.js';
import { bindHighlight, matchCard } from '../components/match.js';
import { setHead } from '../components/pageHeader.js';
import { eventHref, eventsHref } from '../nav.js';
import { bracketHref, esc, fmtDate, fmtLongDate, schoolHref } from '../util.js';

// The school year keeps the championship and division where that year has them (normalize falls back when it
// doesn't); the championship opens its first division (#30 plan v2).
export const eventPatch = (key, value) => (key === 'season' ? { season: value || null, round: null } : patchFor(key, value));

// The championship and its divisions, on the event page itself (was the Playoffs filter row, #30 PR 2):
// a Championship select when the school year has more than one (CIF State, NorCal, SoCal), else its name; the
// divisions as links (each division is its own page) with aria-current on this one; then the school year.
export function eventControlsHtml(catalog, state, season, comp) {
  const divs = comp.divisions.filter((d) => d.gender[0] === state.g);
  const champ = compSelect(season, state.comp) || `<span class="field-label event-comp-name">${esc(comp.label)}</span>`;
  const pills = `<nav class="pill-row event-divs-pills" aria-label="Divisions">${divs.map((d) => `<a class="pill" href="${esc(eventHref({
    st: state.st, season: state.season, comp: comp.id, div: d.code, g: state.g, view: state.view }))}"${d.code === state.div ? ' aria-current="true"' : ''}>${esc(shortDiv(d.label))}</a>`).join('')}</nav>`;
  return `<div class="event-divs">${champ}${pills}<div class="event-year">${seasonSelect(catalog, state.season)}</div></div>`;
}

// "Division 1" -> "D1"; other labels ("Class 7A", "Conference 6A D1", "4A") as they are.
const shortDiv = (label) => label.replace(/^Division (\d+)$/, 'D$1');

export async function render({ state, catalog, statesIndex, controls, view, head, setState }) {
  const season = catalog.seasons.find((s) => s.season === state.season);
  const comps = season?.competitions || [];
  const comp = comps.find((c) => c.id === state.comp);
  // The filter row keeps only the gender toggle (shown when a state covers both); the event's own controls are on
  // the page (eventControlsHtml).
  controls.innerHTML = genderSeg(state.g, catalog);
  bindControls(controls, setState);

  // An event's page (#30): Events › its state's events › the school year.
  const crumbs = [['Events', '#tab=events'], [catalog.name, eventsHref('events', { st: state.st })], [state.season]];
  if (!comp) {
    setHead(head, { crumbs, title: `${catalog.name} events` });
    view.innerHTML = `<div class="card notice">${esc(season?.note || 'No events for this school year.')}</div>`;
    return;
  }
  const div = comp.divisions.find((d) => d.code === state.div);
  const dates = div?.start ? `${fmtDate(div.start)} – ${fmtDate(div.end, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
  const summary = (teams) => [esc(comp.label), teams ? `${teams} teams` : '', esc(dates),
    div ? `${div.played} of ${div.games} games played` : ''].filter(Boolean).join(' · ');
  const title = div ? `${comp.short} · ${div.label}` : comp.label;
  setHead(head, { crumbs, title, subtitle: summary() });
  view.innerHTML = `${eventControlsHtml(catalog, state, season, comp)}<div id="bracket-host"><div class="card notice">Loading bracket…</div></div>`;
  bindFilters(view, setState, { patch: eventPatch });
  if (!div) return;

  const host = view.querySelector('#bracket-host');
  let bracket;
  try {
    bracket = await api.bracket(state.season, comp.id, div.code);
  } catch (err) {
    host.innerHTML = errorHtml(err);
    return;
  }
  // Teams counted from the bracket we already fetched for this page (not for the sidebar).
  const teams = new Set(bracket.games.filter((g) => g.place == null).flatMap((g) => [g.top, g.bottom])
    .filter(Boolean).map((t) => t.schoolId || t.name)).size;
  const src = bracket.source?.maxpreps
    ? `<a href="${esc(bracket.source.maxpreps)}" rel="noopener" target="_blank">MaxPreps bracket <span aria-hidden="true">↗</span></a>` : '';
  setHead(head, { crumbs, title, subtitle: summary(teams), right: src });
  if (state.view === 'games') {
    // The Games tab (#30 PR 2): this bracket's games (no byes), newest day first, with the shared match card.
    host.innerHTML = gamesHtml(bracket, state);
    bindHighlight(host);
    return;
  }
  host.innerHTML = bracketHtml(bracket, state);
  // Wider screens show every round: bring the picked one into view (phones already show only that round).
  if (!matchMedia('(max-width: 768px)').matches) host.querySelector('.round.picked')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  bindHighlight(host);
  host.querySelectorAll('[data-round]').forEach((btn) =>
    btn.addEventListener('click', () => setState({ round: btn.dataset.round }, { replace: true })),
  );
}

// An event's games by day, newest first; each card's "View in bracket" opens the Bracket tab at its round.
export function gamesHtml(b, state) {
  const names = Object.fromEntries(b.rounds.map((r) => [r.index, r.name]));
  const g = b.division.gender[0];
  const days = new Map();
  for (const x of b.games.filter((y) => y.status !== 'bye')) (days.get(x.date) || days.set(x.date, []).get(x.date)).push(x);
  const order = [...days.keys()].sort((a, c) => String(c ?? '').localeCompare(String(a ?? '')));
  const html = order.map((date) => `<section class="day"><h3>${esc(date ? fmtLongDate(date) : 'Date to be announced')}</h3><div class="cards">${days.get(date)
    .sort((a, c) => a.round - c.round || a.slot - c.slot)
    .map((x) => matchCard(x, { g, head: esc(x.place != null ? 'Third place' : names[x.round] || ''),
      bracket: bracketHref(state.st, b.season, b.competition, b.division.code, x.place != null ? null : x.round) }))
    .join('')}</div></section>`).join('');
  return html || '<div class="card notice">No games in this bracket yet.</div>';
}

function bracketHtml(b, state) {
  const main = b.games.filter((g) => g.place == null);
  const extra = b.games.filter((g) => g.place != null);
  const byRound = new Map(b.rounds.map((r) => [r.index, []]));
  for (const g of main) (byRound.get(g.round) || byRound.set(g.round, []).get(g.round)).push(g);
  const firstOpen = b.rounds.find((r) => byRound.get(r.index).some((g) => g.status === 'scheduled'));
  const active = Number(state.round ?? firstOpen?.index ?? b.rounds.at(-1)?.index ?? 0);
  // A link that names a round (a match card's "View in bracket") marks that column on wider screens too.
  const picked = state.round != null ? Number(state.round) : null;
  const g = b.division.gender[0];

  let banner = '';
  if (b.champion) {
    banner = `<div class="champ-banner"><span class="label trophy">Champion</span>
        <a href="${schoolHref(b.champion.schoolId, g)}">${esc(b.champion.fullName || b.champion.name)}</a>
        <span class="muted">${esc(b.division.label)}</span></div>`;
  } else if (main.some((x) => x.status === 'unreported')) {
    banner = '<div class="card notice" style="margin-bottom:18px;padding:12px 16px;text-align:left">Some results in this bracket were never reported by the source, so it has no champion here.</div>';
  }
  // Phones show one round at a time; the round pills only change what is shown, so they are buttons. Each has a
  // stable id, so the pressed pill gets focus back after the re-render (app.js refocusId; #18 item 1).
  const switcher = `<div class="round-switch pill-row" role="group" aria-label="Round">${b.rounds
    .map((r) => `<button type="button" class="pill" id="round-${r.index}" data-round="${r.index}" aria-pressed="${r.index === active}">${esc(shortRound(r.name))}</button>`)
    .join('')}</div>`;
  const cols = b.rounds
    .map((r) => {
      const games = byRound.get(r.index).sort((a, c) => a.slot - c.slot);
      return `<section class="round${r.index === active ? ' active' : ''}${r.index === picked ? ' picked' : ''}" aria-label="${esc(r.name)}">
        <header class="round-head"><div class="name">${esc(r.name)}</div><div class="date">${esc(fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</div></header>
        <div class="round-body">${games.map((x) => matchCard(x, { g, compact: true })).join('')}</div>
      </section>`;
    })
    .join('');
  const third = extra.length
    ? `<h2 class="section-title">Placement games</h2><div class="cards">${extra.map((x) => matchCard(x, { g })).join('')}</div>`
    : '';
  const src = b.source?.maxpreps ? `<p class="muted" style="margin-top:14px;font-size:12px">Source: <a href="${esc(b.source.maxpreps)}" rel="noopener" target="_blank">MaxPreps bracket</a>${b.source.cif ? ` via <a href="${esc(b.source.cif)}" rel="noopener" target="_blank">CIF</a>` : ''}.</p>` : '';
  return `${banner}${switcher}<div class="bracket-wrap"><div class="bracket">${cols}</div></div>${third}${src}`;
}

function shortRound(name) {
  return name.replace('Regional ', '').replace('Semifinals', 'Semis').replace(/^State Finals?$/, 'Final');
}
