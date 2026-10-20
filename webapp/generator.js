/* SSR Azure HA conductor - input definitions and file generator.
 * Pure functions only (no DOM) so the same code runs in the browser and in Node tests.
 */
(function (root) {
  'use strict';

  const F = {
    template: 'conductor_template.json',
    p0: 'conductor-node0-params.json',
    p1: 'conductor-node1-params.json',
    c0: 'conductor-node0-cloud-init.txt',
    c1: 'conductor-node1-cloud-init.txt',
    mop: 'MOP.md',
  };

  const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  const CIDR = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\/(3[0-2]|[12]?\d)$/;
  const SSR_NAME = /^([a-zA-Z0-9]([a-zA-Z0-9\-_]){0,61})?[a-zA-Z0-9]$/;
  const SHA512_CRYPT = /^\$6\$[A-Za-z0-9./]{1,16}\$[A-Za-z0-9./]{86}$/;
  const VM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}[A-Za-z0-9_]$/;
  const AZ_NAME = /^[A-Za-z0-9][A-Za-z0-9._()-]{0,88}[A-Za-z0-9_()-]$|^[A-Za-z0-9]$/;

  const re = (regex, message) => (v) => (regex.test(v) ? null : message);

  const SECTIONS = [
    { id: 'azure', title: 'Azure deployment (shared by both nodes)' },
    { id: 'nodes', title: 'Conductor nodes' },
    { id: 'ssr', title: 'SSR software and conductor identity' },
    { id: 'creds', title: 'Account passwords (SHA-512 crypt hashes)' },
    { id: 'ha', title: 'HA peer bootstrap credentials (temporary)' },
    { id: 'optional', title: 'Optional settings' },
  ];

  /* kind: text | textarea | select | checkbox | secret | hash
   * ph: placeholder written into files when a required value is empty
   * when: { field, equals } - the field only applies (and is only required) when another field has that value
   * select options: strings, or { value, label } */
  const FIELDS = [
    {
      id: 'resourceGroup', section: 'azure', label: 'Resource group', kind: 'text', required: true,
      ph: '<input-your-resource-group>',
      help: 'Existing resource group the conductor VMs, NICs, NSGs (and optional public IPs) are created in. node1 uses it too unless "node1 resource group" is set.',
      usedIn: [`${F.mop}: --resource-group of node0 az commands (and node1's by default)`, `${F.p1}: virtualNetworkResourceGroup, managedIdentityResourceGroup (when node1 has its own resource group and these are empty)`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'location', section: 'azure', label: 'Azure region', kind: 'text', required: true,
      ph: '<input-your-azure-region>',
      help: 'Region of the VNet, lowercase with no spaces (e.g. eastus, westeurope).',
      usedIn: [`${F.p0}: location`, `${F.p1}: location`],
      validate: re(/^[a-z0-9]+$/, 'Use the region short name, e.g. eastus'),
    },
    {
      id: 'virtualNetworkName', section: 'azure', label: 'VNet name', kind: 'text', required: true,
      ph: '<input-your-vnet-name>',
      help: 'Existing VNet both conductor nodes are attached to.',
      usedIn: [`${F.p0}: virtualNetworkName`, `${F.p1}: virtualNetworkName`],
      validate: re(AZ_NAME, 'Not a valid VNet name'),
    },
    {
      id: 'virtualNetworkResourceGroup', section: 'azure', label: 'VNet resource group', kind: 'text', def: '',
      help: 'Only needed when the VNet lives in a different resource group. Empty = node0\'s resource group.',
      usedIn: [`${F.p0}: virtualNetworkResourceGroup`, `${F.p1}: virtualNetworkResourceGroup`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'controlSubnetName', section: 'azure', label: 'Control subnet name', kind: 'text', required: true,
      ph: '<input-your-subnet-name>',
      help: 'Existing subnet for the control interface of both nodes. Routers must reach it; both nodes must reach each other.',
      usedIn: [`${F.p0}: controlSubnetName`, `${F.p1}: controlSubnetName`],
      validate: re(AZ_NAME, 'Not a valid subnet name'),
    },
    {
      id: 'managedIdentity', section: 'azure', label: 'User assigned managed identity', kind: 'text', required: true,
      ph: '<input-your-managed-identity-name>',
      help: 'Identity attached to both VMs. Needs Microsoft.Compute/virtualMachines/read, Microsoft.Network/networkInterfaces/read and Microsoft.Network/virtualNetworks/read.',
      usedIn: [`${F.p0}: managedIdentity`, `${F.p1}: managedIdentity`],
      validate: re(AZ_NAME, 'Not a valid identity name'),
    },
    {
      id: 'managedIdentityResourceGroup', section: 'azure', label: 'Managed identity resource group', kind: 'text', def: '',
      help: 'Only needed when the identity lives in a different resource group. Empty = node0\'s resource group.',
      usedIn: [`${F.p0}: managedIdentityResourceGroup`, `${F.p1}: managedIdentityResourceGroup`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'instanceSize', section: 'azure', label: 'VM size', kind: 'select', def: 'Standard_F16s_v2',
      options: ['Standard_D8s_v5', 'Standard_F8s_v2', 'Standard_F16s_v2', 'Standard_F32s_v2'],
      help: 'Size of both conductor VMs.',
      usedIn: [`${F.p0}: instanceSize`, `${F.p1}: instanceSize`],
    },
    {
      id: 'availabilitySetName', section: 'azure', label: 'Availability set name', kind: 'text', def: '',
      help: 'Existing availability set for regions without availability zones. Leave empty when using zones. Both VMs must be in its resource group, so it cannot be combined with a separate node1 resource group.',
      usedIn: [`${F.p0}: availabilitySetName`, `${F.p1}: availabilitySetName`],
      validate: re(AZ_NAME, 'Not a valid availability set name'),
    },
    {
      id: 'publicIpMode', section: 'azure', label: 'Public IP per node', kind: 'select', def: 'none',
      options: [
        { value: 'none', label: 'None (private IPs only)' },
        { value: 'create', label: 'Create a new public IP per node' },
        { value: 'existing', label: 'Attach an existing public IP per node' },
      ],
      help: 'Public IP on each control interface, needed when routers reach the conductor over the Internet. "Create" adds a static Standard SKU public IP named <VM name>-control; "Attach existing" uses public IPs you already own (for example, addresses already allow-listed by routers).',
      usedIn: [`${F.p0}: createPublicIp, existingPublicIpName`, `${F.p1}: createPublicIp, existingPublicIpName`],
    },
    {
      id: 'publicIpResourceGroup', section: 'azure', label: 'Existing public IP resource group', kind: 'text', def: '',
      when: { field: 'publicIpMode', equals: 'existing' },
      help: 'Only needed when the existing public IPs live in a different resource group than their node. Empty = each node\'s own resource group.',
      usedIn: [`${F.p0}: existingPublicIpResourceGroup`, `${F.p1}: existingPublicIpResourceGroup`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'adminAllowedCidr', section: 'azure', label: 'Admin allowed CIDR', kind: 'text', def: '0.0.0.0/0',
      help: 'Source range allowed SSH (22) and HTTPS (443) to the conductor. Restrict this where possible.',
      usedIn: [`${F.p0}: adminAllowedCidr`, `${F.p1}: adminAllowedCidr`],
      validate: re(CIDR, 'Use x.x.x.x/y'),
    },
    {
      id: 'controlAllowedCidr', section: 'azure', label: 'Router control allowed CIDR', kind: 'text', def: '0.0.0.0/0',
      help: 'Source range of the managed routers (ports 930, 933, 4505-4506).',
      usedIn: [`${F.p0}: controlAllowedCidr`, `${F.p1}: controlAllowedCidr`],
      validate: re(CIDR, 'Use x.x.x.x/y'),
    },
    {
      id: 'adminPublicKeyData', section: 'azure', label: 'SSH public key for t128', kind: 'textarea', required: true,
      ph: '<input-your-ssh-public-key>',
      help: 'Public key (ssh-rsa, at least 2048-bit) used to log in as t128 on both nodes.',
      usedIn: [`${F.p0}: adminPublicKeyData`, `${F.p1}: adminPublicKeyData`],
      validate: re(/^(ssh-rsa|ssh-ed25519) [A-Za-z0-9+/]+=*( .*)?$/, 'Paste a single-line OpenSSH public key (ssh-rsa AAAA...)'),
    },

    {
      id: 'node0VmName', section: 'nodes', label: 'node0 VM name', kind: 'text', def: 'conductor-node0',
      help: 'Azure VM name of the primary node (also prefixes its NIC/NSG/disk names).',
      usedIn: [`${F.p0}: instanceName`, `${F.mop}: --name of node0 az vm commands`],
      validate: re(VM_NAME, 'Not a valid Azure VM name'),
    },
    {
      id: 'node0PrivateIp', section: 'nodes', label: 'node0 private IP', kind: 'text', required: true,
      ph: '<input-node0-private-ip>',
      help: 'Free static IP in the control subnet for node0. It is node0\'s conductor address and its HA address.',
      usedIn: [`${F.p0}: controlPrivateIp`, `${F.p1}: haPeerPrivateIp`, `${F.c0}: initializer-overrides.node-ip`, `${F.c1}: initializer-overrides.ha-peer-ip`],
      validate: re(IPV4, 'Use an IPv4 address without prefix'),
    },
    {
      id: 'node0Zone', section: 'nodes', label: 'node0 availability zone', kind: 'select', def: '1',
      options: ['', '1', '2', '3'],
      help: 'Zone of node0. Empty when the region has no zones (use an availability set instead).',
      usedIn: [`${F.p0}: availabilityZone`],
    },
    {
      id: 'node0PublicIpName', section: 'nodes', label: 'node0 existing public IP name', kind: 'text', required: true,
      when: { field: 'publicIpMode', equals: 'existing' },
      ph: '<input-node0-existing-public-ip-name>',
      help: 'Existing public IP for node0: Standard SKU, static, same region, not attached to anything else, and zone-redundant or in node0\'s zone.',
      usedIn: [`${F.p0}: existingPublicIpName`],
      validate: re(AZ_NAME, 'Not a valid public IP name'),
    },
    {
      id: 'node1VmName', section: 'nodes', label: 'node1 VM name', kind: 'text', def: 'conductor-node1',
      help: 'Azure VM name of the secondary node.',
      usedIn: [`${F.p1}: instanceName`, `${F.mop}: --name of node1 az vm commands`],
      validate: re(VM_NAME, 'Not a valid Azure VM name'),
    },
    {
      id: 'node1ResourceGroup', section: 'nodes', label: 'node1 resource group', kind: 'text', def: '',
      help: 'Existing resource group for node1\'s VM, NIC, NSG (and public IP) when it differs from node0\'s. Empty = same resource group as node0. The VNet and managed identity are still looked up in node0\'s resource group unless their own resource group is set.',
      usedIn: [`${F.mop}: --resource-group of node1 az commands`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'node1PrivateIp', section: 'nodes', label: 'node1 private IP', kind: 'text', required: true,
      ph: '<input-node1-private-ip>',
      help: 'Free static IP in the control subnet for node1.',
      usedIn: [`${F.p1}: controlPrivateIp`, `${F.p0}: haPeerPrivateIp`, `${F.c1}: initializer-overrides.node-ip`, `${F.mop}: step 5 (sshd Match Address)`],
      validate: re(IPV4, 'Use an IPv4 address without prefix'),
    },
    {
      id: 'node1Zone', section: 'nodes', label: 'node1 availability zone', kind: 'select', def: '2',
      options: ['', '1', '2', '3'],
      help: 'Zone of node1. Use a different zone than node0.',
      usedIn: [`${F.p1}: availabilityZone`],
    },
    {
      id: 'node1PublicIpName', section: 'nodes', label: 'node1 existing public IP name', kind: 'text', required: true,
      when: { field: 'publicIpMode', equals: 'existing' },
      ph: '<input-node1-existing-public-ip-name>',
      help: 'Existing public IP for node1, with the same requirements as node0\'s. Must differ from node0\'s.',
      usedIn: [`${F.p1}: existingPublicIpName`],
      validate: re(AZ_NAME, 'Not a valid public IP name'),
    },

    {
      id: 'conductorName', section: 'ssr', label: 'Conductor (router) name', kind: 'text', def: 'Conductor',
      help: 'Name of the conductor router. Each node also gets the hostname <name>-node0 / <name>-node1.',
      usedIn: [`${F.c0}: initializer-overrides.router-name, name, pdc-key-comment`, `${F.c1}: initializer-overrides.router-name, name, pdc-key-comment`],
      validate: (v) => (SSR_NAME.test(v) && v.length <= 57 ? null : 'Letters, digits, - and _ only (max 57 characters)'),
    },
    {
      id: 'ssrVersion', section: 'ssr', label: 'SSR version', kind: 'text', def: '7.2.3',
      help: 'SSR software version installed on both nodes (6.3.0 or later).',
      usedIn: [`${F.c0}: ssr-version`, `${F.c1}: ssr-version`],
      validate: (v) => {
        const m = /^(\d+)\.(\d+)\.(\d+)\S*$/.exec(v);
        if (!m) return 'Use a version such as 7.2.3';
        const n = [Number(m[1]), Number(m[2]), Number(m[3])];
        const tooOld = n[0] < 6 || (n[0] === 6 && n[1] < 3);
        return tooOld ? 'Image based conductor install requires 6.3.0 or later' : null;
      },
    },
    {
      id: 'artifactoryUser', section: 'ssr', label: 'Artifactory username', kind: 'text', required: true,
      ph: '<input-your-artifactory-username>',
      help: 'Juniper software repository user used to download SSR.',
      usedIn: [`${F.c0}: artifactory-user`, `${F.c1}: artifactory-user`],
    },
    {
      id: 'artifactoryToken', section: 'ssr', label: 'Artifactory token', kind: 'secret', required: true, secret: true,
      ph: '<input-your-artifactory-token>',
      help: 'Token/password for the artifactory user.',
      usedIn: [`${F.c0}: artifactory-password`, `${F.c1}: artifactory-password`],
    },

    {
      id: 'adminPasswordHash', section: 'creds', label: 'admin password hash', kind: 'hash', required: true,
      ph: '<input-sha512-crypt-hash-of-admin-password>',
      help: 'SHA-512 crypt hash ($6$...) for the SSR admin account (PCLI/GUI). Never a clear-text password.',
      usedIn: [`${F.c0}: admin-password`, `${F.c1}: admin-password`],
      validate: re(SHA512_CRYPT, 'Must be a SHA-512 crypt hash: $6$<salt>$<86 chars>'),
    },
    {
      id: 'rootPasswordHash', section: 'creds', label: 'root password hash', kind: 'hash', required: true,
      ph: '<input-sha512-crypt-hash-of-root-password>',
      help: 'SHA-512 crypt hash for the Linux root account.',
      usedIn: [`${F.c0}: root-password`, `${F.c1}: root-password`],
      validate: re(SHA512_CRYPT, 'Must be a SHA-512 crypt hash: $6$<salt>$<86 chars>'),
    },
    {
      id: 't128PasswordHash', section: 'creds', label: 't128 password hash', kind: 'hash', required: true,
      ph: '<input-sha512-crypt-hash-of-t128-password>',
      help: 'SHA-512 crypt hash for the Linux t128 account (SSH still uses the key). Also restores t128 on node0 after node1 joins.',
      usedIn: [`${F.c0}: t128-password`, `${F.c1}: t128-password`, `${F.mop}: step 8 (restore t128 password)`],
      validate: re(SHA512_CRYPT, 'Must be a SHA-512 crypt hash: $6$<salt>$<86 chars>'),
    },

    {
      id: 'haPeerPassword', section: 'ha', label: 'Temporary HA peer password', kind: 'secret', required: true, secret: true,
      ph: '<input-temporary-ha-peer-password>',
      help: 'Clear-text, single-use password for t128 on node0. Valid only between MOP steps 5 and 8 while node1 joins. Use a unique, strong value.',
      usedIn: [`${F.c1}: initializer-overrides.unsafe-ha-peer-password`, `${F.mop}: step 5 (temporary t128 password on node0)`],
      validate: (v) => (/[\r\n]/.test(v) ? 'Must not contain line breaks' : v.length < 12 ? 'Use at least 12 characters' : null),
    },

    {
      id: 'dnsServers', section: 'optional', label: 'DNS servers', kind: 'text', def: '',
      help: 'Comma separated IPv4 DNS servers. Empty = bootstrapper defaults (8.8.8.8, 1.1.1.1). Azure DNS is 168.63.129.16.',
      usedIn: [`${F.c0}: dns-servers`, `${F.c1}: dns-servers`],
      validate: (v) => (splitList(v).every((x) => IPV4.test(x)) ? null : 'Comma separated IPv4 addresses'),
    },
    {
      id: 'ntpServers', section: 'optional', label: 'NTP servers', kind: 'text', def: '',
      help: 'Comma separated NTP servers (IP or hostname). Empty = bootstrapper defaults.',
      usedIn: [`${F.c0}: ntp-servers`, `${F.c1}: ntp-servers`],
      validate: (v) => (splitList(v).every((x) => /^[A-Za-z0-9.-]+$/.test(x)) ? null : 'Comma separated IPs or hostnames'),
    },
    {
      id: 'timezone', section: 'optional', label: 'Timezone', kind: 'text', def: '',
      help: 'Optional IANA timezone for both nodes, e.g. America/New_York.',
      usedIn: [`${F.c0}: initializer-overrides.timezone`, `${F.c1}: initializer-overrides.timezone`],
      validate: re(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, 'Use an IANA timezone such as Etc/UTC'),
    },
    {
      id: 'mopCustomer', section: 'optional', label: 'Customer / project name', kind: 'text', def: '',
      help: 'Shown in the MOP title and summary.',
      usedIn: [`${F.mop}: title`],
    },
  ];

  function splitList(v) {
    return String(v || '').split(/[\s,]+/).filter(Boolean);
  }

  const FIELD_BY_ID = Object.fromEntries(FIELDS.map((f) => [f.id, f]));

  function defaults() {
    const values = {};
    for (const f of FIELDS) values[f.id] = f.kind === 'checkbox' ? Boolean(f.def) : (f.def ?? '');
    return values;
  }

  function isActive(values, id) {
    const w = FIELD_BY_ID[id].when;
    return !w || values[w.field] === w.equals;
  }

  /* Maps inputs saved by earlier versions onto the current fields. */
  function upgradeValues(data) {
    const out = { ...data };
    if ('createPublicIp' in out && !('publicIpMode' in out)) out.publicIpMode = out.createPublicIp ? 'create' : 'none';
    delete out.createPublicIp;
    return out;
  }

  /* Value used in generated files: trimmed input, or the placeholder for empty required fields; '' for inactive fields. */
  function resolve(values, id) {
    const f = FIELD_BY_ID[id];
    const raw = values[id];
    if (f.kind === 'checkbox') return Boolean(raw);
    if (!isActive(values, id)) return '';
    const v = f.kind === 'secret' ? String(raw ?? '') : String(raw ?? '').trim();
    if (v === '' && f.required) return f.ph;
    return v;
  }

  /* Public IP of a node: mode none | create | existing, and the public IP resource name. */
  function publicIp(values, node) {
    const mode = resolve(values, 'publicIpMode');
    if (mode === 'create') return { mode, name: `${resolve(values, `node${node}VmName`)}-control` };
    if (mode === 'existing') return { mode, name: resolve(values, `node${node}PublicIpName`) };
    return { mode: 'none', name: '' };
  }

  /* Resource group a node's VM, NIC, NSG and public IP are deployed to. */
  function nodeResourceGroup(values, node) {
    return (node === 1 && resolve(values, 'node1ResourceGroup')) || resolve(values, 'resourceGroup');
  }

  /* True when node1 is deployed to a different resource group than node0 (names are case-insensitive). */
  function separateResourceGroups(values) {
    return nodeResourceGroup(values, 0).toLowerCase() !== nodeResourceGroup(values, 1).toLowerCase();
  }

  /* Resource group of a resource shared by both nodes (VNet, identity) as written to a node's params file:
   * '' lets the template use the node's own resource group, which is only right when that is node0's. */
  function sharedResourceGroup(values, id, node) {
    const set = resolve(values, id);
    if (set) return set;
    return node === 1 && separateResourceGroups(values) ? nodeResourceGroup(values, 0) : '';
  }

  function onboardingConfig(values, node) {
    const s = (id) => resolve(values, id);
    const nodeName = `node${node}`;
    const hostName = `${s('conductorName')}-${nodeName}`;
    const cfg = {
      mode: 'conductor',
      name: hostName,
      'node-name': nodeName,
      'cloud-provider': 'azure',
      'ssr-version': s('ssrVersion'),
      'artifactory-user': s('artifactoryUser'),
      'artifactory-password': s('artifactoryToken'),
      'admin-password': s('adminPasswordHash'),
      'root-password': s('rootPasswordHash'),
      't128-password': s('t128PasswordHash'),
      'pdc-key-comment': hostName,
    };
    const dns = splitList(s('dnsServers'));
    if (dns.length) cfg['dns-servers'] = dns;
    const ntp = splitList(s('ntpServers'));
    if (ntp.length) cfg['ntp-servers'] = ntp;

    const overrides = {
      'router-name': s('conductorName'),
      'node-ip': s(node === 0 ? 'node0PrivateIp' : 'node1PrivateIp'),
    };
    if (node === 1) {
      Object.assign(overrides, {
        'ha-peer-ip': s('node0PrivateIp'),
        'ha-peer-name': 'node0',
        'learn-from-ha-peer': true,
        'ha-peer-username': 't128',
        'unsafe-ha-peer-password': s('haPeerPassword'),
      });
    }
    if (s('timezone')) overrides.timezone = s('timezone');
    cfg['initializer-overrides'] = overrides;
    return cfg;
  }

  function cloudInit(values, node) {
    const role = node === 0
      ? 'node0 - primary. Initialized standalone, node1 joins it later.'
      : 'node1 - secondary. Learns the setup from node0 over SSH (learn-from-ha-peer).';
    const json = JSON.stringify(onboardingConfig(values, node), null, 2)
      .split('\n').map((line) => `      ${line}`).join('\n');
    return [
      '#cloud-config',
      `# SSR HA conductor ${role}`,
      '# Pass to the deployment with: --parameters customData=@<this file>',
      'write_files:',
      '  - path: /etc/128T-hardware-bootstrapper/onboarding-config.json',
      '    owner: root:root',
      "    permissions: '0600'",
      '    content: |',
      json,
      '',
    ].join('\n');
  }

  function paramsFile(values, node) {
    const s = (id) => resolve(values, id);
    const self = node === 0 ? 'node0' : 'node1';
    const peer = node === 0 ? 'node1' : 'node0';
    const p = (value) => ({ value });
    const doc = {
      $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#',
      contentVersion: '1.0.0.0',
      parameters: {
        location: p(s('location')),
        instanceName: p(s(`${self}VmName`)),
        instanceSize: p(s('instanceSize')),
        availabilityZone: p(s(`${self}Zone`)),
        availabilitySetName: p(s('availabilitySetName')),
        managedIdentity: p(s('managedIdentity')),
        managedIdentityResourceGroup: p(sharedResourceGroup(values, 'managedIdentityResourceGroup', node)),
        virtualNetworkName: p(s('virtualNetworkName')),
        virtualNetworkResourceGroup: p(sharedResourceGroup(values, 'virtualNetworkResourceGroup', node)),
        controlSubnetName: p(s('controlSubnetName')),
        controlPrivateIp: p(s(`${self}PrivateIp`)),
        haPeerPrivateIp: p(s(`${peer}PrivateIp`)),
        createPublicIp: p(publicIp(values, node).mode === 'create'),
        existingPublicIpName: p(publicIp(values, node).mode === 'existing' ? publicIp(values, node).name : ''),
        existingPublicIpResourceGroup: p(s('publicIpResourceGroup')),
        controlAllowedCidr: p(s('controlAllowedCidr')),
        adminAllowedCidr: p(s('adminAllowedCidr')),
        adminPublicKeyData: p(s('adminPublicKeyData')),
      },
    };
    return `${JSON.stringify(doc, null, 2)}\n`;
  }

  /* Files whose content depends on the inputs. */
  function buildGeneratedFiles(values) {
    return [
      { path: F.mop, content: mopDocument(values) },
      { path: F.p0, content: paramsFile(values, 0) },
      { path: F.p1, content: paramsFile(values, 1) },
      { path: F.c0, content: cloudInit(values, 0) },
      { path: F.c1, content: cloudInit(values, 1) },
    ];
  }

  /* Generated files plus the static files (template, README), in display order. */
  function buildAllFiles(values, staticFiles) {
    const statics = Object.keys(staticFiles || {}).map((path) => ({ path, content: staticFiles[path], isStatic: true }));
    return [...buildGeneratedFiles(values), ...statics]
      .sort((a, b) => fileOrder(a.path) - fileOrder(b.path) || a.path.localeCompare(b.path));
  }

  function fileOrder(path) {
    const order = [F.mop, F.template, F.p0, F.p1, F.c0, F.c1, 'README.md'];
    const i = order.indexOf(path);
    return i === -1 ? order.length : i;
  }

  /* ---------- MOP: single-line PowerShell commands for Azure Cloud Shell ---------- */
  const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

  /* az command line; every option value is PowerShell single-quoted. */
  function az(words, options) {
    const parts = ['az', ...words];
    for (const [flag, ...vals] of options) parts.push(flag, ...vals.map(psq));
    return parts.join(' ');
  }

  const STATUS_SCRIPT = [
    'if systemctl is-active --quiet 128T-hardware-bootstrapper; then echo STATE=BOOTSTRAPPING',
    'elif systemctl is-failed --quiet 128T-hardware-bootstrapper; then echo STATE=FAILED',
    'elif test -f /etc/128technology/global.init && systemctl is-active --quiet 128T; then echo STATE=READY',
    'else echo STATE=INSTALLING; fi',
    'cat /etc/128technology/global.init 2>/dev/null',
    'echo',
  ].join('; ');

  const SSHD_BLOCK_DELETE = "sed -i --follow-symlinks '/^# BEGIN ha-peer$/,/^# END ha-peer$/d' /etc/ssh/sshd_config";

  /* node0 must accept t128's password from node1 and sudo must prompt for it, see the HA doc "Configure Node A". */
  function openPeerScript(password, node1Ip) {
    return [
      'set -e',
      `echo ${shq(`t128:${password}`)} | chpasswd`,
      'usermod -aG wheel t128',
      'if test -f /etc/sudoers.d/90-cloud-init-users; then mv /etc/sudoers.d/90-cloud-init-users /root/90-cloud-init-users.ha-peer; fi',
      "echo '%wheel ALL=(ALL) ALL' > /etc/sudoers.d/91-ha-peer",
      'chmod 440 /etc/sudoers.d/91-ha-peer',
      'visudo -cq',
      SSHD_BLOCK_DELETE,
      `printf '%s\\n' '# BEGIN ha-peer' ${shq(`Match User t128 Address ${node1Ip}/32`)} '    PasswordAuthentication yes' '# END ha-peer' >> /etc/ssh/sshd_config`,
      'sshd -t',
      'systemctl reload sshd',
      'if sudo -l -U t128 | grep -q NOPASSWD; then echo ERROR_NOPASSWD_SUDO_REMAINS; else echo HA_PEER_ACCESS_OPEN; fi',
    ].join('; ');
  }

  function closePeerScript(t128Hash) {
    return [
      'set -e',
      SSHD_BLOCK_DELETE,
      'sshd -t',
      'systemctl reload sshd',
      'rm -f /etc/sudoers.d/91-ha-peer',
      'if test -f /root/90-cloud-init-users.ha-peer; then mv /root/90-cloud-init-users.ha-peer /etc/sudoers.d/90-cloud-init-users; fi',
      'visudo -cq',
      `usermod -p ${shq(t128Hash)} t128`,
      'echo HA_PEER_ACCESS_CLOSED',
    ].join('; ');
  }

  /* Ordered MOP steps: [{ title, text, cmd, expect }] */
  function mopSteps(values) {
    const s = (id) => resolve(values, id);
    const rgOf = (n) => ['--resource-group', nodeResourceGroup(values, n)];
    const vm0 = s('node0VmName');
    const vm1 = s('node1VmName');
    const deploy = (n) => az(['deployment', 'group', 'create'], [
      rgOf(n), ['--name', `ssr-conductor-node${n}`], ['--template-file', F.template],
      ['--parameters', `@conductor-node${n}-params.json`, `customData=@conductor-node${n}-cloud-init.txt`],
      ['--query', 'properties.provisioningState'], ['--output', 'tsv'],
    ]);
    const runCommand = (n, script) => az(['vm', 'run-command', 'invoke'], [
      rgOf(n), ['--name', n === 0 ? vm0 : vm1], ['--command-id', 'RunShellScript'], ['--scripts', script],
      ['--query', 'value[0].message'], ['--output', 'tsv'],
    ]);
    return [
      {
        title: 'Confirm the Azure subscription',
        text: `Make sure Cloud Shell targets the subscription that contains the resource group${separateResourceGroups(values) ? 's' : ''}. If not, run \`az account set --subscription <name-or-id>\`.`,
        cmd: az(['account', 'show'], [['--query', '[name, id]'], ['--output', 'tsv']]),
        expect: 'The target subscription name and ID.',
      },
      {
        title: 'Accept the marketplace image terms',
        text: 'Required once per subscription for the BYOL image. Safe to repeat.',
        cmd: az(['vm', 'image', 'terms', 'accept'], [['--publisher', 'juniper-networks'],
          ['--offer', 'session-smart-networking-payg'], ['--plan', 'session-smart-networking-public-gen2-byol'],
          ['--query', 'accepted'], ['--output', 'tsv']]),
        expect: '`true`',
      },
      {
        title: 'Deploy node0',
        text: `Creates ${vm0} from the template. The cloud-init file is passed as the template's \`customData\` parameter.`,
        cmd: deploy(0),
        expect: '`Succeeded` (after a few minutes). SSR installation then continues on the VM.',
      },
      {
        title: 'Wait until node0 is initialized',
        text: 'The VM downloads and installs SSR, initializes the conductor and reboots. This usually takes 20-40 minutes. Repeat the command every 5 minutes. Do not continue until the state is READY.',
        cmd: runCommand(0, STATUS_SCRIPT),
        expect: '`STATE=READY`, followed by the global.init content listing conductor `node0`. `STATE=FAILED` means the bootstrapper failed (see Troubleshooting).',
      },
      {
        title: 'Open temporary HA peer access on node0',
        text: `Lets node1 (${s('node1PrivateIp')}) log in to node0 as t128 with the temporary HA peer password, which the initializer on node1 needs to learn the conductor setup from node0. It sets the temporary password, makes sudo prompt for it, and allows SSH password login for t128 only from node1. This automates "Configure Node A" in the Conductor HA for Cloud Deployments documentation. Step 8 reverts it.`,
        cmd: runCommand(0, openPeerScript(s('haPeerPassword'), s('node1PrivateIp'))),
        expect: '`HA_PEER_ACCESS_OPEN`',
      },
      {
        title: 'Deploy node1',
        text: `Creates ${vm1}. Its initializer joins node0 using the temporary credentials.`,
        cmd: deploy(1),
        expect: '`Succeeded`',
      },
      {
        title: 'Wait until node1 has joined',
        text: 'Repeat every 5 minutes (20-40 minutes). Do not continue until node1 is READY and its global.init lists both conductors.',
        cmd: runCommand(1, STATUS_SCRIPT),
        expect: '`STATE=READY`, and global.init lists `node0` and `node1` with their IP addresses.',
      },
      {
        title: 'Close HA peer access on node0',
        text: 'Removes the SSH password exception, restores the original sudo rules, and resets t128 to the password from the onboarding configuration. The temporary password stops working.',
        cmd: runCommand(0, closePeerScript(s('t128PasswordHash'))),
        expect: '`HA_PEER_ACCESS_CLOSED`',
      },
      {
        title: 'Restart node0',
        text: 'node0 must restart to recognize node1.',
        cmd: az(['vm', 'restart'], [rgOf(0), ['--name', vm0]]),
        expect: 'The command returns without error.',
      },
      {
        title: 'Verify the HA pair',
        text: 'Wait about 5 minutes, then check node0. Finally log in to the PCLI on either node (SSH as t128, then `sudo su - admin`) and run `show system connectivity`: both nodes must be connected.',
        cmd: runCommand(0, STATUS_SCRIPT),
        expect: '`STATE=READY`, and global.init lists `node0` and `node1`.',
      },
    ];
  }

  function rollbackCommand(values, node) {
    const s = (id) => resolve(values, id);
    const rg = ['--resource-group', nodeResourceGroup(values, node)];
    const vm = s(`node${node}VmName`);
    const cmds = [
      az(['vm', 'delete'], [rg, ['--name', vm], ['--yes']]),
      az(['network', 'nic', 'delete'], [rg, ['--name', `${vm}-control`]]),
      az(['network', 'nsg', 'delete'], [rg, ['--name', `${vm}-control`]]),
      az(['disk', 'delete'], [rg, ['--name', vm], ['--yes']]),
    ];
    if (publicIp(values, node).mode === 'create') cmds.push(az(['network', 'public-ip', 'delete'], [rg, ['--name', `${vm}-control`]]));
    return cmds.join('; ');
  }

  /* ---------- Network topology (README "What gets built" and MOP) ---------- */
  function placement(values, node) {
    const zone = resolve(values, `node${node}Zone`);
    if (zone) return `zone ${zone}`;
    const set = resolve(values, 'availabilitySetName');
    return set ? `availability set ${set}` : '';
  }

  /* Box drawn with `width` total columns; `up`/`down` put a connector on the top/bottom border at that column. */
  function diagramBox(title, lines, width, { up = -1, down = -1 } = {}) {
    const border = (left, right, joint, pos, label) => {
      const fill = (label ? `─ ${label} ` : '').padEnd(width - 2, '─').split('');
      if (pos > 0) fill[pos - 1] = joint;
      return `${left}${fill.join('')}${right}`;
    };
    return [
      border('┌', '┐', '┴', up, title),
      ...lines.map((l) => `│ ${l.padEnd(width - 4)} │`),
      border('└', '┘', '┬', down, ''),
    ];
  }

  /* Monospace (box-drawing) diagram of both nodes: Azure VM + NIC + NSG outside, SSR node and ge-0-0 inside. */
  function topologyDiagram(values) {
    const s = (id) => resolve(values, id);
    const mode = publicIp(values, 0).mode;
    const router = s('conductorName');
    const cols = [0, 1].map((n) => {
      const vm = s(`node${n}VmName`);
      const ip = s(`node${n}PrivateIp`);
      const where = placement(values, n);
      const pip = mode === 'none' ? ['no public IP'] : [`public IP (${mode === 'create' ? 'new' : 'existing'})`, `  ${publicIp(values, n).name}`];
      return {
        title: `Azure VM ${vm}`,
        ssr: [where || 'no zone or availability set', `SSR router ${router}, node${n}`, `hostname ${router}-node${n}`, '', `ge-0-0  ${ip}`, '  conductor address + HA sync'],
        nic: [`NIC ${vm}-control`, `  static IP ${ip}`, '  tag SSR-ROLE=MGMT', `NSG ${vm}-control`, ...pip],
      };
    });
    const LINK = 4;
    const GAP = 14;
    const linkLabel = ' NIC appears in the VM as ge-0-0';
    const width = Math.max(
      ...cols.flatMap((c) => [c.title.length + 6, ...[...c.ssr, ...c.nic].map((l) => l.length + 4)]),
      LINK + 1 + linkLabel.length,
    );
    const total = width * 2 + GAP;
    const haRow = 1 + cols[0].ssr.indexOf('');
    const gap = (i) => {
      if (i === haRow) return 'HA sync'.padStart(11).padEnd(GAP);
      if (i === haRow + 1) return `<${'─'.repeat(GAP - 2)}>`;
      return ' '.repeat(GAP);
    };
    const pair = (a, b, g = () => ' '.repeat(GAP)) => a.map((l, i) => `${l}${g(i)}${b[i]}`.trimEnd());
    const vms = cols.map((c) => diagramBox(c.title, c.ssr, width, { down: LINK }));
    const nics = cols.map((c) => diagramBox('', c.nic, width, { up: LINK, down: LINK }));
    const link = `${' '.repeat(LINK)}│${linkLabel}`.padEnd(width);
    const bus = '═'.repeat(total).split('');
    bus[LINK] = '╧';
    bus[width + GAP + LINK] = '╧';

    const vnetRg = sharedResourceGroup(values, 'virtualNetworkResourceGroup', 1);
    const created = `VM, NIC, NSG${mode === 'create' ? ', public IP' : ''}`;
    const rgText = separateResourceGroups(values)
      ? `node0 in resource group ${nodeResourceGroup(values, 0)}, node1 in resource group ${nodeResourceGroup(values, 1)}`
      : `Resource group ${s('resourceGroup')}`;
    const nsgRows = [
      ['routers', 'TCP 930, 933, 4505-4506', `from ${s('controlAllowedCidr')}`],
      ['admins', 'TCP 22, 443', `from ${s('adminAllowedCidr')}`],
      ['HA peer', 'all ports', 'from the other node\'s IP only (/32)'],
    ];
    return [
      `${rgText} (${s('location')}) - created per node: ${created}`,
      '',
      ...pair(vms[0], vms[1], gap),
      pair([link], [link])[0],
      ...pair(nics[0], nics[1]),
      bus.join(''),
      ` Subnet ${s('controlSubnetName')} in VNet ${s('virtualNetworkName')} (existing${vnetRg ? `, resource group ${vnetRg}` : ''})`,
      ` Inbound, allowed by each node's NSG${mode === 'none' ? '' : ' (private and public IP)'}:`,
      ...nsgRows.map(([who, ports, from]) => `   ${who.padEnd(9)}${ports.padEnd(25)}${from}`),
      ' Outbound: HTTPS to the SSR software repository (install and upgrades)',
    ].join('\n');
  }

  /* Diagram plus a table mapping each SSR (inside the VM) term to its Azure (outside the VM) resource. */
  function topologyMarkdown(values) {
    const s = (id) => resolve(values, id);
    const FENCE = '```';
    const c = (x) => `\`${x}\``;
    const vm = [s('node0VmName'), s('node1VmName')];
    const ip = [s('node0PrivateIp'), s('node1PrivateIp')];
    const nic = vm.map((v) => c(`${v}-control`)).join(' / ');
    const router = s('conductorName');
    const where = [placement(values, 0), placement(values, 1)];
    const whereText = where[0] || where[1] ? ` (${where.join(' / ')})` : '';
    const rgDetail = separateResourceGroups(values)
      ? ` node0 is in resource group ${c(nodeResourceGroup(values, 0))}, node1 in ${c(nodeResourceGroup(values, 1))}.`
      : '';
    const pip = [publicIp(values, 0), publicIp(values, 1)];
    const pipNames = pip.map((p) => c(p.name)).join(' / ');
    const pipRg = s('publicIpResourceGroup');
    const publicIpRow = {
      none: ['No public IP', 'Routers and administrators reach the nodes on their private IPs (VNet peering, VPN or ExpressRoute).'],
      create: [`New public IPs ${pipNames}`, 'Created by the template: Standard SKU, static, in the node\'s zone, one per NIC. Use them when routers or administrators reach the conductor over the Internet; the NSG rules apply to them too.'],
      existing: [`Existing public IPs ${pipNames}${pipRg ? ` (resource group ${c(pipRg)})` : ''}`, 'Already created; the template only attaches them to the NICs, and the MOP rollback does not delete them. Use them when routers or administrators reach the conductor over the Internet; the NSG rules apply to them too.'],
    }[pip[0].mode];
    return [
      'Each SSR conductor node is one Azure VM with a **single NIC** in the same existing subnet. Inside the VM, SSR sees that NIC as `ge-0-0`, and it carries both the conductor (control) traffic from managed routers and the HA sync between the two nodes. No separate HA sync or fabric NIC is deployed.',
      '',
      `${FENCE}text`,
      topologyDiagram(values),
      FENCE,
      '',
      '| SSR term (inside the VM) | Azure resource (outside the VM) | Details |',
      '|---|---|---|',
      `| Conductor router ${c(router)}, nodes ${c('node0')} / ${c('node1')} | VMs ${c(vm[0])} / ${c(vm[1])}${whereText} | One VM per node from the BYOL marketplace image, deployed from the same ARM template.${rgDetail} Hostnames ${c(`${router}-node0`)} / ${c(`${router}-node1`)}. |`,
      `| Interface ${c('ge-0-0')} | NICs ${nic} | The only NIC on each VM, so SSR names it ${c('ge-0-0')} (NICs become ${c('ge-0-0')}, ${c('ge-0-1')}, ... in attach order). Tagged ${c('SSR-ROLE=MGMT')}; accelerated networking and IP forwarding enabled. |`,
      `| Node IP (${c('node-ip')}), the conductor address | Static private IPs ${c(ip[0])} / ${c(ip[1])} | The NIC IP (template ${c('controlPrivateIp')}) and the cloud-init ${c('node-ip')} are the same value. Managed routers connect to both addresses. |`,
      `| HA sync interface (node1 ${c('ha-peer-ip')} = ${c(ip[0])}) | Same NIC and IP; no HA sync NIC | Conductor-to-conductor sync runs over ${c('ge-0-0')} through the subnet. Hardware conductors use a dedicated HA sync NIC on ${c('169.254.253.x')} (${c('clustered')}), which an Azure VNet cannot carry. |`,
      `| HA fabric interface | None | Conductors do not forward session traffic, so there is no fabric link. |`,
      `| - | NSGs ${nic}, one per NIC | Inbound allow: TCP 22, 443 from ${c(s('adminAllowedCidr'))}; TCP 930 (router control), 933 (secure onboarding), 4505-4506 (salt) from ${c(s('controlAllowedCidr'))}; all traffic from the HA peer's IP. |`,
      `| - | ${publicIpRow[0]} | ${publicIpRow[1]} |`,
      `| - | VNet ${c(s('virtualNetworkName'))}, subnet ${c(s('controlSubnetName'))} | Existing, not created by the template. Needs outbound HTTPS for the SSR download and must allow traffic between the two nodes. |`,
    ].join('\n');
  }

  function mopDocument(values) {
    const s = (id) => resolve(values, id);
    const FENCE = '```';
    const customer = s('mopCustomer');
    const zone = (n) => s(`node${n}Zone`) || (s('availabilitySetName') ? `availability set ${s('availabilitySetName')}` : 'none');
    const pip = [publicIp(values, 0), publicIp(values, 1)];
    const pipNames = pip.map((p) => `\`${p.name}\``).join(' / ');
    const split = separateResourceGroups(values);
    const rg = [nodeResourceGroup(values, 0), nodeResourceGroup(values, 1)];
    const pipWhere = s('publicIpResourceGroup')
      ? `in resource group \`${s('publicIpResourceGroup')}\``
      : (split ? 'in their node\'s resource group' : `in resource group \`${rg[0]}\``);
    const publicIpText = {
      none: 'no',
      create: `new, one per node (${pipNames})`,
      existing: `existing, attached to node0 / node1: ${pipNames} ${pipWhere}`,
    }[pip[0].mode];
    const prereqPublicIp = pip[0].mode === 'existing'
      ? [`- The existing public IPs ${pipNames} are ${pipWhere} and region \`${s('location')}\`, are Standard SKU with static allocation, are not attached to any other resource, and are zone-redundant or in their node's zone. Your account needs \`Microsoft.Network/publicIPAddresses/join/action\` on them.`]
      : [];
    const out = [
      `# MOP: Highly available SSR conductor in Azure${customer ? ` - ${customer}` : ''}`,
      '',
      'This procedure deploys a two-node highly available Session Smart conductor (node0 and node1) in Azure from the BYOL marketplace image, using an ARM template, a parameters file per node and a cloud-init file per node. Allow 60-90 minutes, most of it waiting for the SSR software to install on each node.',
      '',
      '## Environment',
      '',
      '| Item | Value |',
      '|---|---|',
      split ? `| Resource groups | node0 \`${rg[0]}\`, node1 \`${rg[1]}\` |` : `| Resource group | \`${rg[0]}\` |`,
      `| Region | \`${s('location')}\` |`,
      `| VNet / subnet | \`${s('virtualNetworkName')}\` / \`${s('controlSubnetName')}\` |`,
      `| node0 | VM \`${s('node0VmName')}\`, IP \`${s('node0PrivateIp')}\`, zone ${zone(0)} |`,
      `| node1 | VM \`${s('node1VmName')}\`, IP \`${s('node1PrivateIp')}\`, zone ${zone(1)} |`,
      `| Public IPs | ${publicIpText} |`,
      `| Conductor name | \`${s('conductorName')}\` |`,
      `| SSR version | \`${s('ssrVersion')}\` |`,
      '',
      '## Network topology',
      '',
      topologyMarkdown(values),
      '',
      '## Prerequisites',
      '',
      `- The resource group${split ? 's' : ''}, VNet, subnet and managed identity listed above exist. The two node IPs are free in the subnet.`,
      '- The subnet has outbound HTTPS access to download the SSR software, and allows traffic between the two nodes.',
      ...prereqPublicIp,
      `- Azure Cloud Shell (PowerShell) with permission to deploy to ${split ? 'both resource groups' : 'the resource group'} and to run \`az vm run-command\`.`,
      '- The five deployment files below, uploaded to one Cloud Shell directory (Manage files > Upload). Run every command from that directory.',
      '',
      '## Files',
      '',
      '| File | Purpose |',
      '|---|---|',
      `| \`${F.template}\` | ARM template for one conductor node (deployed once per node) |`,
      `| \`${F.p0}\` / \`${F.p1}\` | Template parameters for node0 / node1 |`,
      `| \`${F.c0}\` / \`${F.c1}\` | cloud-init with the SSR onboarding configuration for node0 / node1 |`,
      '',
      '> The cloud-init files contain the repository token and a temporary password. Keep them private and delete them from Cloud Shell when the procedure is complete.',
      '',
      '## Procedure',
      '',
      'Each command is a single line for Azure Cloud Shell (PowerShell). Copy the whole line.',
    ];
    mopSteps(values).forEach((step, i) => {
      out.push('', `### Step ${i + 1}: ${step.title}`, '', step.text, '', `${FENCE}powershell`, step.cmd, FENCE, '', `Expected: ${step.expect}`);
    });
    out.push(
      '',
      '## Rollback',
      '',
      'To remove a node (for example to retry it), delete its resources. Re-run the procedure from that node\'s deploy step. If node1 is removed after it joined, also remove it from node0 before redeploying.' +
        (pip[0].mode === 'existing' ? ' The existing public IPs are detached when the NIC is deleted and are kept for the redeploy.' : ''),
      '',
      `${FENCE}powershell`,
      rollbackCommand(values, 1),
      rollbackCommand(values, 0),
      FENCE,
      '',
      '## Troubleshooting',
      '',
      '- Bootstrapper log (download, install, onboarding): `/var/log/128T-hardware-bootstrapper/128T-hardware-bootstrapper.log`',
      '- Initializer log (conductor and HA setup): `/var/log/128technology/initializer.log`',
      '- cloud-init log: `/var/log/cloud-init-output.log`',
      '- Read a log without SSH: replace the `--scripts` value of the status command with `\'tail -n 50 <log file>\'`.',
      '- `ERROR_NOPASSWD_SUDO_REMAINS` in step 5: another sudoers rule gives t128 passwordless sudo. Remove it, then repeat step 5.',
      '- node1 fails with `Invalid credentials` in the initializer log: step 5 was not completed before node1 initialized, or the subnet blocks traffic between the nodes. Fix the cause, roll back node1, then repeat steps 5-7.',
      '',
    );
    return out.join('\n');
  }

  /* Returns { fieldErrors: {id: msg}, warnings: [msg], missing: [id] } */
  function validate(values) {
    const fieldErrors = {};
    const missing = [];
    const warnings = [];
    for (const f of FIELDS) {
      if (f.kind === 'checkbox' || f.kind === 'select' || !isActive(values, f.id)) continue;
      const v = f.kind === 'secret' ? String(values[f.id] ?? '') : String(values[f.id] ?? '').trim();
      if (v === '') {
        if (f.required) missing.push(f.id);
        continue;
      }
      const err = f.validate ? f.validate(v) : null;
      if (err) fieldErrors[f.id] = err;
    }
    const v = (id) => String(values[id] ?? '').trim();
    if (v('node0PrivateIp') && v('node0PrivateIp') === v('node1PrivateIp')) {
      fieldErrors.node1PrivateIp = 'node0 and node1 need different IPs';
    }
    if (v('node0VmName') && v('node0VmName') === v('node1VmName')) {
      fieldErrors.node1VmName = 'node0 and node1 need different VM names';
    }
    if (v('availabilitySetName') && (v('node0Zone') || v('node1Zone'))) {
      fieldErrors.availabilitySetName = 'Availability set and availability zones are mutually exclusive; clear the node zones to use a set';
    }
    if (v('availabilitySetName') && v('node1ResourceGroup') && v('node1ResourceGroup').toLowerCase() !== v('resourceGroup').toLowerCase()) {
      fieldErrors.node1ResourceGroup = 'An availability set needs both VMs in its resource group; clear this or the availability set';
    }
    if (v('node0Zone') && v('node0Zone') === v('node1Zone')) {
      warnings.push('node0 and node1 are in the same availability zone; use different zones for zone redundancy.');
    }
    if (!v('availabilitySetName') && !v('node0Zone') && !v('node1Zone')) {
      warnings.push('No availability zones or availability set selected: the nodes have no placement redundancy.');
    }
    if (v('adminAllowedCidr') === '0.0.0.0/0' && v('publicIpMode') !== 'none') {
      warnings.push('SSH/HTTPS is open to the Internet (admin CIDR 0.0.0.0/0 with public IPs). Consider restricting it.');
    }
    if (v('publicIpMode') === 'existing' && v('node0PublicIpName') && v('node0PublicIpName') === v('node1PublicIpName')) {
      fieldErrors.node1PublicIpName = 'node0 and node1 need different public IPs';
    }
    const hashes = ['adminPasswordHash', 'rootPasswordHash', 't128PasswordHash'].map(v).filter(Boolean);
    if (hashes.length === 3 && new Set(hashes).size === 1) {
      warnings.push('admin, root and t128 use the identical hash; consider separate passwords.');
    }
    return { fieldErrors, warnings, missing };
  }

  /* ---------- ZIP (store only) ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* entries: [{path, content(string)}] -> Uint8Array zip */
  function makeZip(entries, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.path);
      const data = enc.encode(e.content);
      const crc = crc32(data);
      const mode = /\.(sh|ps1)$/.test(e.path) ? 0o100755 : 0o100644;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), name, data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, (3 << 8) | 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(38, (mode << 16) >>> 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
    let pos = 0;
    for (const c of parts) { out.set(c, pos); pos += c.length; }
    return out;
  }

  /* ---------- SHA-512 (32-bit hi/lo arithmetic) ---------- */
  function isqrtBig(n) {
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    for (;;) {
      const y = (x + n / x) >> 1n;
      if (y >= x) {
        while (x * x > n) x -= 1n;
        while ((x + 1n) * (x + 1n) <= n) x += 1n;
        return x;
      }
      x = y;
    }
  }

  function icbrtBig(n) {
    let x = BigInt(Math.floor(Math.cbrt(Number(n)))) + 1n;
    for (;;) {
      const y = (2n * x + n / (x * x)) / 3n;
      if (y >= x) {
        while (x * x * x > n) x -= 1n;
        while ((x + 1n) * (x + 1n) * (x + 1n) <= n) x += 1n;
        return x;
      }
      x = y;
    }
  }

  /* Constants are derived (fractional parts of square / cube roots of primes) rather than typed in. */
  const SHA512_CONST = (() => {
    const primes = [];
    for (let n = 2; primes.length < 80; n++) {
      if (primes.every((p) => n % p !== 0)) primes.push(n);
    }
    const mask = (1n << 64n) - 1n;
    const split = (v) => [Number(v >> 32n) | 0, Number(v & 0xffffffffn) | 0];
    const H = new Int32Array(16);
    primes.slice(0, 8).forEach((p, i) => {
      const [hi, lo] = split(isqrtBig(BigInt(p) << 128n) & mask);
      H[2 * i] = hi;
      H[2 * i + 1] = lo;
    });
    const K = new Int32Array(160);
    primes.forEach((p, i) => {
      const [hi, lo] = split(icbrtBig(BigInt(p) << 192n) & mask);
      K[2 * i] = hi;
      K[2 * i + 1] = lo;
    });
    return { H, K };
  })();

  function sha512(msg) {
    const { H, K } = SHA512_CONST;
    const len = msg.length;
    const total = Math.ceil((len + 17) / 128) * 128;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);

    const h = Int32Array.from(H);
    const w = new Int32Array(160);
    for (let off = 0; off < total; off += 128) {
      for (let i = 0; i < 32; i++) w[i] = dv.getInt32(off + i * 4);
      for (let i = 16; i < 80; i++) {
        let xh = w[2 * (i - 15)], xl = w[2 * (i - 15) + 1];
        const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
        const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
        xh = w[2 * (i - 2)]; xl = w[2 * (i - 2) + 1];
        const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
        const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
        const lo = (w[2 * (i - 16) + 1] >>> 0) + (s0l >>> 0) + (w[2 * (i - 7) + 1] >>> 0) + (s1l >>> 0);
        w[2 * i] = w[2 * (i - 16)] + s0h + w[2 * (i - 7)] + s1h + Math.floor(lo / 0x100000000);
        w[2 * i + 1] = lo;
      }

      let ah = h[0], al = h[1], bh = h[2], bl = h[3], ch = h[4], cl = h[5], dh = h[6], dl = h[7];
      let eh = h[8], el = h[9], fh = h[10], fl = h[11], gh = h[12], gl = h[13], hh = h[14], hl = h[15];
      for (let i = 0; i < 80; i++) {
        const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
        const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
        const chh = (eh & fh) ^ (~eh & gh);
        const chl = (el & fl) ^ (~el & gl);
        const t1lo = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K[2 * i + 1] >>> 0) + (w[2 * i + 1] >>> 0);
        const t1h = (hh + S1h + chh + K[2 * i] + w[2 * i] + Math.floor(t1lo / 0x100000000)) | 0;
        const t1l = t1lo | 0;
        const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
        const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
        const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
        const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
        const t2lo = (S0l >>> 0) + (majl >>> 0);
        const t2h = (S0h + majh + Math.floor(t2lo / 0x100000000)) | 0;
        const t2l = t2lo | 0;
        hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
        const elo = (dl >>> 0) + (t1l >>> 0);
        eh = (dh + t1h + Math.floor(elo / 0x100000000)) | 0; el = elo | 0;
        dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
        const alo = (t1l >>> 0) + (t2l >>> 0);
        ah = (t1h + t2h + Math.floor(alo / 0x100000000)) | 0; al = alo | 0;
      }
      const v = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
      for (let i = 0; i < 16; i += 2) {
        const lo = (h[i + 1] >>> 0) + (v[i + 1] >>> 0);
        h[i] = h[i] + v[i] + Math.floor(lo / 0x100000000);
        h[i + 1] = lo;
      }
    }
    const out = new Uint8Array(64);
    const odv = new DataView(out.buffer);
    for (let i = 0; i < 16; i++) odv.setInt32(i * 4, h[i]);
    return out;
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    return out;
  }

  function repeatTo(src, length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = src[i % src.length];
    return out;
  }

  const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

  /* SHA-512 crypt ($6$), default 5000 rounds, as produced by `openssl passwd -6` / mkpasswd. */
  function sha512Crypt(password, salt) {
    const enc = new TextEncoder();
    const P = enc.encode(password);
    const S = enc.encode(String(salt).slice(0, 16));
    if (!/^[A-Za-z0-9./]{1,16}$/.test(String(salt).slice(0, 16))) throw new Error('invalid salt');
    const rounds = 5000;

    const B = sha512(concat([P, S, P]));
    const aParts = [P, S, repeatTo(B, P.length)];
    for (let n = P.length; n > 0; n >>= 1) aParts.push(n & 1 ? B : P);
    const A = sha512(concat(aParts));

    const DP = sha512(concat(Array(P.length).fill(P)));
    const Pseq = P.length ? repeatTo(DP, P.length) : new Uint8Array(0);
    const DS = sha512(concat(Array(16 + A[0]).fill(S)));
    const Sseq = repeatTo(DS, S.length);

    let C = A;
    for (let i = 0; i < rounds; i++) {
      const parts = [];
      parts.push(i & 1 ? Pseq : C);
      if (i % 3) parts.push(Sseq);
      if (i % 7) parts.push(Pseq);
      parts.push(i & 1 ? C : Pseq);
      C = sha512(concat(parts));
    }

    let out = '';
    const b64 = (b2, b1, b0, n) => {
      let w = (b2 << 16) | (b1 << 8) | b0;
      for (let i = 0; i < n; i++) { out += ITOA64[w & 0x3f]; w >>>= 6; }
    };
    const order = [
      [0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26], [6, 27, 48],
      [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32], [12, 33, 54], [34, 55, 13],
      [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38], [18, 39, 60], [40, 61, 19], [62, 20, 41],
    ];
    for (const [x, y, z] of order) b64(C[x], C[y], C[z], 4);
    b64(0, 0, C[63], 2);
    return `$6$${String(salt).slice(0, 16)}$${out}`;
  }

  function randomSalt(length = 16) {
    const bytes = new Uint8Array(length);
    (root.crypto || globalThis.crypto).getRandomValues(bytes);
    return Array.from(bytes, (b) => ITOA64[b & 0x3f]).join('');
  }

  root.SsrHa = {
    FILES: F,
    SECTIONS,
    FIELDS,
    FIELD_BY_ID,
    defaults,
    isActive,
    upgradeValues,
    resolve,
    nodeResourceGroup,
    separateResourceGroups,
    onboardingConfig,
    buildGeneratedFiles,
    buildAllFiles,
    mopSteps,
    mopDocument,
    topologyDiagram,
    topologyMarkdown,
    validate,
    makeZip,
    crc32,
    sha512,
    sha512Crypt,
    randomSalt,
    splitList,
  };
})(typeof window !== 'undefined' ? window : globalThis);
