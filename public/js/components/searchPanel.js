// The header search panel's HTML (#13, #31): help text outside the listbox, then the listbox of options.
// Pure (no DOM), so tests can check the markup. Every actionable row is a role="option".
import { esc } from '../util.js';
import { HINT, optionText, scopeText } from '../search.js';

export const optionId = (i) => `search-opt-${i}`;

// One group per kind, in the order the options come (#31: a state's list, schools, cities' lists, all matches).
const GROUPS = { state: 'State', school: 'Schools', city: 'Cities', all: 'All matches', chip: 'Examples' };

export function panelHtml(result, { active = -1, raw = '', idx = null, statesIndex, phone = false } = {}) {
  let help = '';
  if (result.mode === 'help') {
    help = phone
      ? `<p class="qhelp-scope">${esc(scopeText(idx, statesIndex, { phone: true }))}</p>`
      : `<p class="qhelp-scope">${esc(scopeText(idx, statesIndex))}</p><p>${esc(HINT)} For example:</p>`;
  } else if (result.mode === 'nomatch') {
    help = `<p class="qhelp-scope">No school matches “${esc(String(raw).trim())}”.</p><p>Try the start of a school's name, a city or a state:</p>`;
  }
  const parts = [];
  let open = null;
  result.items.forEach((it, i) => {
    const group = GROUPS[it.kind];
    if (group !== open) {
      if (open) parts.push('</div>');
      const chips = it.kind === 'chip';
      parts.push(`<div role="group" aria-label="${group}"${chips ? ' class="qchips"' : ''}>`
        + (chips || it.kind === 'all' ? '' : `<div class="qgroup-label" aria-hidden="true">${group}</div>`));
      open = group;
    }
    const { name, line } = optionText(it);
    const on = i === active;
    parts.push(`<div role="option" id="${optionId(i)}" class="qopt${it.kind === 'chip' ? ' qchip' : ''}${on ? ' active' : ''}" aria-selected="${on}" data-i="${i}">`
      + `<span class="qopt-name">${esc(name)}</span>`
      + (line ? `<span class="sr-only">, </span><span class="qopt-sub">${esc(line)}</span>` : '')
      + '</div>');
  });
  if (open) parts.push('</div>');
  const foot = !phone && result.mode !== 'list'
    ? '<div class="qfoot" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Esc</kbd> close</span><span>School, city or state</span></div>'
    : '';
  return `${help ? `<div class="qhelp">${help}</div>` : ''}<div role="listbox" id="search-list" aria-label="Suggestions" class="qlist">${parts.join('')}</div>${foot}`;
}
