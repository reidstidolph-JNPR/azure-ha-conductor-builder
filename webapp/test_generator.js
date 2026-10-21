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
      const cond = f.when && (f.when.set ? `${G.FIELD_BY_ID[f.when.field].label} is set` : `${G.FIELD_BY_ID[f.when.field].label} = \`${f.when.equals}\``);
      const when = f.when ? ` (only when ${cond})` : '';
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
    Object.assign(filled(), { node1ResourceGroup: 'rg-b', node1Location: 'westus2', node1VirtualNetworkName: 'vnet-b' }),
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

/* Body of a `bash -euo pipefail <<'DELIM'` block as the inner bash receives it (the quoted here-document is not expanded). */
function heredocBody(block) {
  const lines = block.split('\n');
  const m = /^bash -euo pipefail <<'([A-Z_]+)'$/.exec(lines[0]);
  assert.ok(m, `not a quoted here-document: ${lines[0]}`);
  assert.strictEqual(lines[lines.length - 1], m[1], 'here-document is not terminated on the last line');
  assert.strictEqual(lines.slice(1, -1).indexOf(m[1]), -1, 'delimiter appears inside the body');
  return lines.slice(1, -1).join('\n');
}

test('MOP steps: Cloud Shell only for Azure, node steps are valid bash, secrets survive quoting', () => {
  const values = filled();
  values.haPeerPassword = `Tricky 'quote' "dq" $HOME \`back\` ;|& HA_PEER_OPEN`;
  const steps = G.mopSteps(values);
  assert.deepStrictEqual(steps.map((st) => st.where), [
    'cloudshell', 'cloudshell', 'cloudshell', 'terminal', 'node0', 'pcli0', 'pcli0', 'node0',
    'cloudshell', 'terminal', 'node1', 'node0', 'node0', 'node0', 'pcli0', 'pcli0', 'pcli0']);
  for (const step of steps) {
    assert.ok(G.WHERE[step.where], step.title);
    assert.ok(!/\{\{step:/.test(step.text + step.expect), `unresolved step reference in ${step.title}`);
    if (step.where === 'cloudshell') {
      for (const line of step.cmd.split('\n')) assert.strictEqual(parsePowerShellArgs(line)[0], 'az', `${step.title}: one az command per line`);
    } else if (step.where === 'pcli0') {
      for (const line of step.cmd.split('\n')) assert.match(line, /^(config authority |commit force$|show (assets|system connectivity)$|exit$)/, `${step.title}: ${line}`);
      assert.ok(step.text.includes('su - admin') || step.text.startsWith('Still in the node0 PCLI'), `${step.title} says how to get into the PCLI`);
    } else {
      assert.ok(!/\baz vm run-command\b/.test(step.cmd), `${step.title} uses run-command`);
      execFileSync('bash', ['-n', '-c', step.cmd]);
    }
  }
  const byTitle = Object.fromEntries(steps.map((st) => [st.title, st]));

  const open = heredocBody(byTitle['Open temporary HA peer access on node0'].cmd);
  const pwLine = open.split('\n').find((l) => l.endsWith('| chpasswd'));
  assert.strictEqual(execFileSync('bash', ['-c', pwLine.replace('| chpasswd', '')]).toString(), `t128:${values.haPeerPassword}\n`);
  assert.ok(open.includes(`'Match User t128 Address ${values.node1PrivateIp}/32'`));
  assert.ok(open.includes("> /etc/sudoers.d/zz-ha-peer"), 'sudo rule sorts after every other sudoers.d file');
  assert.ok(/sudo -n true.*exit 1/.test(open), 'open verifies that sudo asks for the password');
  assert.ok(!/grep -q/.test(open), 'grep -q under pipefail can fail on SIGPIPE');
  const close = heredocBody(byTitle['Close HA peer access on node0'].cmd);
  assert.ok(close.includes(`usermod -p '${values.t128PasswordHash}' t128`));
  assert.ok(close.includes('rm -f /etc/sudoers.d/zz-ha-peer'));

  const deploy = parsePowerShellArgs(byTitle['Deploy node0'].cmd);
  assert.deepStrictEqual(deploy.slice(deploy.indexOf('--parameters'), deploy.indexOf('--parameters') + 3),
    ['--parameters', '@conductor-node0-params.json', 'customData=@conductor-node0-cloud-init.txt']);
  assert.ok(byTitle['Connect to node0'].cmd.startsWith(`ssh -i <private-key-file> t128@${values.node0PrivateIp}\nsudo -i`));
  assert.ok(G.mopSteps(Object.assign(filled(), { publicIpMode: 'create' }))[3].cmd.includes('t128@<node0-public-ip>'));
  assert.ok(byTitle['Deploy node1'].text.includes('after step 8 printed'), byTitle['Deploy node1'].text);
  assert.ok(byTitle['Open temporary HA peer access on node0'].text.includes('Step 12 reverts it'));

  // PCLI: node0's asset is accepted and node1 is configured before node1 is deployed; node1's asset after node0 restarts.
  const order = steps.map((st) => st.title);
  const at = (title) => order.indexOf(title);
  assert.strictEqual(byTitle["Accept node0's asset"].cmd, 'config authority router Conductor node node0 asset-id Conductor-node0\ncommit force\nshow assets');
  assert.strictEqual(byTitle['Add node1 to the conductor configuration'].cmd, 'config authority router Conductor node node1 role conductor\ncommit force\nexit');
  assert.strictEqual(byTitle["Accept node1's asset"].cmd, 'config authority router Conductor node node1 asset-id Conductor-node1\ncommit force\nshow assets');
  assert.ok(at('Wait until node0 is initialized') < at("Accept node0's asset"));
  assert.ok(at("Accept node0's asset") < at('Add node1 to the conductor configuration'));
  assert.ok(at('Add node1 to the conductor configuration') < at('Deploy node1'));
  assert.ok(at('Restart node0') < at("Accept node1's asset") && at("Accept node1's asset") < at('Verify the HA pair'));
  const custom = Object.fromEntries(G.mopSteps(Object.assign(filled(), { conductorName: 'AcmeCond' })).map((st) => [st.title, st.cmd]));
  assert.ok(custom["Accept node1's asset"].startsWith('config authority router AcmeCond node node1 asset-id AcmeCond-node1'));
  assert.ok(byTitle['Wait until node0 is initialized'].cmd.includes('t128-salt-key --no-color -l unaccepted'), 'status lists pending assets');

  // Optional conductor addresses come after every required step.
  assert.deepStrictEqual(steps.filter((st) => st.optional).map((st) => st.title), ['Set the conductor addresses for managed routers']);
  assert.ok(steps.findIndex((st) => st.optional) === steps.filter((st) => !st.optional).length, 'optional steps are last');
  assert.strictEqual(byTitle['Set the conductor addresses for managed routers'].cmd,
    `config authority conductor-address ${values.node0PrivateIp}\nconfig authority conductor-address ${values.node1PrivateIp}\ncommit force\nexit`);
  const pub = G.mopSteps(Object.assign(filled(), { publicIpMode: 'existing', node0PublicIpName: 'pip0', node1PublicIpName: 'pip1', node1ResourceGroup: 'ssr-rg-b' }));
  const pubOpt = pub.filter((st) => st.optional);
  assert.deepStrictEqual(pubOpt.map((st) => st.where), ['cloudshell', 'pcli0']);
  const lookups = pubOpt[0].cmd.split('\n').map(parsePowerShellArgs);
  assert.deepStrictEqual(lookups.map((a) => [a[a.indexOf('--resource-group') + 1], a[a.indexOf('--name') + 1]]), [['ssr-rg', 'conductor-node0'], ['ssr-rg-b', 'conductor-node1']]);
  assert.ok(pubOpt[1].cmd.startsWith('config authority conductor-address <node0-address>\nconfig authority conductor-address <node1-address>'));
  assert.ok(pubOpt[1].text.includes('step 17'), pubOpt[1].text);

  const mop = G.mopDocument(values);
  for (const heading of ['### Where each command runs', '### Timing and what to expect']) {
    assert.ok(mop.indexOf(heading) > mop.indexOf('## Procedure') && mop.indexOf(heading) < mop.indexOf('### Step 1:'), heading);
  }
  assert.ok(mop.includes('**Run in:** node0 root shell\n'));
  assert.ok(mop.includes('**Run in:** node0 PCLI (admin)\n'));
  assert.ok(mop.includes('### Optional: conductor addresses for managed routers\n\nThe HA conductor is complete after step 16.'));
  assert.ok(mop.includes('### Step 17 (optional): Set the conductor addresses for managed routers'));
  assert.ok(mop.includes('```pcli\nconfig authority router Conductor node node0 asset-id Conductor-node0'));
  assert.ok(mop.includes('```bash\nbash -euo pipefail <<\'HA_PEER_OPEN\''));
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
  const azSteps = (values) => G.mopSteps(values).filter((st) => st.where === 'cloudshell');
  for (const step of azSteps(same)) for (const rg of rgArgs(step.cmd)) assert.strictEqual(rg, 'ssr-rg');
  assert.strictEqual(params(same, 1).virtualNetworkResourceGroup.value, '');

  const split = Object.assign(filled(), { publicIpMode: 'create', node1ResourceGroup: 'ssr-rg-b' });
  assert.deepStrictEqual(G.validate(split).fieldErrors, {});
  const byTitle = Object.fromEntries(azSteps(split).map((st) => [st.title, rgArgs(st.cmd)]));
  assert.deepStrictEqual(byTitle['Deploy node0'], ['ssr-rg']);
  assert.deepStrictEqual(byTitle['Deploy node1'], ['ssr-rg-b']);
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

test('node1 in its own resource group can use its own region, VNet, subnet and identity', () => {
  const params = (values, n) => JSON.parse(G.buildGeneratedFiles(values).find((f) => f.path === G.FILES[`p${n}`]).content).parameters;
  const pick = (p) => Object.fromEntries(['location', 'virtualNetworkName', 'virtualNetworkResourceGroup', 'controlSubnetName', 'managedIdentity', 'managedIdentityResourceGroup'].map((k) => [k, p[k].value]));
  const node0Expected = { location: 'eastus', virtualNetworkName: 'ssr-vnet', virtualNetworkResourceGroup: '', controlSubnetName: 'conductor', managedIdentity: 'ssr-id', managedIdentityResourceGroup: '' };
  const own = {
    node1Location: 'westus2', node1VirtualNetworkName: 'vnet-b', node1ControlSubnetName: 'conductor-b', node1ManagedIdentity: 'id-b',
  };

  // node1 overrides are ignored (and hidden) until node1 has its own resource group.
  const ignored = Object.assign(filled(), own);
  for (const id of Object.keys(own)) assert.ok(!G.isActive(ignored, id), id);
  assert.deepStrictEqual(pick(params(ignored, 1)), node0Expected);

  // Own VNet and identity named, resource groups left empty: they live in node1's resource group ('' = deployment RG).
  const sep = Object.assign(filled(), own, { node1ResourceGroup: 'ssr-rg-b' });
  assert.deepStrictEqual(G.validate(sep).fieldErrors, {});
  assert.deepStrictEqual(pick(params(sep, 0)), node0Expected, 'node0 is unaffected');
  assert.deepStrictEqual(pick(params(sep, 1)), {
    location: 'westus2', virtualNetworkName: 'vnet-b', virtualNetworkResourceGroup: '', controlSubnetName: 'conductor-b', managedIdentity: 'id-b', managedIdentityResourceGroup: '',
  });
  assert.strictEqual(G.fallbackValue(sep, 'node1VirtualNetworkResourceGroup'), 'ssr-rg-b');
  assert.strictEqual(G.fallbackValue(sep, 'node1Location'), 'eastus');
  assert.ok(G.validate(sep).warnings.some((w) => /different VNets/.test(w)));

  // Explicit node1 resource groups for its VNet and identity.
  const explicit = Object.assign(filled(), own, { node1ResourceGroup: 'ssr-rg-b', node1VirtualNetworkResourceGroup: 'net-b', node1ManagedIdentityResourceGroup: 'id-rg-b' });
  assert.strictEqual(params(explicit, 1).virtualNetworkResourceGroup.value, 'net-b');
  assert.strictEqual(params(explicit, 1).managedIdentityResourceGroup.value, 'id-rg-b');
  const sameAsOwn = Object.assign(filled(), own, { node1ResourceGroup: 'ssr-rg-b', node1VirtualNetworkResourceGroup: 'SSR-RG-B' });
  assert.strictEqual(params(sameAsOwn, 1).virtualNetworkResourceGroup.value, '', 'own resource group stays the template default');

  // Shares node0's VNet but has its own identity: VNet resource group points at node0's, identity at node1's.
  const shared = Object.assign(filled(), { node1ResourceGroup: 'ssr-rg-b', node1ManagedIdentity: 'id-b' });
  assert.strictEqual(params(shared, 1).virtualNetworkName.value, 'ssr-vnet');
  assert.strictEqual(params(shared, 1).virtualNetworkResourceGroup.value, 'ssr-rg');
  assert.strictEqual(params(shared, 1).managedIdentityResourceGroup.value, '');
  assert.strictEqual(G.fallbackValue(shared, 'node1VirtualNetworkResourceGroup'), 'ssr-rg');

  // Another region needs another VNet.
  const regionOnly = Object.assign(filled(), { node1ResourceGroup: 'ssr-rg-b', node1Location: 'westus2' });
  assert.ok(G.validate(regionOnly).fieldErrors.node1VirtualNetworkName);

  // MOP and diagram show each node's network.
  const mop = G.mopDocument(sep);
  assert.ok(mop.includes('| Region | node0 `eastus`, node1 `westus2` |'));
  assert.ok(mop.includes('| VNet / subnet | node0 `ssr-vnet` / `conductor`, node1 `vnet-b` / `conductor-b` |'));
  assert.ok(mop.includes('| Managed identity | node0 `ssr-id`, node1 `id-b` |'));
  assert.ok(mop.includes('- The VNets `ssr-vnet` and `vnet-b` are peered'));
  const diagram = G.topologyDiagram(sep).split('\n');
  assert.ok(diagram[0].startsWith('node0 in resource group ssr-rg (eastus), node1 in resource group ssr-rg-b (westus2)'));
  assert.ok(diagram.some((l) => l.includes('<── peered ──>')));
  assert.ok(diagram.includes(' node1: subnet conductor-b in VNet vnet-b (existing, resource group ssr-rg-b)'));
  const single = G.mopDocument(filled());
  assert.ok(single.includes('| Region | `eastus` |') && single.includes('| Managed identity | `ssr-id` |'));
  assert.ok(!single.includes('peered'));
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
