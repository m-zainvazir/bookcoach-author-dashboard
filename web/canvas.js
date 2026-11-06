/*
 * canvas.js — the n8n-style view: one author's pipeline as a graph.
 *
 * Plain SVG, no library (plan 22 D6, decided at M4): the graph is fixed — the
 * checklist steps plus the after-launch group — so it needs a layout and a renderer, not
 * a graph editor. That keeps the page free of a build step and of any CDN
 * script, which matters in a page that holds a session token able to sign off
 * steps and flip switches.
 *
 * Renders the SAME step states as the grid (both come from /api/state), so the
 * two views can never disagree. All text is set with textContent.
 */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const W = 184;
  const H = 62;
  const XSTEP = W + 70;
  const YSTEP = H + 22;
  const GLYPH = { DONE: '✓', READY: '▶', BLOCKED: '·', CONFIRM: '?', FAIL: '✗', OPTIONAL: '○', OK: '✓', WARN: '!', SKIP: '–' };
  const views = new WeakMap();
  const SHORT = { DONE: 'done', READY: 'do next', BLOCKED: 'waiting', CONFIRM: 'confirm', FAIL: 'wrong', OPTIONAL: 'optional' };
  const READABLE = 0.8;

  const el = (tag, attrs, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, String(v));
    }
    for (const k of kids.flat()) if (k) n.append(k);
    return n;
  };

  /** Column = longest chain of `needs` behind a step. */
  function layout(steps) {
    const depth = {};
    for (const s of steps) depth[s.id] = s.needs.length ? 1 + Math.max(...s.needs.map((n) => depth[n])) : 0;
    const cols = {};
    for (const s of steps) (cols[depth[s.id]] = cols[depth[s.id]] || []).push(s.id);
    const tallest = Math.max(...Object.values(cols).map((c) => c.length));
    const pos = {};
    for (const [d, ids] of Object.entries(cols)) {
      const top = ((tallest - ids.length) * YSTEP) / 2;
      ids.sort((a, b) => a - b).forEach((id, i) => { pos[id] = { x: Number(d) * XSTEP, y: top + i * YSTEP }; });
    }
    return { pos, depth, cols: Object.keys(cols).length, tallest };
  }

  /** Drop an edge n -> s when another need of s already depends on n (transitive reduction). */
  function edges(steps) {
    const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
    const anc = {};
    const ancestors = (id) => {
      if (anc[id]) return anc[id];
      const out = new Set();
      for (const n of byId[id].needs) { out.add(n); for (const a of ancestors(n)) out.add(a); }
      return (anc[id] = out);
    };
    const out = [];
    for (const s of steps) {
      for (const n of s.needs) {
        const implied = s.needs.some((m) => m !== n && ancestors(m).has(n));
        if (!implied) out.push([n, s.id]);
      }
    }
    return out;
  }

  const curve = (x1, y1, x2, y2) => {
    const dx = Math.max(30, (x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const worst = (statuses) => ['FAIL', 'WARN', 'OK', 'SKIP'].find((x) => statuses.includes(x)) || 'SKIP';

  function node({ x, y, title, sub, state, glyph, tip, cls, onclick }) {
    const fill = `fill-${state}`;
    return el('g', { class: `node ${cls || ''}`, transform: `translate(${x} ${y})`, tabindex: 0, role: 'button', onclick, onkeydown: (e) => { if (e.key === 'Enter') onclick(); } },
      el('title', { text: tip }),
      el('rect', { class: 'box', width: W, height: H, rx: 10 }),
      el('rect', { class: `bar ${fill}`, width: 6, height: H, rx: 3 }),
      el('text', { x: 16, y: 25, text: title }),
      el('text', { class: 'sub', x: 16, y: 45, text: sub }),
      el('circle', { class: fill, cx: W - 20, cy: H / 2, r: 12 }),
      el('text', { class: 'glyph', x: W - 20, y: H / 2 + 4.5, 'text-anchor': 'middle', fill: '#fff', text: glyph }));
  }

  function render(svg, { author, steps, labels, health, selected, onSelect, onSelectHealth }) {
    const { pos, cols, tallest } = layout(steps);
    const byId = Object.fromEntries(author.steps.map((s) => [s.id, s]));
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    svg.append(el('defs', null, el('pattern', { id: 'dots', width: 22, height: 22, patternUnits: 'userSpaceOnUse' }, el('circle', { class: 'bg-dot', cx: 1.5, cy: 1.5, r: 1.2 }))));
    const contentW = (cols + 1) * XSTEP + W;
    const contentH = Math.max(tallest, 9) * YSTEP + 60;
    svg.append(el('rect', { x: -2000, y: -2000, width: contentW + 4000, height: contentH + 4000, fill: 'url(#dots)' }));
    svg.append(el('text', { class: 'group-label', x: 0, y: -18, text: `${author.code} ${author.name} — onboarding, steps 0-16` }));

    // Edges first, so nodes sit on top of them.
    const lines = el('g');
    for (const [from, to] of edges(steps)) {
      const a = pos[from];
      const b = pos[to];
      lines.append(el('path', { class: `edge${byId[from].state === 'DONE' ? ' done' : ''}`, d: curve(a.x + W, a.y + H / 2, b.x, b.y + H / 2) }));
    }
    svg.append(lines);

    const here = author.where ? author.where.id : null;
    for (const s of steps) {
      const st = byId[s.id];
      const state = st.state === 'DONE' && st.warn ? 'WARNDONE' : st.state;
      svg.append(node({
        x: pos[s.id].x, y: pos[s.id].y,
        // A long name (Course Collection + Bundle Image) is cut to fit the box; the tooltip has it whole.
        title: (({ t }) => (t.length > 23 ? `${t.slice(0, 22)}…` : t))({ t: `${s.id}  ${s.title}` }),
        sub: `${s.platform} · ${SHORT[st.state]}${st.warn ? ' (note)' : ''}`.slice(0, 27),
        state, glyph: st.state === 'DONE' && st.warn ? '!' : GLYPH[st.state],
        tip: `${s.id} ${s.long}\n${labels[st.state]}${st.warn ? ' (with a note)' : ''}${st.blockers.length && st.state === 'BLOCKED' ? `\nneeds step ${st.blockers.join(', ')}` : ''}`,
        cls: `${selected === s.id ? 'sel' : ''} ${here === s.id ? 'here' : ''}`,
        onclick: () => onSelect(s.id),
      }));
    }

    // After launch: the shared machinery every author rides, watched by the health checks.
    if (health && health.afterLaunch) {
      const gx = cols * XSTEP + 30;
      const items = health.afterLaunch;
      const gy = Math.max(0, ((tallest - items.length) * YSTEP) / 2);
      svg.append(el('rect', { class: 'group', x: gx - 16, y: gy - 34, width: W + 32, height: items.length * YSTEP + 30, rx: 14 }));
      svg.append(el('text', { class: 'group-label', x: gx - 4, y: gy - 14, text: 'After launch — health checks' }));
      // From the checklist's last step, whatever its number (the list was renumbered once already).
      const lastId = Math.max(...steps.map((x) => x.id));
      const last = pos[lastId];
      svg.append(el('path', { class: `edge${byId[lastId].state === 'DONE' ? ' done' : ''}`, d: curve(last.x + W, last.y + H / 2, gx - 16, gy + (items.length * YSTEP) / 2) }));
      items.forEach((s, i) => {
        const st = worst(s.checks.map((id) => (health.rows.find((r) => r.id === id) || {}).status || 'SKIP'));
        svg.append(node({
          x: gx, y: gy + i * YSTEP,
          title: `${s.id}  ${s.short || s.title}`.slice(0, 26),
          sub: `${s.checks.join(' + ')} · ${st}`,
          state: st, glyph: GLYPH[st],
          tip: `${s.id} ${s.title}\nwatched by ${s.checks.join(' + ')}: ${st}`,
          onclick: () => onSelectHealth(s.id),
        }));
      });
    }

    const v = views.get(svg) || {};
    v.bounds = { x: -40, y: -60, w: contentW + 120, h: contentH + 60 };
    // Where a readable view centres: the step you are on, else the one selected, else the start.
    const focusId = selected ?? here ?? 0;
    v.focus = { x: pos[focusId].x + W / 2, y: pos[focusId].y + H / 2 };
    views.set(svg, v);
    if (!v.vb) fit(svg);
    else apply(svg);
    if (!v.wired) wire(svg);
  }

  function apply(svg) {
    const v = views.get(svg);
    svg.setAttribute('viewBox', `${v.vb.x} ${v.vb.y} ${v.vb.w} ${v.vb.h}`);
  }

  /**
   * Show everything when it is readable; otherwise open at a readable zoom,
   * centred on the step you are on. `all` (the Fit button) always shows everything.
   */
  function fit(svg, { all = false } = {}) {
    const v = views.get(svg);
    if (!v || !v.bounds) return;
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const cw = svg.clientWidth || 0;
    const ch = svg.clientHeight || 0;
    const b = v.bounds;
    const scale = cw && ch ? Math.min(cw / b.w, ch / b.h) : 1;
    if (all || !cw || scale >= READABLE || !v.focus) {
      v.vb = { ...b };
    } else {
      const w = cw / READABLE;
      const hgt = ch / READABLE;
      const x = Math.min(Math.max(v.focus.x - w / 2, b.x), b.x + b.w - w);
      const y = Math.min(Math.max(v.focus.y - hgt / 2, b.y), Math.max(b.y, b.y + b.h - hgt));
      v.vb = { x, y, w, h: hgt };
    }
    apply(svg);
  }

  function toSvg(svg, cx, cy) {
    const p = svg.createSVGPoint();
    p.x = cx;
    p.y = cy;
    const m = svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  function wire(svg) {
    const v = views.get(svg);
    v.wired = true;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const at = toSvg(svg, e.clientX, e.clientY);
      const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      const w = Math.min(Math.max(v.vb.w * k, 300), 12000);
      const ratio = w / v.vb.w;
      v.vb = { x: at.x - (at.x - v.vb.x) * ratio, y: at.y - (at.y - v.vb.y) * ratio, w, h: v.vb.h * ratio };
      apply(svg);
    }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('.node')) return;
      drag = { at: toSvg(svg, e.clientX, e.clientY) };
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('panning');
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const now = toSvg(svg, e.clientX, e.clientY);
      v.vb.x -= now.x - drag.at.x;
      v.vb.y -= now.y - drag.at.y;
      apply(svg);
    });
    const end = () => { drag = null; svg.classList.remove('panning'); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
  }

  window.PipelineCanvas = { render, fit, layout, edges };
})();
