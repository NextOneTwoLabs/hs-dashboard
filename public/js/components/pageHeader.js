// Content header (collegedash .content-header): breadcrumb, title, summary line, links on the right.
import { esc } from '../util.js';

// crumbs: [[label, href], ...]; the last one is the current page and is not a link.
// `subtitle`, `right` and `lead` (a decorative mark before the title, e.g. a team's initials) are HTML the
// caller has already escaped.
export function pageHeadHtml({ crumbs = [], title = '', subtitle = '', right = '', lead = '' }) {
  const trail = crumbs.map(([label, href], i) => (i === crumbs.length - 1 || !href
    ? `<span class="breadcrumb-current"${i === crumbs.length - 1 ? ' aria-current="page"' : ''}>${esc(label)}</span>`
    : `<a href="${esc(href)}">${esc(label)}</a><span class="breadcrumb-sep" aria-hidden="true">›</span>`)).join('');
  return `${lead ? `<div class="content-header-lead" aria-hidden="true">${lead}</div>` : ''}<div class="content-header-main">
      ${crumbs.length ? `<nav class="breadcrumb" aria-label="Breadcrumb">${trail}</nav>` : ''}
      <h1 class="content-title" tabindex="-1">${esc(title)}</h1>
      ${subtitle ? `<div class="content-subtitle">${subtitle}</div>` : ''}
    </div>${right ? `<div class="content-header-right">${right}</div>` : ''}`;
}

export function setHead(head, opts) {
  if (head) head.innerHTML = pageHeadHtml(opts);
}
