import { api, errorHtml } from '../api.js';
import { bindControls, genderSeg } from '../components/controls.js';
import { bindFilters, compSelect, divisionSelect, seasonSelect, stateSelect, termNote } from '../components/filters.js';
import { bindHighlight, matchCard } from '../components/match.js';
import { setHead } from '../components/pageHeader.js';
import { hrefFor } from '../nav.js';
import { esc, fmtDate, schoolHref } from '../util.js';

export async function render({ state, catalog, statesIndex, controls, view, head, setState }) {
  const season = catalog.seasons.find((s) => s.season === state.season);
  const comps = season?.competitions || [];
  const comp = comps.find((c) => c.id === state.comp);
  // The filter row (#20 PR 3): state, school year, championship, division; the season of play as text.
  controls.innerHTML = [
    stateSelect(statesIndex, state.st),
    seasonSelect(catalog, state.season),
    compSelect(season, state.comp),
    divisionSelect(comp, state),
    genderSeg(state.g, catalog),
    termNote(statesIndex, state.st),
  ].join('');
  bindFilters(controls, setState);
  bindControls(controls, setState);

  const crumbs = [['All states', '#tab=teams'], [catalog.name, hrefFor({ tab: 'playoffs', st: state.st })], [state.season]];
  if (!comp) {
    setHead(head, { crumbs, title: `${catalog.name} brackets` });
    view.innerHTML = `<div class="card notice">${esc(season?.note || 'No brackets for this season.')}</div>`;
    return;
  }
  const div = comp.divisions.find((d) => d.code === state.div);
  const dates = div?.start ? `${fmtDate(div.start)} – ${fmtDate(div.end, { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
  const summary = (teams) => [esc(comp.label), teams ? `${teams} teams` : '', esc(dates),
    div ? `${div.played} of ${div.games} games played` : ''].filter(Boolean).join(' · ');
  setHead(head, { crumbs, title: div ? div.label : comp.label, subtitle: summary() });
  view.innerHTML = '<div id="bracket-host"><div class="card notice">Loading bracket…</div></div>';
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
  setHead(head, { crumbs, title: div.label, subtitle: summary(teams), right: src });
  host.innerHTML = bracketHtml(bracket, state);
  bindHighlight(host);
  host.querySelectorAll('[data-round]').forEach((btn) =>
    btn.addEventListener('click', () => setState({ round: btn.dataset.round }, { replace: true })),
  );
}

function bracketHtml(b, state) {
  const main = b.games.filter((g) => g.place == null);
  const extra = b.games.filter((g) => g.place != null);
  const byRound = new Map(b.rounds.map((r) => [r.index, []]));
  for (const g of main) (byRound.get(g.round) || byRound.set(g.round, []).get(g.round)).push(g);
  const firstOpen = b.rounds.find((r) => byRound.get(r.index).some((g) => g.status === 'scheduled'));
  const active = Number(state.round ?? firstOpen?.index ?? b.rounds.at(-1)?.index ?? 0);
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
      return `<section class="round${r.index === active ? ' active' : ''}" aria-label="${esc(r.name)}">
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
