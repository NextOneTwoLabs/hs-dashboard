import { setHead } from '../components/pageHeader.js';
import { statePills } from '../components/sidebar.js';
import { hrefFor } from '../nav.js';
import { esc } from '../util.js';

// "About the data": a static page (UI only), from the README's notes on the data.
export async function render({ statesIndex, controls, view, head }) {
  controls.innerHTML = statePills(statesIndex, null, (code) => hrefFor({ tab: 'playoffs', st: code }));
  const covered = statesIndex.states.filter((s) => s.latestSeason);
  setHead(head, { crumbs: [['All states', '#tab=teams'], ['About the data']], title: 'About the data',
    subtitle: `US high school girls soccer state championships · ${covered.length} states so far` });
  const list = covered.map((s) => `<li><b>${esc(s.name)}</b>: ${esc(s.associationName || s.association)} (${esc(s.association)}), ${esc(s.seasons.join(', '))}</li>`).join('');
  view.innerHTML = `<div class="card card-pad prose">
    <h2>Where the data comes from</h2>
    <p>Every bracket is a MaxPreps bracket page for the state association's championship. California's CIF brackets are found through cifstate.org. The pages are saved as they were fetched and everything on this site is rebuilt from those saved pages.</p>
    <h2>How results are read</h2>
    <ul>
      <li><b>Winners</b> come from MaxPreps' winner markers or its "(W)" shootout mark, so games decided on penalty kicks have the right winner. In records they count as draws.</li>
      <li>Without a marker, the higher score wins. Each winner is also checked against who actually plays in the next round.</li>
      <li><b>Byes</b> are shown as "Bye" and don't count as games or losses.</li>
      <li><b>Not reported:</b> a game whose date had passed when it was fetched, but has no result, is marked "Result not reported". A school whose last game was never reported shows "Result not reported", never "Still alive", once the bracket is finished.</li>
    </ul>
    <h2>What isn't covered</h2>
    <p>The source is each state's championship brackets, so every record on this site is a <b>playoff record</b>: state playoff games only. Regular-season schedules, league membership and <b>league standings aren't covered</b>, so there are no league tables or league positions here, and none are estimated.</p>
    <h2>Seasons and divisions</h2>
    <p>Seasons are school years (2025-26), whether a state plays in the fall, winter or spring. Divisions use each state's own names, largest class first. Schools are identified by their MaxPreps school id, which stays the same across seasons.</p>
    <h2>Coverage</h2>
    <ul>${list}</ul>
    <h2>Updates</h2>
    <p>"Data updated" in the header is when the data last changed, not the last time the crawler ran. During a state's playoffs its brackets are checked every 30 minutes.</p>
  </div>`;
}
