// A team's page (#20 PR 2): the team's home, with its own nav (Overview · Results · Playoff history, in the
// content header's sub-nav) and no statewide filters. Every record here is a playoff record: the source
// is state championship brackets, so there are no league standings or regular-season games.
// The markup is built by pure functions (exported for tests); render() fetches and binds.
import { api, errorHtml } from '../api.js';
import { matchCard } from '../components/match.js';
import { setHead } from '../components/pageHeader.js';
import { listHref, teamHref } from '../nav.js';
import { bracketHref, esc, favorites, fmtDate, resultText, toggleFavorite } from '../util.js';

export const STANDINGS_NOTE = 'Playoff games only: our source is state championship brackets, so league standings and regular-season games aren\'t covered.';
export const PK_NOTE = 'Games decided on penalty kicks count as a draw (D) in the playoff record, as the source records them; the shootout winner is shown on the game.';

let refocus = null;   // the in-page control to focus again after its own re-render (#18 item 1)

// One program at a time (a MaxPreps school id can cover boys and girls): `g` if it has games, else the larger.
export function program(s, g) {
  const count = (p) => s.appearances.filter((a) => a.gender[0] === p).length;
  const programs = ['g', 'b'].filter(count);
  const pick = programs.includes(g) ? g : programs.sort((a, b) => count(b) - count(a))[0];
  return { g: pick, own: s.appearances.filter((a) => a.gender[0] === pick) };
}

// Seasons with an appearance, newest first, and the one shown (the hash's, else the latest).
export function seasonsOf(own) {
  return [...new Set(own.map((a) => a.season))].sort().reverse();
}
export const pickSeason = (own, season) => (seasonsOf(own).includes(season) ? season : seasonsOf(own)[0]);

const compName = (a, comps) => comps[a.competition]?.label || a.competition;
const compShort = (a, comps) => comps[a.competition]?.short || '';
const furthest = (a) => (a.result === 'champion' ? 'Champion' : a.reached || '—');
const wld = (a) => `${a.w}-${a.l}-${a.d}`;
const played = (a) => a.games.filter((x) => x.res !== 'BYE');

// "Los Gatos, CA · Girls soccer · 2025-26: CIF State Championships, Division 1 (seed 3)"
export function identityLine(s, a, comps) {
  const place = [s.city, s.state].filter(Boolean).join(', ');
  const sport = a?.gender === 'boys' ? 'Boys soccer' : 'Girls soccer';
  const comp = a ? ` · ${a.season}: ${compName(a, comps)}, ${a.divisionLabel}${a.seed ? ` (seed ${a.seed})` : ''}` : '';
  return `${place} · ${sport}${comp}`;
}

// A team's game as the shared match card's game: this team on top, the opponent below.
export function teamGame(s, a, x) {
  const me = { id: s.id, name: s.name, seed: a.seed, score: x.gf };
  if (x.res === 'BYE') return { status: 'bye', top: me, bottom: null };
  const opp = x.opp ? { id: x.opp.id, name: x.opp.name, seed: x.opp.seed, score: x.ga } : null;
  const won = x.res === 'W' || (x.res === 'D' && x.pk === 'W');
  const lost = x.res === 'L' || (x.res === 'D' && x.pk === 'L');
  return { status: rowStatus(a, x), top: me, bottom: opp,
    winner: won ? 'top' : lost ? 'bottom' : null, decidedBy: x.pk ? 'pk' : null };
}

// A school file's game row has no status, and `res` is null both for a game never reported and for one not
// played yet (crawler/derive.py writes `res` for final games only). The appearance tells them apart: while the
// team is still alive, its last row without a result is the next game; any other one was never reported.
export function rowStatus(a, x) {
  if (x.res === 'BYE') return 'bye';
  if (x.res != null) return 'final';
  if (a.result === 'alive') {
    const open = a.games.filter((r) => r.res == null);
    if (open.at(-1) === x) return 'scheduled';
  }
  return 'unreported';
}

// The card's footer: Final, a PK decision (a draw in the record), a missing score or result, a bye, next game.
export function gameMeta(a, x) {
  const status = rowStatus(a, x);
  if (status === 'bye') return '<span>Bye</span>';
  if (status === 'scheduled') return `<span>Scheduled</span>${x.opp ? '' : '<span>Opponent to be decided</span>'}`;
  if (status === 'unreported') return '<span>Result not reported</span>';
  if (x.gf == null) return '<span>Final</span><span>Score not reported</span>';
  if (x.pk) return '<span>Final · decided on PKs</span><span>A draw in the playoff record</span>';
  return '<span>Final</span>';
}

export function gameCardHtml(s, a, x, comps, g) {
  const short = compShort(a, comps);
  const top = `<a href="${bracketHref(a.state, a.season, a.competition, a.division)}">${esc(short ? `${short} · ` : '')}${esc(a.divisionLabel)}</a>`
    + `<span>${esc(x.roundName)}${x.date ? ` · ${esc(fmtDate(x.date))}` : ''}</span>`;
  return matchCard(teamGame(s, a, x), { top, meta: gameMeta(a, x), g });
}

// One step of the playoff journey, from this team's side.
export function stepText(a, x) {
  const opp = x.opp ? ` v ${x.opp.name}` : '';
  const score = x.gf != null ? ` ${x.gf}–${x.ga}` : '';
  const status = rowStatus(a, x);
  if (status === 'bye') return 'Bye';
  if (status === 'scheduled') return x.opp ? `Scheduled${opp}` : 'Scheduled · opponent to be decided';
  if (status === 'unreported') return `${opp.trim()} · result not reported`;
  if (x.res === 'D') return `${x.pk === 'W' ? 'Won' : x.pk === 'L' ? 'Lost' : 'Drew'} on PKs${score}${opp}`;
  return `${x.res === 'W' ? 'Won' : 'Lost'}${score || ' (score not reported)'}${opp}`;
}
const stepClass = (x) => (x.res === 'W' || (x.res === 'D' && x.pk === 'W') ? 'win' : x.res === 'L' || (x.res === 'D' && x.pk === 'L') ? 'loss' : '');

// Overview, in reading order on every width: latest playoff game, season summary, playoff journey, recent games.
export function overviewHtml({ s, a, own, comps, g }) {
  const games = played(a);
  const latest = games.at(-1) || a.games.at(-1);
  const latestCard = latest ? gameCardHtml(s, a, latest, comps, g) : '<p class="muted">No games on record.</p>';
  const steps = a.games.map((x) => `<li class="step ${stepClass(x)}"><b>${esc(x.roundName)}</b><span>${esc(stepText(a, x))}</span></li>`).join('')
    + `<li class="step end"><b>${esc(a.result === 'champion' ? 'Champion' : a.result === 'runner-up' ? 'Runner-up' : 'Finish')}</b><span>${esc(resultText(a))}</span></li>`;
  const recent = own.flatMap((ap) => played(ap).map((x) => ({ ap, x })))
    .sort((p, q) => String(q.x.date).localeCompare(String(p.x.date))).slice(0, 5)
    .map(({ ap, x }) => {
      const res = x.res === 'D' ? 'D' : x.res || '–';
      const opp = x.opp ? `<a href="${esc(teamHref(x.opp.id, { g }))}">${esc(x.opp.name)}</a>` : 'opponent to be decided';
      const status = rowStatus(ap, x);
      const what = status === 'scheduled' ? 'Scheduled · ' : status === 'unreported' ? 'Result not reported · '
        : x.gf != null ? `${x.gf}–${x.ga}${x.pk ? ` (PK ${x.pk === 'W' ? 'won' : 'lost'})` : ''} · ` : '';
      return `<li><span class="res res-${esc(res)}">${esc(res)}</span><span class="recent-opp">v ${opp}</span>`
        + `<span class="muted recent-meta">${esc(what)}${esc(fmtDate(x.date))} · ${esc(ap.season)}</span></li>`;
    }).join('');
  return `<div class="team-overview">
    <section class="card card-pad ov-latest" aria-labelledby="ov-latest-h"><h2 class="panel-title" id="ov-latest-h">Latest playoff game</h2>${latestCard}</section>
    <section class="card card-pad ov-summary" aria-labelledby="ov-summary-h"><h2 class="panel-title" id="ov-summary-h">Season summary · playoff record</h2>
      <dl class="summary">
        <div><dt>Seed</dt><dd>${esc(a.seed ?? '—')}</dd></div>
        <div><dt>Furthest round</dt><dd class="word">${esc(furthest(a))}</dd></div>
        <div><dt>Playoff W-L-D</dt><dd>${wld(a)}</dd></div>
      </dl>
      <p class="note">${esc(STANDINGS_NOTE)}</p></section>
    <section class="card card-pad ov-journey" aria-labelledby="ov-journey-h"><h2 class="panel-title" id="ov-journey-h">Playoff journey · ${esc(compShort(a, comps) || compName(a, comps))} ${esc(a.divisionLabel)}</h2>
      <ol class="journey">${steps}</ol></section>
    <section class="card card-pad ov-recent" aria-labelledby="ov-recent-h"><h2 class="panel-title" id="ov-recent-h">Recent playoff games</h2>
      <ul class="recent">${recent || '<li class="muted">No games on record.</li>'}</ul></section>
  </div>`;
}

export function resultsHtml({ s, a, comps, g }) {
  const cards = [...a.games].reverse().map((x) => gameCardHtml(s, a, x, comps, g)).join('');
  return `<div class="cards">${cards}</div><p class="note">${esc(PK_NOTE)}</p>`;
}

// Seasons the state's coverage lists but this team has no appearance in, with the catalog's note (e.g. COVID).
export function missingSeasons(own, catalog) {
  if (!catalog) return [];
  const have = new Set(own.map((a) => a.season));
  return catalog.seasons.filter((x) => !have.has(x.season)).map((x) => ({ season: x.season, note: x.note || null }));
}

// Playoff history: every recorded appearance (all seasons, so no season filter), replacing the old chart.
export function historyHtml({ s, own, comps, catalog, g }) {
  const rows = [...own].sort((p, q) => q.season.localeCompare(p.season)).map((a) => `<tr role="row">
      <th scope="row" role="rowheader" class="num" data-label="Season"><a href="${esc(teamHref(s.id, { season: a.season, g }))}">${esc(a.season)}</a></th>
      <td role="cell" data-label="Competition">${esc(compName(a, comps))} · ${esc(a.divisionLabel)}</td>
      <td role="cell" class="n" data-label="Seed">${esc(a.seed ?? '—')}</td>
      <td role="cell" data-label="Furthest round">${esc(furthest(a))}${a.result === 'eliminated' ? ' <span class="muted">(lost)</span>' : a.result === 'runner-up' ? ' <span class="muted">(final)</span>' : a.result === 'unreported' ? ' <span class="muted">(result not reported)</span>' : ''}</td>
      <td role="cell" class="n num" data-label="Playoff W-L-D">${wld(a)}</td></tr>`).join('');
  const missing = missingSeasons(own, catalog);
  const notes = missing.filter((m) => m.note).map((m) => ` ${esc(m.season)}: ${esc(m.note)}`).join('');
  const covered = catalog ? catalog.seasons.map((x) => x.season).sort() : [];
  const missingNote = missing.length
    ? `<p class="note">No recorded appearance in ${esc(missing.map((m) => m.season).join(', '))}. A season that isn't listed means we have no state playoff game on record for this team, not that the team didn't play.${notes}</p>`
    : '';
  return `<div class="card table-wrap"><table class="data history" role="table">
      <caption>Every recorded state playoff appearance${covered.length ? ` (${esc(catalog.name)} coverage: ${esc(covered[0])} to ${esc(covered.at(-1))})` : ''}</caption>
      <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Season</th><th scope="col" role="columnheader">Competition</th><th scope="col" role="columnheader" class="n">Seed</th><th scope="col" role="columnheader">Furthest round</th><th scope="col" role="columnheader" class="n">Playoff W-L-D</th></tr></thead>
      <tbody role="rowgroup">${rows}</tbody></table></div>
    ${missingNote}<p class="note">${esc(PK_NOTE)}</p>`;
}

const initials = (name) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export async function render({ state, statesIndex, controls, view, head, setState }) {
  controls.innerHTML = '';   // no statewide filters on a team page: the filter row hides (app.js)
  setHead(head, { crumbs: [['Teams', '#tab=teams'], ['Team']], title: 'Team' });
  view.innerHTML = '<div class="card notice">Loading team…</div>';
  let s;
  try {
    s = await api.school(state.school);
  } catch (err) {
    view.innerHTML = errorHtml(err);
    return;
  }
  let catalog = null;
  try { catalog = await api.stateCatalog(s.state); } catch { /* the missing-seasons note is skipped */ }
  const comps = statesIndex.competitions || {};
  const { g, own } = program(s, state.g);
  const season = pickSeason(own, state.season);
  const apps = own.filter((a) => a.season === season);
  const a = apps.at(-1);   // the season's last appearance (one per season in every state so far)
  const tab = state.view || 'overview';
  const fav = favorites().some((f) => f.id === s.id);
  const stateName = statesIndex.states.find((x) => x.code === s.state)?.name || s.state;
  setHead(head, {
    crumbs: [['Teams', '#tab=teams'], [stateName, listHref({ st: s.state })], [s.name]],
    lead: `<span class="crest">${esc(initials(s.name))}</span>`,
    title: s.fullName || s.name,
    subtitle: esc(identityLine(s, a, comps)),
    right: `<button class="star-btn" id="fav" type="button" aria-pressed="${fav}" aria-describedby="fav-note">${fav ? '★ Following' : '☆ Follow'}</button>`
      + `<span class="follow-note" id="fav-note">Saved in this browser only</span>`
      + (s.maxpreps ? `<a href="${esc(s.maxpreps)}" target="_blank" rel="noopener">MaxPreps <span aria-hidden="true">↗</span></a>` : ''),
  });
  const seasons = seasonsOf(own);
  const picker = `<label class="team-season">Season <select id="team-season">${seasons.map((x) => `<option value="${esc(x)}"${x === season ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>`;
  const bar = (title) => `<div class="team-bar"><h2 class="section-h">${esc(title)}</h2>${tab === 'history' || seasons.length < 2 ? '' : picker}</div>`;
  const ctx = { s, a, own, comps, catalog, g };
  view.innerHTML = tab === 'history' ? bar('Playoff history') + historyHtml(ctx)
    : tab === 'results' ? bar(`${season} playoff results`) + resultsHtml(ctx)
      : bar(`${season} season`) + overviewHtml(ctx);
  const select = view.querySelector('#team-season');
  if (select) {
    select.addEventListener('change', () => { refocus = 'team-season'; setState({ season: select.value }, { replace: true }); });
    if (refocus === 'team-season') select.focus();
  }
  refocus = null;
  head.querySelector('#fav')?.addEventListener('click', (e) => {
    const on = toggleFavorite(s);
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.textContent = on ? '★ Following' : '☆ Follow';
  });
}
