/* SSR Azure HA conductor web app - UI. Depends on generator.js (window.SsrHa). */
(function () {
  'use strict';

  const G = window.SsrHa;
  const STATIC_FILES = JSON.parse(document.getElementById('static-files').textContent);
  /* README.md is the Usage tab; the customer bundle is the MOP plus the five deployment files. */
  const DEPLOY_FILES = Object.fromEntries(Object.entries(STATIC_FILES).filter(([path]) => path !== 'README.md'));
  const BUNDLE_DIR = 'ssr-ha-conductor-azure';
  const PLACEHOLDER = /<input-[^>]*>/g;

  const state = {
    values: G.defaults(),
    expanded: new Set(),
    mopView: 'readable',
    files: [],
  };

  const $ = (sel, el = document) => el.querySelector(sel);
  const h = (tag, attrs = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  /* ---------- tabs ---------- */
  function showTab(id) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === id));
    if (id === 'files') renderFiles();
  }

  /* ---------- usage (rendered README) ---------- */
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inlineMd(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = escapeHtml(s)
      .replace(/&amp;(lt|gt|amp|quot);/g, '&$1;')
      .replace(/&lt;br&gt;/g, '<br>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
        const external = /^https?:/.test(url);
        return external ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>` : `<code>${text}</code>`;
      });
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  }

  function renderMarkdown(md) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    const isTableSep = (l) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    while (i < lines.length) {
      const line = lines[i];
      const fence = /^```(\S*)/.exec(line);
      if (fence) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        // `text` blocks hold diagrams, which must keep their exact layout.
        out.push(`<pre class="md-code${fence[1] === 'text' ? ' md-diagram' : ''}">${escapeHtml(buf.join('\n'))}</pre>`);
        continue;
      }
      const hm = /^(#{1,4})\s+(.*)$/.exec(line);
      if (hm) {
        const level = hm[1].length;
        const id = hm[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        out.push(`<h${level + 1} id="md-${id}">${inlineMd(hm[2])}</h${level + 1}>`);
        i++;
        continue;
      }
      if (/^\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
        out.push('<div class="table-wrap"><table><thead><tr>' + head.map((c) => `<th>${inlineMd(c)}</th>`).join('') +
          '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>');
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
        const ordered = /^\s*\d+\./.test(line);
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '');
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
          items.push(`<li>${inlineMd(item)}</li>`);
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
        out.push(`<blockquote>${inlineMd(buf.join(' '))}</blockquote>`);
        continue;
      }
      if (line.trim() === '' || /^<!--.*-->$/.test(line.trim())) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s|>)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inlineMd(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }

  function renderUsage() {
    $('#usage-content').innerHTML = renderMarkdown(STATIC_FILES['README.md'] || '# README.md missing');
  }

  /* ---------- form ---------- */
  function fieldInput(f) {
    const common = { id: `f-${f.id}`, name: f.id, oninput: onInput, onchange: onInput };
    if (f.kind === 'checkbox') return h('input', { ...common, type: 'checkbox' });
    if (f.kind === 'select') {
      return h('select', common, f.options.map((o) => (typeof o === 'string'
        ? h('option', { value: o }, o === '' ? '(none)' : o)
        : h('option', { value: o.value }, o.label))));
    }
    if (f.kind === 'textarea') return h('textarea', { ...common, rows: 3, spellcheck: 'false', placeholder: f.ph || '' });
    const input = h('input', {
      ...common,
      type: f.kind === 'secret' ? 'password' : 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: f.ph || (f.def !== undefined && f.def !== '' ? String(f.def) : ''),
    });
    if (f.kind === 'secret') {
      return h('div', { class: 'with-btn' }, input,
        h('button', { type: 'button', class: 'small', onclick: (e) => {
          input.type = input.type === 'password' ? 'text' : 'password';
          e.target.textContent = input.type === 'password' ? 'Show' : 'Hide';
        } }, 'Show'));
    }
    if (f.kind === 'hash') {
      return h('div', { class: 'with-btn' }, input,
        h('button', { type: 'button', class: 'small', onclick: () => openHashDialog(f) }, 'Generate…'));
    }
    return input;
  }

  function renderForm() {
    const form = $('#inputs-form');
    form.innerHTML = '';
    for (const section of G.SECTIONS) {
      const fields = G.FIELDS.filter((f) => f.section === section.id);
      form.append(h('fieldset', {},
        h('legend', {}, section.title),
        fields.map((f) => h('div', { class: `field ${f.kind === 'textarea' ? 'wide' : ''}`, id: `w-${f.id}` },
          h('label', { for: `f-${f.id}` }, f.label, f.required ? h('span', { class: 'req', title: 'required' }, ' *') : null),
          fieldInput(f),
          h('div', { class: 'error', id: `e-${f.id}` }),
          h('div', { class: 'help' }, f.help),
          h('div', { class: 'used-in' }, 'Used in: ', f.usedIn.map((u) => h('code', {}, u)))))));
    }
    writeValuesToForm();
  }

  function writeValuesToForm() {
    for (const f of G.FIELDS) {
      const el = $(`#f-${f.id}`);
      if (f.kind === 'checkbox') el.checked = Boolean(state.values[f.id]);
      else el.value = state.values[f.id] ?? '';
    }
    refresh();
  }

  function onInput(e) {
    const f = G.FIELD_BY_ID[e.target.name];
    state.values[f.id] = f.kind === 'checkbox' ? e.target.checked : e.target.value;
    refresh();
  }

  function refresh() {
    const { fieldErrors, warnings, missing } = G.validate(state.values);
    for (const f of G.FIELDS) {
      const msg = fieldErrors[f.id] || '';
      $(`#e-${f.id}`).textContent = msg;
      $(`#w-${f.id}`).hidden = !G.isActive(state.values, f.id);
      $(`#w-${f.id}`).classList.toggle('invalid', Boolean(msg));
      $(`#w-${f.id}`).classList.toggle('missing', missing.includes(f.id));
    }
    const errors = Object.keys(fieldErrors).length;
    const status = $('#status');
    status.innerHTML = '';
    status.className = `status ${errors ? 'bad' : missing.length ? 'warn' : 'good'}`;
    status.append(
      errors ? `${errors} invalid value${errors > 1 ? 's' : ''}. ` : '',
      missing.length ? `${missing.length} required input${missing.length > 1 ? 's' : ''} still empty (placeholders will be written). ` : '',
      !errors && !missing.length ? 'All inputs valid - files are ready.' : '',
    );
    if (warnings.length) status.append(h('ul', {}, warnings.map((w) => h('li', {}, w))));
    state.files = G.buildAllFiles(state.values, DEPLOY_FILES);
    renderCommands();
    if ($('#files').classList.contains('active')) renderFiles();
  }

  function renderCommands() {
    const list = $('#steps');
    list.innerHTML = '';
    for (const step of G.mopSteps(state.values)) {
      const pre = h('pre', { class: 'cmd' }, step.cmd);
      list.append(h('li', {},
        h('div', { class: 'step-head' }, h('strong', {}, step.title),
          h('button', { class: 'small', onclick: (e) => copyText(step.cmd, e.target) }, 'Copy')),
        pre,
        h('div', { class: 'note' }, `Expected: ${step.expect.replace(/`/g, '')}`)));
    }
  }

  /* ---------- hash dialog ---------- */
  let hashTarget = null;
  function openHashDialog(field) {
    hashTarget = field;
    $('#hash-title').textContent = `Generate ${field.label}`;
    $('#hash-pw').value = '';
    $('#hash-pw2').value = '';
    $('#hash-error').textContent = '';
    $('#hash-dialog').showModal();
    $('#hash-pw').focus();
  }

  function applyHash(e) {
    e.preventDefault();
    const pw = $('#hash-pw').value;
    if (pw.length < 8) { $('#hash-error').textContent = 'Use at least 8 characters.'; return; }
    if (pw !== $('#hash-pw2').value) { $('#hash-error').textContent = 'Passwords do not match.'; return; }
    state.values[hashTarget.id] = G.sha512Crypt(pw, G.randomSalt());
    if ($('#hash-all').checked) {
      for (const id of ['adminPasswordHash', 'rootPasswordHash', 't128PasswordHash']) {
        if (id !== hashTarget.id) state.values[id] = G.sha512Crypt(pw, G.randomSalt());
      }
    }
    $('#hash-pw').value = '';
    $('#hash-pw2').value = '';
    $('#hash-dialog').close();
    writeValuesToForm();
  }

  /* ---------- files ---------- */
  /* Static files (README, deploy script) mention placeholders as documentation; only generated files count. */
  function placeholdersIn(file) {
    return file.isStatic ? [] : [...new Set(file.content.match(PLACEHOLDER) || [])];
  }

  const markPlaceholders = (html) => html.replace(/&lt;input-[^&]*?&gt;/g, (m) => `<mark>${m}</mark>`);

  const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(?<![\w.$-])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w.])|([{}[\],])/g;

  /* Syntax-highlights JSON text (also works line by line on the JSON embedded in cloud-init). */
  function highlightJson(text) {
    let html = '';
    let last = 0;
    for (const m of text.matchAll(JSON_TOKEN)) {
      html += escapeHtml(text.slice(last, m.index));
      const token = escapeHtml(m[0]);
      if (m[1]) {
        const cls = m[2] ? 'j-key' : (/^"\[.*\]"$/s.test(m[1]) ? 'j-expr' : 'j-str');
        html += `<span class="${cls}">${escapeHtml(m[1])}</span>${m[2] ? `<span class="j-punc">${escapeHtml(m[2])}</span>` : ''}`;
      } else if (m[3]) {
        html += `<span class="j-lit">${token}</span>`;
      } else if (m[4]) {
        html += `<span class="j-punc">${token}</span>`;
      } else {
        html += `<span class="j-num">${token}</span>`;
      }
      last = m.index + m[0].length;
    }
    return html + escapeHtml(text.slice(last));
  }

  function highlightCloudInit(text) {
    return text.split('\n').map((line) => (/^\s*#/.test(line)
      ? `<span class="j-comment">${escapeHtml(line)}</span>`
      : highlightJson(line))).join('\n');
  }

  function fileKind(path) {
    if (path.endsWith('.md')) return 'markdown';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('cloud-init.txt')) return 'cloud-init';
    return 'text';
  }

  function fileBody(file) {
    const kind = fileKind(file.path);
    if (kind === 'markdown' && state.mopView === 'readable') {
      const div = h('div', { class: 'markdown file-render' });
      div.innerHTML = markPlaceholders(renderMarkdown(file.content));
      return div;
    }
    const pre = h('pre', { class: 'file-code' });
    let html;
    if (kind === 'json') html = highlightJson(file.content);
    else if (kind === 'cloud-init') html = highlightCloudInit(file.content);
    else html = escapeHtml(file.content);
    pre.innerHTML = file.isStatic ? html : markPlaceholders(html);
    return pre;
  }

  function fileToolbar(file) {
    const bar = h('div', { class: 'file-toolbar' });
    if (fileKind(file.path) === 'markdown') {
      const toggle = h('div', { class: 'segmented', role: 'group', 'aria-label': 'MOP view' });
      for (const [mode, label] of [['readable', 'Readable'], ['raw', 'Raw markdown']]) {
        toggle.append(h('button', {
          type: 'button',
          class: state.mopView === mode ? 'active' : '',
          'aria-pressed': String(state.mopView === mode),
          onclick: () => { state.mopView = mode; renderFiles(); },
        }, label));
      }
      bar.append(toggle);
    }
    bar.append(
      h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'small', onclick: (e) => copyText(file.content, e.target) }, 'Copy'),
      h('button', { type: 'button', class: 'small', onclick: () => download(file.path.split('/').pop(), file.content) }, 'Download'),
    );
    return bar;
  }

  function renderFiles() {
    const list = $('#file-list');
    list.innerHTML = '';
    for (const file of state.files) {
      const ph = placeholdersIn(file);
      const lines = file.content.split('\n').length - (file.content.endsWith('\n') ? 1 : 0);
      const details = h('details', { class: 'file', open: state.expanded.has(file.path) },
        h('summary', {},
          h('span', { class: 'fname' }, file.path),
          file.isStatic ? h('span', { class: 'badge static', title: 'Same for every deployment' }, 'static') : null,
          ph.length ? h('span', { class: 'badge warn', title: ph.join('\n') }, `${ph.length} to fill`) : null,
          h('span', { class: 'fmeta' }, `${lines} lines`)));
      details.addEventListener('toggle', () => {
        if (details.open) {
          state.expanded.add(file.path);
          if (!details.querySelector('.file-body')) details.append(fileContent(file, ph));
        } else {
          state.expanded.delete(file.path);
        }
      });
      if (details.open) details.append(fileContent(file, ph));
      list.append(details);
    }
    const total = state.files.reduce((n, f) => n + placeholdersIn(f).length, 0);
    $('#zip-warning').textContent = total ? `${total} placeholder(s) remain. Fill them on the Inputs tab before handing off the bundle.` : '';
  }

  function fileContent(file, ph) {
    return h('div', { class: 'file-body' },
      fileToolbar(file),
      ph.length ? h('div', { class: 'file-warning' }, `Unfilled inputs: ${ph.join(', ')}`) : null,
      fileBody(file));
  }

  function setAllExpanded(open) {
    state.expanded = new Set(open ? state.files.map((f) => f.path) : []);
    renderFiles();
  }

  function download(name, content, type = 'text/plain') {
    const blob = content instanceof Uint8Array ? new Blob([content], { type }) : new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if (button) {
      const old = button.textContent;
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = old; }, 1200);
    }
  }

  /* ---------- import / export (secrets are never exported) ---------- */
  function exportInputs() {
    const data = {};
    for (const f of G.FIELDS) if (!f.secret) data[f.id] = state.values[f.id];
    download('ssr-ha-conductor-inputs.json', `${JSON.stringify(data, null, 2)}\n`, 'application/json');
  }

  function importInputs(e) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((text) => {
      const data = G.upgradeValues(JSON.parse(text));
      for (const f of G.FIELDS) if (f.id in data) state.values[f.id] = data[f.id];
      writeValuesToForm();
    }).catch((err) => alert(`Unable to import: ${err.message}`)).finally(() => { e.target.value = ''; });
  }

  function loadExample() {
    const pw = 'Example-Only-Passw0rd!';
    Object.assign(state.values, G.defaults(), {
      resourceGroup: 'ssr-conductor-rg',
      location: 'eastus',
      virtualNetworkName: 'ssr-vnet',
      controlSubnetName: 'conductor-subnet',
      managedIdentity: 'ssr-conductor-identity',
      adminPublicKeyData: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDExampleKeyOnlyReplaceMe= admin@example',
      node0PrivateIp: '10.0.1.10',
      node1PrivateIp: '10.0.1.11',
      artifactoryUser: 'example-user',
      artifactoryToken: 'example-token',
      adminPasswordHash: G.sha512Crypt(pw, G.randomSalt()),
      rootPasswordHash: G.sha512Crypt(pw, G.randomSalt()),
      t128PasswordHash: G.sha512Crypt(pw, G.randomSalt()),
      haPeerPassword: 'Temp-HA-Peer-Example-123',
      dnsServers: '168.63.129.16',
    });
    writeValuesToForm();
  }

  function resetInputs() {
    if (!confirm('Clear all inputs?')) return;
    state.values = G.defaults();
    writeValuesToForm();
  }

  /* ---------- wire up ---------- */
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
  $('#btn-example').addEventListener('click', loadExample);
  $('#btn-reset').addEventListener('click', resetInputs);
  $('#btn-export').addEventListener('click', exportInputs);
  $('#import-file').addEventListener('change', importInputs);
  $('#btn-expand-all').addEventListener('click', () => setAllExpanded(true));
  $('#btn-collapse-all').addEventListener('click', () => setAllExpanded(false));
  $('#btn-zip').addEventListener('click', () => {
    const zip = G.makeZip(state.files.map((f) => ({ path: `${BUNDLE_DIR}/${f.path}`, content: f.content })));
    download(`${BUNDLE_DIR}.zip`, zip, 'application/zip');
  });
  $('#hash-form').addEventListener('submit', applyHash);
  $('#hash-cancel').addEventListener('click', () => $('#hash-dialog').close());

  renderUsage();
  renderForm();
})();
