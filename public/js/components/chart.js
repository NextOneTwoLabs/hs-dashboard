import { esc } from '../util.js';

// Single-series line: how far a school went in each playoff appearance
// (0 = lost in first round, 1 = champion). Hover/focus shows a tooltip.
export function depthChart(points) {
  if (points.length < 2) return '';
  const W = 720, H = 220, L = 74, R = 16, T = 18, B = 34;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + (1 - v) * (H - T - B);
  const grid = [0, 0.5, 1]
    .map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--chart-grid)" stroke-width="1"/>
      <text x="${L - 10}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-secondary)">${v === 1 ? 'Champion' : v === 0 ? 'First round' : 'Halfway'}</text>`)
    .join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const every = Math.ceil(points.length / 10);
  const xlabels = points
    .map((p, i) => (i % every === 0 || i === points.length - 1
      ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${esc(p.label)}</text>`
      : ''))
    .join('');
  const dots = points
    .map((p, i) => `<g class="pt" tabindex="0" data-i="${i}" aria-label="${esc(p.label)}: ${esc(p.detail)}">
        <circle cx="${x(i)}" cy="${y(p.value)}" r="14" fill="transparent"/>
        <circle cx="${x(i)}" cy="${y(p.value)}" r="4.5" fill="var(--accent)" stroke="var(--bg-surface)" stroke-width="2"/>
        ${p.value === 1 ? `<text x="${x(i)}" y="${y(p.value) - 10}" text-anchor="middle" font-size="12">🏆</text>` : ''}
      </g>`)
    .join('');
  return `<div class="chart" data-points='${esc(JSON.stringify(points.map((p) => [p.label, p.detail])))}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Playoff depth by season">${grid}
      <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${dots}${xlabels}</svg>
    <div class="tip" hidden></div></div>`;
}

export function bindChart(root) {
  const chart = root.querySelector('.chart');
  if (!chart) return;
  const data = JSON.parse(chart.dataset.points);
  const tip = chart.querySelector('.tip');
  const show = (g) => {
    const [label, detail] = data[Number(g.dataset.i)];
    const c = g.querySelector('circle').getBoundingClientRect();
    const box = chart.getBoundingClientRect();
    tip.innerHTML = `<strong>${esc(label)}</strong><br>${esc(detail)}`;
    tip.style.left = `${c.left + c.width / 2 - box.left}px`;
    tip.style.top = `${c.top - box.top}px`;
    tip.hidden = false;
  };
  chart.querySelectorAll('.pt').forEach((g) => {
    g.addEventListener('mouseenter', () => show(g));
    g.addEventListener('focus', () => show(g));
    g.addEventListener('mouseleave', () => (tip.hidden = true));
    g.addEventListener('blur', () => (tip.hidden = true));
  });
}
