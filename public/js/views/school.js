import { api, errorHtml } from '../api.js';
import { bindChart, depthChart } from '../components/chart.js';
import { bindControls, segmented } from '../components/controls.js';
import { setHead } from '../components/pageHeader.js';
import { statePills } from '../components/sidebar.js';
import { listHref } from '../nav.js';
import { bracketHref, esc, favorites, fmtDate, genderLabel, resultText, schoolHref, toggleFavorite } from '../util.js';

export async function render({ state, statesIndex, controls, view, head, setState }) {
  const pills = (st) => statePills(statesIndex, st, (code) => listHref({ st: code }),
    { all: listHref(), count: 'schools' });
  controls.innerHTML = pills(null);
  setHead(head, { crumbs: [['Teams', '#tab=teams'], ['Schools', listHref()], ['School']], title: 'School' });
  view.innerHTML = '<div class="card notice">Loading school…</div>';
  let s;
  try {
    s = await api.school(state.school);
  } catch (err) {
    view.innerHTML = errorHtml(err);
    return;
  }
  const comps = statesIndex.competitions || {};
  const fav = favorites().some((f) => f.id === s.id);
  // One MaxPreps school id covers both programs; show one program at a time.
  const count = (g) => s.appearances.filter((a) => a.gender[0] === g).length;
  const programs = ['b', 'g'].filter(count);
  const g = programs.includes(state.g) ? state.g : programs.sort((a, b) => count(b) - count(a))[0];
  const own = s.appearances.filter((a) => a.gender[0] === g);
  const sum = {
    appearances: own.length,
    titles: own.filter((a) => a.result === 'champion').length,
    finals: own.filter((a) => a.result === 'champion' || a.result === 'runner-up').length,
    w: own.reduce((t, a) => t + a.w, 0), l: own.reduce((t, a) => t + a.l, 0), d: own.reduce((t, a) => t + a.d, 0),
  };
  const best = own.reduce((b, a) => (!b || a.depth > b.depth || (a.depth === b.depth && a.season > b.season) ? a : b), null);
  controls.innerHTML = pills(s.state);
  if (programs.length > 1) {
    controls.innerHTML += segmented('g', g, programs.map((p) => [p, genderLabel(p)]), 'Program');
    bindControls(controls, setState);
  }
  const bracketName = (a) => {
    const c = comps[a.competition];
    const prefix = c && c.short !== 'State' ? `${c.short} · ` : '';
    return `${prefix}${a.divisionLabel}`;
  };
  const apps = [...own].reverse();
  const points = own.map((a) => ({
    label: a.season.slice(2),
    value: a.depth,
    detail: `${bracketName(a)} — ${resultText(a)}`,
  }));

  const rows = apps
    .map((a) => {
      const chip = a.result === 'champion'
        ? '<span class="chip gold trophy">Champion</span>'
        : a.result === 'runner-up' ? '<span class="chip accent">Runner-up</span>' : esc(resultText(a));
      const games = a.games
        .map((x) => x.res === 'BYE' ? `<li>${esc(x.roundName)} · Bye</li>` : `<li>${esc(x.roundName)} · ${esc(fmtDate(x.date))} · ${x.res ? `<span class="res-${x.res}">${x.res}</span>` : 'vs'} ${x.gf ?? ''}${x.gf != null ? '–' : ''}${x.ga ?? ''}${x.pk ? ` (PK ${x.pk === 'W' ? 'won' : 'lost'})` : ''}
          ${x.opp ? `${x.res ? 'vs' : ''} <a href="${schoolHref(x.opp.id, g)}">${esc(x.opp.name)}</a>${x.opp.seed ? ` <span class="muted">(${x.opp.seed})</span>` : ''}` : 'TBD'}</li>`)
        .join('');
      return `<tr><td class="num"><a href="${bracketHref(a.state, a.season, a.competition, a.division)}">${esc(a.season)}</a></td>
        <td>${esc(bracketName(a))}</td>
        <td class="n">${esc(a.seed ?? '')}</td><td>${chip}</td>
        <td class="n">${a.w}-${a.l}-${a.d}</td><td class="n">${a.gf}:${a.ga}</td>
        <td><ul class="games-list">${games}</ul></td></tr>`;
    })
    .join('');

  const stateMeta = statesIndex.states.find((x) => x.code === s.state);
  const place = [s.city, s.state].filter(Boolean).join(', ');
  setHead(head, {
    crumbs: [['Teams', '#tab=teams'], ['Schools', listHref({ st: s.state })], [s.name]],
    title: s.fullName || s.name,
    subtitle: `${esc(place)}${stateMeta ? ` · ${esc(stateMeta.association)}` : ''}`,
    right: `<button class="star-btn" id="fav" type="button" aria-pressed="${fav}">${fav ? '★ Following' : '☆ Follow'}</button>`
      + (s.maxpreps ? `<a href="${esc(s.maxpreps)}" target="_blank" rel="noopener">MaxPreps <span aria-hidden="true">↗</span></a>` : ''),
  });
  view.innerHTML = `<div class="card card-pad">
      <div class="stats" style="margin-top:0">
        <div class="stat"><div class="v">${sum.appearances}</div><div class="k">Appearances</div></div>
        <div class="stat"><div class="v">${sum.titles}</div><div class="k">Titles</div></div>
        <div class="stat"><div class="v">${sum.finals}</div><div class="k">Finals</div></div>
        <div class="stat"><div class="v">${sum.w}-${sum.l}-${sum.d}</div><div class="k">Playoff record (W-L-D)</div></div>
        <div class="stat"><div class="v" style="font-size:15px;padding-top:5px">${esc(resultText(best))}</div><div class="k">Best finish (${esc(best.season)})</div></div>
      </div></div>
    ${points.length > 1 ? `<h2 class="section-title">How far they went</h2><div class="card card-pad">${depthChart(points)}</div>` : ''}
    <h2 class="section-title">Playoff history</h2>
    <div class="card table-wrap"><table class="data"><thead><tr><th>Season</th><th>Bracket</th><th class="n">Seed</th><th>Result</th><th class="n">W-L-D</th><th class="n">Goals</th><th>Games</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class="muted" style="margin-top:10px;font-size:12px">Games decided on penalty kicks count as draws (D) in the record.</p>`;
  bindChart(view);
  head.querySelector('#fav').addEventListener('click', (e) => {
    const on = toggleFavorite(s);
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.textContent = on ? '★ Following' : '☆ Follow';
  });
}
