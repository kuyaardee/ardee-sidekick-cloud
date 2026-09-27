// The desk skin: one Claude Code session drawn as a trading terminal.
//
//   files touched  -> Market Watch symbols (bid = lines added, ask = lines removed)
//   each step      -> a candle on the chart (green when it worked, red when it failed,
//                     a diff is a big green candle sized by the lines it changed)
//   thinking       -> a doji whose wicks grow with the token count
//   your message   -> a purple ORDER line on the chart; turn_end -> a gold CLOSE line
//   helpers        -> Expert Advisors in the Navigator
//   an ask         -> an order ticket: BUY allows once, SELL denies
//   to-do list     -> Pending Orders; usage -> Account; limits -> margin meters
//
// Built on the template's contract (see STREAM.md): stream.js updates `s.state` before each
// handler runs; every handler returns a short name for what it drew. Every word from the stream
// is untrusted: textContent or canvas fillText only.

import { render as renderMd } from '/skins/lib/md.js';

let current = null;

export function workActive() { return current ? current.working() : false; }

export function destroy() {
  if (current) current.close();
  current = null;
}

export function install(root, stream) {
  destroy();
  const connect = typeof stream === 'function' ? stream : stream.connect;
  const TERMINAL = (stream && stream.TERMINAL) || new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled', 'error']);
  const doc = root.ownerDocument || document;
  const win = doc.defaultView || window;
  const $ = (id) => doc.getElementById(id);
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  };
  const clip = (v, n = 200) => { const t = String(v ?? ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const fmtK = (n) => { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); };
  const usd = (v) => '$' + (+v || 0).toFixed(2);
  const hms = () => new Date().toTimeString().slice(0, 8);
  const unfence = (t) => String(t).replace(/^\s*```[\w-]*\s*$/gm, '').replace(/\n{3,}/g, '\n\n'); // md.js has no code blocks
  const hash = (t) => { let h = 7; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const running = (a) => !TERMINAL.has(a.status) && !a.returned;

  const log = $('log');
  const blocks = new Map(); // block_id -> the reply row's body while it is written
  const steps = new Map();  // tool_use_id -> {row, candle}

  /* ================= the chart ================= */

  const canvas = $('chart');
  const ctx = canvas.getContext('2d');
  const chart = { candles: [], marks: [], price: 100, think: null };
  let drawQueued = false;

  function resetChart() { chart.candles = []; chart.marks = []; chart.price = 100; chart.think = null; queueDraw(); }
  function pushCandle(kind, label) {
    const c = { o: chart.price, c: chart.price, h: chart.price, l: chart.price, kind, label, pending: true };
    chart.candles.push(c);
    if (chart.candles.length > 400) { chart.candles.shift(); for (const m of chart.marks) m.i--; }
    queueDraw();
    return c;
  }
  function settle(c, move, label) {
    if (!c) return;
    c.pending = false;
    c.c = c.o + move;
    const wick = 0.25 + (hash(c.label) % 7) / 10;
    c.h = Math.max(c.o, c.c) + wick;
    c.l = Math.min(c.o, c.c) - wick * 0.8;
    if (label) c.label = label;
    chart.price = c.c;
    queueDraw();
  }
  function mark(kind, label) { chart.marks.push({ i: chart.candles.length, kind, label }); queueDraw(); }
  function endThink() { if (chart.think) { chart.think.pending = false; chart.think = null; } $('c-think').hidden = true; }

  function queueDraw() {
    if (drawQueued) return;
    drawQueued = true;
    win.requestAnimationFrame(() => { drawQueued = false; draw(); });
  }
  function css(name) { return win.getComputedStyle(doc.documentElement).getPropertyValue(name).trim(); }

  function draw() {
    const dpr = win.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const UP = css('--up'), DOWN = css('--down'), GOLD = css('--gold'), YOU = css('--you'),
      GRID = css('--grid'), MUTED = css('--muted'), BLUE = css('--blue'), DIM = css('--dim');
    const axisW = 58, top = 34, bottom = 22, plotW = W - axisW - 8, plotH = H - top - bottom;
    const step = Math.max(14, Math.min(34, plotW / (chart.candles.length + 6))), bodyW = Math.max(8, Math.round(step * 0.55));
    const n = Math.max(1, Math.floor(plotW / step) - 2);
    const first = Math.max(0, chart.candles.length - n);
    const vis = chart.candles.slice(first);

    let hi = chart.price + 2, lo = chart.price - 2;
    for (const c of vis) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); }
    const pad = (hi - lo) * 0.12; hi += pad; lo -= pad;
    const y = (p) => top + (hi - p) / (hi - lo) * plotH;
    const x = (i) => 8 + (i - first) * step + step / 2;

    // grid and price axis
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 5; k++) {
      const p = lo + (hi - lo) * k / 5, yy = Math.round(y(p)) + 0.5;
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W - axisW, yy); ctx.stroke();
      ctx.fillStyle = MUTED; ctx.fillText(p.toFixed(2), W - axisW + 6, yy);
    }
    for (let i = first; i < first + n; i += 10) {
      const xx = Math.round(x(i)) + 0.5;
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(xx, top); ctx.lineTo(xx, H - bottom); ctx.stroke();
    }

    // order / close / EA lines
    ctx.textBaseline = 'top';
    // each label may run only up to the next mark in its lane, so bursts never overprint
    const laneOf = (m) => (m.kind === 'close' ? 'bottom' : m.kind === 'ea' ? 'mid' : 'top');
    const starts = chart.marks.filter((m) => m.i >= first).map((m) => ({ lane: laneOf(m), x: Math.round(x(m.i) - step / 2) }));
    let nextStart = {};
    chart.marks.filter((m) => m.i >= first).forEach((m, k) => {
      const mine = laneOf(m);
      const nx = starts.slice(k + 1).find((t) => t.lane === mine);
      nextStart = { [mine]: nx ? nx.x : W - axisW };
      drawMark(m);
    });
    function drawMark(m) {
      const xx = Math.round(x(m.i) - step / 2) + 0.5;
      const col = m.kind === 'order' ? YOU : m.kind === 'close' ? GOLD : BLUE;
      ctx.strokeStyle = col; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(xx, top - 4); ctx.lineTo(xx, H - bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      const tag = m.kind === 'order' ? 'ORDER ' : m.kind === 'close' ? 'CLOSE ' : 'EA ';
      const lane = m.kind === 'close' ? 'bottom' : m.kind === 'ea' ? 'mid' : 'top';
      const ly = lane === 'bottom' ? H - bottom + 5 : lane === 'mid' ? top + 10 : top - 2;
      let text = tag + clip(m.label, 28);
      const room = (nextStart[lane] ?? W - axisW) - xx - 8;
      while (text.length > 4 && ctx.measureText(text).width > room) text = text.slice(0, -2);
      if (room > 24) ctx.fillText(text.length < (tag + clip(m.label, 28)).length ? text + '…' : text, xx + 3, ly);
    }

    // candles
    vis.forEach((c, k) => {
      const i = first + k, cx = Math.round(x(i)) + 0.5;
      const think = c.kind === 'think';
      const col = c.pending ? DIM : think ? GOLD : c.c >= c.o ? UP : DOWN;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke();
      const y1 = y(Math.max(c.o, c.c)), y2 = y(Math.min(c.o, c.c));
      const h = Math.max(1.5, y2 - y1);
      if (c.pending) ctx.strokeRect(cx - bodyW / 2, y1, bodyW, Math.max(h, 3));
      else ctx.fillRect(cx - bodyW / 2, y1, bodyW, h);
    });

    // last price line
    const py = Math.round(y(chart.price)) + 0.5;
    const last = chart.candles[chart.candles.length - 1];
    const lastCol = !last || last.c >= last.o ? UP : DOWN;
    ctx.strokeStyle = lastCol; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W - axisW, py); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = lastCol; ctx.fillRect(W - axisW, py - 8, axisW, 16);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
    ctx.fillText(chart.price.toFixed(2), W - axisW + 6, py);

    if (!chart.candles.length && !chart.marks.length) {
      ctx.fillStyle = DIM; ctx.textAlign = 'center'; ctx.font = '12px Inter, sans-serif';
      ctx.fillText('market closed · send an order to open the session', (W - axisW) / 2, top + plotH / 2);
      ctx.textAlign = 'start';
    }
    const o = chart.candles.length ? chart.candles[0].o : 100;
    const chg = chart.price - o;
    $('c-ohlc').textContent = `${chart.candles.length} bars · ${chart.price.toFixed(2)} ${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)}`;
    $('c-ohlc').className = 'ohlc ' + (chg >= 0 ? 'up' : 'down');
  }
  const ro = new win.ResizeObserver(() => queueDraw());
  ro.observe(canvas);

  /* ================= the journal ================= */

  function row(tag, text, cls = '') {
    const r = el('div', 'row ' + cls);
    r.append(el('span', 'time', hms()), el('span', 'tag', tag), el('span', 'body', text));
    log.append(r);
    if (log.children.length > 600) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
    return r;
  }
  function diffPre(lines) {
    const pre = el('pre', 'diff');
    for (const ln of lines.slice(0, 40)) {
      const s = String(ln);
      pre.append(el('span', s[0] === '+' ? 'a' : s[0] === '-' ? 'd' : 'c', s + '\n'));
    }
    return pre;
  }
  function closeCarets() {
    for (const b of blocks.values()) b.classList.remove('caret');
    blocks.clear();
  }

  /* ================= panels, redrawn from state ================= */

  function list(ul, items, empty, drawItem) {
    ul.replaceChildren();
    if (!items.length) { ul.append(el('li', 'empty', empty)); return; }
    for (const it of items) ul.append(drawItem(it));
  }
  function drawBanner(st) {
    $('b-version').textContent = st.facts.version ? 'v' + st.facts.version : '–';
    $('b-model').textContent = st.model || '–';
    $('b-plan').textContent = st.facts.plan || '–';
    $('b-folder').textContent = st.facts.folder || '–';
    $('c-sym').textContent = String(st.model || 'session').toUpperCase().replace(/^CLAUDE-/, '');
  }
  function drawSessions(st) {
    const box = $('session-list');
    box.replaceChildren();
    for (const p of st.sessions.slice(0, 5)) {
      const b = el('button', p.session_id === st.sessionId ? 'current' : '', clip(p.title || 'untitled', 32));
      b.type = 'button';
      b.addEventListener('click', () => s.openSession(p.session_id));
      box.append(b);
    }
  }
  const prevFiles = new Map();
  function drawFiles(st) {
    $('mw-count').textContent = st.files.length;
    list($('files'), st.files, 'no symbols yet', (f) => {
      const key = f.path || f.name, a = +f.added || 0, d = +f.removed || 0, net = a - d;
      const li = el('li');
      li.append(el('span', '', clip(f.name || f.path, 40)), el('span', 'up', '+' + a), el('span', 'down', '−' + d),
        el('span', net >= 0 ? 'up' : 'down', (net >= 0 ? '▲' : '▼') + Math.abs(net)));
      li.title = String(f.path || f.name || '');
      const was = prevFiles.get(key);
      if (!was || was !== a + ':' + d) { li.classList.add('flash'); win.setTimeout(() => li.classList.remove('flash'), 60); }
      prevFiles.set(key, a + ':' + d);
      return li;
    });
  }
  function drawAgents(st) {
    const all = [...st.agents.values()];
    $('ea-count').textContent = all.filter(running).length + '/' + all.length;
    const max = Math.max(4, ...all.map((a) => +a.tool_uses || 0));
    list($('agents'), all, 'no EAs attached', (a) => {
      const live = running(a);
      const ok = a.status === 'completed' || a.ok;
      const cls = live ? 'running' : ok ? 'done' : 'fail';
      const li = el('li', cls);
      const top = el('div', 'ea-top');
      top.append(el('span', 'ea-face', live ? '☺' : ok ? '✓' : '✕'), el('span', 'ea-name', clip(a.description || 'helper', 60)),
        el('span', 'ea-state', live ? (a.status === 'launched' ? 'loading' : 'trading') : ok ? 'closed' : a.status || 'stopped'));
      const meta = [a.subagent_type || 'general', (a.tool_uses ?? 0) + ' trades', fmtK(a.tokens) + ' tok'];
      if (live && a.last_tool) meta.push('last: ' + clip(a.last_label || a.last_tool, 40));
      const bar = el('div', 'ea-bar'), u = el('u');
      u.style.width = Math.min(100, (+a.tool_uses || 0) / max * 100) + '%';
      bar.append(u);
      li.append(top, el('div', 'ea-meta', meta.join(' · ')), bar);
      return li;
    });
  }
  function drawTasks(st) {
    const items = st.tasks || [];
    $('task-count').textContent = items.filter((t) => t.state !== 'done').length;
    const mk = { done: '✓', in_progress: '▶', pending: '○' };
    list($('tasks'), items, 'no pending orders', (t) => {
      const li = el('li', t.state || 'pending');
      li.append(el('span', 'mk', mk[t.state] || '○'), el('span', '', clip(t.text, 90)));
      return li;
    });
  }
  function drawStats(st) {
    const x = st.stats || {}, tk = x.tokens || {};
    $('a-cost').textContent = usd(x.cost_usd);
    $('a-turns').textContent = x.turns ?? 0;
    $('a-time').textContent = Math.round((x.duration_ms || 0) / 1000) + 's';
    $('a-in').textContent = fmtK((tk.input || 0) + (tk.cache_read || 0) + (tk.cache_creation || 0));
    $('a-out').textContent = fmtK(tk.output);
    $('s-cost').textContent = usd(x.cost_usd);
  }
  function meter(id, bar, frac) {
    const u = $(bar);
    if (frac == null) { $(id).textContent = '–'; u.style.width = '0'; return; }
    const p = Math.max(0, Math.min(1, frac));
    $(id).textContent = Math.round(p * 100) + '%';
    u.style.width = p * 100 + '%';
    u.className = p > 0.85 ? 'hot' : p > 0.6 ? 'warn' : '';
  }
  function drawStatus(st) {
    const conn = $('conn');
    conn.className = 'conn ' + (st.replay ? 'replay' : st.connected ? 'on' : '');
    $('conn-text').textContent = st.replay ? 'replay · ' + st.replay : st.connected ? 'connected' : 'offline';
    const busy = $('j-busy');
    busy.textContent = st.busy ? '● market open' : 'idle';
    busy.className = 'busy' + (st.busy ? ' live' : '');
    $('s-mode').textContent = st.mode === 'default' ? 'ask first' : st.mode || '–';
    $('s-effort').textContent = st.effort || '–';
    meter('s-ctx', 'm-ctx', st.stats && st.stats.context_pct != null ? st.stats.context_pct / 100 : null);
    const L = st.limits || {};
    meter('s-5h', 'm-5h', L.five_hour ? L.five_hour.utilization : null);
    meter('s-wk', 'm-wk', L.seven_day ? L.seven_day.utilization : null);
  }
  function drawAsk(st) {
    const box = $('ask'), tk = $('ticket');
    box.replaceChildren(); tk.replaceChildren();
    const ask = [...st.asking.values()][0];
    box.classList.toggle('flash', !!ask);
    if (!ask) { box.append(el('p', 'empty', 'no pending confirmation')); tk.hidden = true; return; }
    const what = clip(ask.display_name || ask.tool, 40);
    const mini = el('div', 'ticket-mini');
    mini.append(el('div', 'gold', '⚠ awaiting your confirmation'), el('div', 't-what', what + ': ' + clip(ask.input_summary, 120)));
    box.append(mini);

    tk.append(el('div', 't-title', 'ORDER CONFIRMATION · ' + what.toUpperCase()), el('div', 't-what', clip(ask.input_summary, 200)));
    if (ask.description) tk.append(el('p', 'empty', clip(ask.description, 200)));
    const dp = ask.diff_preview;
    if (dp && (dp.old != null || dp.new != null)) {
      const lines = [];
      for (const l of String(dp.old || '').split('\n').slice(0, 12)) if (l) lines.push('-' + l);
      for (const l of String(dp.new || '').split('\n').slice(0, 12)) if (l) lines.push('+' + l);
      tk.append(diffPre(lines));
    }
    const bs = el('div', 'buysell');
    const yes = el('button', 'buy'), no = el('button', 'sell');
    yes.append('BUY', el('small', '', 'allow once')); no.append('SELL', el('small', '', 'deny'));
    yes.type = no.type = 'button';
    yes.id = 'ask-yes'; no.id = 'ask-no';
    const answer = (allow) => { yes.disabled = no.disabled = true; s.answer(ask.request_id, allow); };
    yes.addEventListener('click', () => answer(true));
    no.addEventListener('click', () => answer(false));
    bs.append(yes, no);
    tk.append(bs);
    tk.hidden = false;
  }
  function redrawAll(st) {
    drawBanner(st); drawSessions(st); drawFiles(st); drawAgents(st); drawTasks(st); drawStats(st); drawStatus(st); drawAsk(st);
  }
  function reset(st) {
    log.replaceChildren(); steps.clear(); blocks.clear(); prevFiles.clear();
    resetChart(); endThink(); redrawAll(st);
  }

  /* ================= handlers (see STREAM.md) ================= */

  const on = {
    hello(ev, s) { reset(s.state); return 'redraw'; },
    session_switched(ev, s) { reset(s.state); return 'redraw'; },
    facts(ev, s) { drawBanner(s.state); return 'banner'; },
    session(ev, s) { drawBanner(s.state); drawSessions(s.state); drawStatus(s.state); return 'banner'; },
    connection(ev, s) { drawStatus(s.state); return 'status'; },
    busy(ev, s) { drawStatus(s.state); return 'status'; },

    you(ev) { endThink(); row('order', ev.text, 'you'); mark('order', ev.text); return 'order'; },
    thinking(ev) {
      const n = +ev.estimated_tokens || 0;
      $('c-think').hidden = false;
      $('think-n').textContent = fmtK(n);
      if (!chart.think) { chart.think = pushCandle('think', 'thinking'); }
      const c = chart.think;
      c.h = c.o + 0.3 + Math.sqrt(n) / 12; c.l = c.o - 0.3 - Math.sqrt(n) / 16;
      queueDraw();
      const last = log.lastElementChild;
      const text = n ? `analysing · ~${fmtK(n)} tokens` : 'analysing…';
      if (last && last.classList.contains('thinking')) last.lastChild.textContent = text;
      else row('think', text, 'thinking');
      return 'doji';
    },
    say_start(ev) {
      endThink();
      const b = row('news', '', 'reply').lastChild;
      b.classList.add('caret'); blocks.set(ev.block_id, b);
      return 'row';
    },
    say_delta(ev) {
      let b = blocks.get(ev.block_id);
      if (!b) { b = row('news', '', 'reply').lastChild; b.classList.add('caret'); blocks.set(ev.block_id, b); }
      b.textContent += ev.text || '';
      log.scrollTop = log.scrollHeight;
      return 'text';
    },
    say_end(ev) { const b = blocks.get(ev.block_id); if (b) { b.classList.remove('caret'); renderMd(doc, b, unfence(b.textContent)); } blocks.delete(ev.block_id); return 'close'; },
    say_full(ev) { endThink(); renderMd(doc, row('news', '', 'reply').lastChild, unfence(ev.text || '')); return 'row'; },

    step(ev) {
      endThink();
      const label = ev.label || ev.input_summary || ev.tool;
      const r = row(clip(ev.tool, 10), label);
      steps.set(ev.tool_use_id, { row: r, candle: pushCandle('step', label) });
      return 'candle';
    },
    step_done(ev) {
      const st = steps.get(ev.tool_use_id);
      const ok = ev.ok !== false;
      const r = st ? st.row : row('result', '');
      r.lastChild.append(el('span', 'res', `  ${ok ? '✓' : '✗'} ${ev.summary || ''}`));
      r.classList.add(ok ? 'ok' : 'fail');
      const c = st ? st.candle : pushCandle('step', 'result');
      const mag = 0.5 + (hash(c.label) % 10) / 10;
      settle(c, ok ? mag : -mag * 1.4);
      return 'settle';
    },
    diff(ev) {
      const st = steps.get(ev.tool_use_id);
      const r = st ? st.row : row('edit', '');
      const a = +ev.added || 0, d = +ev.removed || 0;
      r.lastChild.append(el('span', 'res', `  ✓ ${clip(ev.file, 60)} +${a} −${d}`));
      r.lastChild.append(diffPre((ev.hunks || []).flatMap((h) => h.lines || [])));
      r.classList.add('ok');
      settle(st ? st.candle : pushCandle('edit', ev.file), 1 + Math.sqrt(a + d));
      log.scrollTop = log.scrollHeight;
      return 'big-candle';
    },
    denied(ev) {
      row('rejected', `${ev.tool}: ${ev.message || 'refused'}`, 'fail');
      const st = steps.get(ev.tool_use_id);
      if (st && st.candle.pending) settle(st.candle, -2.5);
      return 'rejected';
    },
    skill(ev) { row('skill', ev.name); return 'row'; },
    pad(ev) { row('pad', ev.title || ev.kind); return 'row'; },
    compacted(ev) { row('compact', `${fmtK(ev.pre_tokens)} → ${fmtK(ev.post_tokens)} tokens`); return 'row'; },

    agent_launch(ev, s) { endThink(); row('ea load', ev.description || 'helper'); mark('ea', ev.description || 'helper'); drawAgents(s.state); return 'ea'; },
    agent_start(ev, s) { drawAgents(s.state); return 'ea'; },
    agent_progress(ev, s) { drawAgents(s.state); return 'ea-meter'; },
    agent_tool(ev, s) { drawAgents(s.state); return 'ea-meter'; },
    agent_done(ev, s) { drawAgents(s.state); return 'ea'; },
    agent_result(ev, s) {
      const a = s.agentOf(ev);
      row('ea close', (ev.ok === false ? '✗ ' : '✓ ') + (a?.description || 'helper'), ev.ok === false ? 'fail' : 'ok');
      drawAgents(s.state);
      return 'row';
    },

    ask(ev, s) { endThink(); row('ticket', `${ev.display_name || ev.tool}: ${ev.input_summary || ''}`, 'close'); drawAsk(s.state); return 'ticket'; },
    ask_answered(ev, s) { row(ev.allow ? 'filled' : 'rejected', ev.allow ? 'BUY · allowed once' : 'SELL · denied', ev.allow ? 'ok' : 'fail'); drawAsk(s.state); return 'resolve'; },
    ask_cancel(ev, s) { row('ticket', 'withdrawn'); drawAsk(s.state); return 'resolve'; },

    tasks(ev, s) { drawTasks(s.state); return 'orders'; },
    files(ev, s) { drawFiles(s.state); return 'watch'; },
    turn_end(ev, s) {
      closeCarets(); endThink();
      const secs = Math.round((ev.duration_ms || 0) / 1000);
      const txt = `${secs}s · ${usd(ev.cost_usd)}${ev.interrupted ? ' · stopped' : ''}`;
      row('close', txt, 'close');
      mark('close', txt);
      $('a-last').textContent = txt;
      drawStatus(s.state);
      return 'close';
    },
    stats(ev, s) { drawStats(s.state); drawStatus(s.state); return 'account'; },
    limits(ev, s) { drawStatus(s.state); return 'meters'; },
    session_update(ev, s) { drawBanner(s.state); drawStatus(s.state); return 'status'; },
    ended(ev, s) { closeCarets(); endThink(); row('ended', 'the session ended; send an order to start again', 'fail'); drawAsk(s.state); drawStatus(s.state); return 'row'; },
    error(ev) { row('refused', ev.message || 'refused', 'fail'); return 'row'; },
    raw() { return null; },
  };

  const s = connect({ skin: 'desk', on });

  /* ================= input ================= */

  const ta = $('in');
  const send = () => {
    const text = ta.value;
    if (!text.trim()) return;
    if (s.say(text)) ta.value = '';
  };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && s.state.busy) { e.preventDefault(); s.interrupt(); }
  });
  $('compose').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $('new-session').addEventListener('click', () => s.newSession());
  redrawAll(s.state);
  queueDraw();

  current = {
    working: () => !!(s.state.busy || s.state.thinking || blocks.size || [...s.state.agents.values()].some(running)),
    close: () => { ro.disconnect(); s.close(); },
  };
  return s;
}
