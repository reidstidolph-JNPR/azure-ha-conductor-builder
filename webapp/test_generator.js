#!/usr/bin/env node
/* Tests for generator.js. Run:  node test_generator.js
 * Regenerate the sample (placeholder) files in the bundle directory:  node test_generator.js --write
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('./generator.js');
const G = globalThis.SsrHa;
const BUNDLE_DIR = path.resolve(__dirname, '..');
const README = path.join(BUNDLE_DIR, 'README.md');

/* Markdown inputs reference for README.md, generated from the same FIELDS the web app uses. */
function inputsTable() {
  const cell = (s) => String(s).replace(/\|/g, '\\|');
  const text = (s) => cell(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const out = [];
  for (const section of G.SECTIONS) {
    out.push('', `#### ${section.title}`, '');
    out.push('| # | Input | Required | Default | Description | File: key |', '|---|---|---|---|---|---|');
    for (const f of G.FIELDS.filter((x) => x.section === section.id)) {
      const n = G.FIELDS.indexOf(f) + 1;
      let def = '-';
      if (f.kind === 'checkbox') def = `\`${Boolean(f.def)}\``;
      else if (f.def === '') def = '(empty)';
      else if (f.def !== undefined) def = `\`${f.def}\``;
      const ph = f.required ? ` Placeholder: \`${f.ph}\`` : '';
      const used = f.usedIn.map((u) => `\`${cell(u)}\``).join('<br>');
      const when = f.when ? ` (only when ${G.FIELD_BY_ID[f.when.field].label} = \`${f.when.equals}\`)` : '';
      out.push(`| ${n} | ${text(f.label)} | ${f.required ? 'Yes' : 'No'}${when} | ${def} | ${text(f.help)}${ph} | ${used} |`);
    }
  }
  return `${out.join('\n')}\n`;
}

function replaceBlock(text, marker, content) {
  const begin = `<!-- ${marker}:BEGIN -->`;
  const end = `<!-- ${marker}:END -->`;
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start < 0 || stop < start) throw new Error(`README.md is missing the ${marker} markers`);
  return `${text.slice(0, start + begin.length)}${content}${text.slice(stop)}`;
}

/* README.md with its generated blocks (topology for placeholder inputs, inputs table) refreshed. */
function readmeWithGenerated(readme) {
  const topology = `\n${G.topologyMarkdown(G.defaults())}\n`;
  return replaceBlock(replaceBlock(readme, 'TOPOLOGY', topology), 'INPUTS-TABLE', inputsTable());
}

if (process.argv.includes('--write')) {
  for (const f of G.buildGeneratedFiles(G.defaults())) {
    fs.writeFileSync(path.join(BUNDLE_DIR, f.path), f.content);
    console.log(`wrote ${f.path}`);
  }
  fs.writeFileSync(README, readmeWithGenerated(fs.readFileSync(README, 'utf8')));
  console.log('updated README.md topology and inputs table');
  process.exit(0);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const filled = () => Object.assign(G.defaults(), {
  resourceGroup: 'ssr-rg',
  location: 'eastus',
  virtualNetworkName: 'ssr-vnet',
  controlSubnetName: 'conductor',
  managedIdentity: 'ssr-id',
  adminPublicKeyData: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7 user@host',
  node0PrivateIp: '10.0.1.10',
  node1PrivateIp: '10.0.1.11',
  artifactoryUser: 'user',
  artifactoryToken: 'tok"en\\with-quotes',
  adminPasswordHash: G.sha512Crypt('admin-password', 'adminsalt'),
  rootPasswordHash: G.sha512Crypt('root-password', 'rootsalt'),
  t128PasswordHash: G.sha512Crypt('t128-password', 't128salt'),
  haPeerPassword: 'Temp "peer" pa$$:word',
  dnsServers: '168.63.129.16, 8.8.8.8',
  ntpServers: 'time.windows.com',
  timezone: 'America/New_York',
});

const extractJson = (cloudInit) => JSON.parse(cloudInit.slice(cloudInit.indexOf('{'), cloudInit.lastIndexOf('}') + 1));

test('sample files on disk match generator output for empty inputs', () => {
  for (const f of G.buildGeneratedFiles(G.defaults())) {
    const onDisk = fs.readFileSync(path.join(BUNDLE_DIR, f.path), 'utf8');
    assert.strictEqual(onDisk, f.content, `${f.path} is stale; run: node test_generator.js --write`);
  }
});

test('README topology and inputs table match the generator', () => {
  const readme = fs.readFileSync(README, 'utf8');
  assert.strictEqual(readme, readmeWithGenerated(readme), 'README.md generated blocks are stale; run: node test_generator.js --write');
  for (const f of G.FIELDS) assert.ok(readme.includes(`| ${f.label.replace(/</g, '&lt;')} |`), f.label);
  assert.ok(readme.indexOf('## What gets built') < readme.indexOf('## Hand-off bundle'), 'topology is shown up front');
});

test('topology diagram is aligned and reflects the inputs', () => {
  const variants = [
    G.defaults(),
    filled(),
    Object.assign(filled(), { publicIpMode: 'create', node0Zone: '', node1Zone: '', availabilitySetName: 'cond-avset', node0VmName: 'a-much-longer-conductor-vm-name-0' }),
    Object.assign(filled(), { publicIpMode: 'existing', node0PublicIpName: 'pip-a', node1PublicIpName: 'pip-b' }),
    Object.assign(G.defaults(), { publicIpMode: 'existing' }),
  ];
  for (const values of variants) {
    const lines = G.topologyDiagram(values).split('\n');
    const boxes = lines.filter((l) => /^[┌│└]/.test(l));
    const bus = lines.find((l) => l.startsWith('═'));
    assert.ok(bus, 'subnet line present');
    for (const l of boxes) assert.strictEqual(l.length, bus.length, `misaligned row: ${l}`);
    for (const ch of ['┬', '┴']) {
      const cols = boxes.filter((l) => l.includes(ch)).map((l) => [l.indexOf(ch), l.lastIndexOf(ch)].join());
      assert.ok(cols.every((c) => c === [bus.indexOf('╧'), bus.lastIndexOf('╧')].join()), `${ch} connectors line up with the subnet`);
    }
    const ha = boxes.find((l) => l.includes('<──'));
    assert.ok(ha && ha.split('ge-0-0').length === 3, 'HA sync link joins both ge-0-0 rows');
    for (const n of [0, 1]) {
      const vm = G.resolve(values, `node${n}VmName`);
      for (const want of [`Azure VM ${vm}`, `NIC ${vm}-control`, `NSG ${vm}-control`, `ge-0-0  ${G.resolve(values, `node${n}PrivateIp`)}`]) {
        assert.ok(lines.some((l) => l.includes(want)), want);
      }
    }
    const mode = values.publicIpMode;
    assert.strictEqual(lines.some((l) => l.includes('public IP (new)')), mode === 'create');
    assert.strictEqual(lines.some((l) => l.includes('public IP (existing)')), mode === 'existing');
    assert.strictEqual(lines.some((l) => l.includes('no public IP')), mode === 'none');
    if (mode !== 'none') {
      for (const n of [0, 1]) {
        const name = mode === 'create' ? `${G.resolve(values, `node${n}VmName`)}-control` : G.resolve(values, `node${n}PublicIpName`);
        assert.ok(lines.some((l) => l.includes(`  ${name}`)), name);
      }
    }
  }
  const mop = G.mopDocument(filled());
  assert.ok(mop.indexOf('## Network topology') > mop.indexOf('## Environment') && mop.indexOf('## Network topology') < mop.indexOf('## Procedure'));
  assert.ok(mop.includes(`\`\`\`text\n${G.topologyDiagram(filled())}\n\`\`\``));
});

test('sha512 matches node crypto', () => {
  for (let len = 0; len < 600; len += 7) {
    const data = crypto.randomBytes(len);
    assert.strictEqual(Buffer.from(G.sha512(data)).toString('hex'), crypto.createHash('sha512').update(data).digest('hex'));
  }
});

test('sha512Crypt matches the reference test vector', () => {
  assert.strictEqual(
    G.sha512Crypt('Hello world!', 'saltstring'),
    '$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1',
  );
  const vectors = process.env.SHA512_CRYPT_VECTORS;
  if (vectors) {
    for (const [pw, salt, expected] of JSON.parse(fs.readFileSync(vectors, 'utf8'))) {
      assert.strictEqual(G.sha512Crypt(pw, salt), expected, `password ${JSON.stringify(pw)}`);
    }
  }
});

test('sha512Crypt output matches the onboarding schema pattern', () => {
  const pattern = /^\$6\$[A-Za-z0-9./]{1,16}\$[A-Za-z0-9./]{86}$/;
  for (let i = 0; i < 5; i++) assert.match(G.sha512Crypt(`pw${i}`, G.randomSalt()), pattern);
});

test('filled inputs validate cleanly and contain no placeholders', () => {
  const values = filled();
  const result = G.validate(values);
  assert.deepStrictEqual(result.fieldErrors, {});
  assert.deepStrictEqual(result.missing, []);
  for (const f of G.buildGeneratedFiles(values)) assert.ok(!/<input-/.test(f.content), f.path);
});

test('node0/node1 onboarding configs carry the HA settings', () => {
  const values = filled();
  const byPath = Object.fromEntries(G.buildGeneratedFiles(values).map((f) => [f.path, f]));
  const [p0, p1, c0, c1] = [G.FILES.p0, G.FILES.p1, G.FILES.c0, G.FILES.c1].map((p) => byPath[p]);
  const n0 = extractJson(c0.content);
  const n1 = extractJson(c1.content);
  assert.strictEqual(n0['node-name'], 'node0');
  assert.strictEqual(n1['node-name'], 'node1');
  assert.strictEqual(n0.name, 'Conductor-node0');
  assert.strictEqual(n0['cloud-provider'], 'azure');
  assert.ok(!('clustered' in n0) && !('clustered' in n1));
  assert.deepStrictEqual(n0['initializer-overrides'], { 'router-name': 'Conductor', 'node-ip': '10.0.1.10', timezone: 'America/New_York' });
  assert.deepStrictEqual(n1['initializer-overrides'], {
    'router-name': 'Conductor',
    'node-ip': '10.0.1.11',
    'ha-peer-ip': '10.0.1.10',
    'ha-peer-name': 'node0',
    'learn-from-ha-peer': true,
    'ha-peer-username': 't128',
    'unsafe-ha-peer-password': 'Temp "peer" pa$$:word',
    timezone: 'America/New_York',
  });
  assert.strictEqual(n1['artifactory-password'], 'tok"en\\with-quotes');
  assert.deepStrictEqual(n0['dns-servers'], ['168.63.129.16', '8.8.8.8']);

  const params0 = JSON.parse(p0.content).parameters;
  const params1 = JSON.parse(p1.content).parameters;
  assert.strictEqual(params0.controlPrivateIp.value, '10.0.1.10');
  assert.strictEqual(params0.haPeerPrivateIp.value, '10.0.1.11');
  assert.strictEqual(params1.controlPrivateIp.value, '10.0.1.11');
  assert.strictEqual(params1.haPeerPrivateIp.value, '10.0.1.10');
  assert.strictEqual(params0.availabilityZone.value, '1');
  assert.strictEqual(params1.availabilityZone.value, '2');
  assert.strictEqual(params0.createPublicIp.value, false);
  assert.strictEqual(params0.existingPublicIpName.value, '');
  assert.strictEqual(params0.existingPublicIpResourceGroup.value, '');
});

test('public IP modes: none, create new, attach existing', () => {
  const params = (values, n) => JSON.parse(G.buildGeneratedFiles(values).find((f) => f.path === G.FILES[`p${n}`]).content).parameters;
  const rollback = (values) => G.mopDocument(values).split('## Rollback')[1].split('## Troubleshooting')[0];

  const created = Object.assign(filled(), { publicIpMode: 'create', node0PublicIpName: 'ignored', publicIpResourceGroup: 'ignored-rg' });
  assert.deepStrictEqual(G.validate(created).fieldErrors, {});
  for (const n of [0, 1]) {
    const p = params(created, n);
    assert.strictEqual(p.createPublicIp.value, true);
    assert.strictEqual(p.existingPublicIpName.value, '', 'inactive existing-IP inputs are not written');
    assert.strictEqual(p.existingPublicIpResourceGroup.value, '');
  }
  assert.ok(rollback(created).includes("az network public-ip delete --resource-group 'ssr-rg' --name 'conductor-node0-control'"));

  const existing = Object.assign(filled(), { publicIpMode: 'existing', node0PublicIpName: 'pip-a', node1PublicIpName: 'pip-b', publicIpResourceGroup: 'pip-rg' });
  assert.deepStrictEqual(G.validate(existing).fieldErrors, {});
  assert.deepStrictEqual(G.validate(existing).missing, []);
  ['pip-a', 'pip-b'].forEach((name, n) => {
    const p = params(existing, n);
    assert.strictEqual(p.createPublicIp.value, false);
    assert.strictEqual(p.existingPublicIpName.value, name);
    assert.strictEqual(p.existingPublicIpResourceGroup.value, 'pip-rg');
  });
  const mop = G.mopDocument(existing);
  assert.ok(mop.includes('| Public IPs | existing, attached to node0 / node1: `pip-a` / `pip-b` in resource group `pip-rg` |'));
  assert.ok(mop.includes('- The existing public IPs `pip-a` / `pip-b` are in resource group `pip-rg`'));
  assert.ok(!rollback(existing).includes('public-ip delete'), 'existing public IPs are never deleted');
  assert.ok(rollback(existing).includes('are kept'));

  const empty = Object.assign(filled(), { publicIpMode: 'existing' });
  assert.deepStrictEqual(G.validate(empty).missing, ['node0PublicIpName', 'node1PublicIpName']);
  assert.strictEqual(params(empty, 1).existingPublicIpName.value, '<input-node1-existing-public-ip-name>');
  const dup = Object.assign(filled(), { publicIpMode: 'existing', node0PublicIpName: 'pip-a', node1PublicIpName: 'pip-a' });
  assert.ok(G.validate(dup).fieldErrors.node1PublicIpName);
  assert.deepStrictEqual(G.validate(Object.assign(filled(), { node0PublicIpName: 'not valid!' })).fieldErrors, {}, 'inactive fields are not validated');

  assert.strictEqual(G.upgradeValues({ createPublicIp: true }).publicIpMode, 'create');
  assert.strictEqual(G.upgradeValues({ createPublicIp: false }).publicIpMode, 'none');
  assert.ok(!('createPublicIp' in G.upgradeValues({ createPublicIp: true })));
});

test('template wires new and existing public IPs', () => {
  const t = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'conductor_template.json'), 'utf8'));
  const pip = t.resources.find((r) => r.type === 'Microsoft.Network/publicIPAddresses');
  const nic = t.resources.find((r) => r.type === 'Microsoft.Network/networkInterfaces');
  assert.strictEqual(pip.condition, "[variables('createNewPublicIp')]");
  assert.ok(nic.dependsOn.includes("[variables('newPublicIpRef')]"), 'NIC may only depend on the template-created public IP');
  assert.ok(nic.properties.ipConfigurations[0].properties.publicIPAddress.includes("variables('attachPublicIp')"));
  for (const v of ['useExistingPublicIp', 'createNewPublicIp', 'attachPublicIp', 'newPublicIpRef', 'publicIpRef']) assert.ok(v in t.variables, v);
  assert.strictEqual(t.outputs.publicIPAddress.condition, "[variables('attachPublicIp')]");
  for (const o of [t.outputs.publicIPAddress.value, t.outputs.SSHLogin.value]) assert.ok(o.includes("reference(variables('publicIpRef'), '2019-09-01')"));
});

test('params files only use parameters defined in the template', () => {
  const template = JSON.parse(fs.readFileSync(path.join(BUNDLE_DIR, 'conductor_template.json'), 'utf8'));
  const defined = new Set(Object.keys(template.parameters));
  const paramFiles = G.buildGeneratedFiles(filled()).filter((f) => f.path.endsWith('-params.json'));
  for (const f of paramFiles) {
    for (const name of Object.keys(JSON.parse(f.content).parameters)) assert.ok(defined.has(name), `${f.path}: ${name}`);
  }
  const required = Object.entries(template.parameters).filter(([, p]) => !('defaultValue' in p)).map(([n]) => n);
  const provided = new Set([...Object.keys(JSON.parse(paramFiles[0].content).parameters), 'customData']);
  for (const name of required) assert.ok(provided.has(name), `required template parameter ${name} not provided`);
});

/* Splits a PowerShell command line made of bare words and single-quoted strings (as generated) into arguments. */
function parsePowerShellArgs(line) {
  const args = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ') { i++; continue; }
    let arg = '';
    if (line[i] === "'") {
      i++;
      for (;;) {
        if (i >= line.length) throw new Error('unterminated quote');
        if (line[i] === "'" && line[i + 1] === "'") { arg += "'"; i += 2; continue; }
        if (line[i] === "'") { i++; break; }
        arg += line[i++];
      }
    } else {
      while (i < line.length && line[i] !== ' ') {
        if (/[<>|;&$`"(){}@]/.test(line[i]) && arg === '' ) throw new Error(`unquoted special character in ${line.slice(i, i + 20)}`);
        arg += line[i++];
      }
    }
    args.push(arg);
  }
  return args;
}

test('MOP commands are single lines with safe PowerShell quoting and valid shell scripts', () => {
  const values = filled();
  values.haPeerPassword = `Tricky 'quote' "dq" $HOME \`back\` ;|&`;
  const steps = G.mopSteps(values);
  assert.strictEqual(steps.length, 10);
  for (const step of steps) {
    assert.ok(!step.cmd.includes('\n'), `${step.title} is not a single line`);
    const args = parsePowerShellArgs(step.cmd);
    assert.strictEqual(args[0], 'az');
    const i = args.indexOf('--scripts');
    if (i > 0) execFileSync('bash', ['-n', '-c', args[i + 1]]);
  }
  const open = parsePowerShellArgs(steps[4].cmd);
  const script = open[open.indexOf('--scripts') + 1];
  const echoed = execFileSync('bash', ['-c', script.split('; ')[1].replace('| chpasswd', '')]).toString().trim();
  assert.strictEqual(echoed, `t128:${values.haPeerPassword}`);
  assert.ok(script.includes(`Match User t128 Address ${values.node1PrivateIp}/32`));
  const close = parsePowerShellArgs(steps[7].cmd);
  assert.ok(close[close.indexOf('--scripts') + 1].includes(`usermod -p '${values.t128PasswordHash}' t128`));
  const deploy = parsePowerShellArgs(steps[2].cmd);
  assert.deepStrictEqual(deploy.slice(deploy.indexOf('--parameters'), deploy.indexOf('--parameters') + 3),
    ['--parameters', '@conductor-node0-params.json', 'customData=@conductor-node0-cloud-init.txt']);
});

test('node1 can use its own resource group', () => {
  const rgArgs = (cmd) => {
    const args = parsePowerShellArgs(cmd);
    return args.flatMap((a, i) => (a === '--resource-group' ? [args[i + 1]] : []));
  };
  const params = (values, n) => JSON.parse(G.buildGeneratedFiles(values).find((f) => f.path === G.FILES[`p${n}`]).content).parameters;
  const rollbackLines = (values) => G.mopDocument(values).split('## Rollback')[1].split('```powershell\n')[1].split('\n```')[0].split('\n');

  const same = filled();
  assert.ok(!G.separateResourceGroups(same));
  assert.ok(!G.separateResourceGroups(Object.assign(filled(), { node1ResourceGroup: 'SSR-RG' })), 'resource group names are case-insensitive');
  for (const step of G.mopSteps(same)) for (const rg of rgArgs(step.cmd)) assert.strictEqual(rg, 'ssr-rg');
  assert.strictEqual(params(same, 1).virtualNetworkResourceGroup.value, '');

  const split = Object.assign(filled(), { publicIpMode: 'create', node1ResourceGroup: 'ssr-rg-b' });
  assert.deepStrictEqual(G.validate(split).fieldErrors, {});
  const steps = G.mopSteps(split);
  const byTitle = Object.fromEntries(steps.map((st) => [st.title, rgArgs(st.cmd)]));
  assert.deepStrictEqual(byTitle['Deploy node0'], ['ssr-rg']);
  assert.deepStrictEqual(byTitle['Wait until node0 is initialized'], ['ssr-rg']);
  assert.deepStrictEqual(byTitle['Open temporary HA peer access on node0'], ['ssr-rg']);
  assert.deepStrictEqual(byTitle['Deploy node1'], ['ssr-rg-b']);
  assert.deepStrictEqual(byTitle['Wait until node1 has joined'], ['ssr-rg-b']);
  assert.deepStrictEqual(byTitle['Close HA peer access on node0'], ['ssr-rg']);
  assert.deepStrictEqual(byTitle['Restart node0'], ['ssr-rg']);
  const [rb1, rb0] = rollbackLines(split);
  assert.ok(rb1.includes("'conductor-node1'") && rb1.split('; ').every((c) => rgArgs(c)[0] === 'ssr-rg-b'), rb1);
  assert.ok(rb0.includes("'conductor-node0'") && rb0.split('; ').every((c) => rgArgs(c)[0] === 'ssr-rg'), rb0);

  // Shared resources (VNet, identity) default to node0's resource group, so node1's params name it explicitly.
  assert.strictEqual(params(split, 0).virtualNetworkResourceGroup.value, '');
  assert.strictEqual(params(split, 1).virtualNetworkResourceGroup.value, 'ssr-rg');
  assert.strictEqual(params(split, 1).managedIdentityResourceGroup.value, 'ssr-rg');
  const explicit = Object.assign(filled(), { node1ResourceGroup: 'ssr-rg-b', virtualNetworkResourceGroup: 'net-rg', managedIdentityResourceGroup: 'id-rg' });
  for (const n of [0, 1]) {
    assert.strictEqual(params(explicit, n).virtualNetworkResourceGroup.value, 'net-rg');
    assert.strictEqual(params(explicit, n).managedIdentityResourceGroup.value, 'id-rg');
  }

  const mop = G.mopDocument(split);
  assert.ok(mop.includes('| Resource groups | node0 `ssr-rg`, node1 `ssr-rg-b` |'));
  assert.ok(mop.includes('permission to deploy to both resource groups'));
  assert.ok(G.topologyDiagram(split).startsWith('node0 in resource group ssr-rg, node1 in resource group ssr-rg-b'));
  assert.ok(G.topologyDiagram(split).includes('(existing, resource group ssr-rg)'), 'VNet location is explicit');

  const avset = Object.assign(filled(), { node1ResourceGroup: 'ssr-rg-b', node0Zone: '', node1Zone: '', availabilitySetName: 'set' });
  assert.ok(G.validate(avset).fieldErrors.node1ResourceGroup);
});

test('cross-field validation', () => {
  const values = filled();
  values.node1PrivateIp = values.node0PrivateIp;
  values.availabilitySetName = 'my-set';
  values.adminPasswordHash = 'clear-text';
  const { fieldErrors } = G.validate(values);
  assert.ok(fieldErrors.node1PrivateIp);
  assert.ok(fieldErrors.availabilitySetName);
  assert.ok(fieldErrors.adminPasswordHash);
});

test('zip archive is readable by unzip', () => {
  const zip = G.makeZip([{ path: 'dir/a.txt', content: 'hello\n' }, { path: 'dir/s.sh', content: '#!/bin/sh\necho hi\n' }]);
  const tmp = path.join(require('os').tmpdir(), `ssr-ha-test-${process.pid}.zip`);
  fs.writeFileSync(tmp, zip);
  try {
    execFileSync('unzip', ['-tq', tmp]);
    assert.strictEqual(execFileSync('unzip', ['-p', tmp, 'dir/a.txt']).toString(), 'hello\n');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('index.html is up to date with its sources', () => {
  execFileSync('python3', [path.join(__dirname, 'build.py'), '--check'], { stdio: 'pipe' });
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`ok   - ${t.name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL - ${t.name}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
