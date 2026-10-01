import { api, errorHtml } from '../api.js';
import { bindControls, genderSeg, seasonSelect, segmented } from '../components/controls.js';
import { bindHighlight, matchCard } from '../components/match.js';
import { divShort, esc, fmtDate, schoolHref } from '../util.js';

export async function render({ state, catalog, controls, view, setState }) {
  const season = catalog.seasons.find((s) => s.season === state.season);
  const comps = season?.competitions || [];
  controls.innerHTML = [
    seasonSelect(catalog, state.season),
    comps.length > 1 ? segmented('comp', state.comp, comps.map((c) => [c.id, c.short]), 'Region') : '',
    genderSeg(state.g, catalog),
  ].join('');
  bindControls(controls, (patch) => setState(patch.comp || patch.g || patch.season ? { ...patch, div: null } : patch));

  const comp = comps.find((c) => c.id === state.comp);
  if (!comp) {
    view.innerHTML = `<div class="card notice">${esc(season?.note || 'No brackets for this season.')}</div>`;
    return;
  }
  const divs = comp.divisions.filter((d) => d.code[0] === state.g);
  const div = comp.divisions.find((d) => d.code === state.div);
  const tabs = divs
    .map((d) => `<a href="#tab=playoffs&season=${state.season}&comp=${comp.id}&g=${state.g}&div=${d.code}" aria-current="${d.code === state.div}">${divShort(d.code)}</a>`)
    .join('');
  view.innerHTML = `<div class="page-head"><h1 class="page">${esc(comp.label)}</h1><span class="muted">${esc(state.season)}</span></div>
    <nav class="div-tabs" aria-label="Divisions">${tabs || '<span class="muted">No divisions</span>'}</nav>
    <div id="bracket-host"><div class="card notice">Loading bracket…</div></div>`;
  if (!div) return;

  const host = view.querySelector('#bracket-host');
  let bracket;
  try {
    bracket = await api.bracket(state.season, comp.id, div.code);
  } catch (err) {
    host.innerHTML = errorHtml(err);
    return;
  }
  host.innerHTML = bracketHtml(bracket, state);
  bindHighlight(host);
  host.querySelectorAll('[data-round]').forEach((btn) =>
    btn.addEventListener('click', () => setState({ round: btn.dataset.round }, { replace: true })),
  );
}

function bracketHtml(b, state) {
  const byRound = new Map(b.rounds.map((r) => [r.index, []]));
  for (const g of b.games) (byRound.get(g.round) || byRound.set(g.round, []).get(g.round)).push(g);
  const firstOpen = b.rounds.find((r) => byRound.get(r.index).some((g) => g.status !== 'final'));
  const active = Number(state.round ?? firstOpen?.index ?? b.rounds.at(-1)?.index ?? 0);

  const champ = b.champion
    ? `<div class="champ-banner"><span class="label trophy">Champion</span>
        <a href="${schoolHref(b.champion.schoolId, b.division.code[0])}">${esc(b.champion.fullName || b.champion.name)}</a>
        <span class="muted">${esc(b.division.label)}</span></div>`
    : '';
  const switcher = `<div class="round-switch seg" role="group" aria-label="Round">${b.rounds
    .map((r) => `<button type="button" data-round="${r.index}" aria-pressed="${r.index === active}">${esc(shortRound(r.name))}</button>`)
    .join('')}</div>`;
  const cols = b.rounds
    .map((r) => {
      const games = byRound.get(r.index).sort((a, c) => a.slot - c.slot);
      return `<section class="round${r.index === active ? ' active' : ''}" aria-label="${esc(r.name)}">
        <header class="round-head"><div class="name">${esc(r.name)}</div><div class="date">${esc(fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</div></header>
        <div class="round-body">${games.map((g) => matchCard(g, { meta: metaLine(g), g: b.division.code[0] })).join('')}</div>
      </section>`;
    })
    .join('');
  const src = b.source?.maxpreps ? `<p class="muted" style="margin-top:14px;font-size:12px">Source: <a href="${esc(b.source.maxpreps)}" rel="noopener" target="_blank">MaxPreps bracket</a>${b.source.cif ? ` via <a href="${esc(b.source.cif)}" rel="noopener" target="_blank">CIF</a>` : ''}.</p>` : '';
  return `${champ}${switcher}<div class="bracket-wrap"><div class="bracket">${cols}</div></div>${src}`;
}

function metaLine(g) {
  if (g.status !== 'final') return '<span>Scheduled</span>';
  const parts = ['<span>Final</span>'];
  if (g.decidedBy === 'pk') parts.push('<span>Decided on PKs</span>');
  if (g.decidedBy === 'unreported') parts.push('<span>Score not reported</span>');
  return parts.join('');
}

function shortRound(name) {
  return name.replace('Regional ', '').replace('Semifinals', 'Semis').replace('State Final', 'Final');
}
