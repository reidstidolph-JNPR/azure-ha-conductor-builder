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
  /* SSR node name that is also safe in a hostname (<conductor name>-<node name>): no underscores. */
  const NODE_NAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

  const re = (regex, message) => (v) => (regex.test(v) ? null : message);
  /* node1's own region, VNet, subnet and identity only apply while it has its own resource group. */
  const NODE1_OWN_RG = { field: 'node1ResourceGroup', set: true };

  const SECTIONS = [
    { id: 'azure', title: 'Azure deployment (both nodes; node1 can override some below)' },
    { id: 'nodes', title: 'Conductor nodes' },
    { id: 'node1rg', title: 'node1 in its own resource group (optional)' },
    { id: 'ssr', title: 'SSR software and conductor identity' },
    { id: 'creds', title: 'Account passwords (SHA-512 crypt hashes)' },
    { id: 'ha', title: 'HA peer bootstrap credentials (temporary)' },
    { id: 'optional', title: 'Optional settings' },
  ];

  /* kind: text | textarea | select | checkbox | secret | hash
   * ph: placeholder written into files when a required value is empty
   * when: { field, equals } or { field, set: true } - the field only applies (and is only required) when another
   *   field has that value, or is not empty
   * fallback: (values) => value used when the field is left empty (shown as its placeholder in the form)
   * select options: strings, or { value, label } */
  const FIELDS = [
    {
      id: 'resourceGroup', section: 'azure', label: 'Resource group', kind: 'text', required: true,
      ph: '<input-your-resource-group>',
      help: 'Existing resource group the conductor VMs, NICs, NSGs (and optional public IPs) are created in. node1 uses it too unless "node1 resource group" is set.',
      usedIn: [`${F.mop}: --resource-group of node0 az commands (and node1's by default)`, `${F.p1}: virtualNetworkResourceGroup, managedIdentityResourceGroup (when node1 has its own resource group but uses node0's VNet or identity)`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'location', section: 'azure', label: 'Azure region', kind: 'text', required: true,
      ph: '<input-your-azure-region>',
      help: 'Region of the VNet, lowercase with no spaces (e.g. eastus, westeurope). Also node1\'s region unless node1 has its own.',
      usedIn: [`${F.p0}: location`, `${F.p1}: location`],
      validate: re(/^[a-z0-9]+$/, 'Use the region short name, e.g. eastus'),
    },
    {
      id: 'virtualNetworkName', section: 'azure', label: 'VNet name', kind: 'text', required: true,
      ph: '<input-your-vnet-name>',
      help: 'Existing VNet the conductor nodes are attached to (node1 too, unless it has its own).',
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
      help: 'Existing subnet for the control interface of node0, and of node1 unless it has its own. Routers must reach it; both nodes must reach each other.',
      usedIn: [`${F.p0}: controlSubnetName`, `${F.p1}: controlSubnetName`],
      validate: re(AZ_NAME, 'Not a valid subnet name'),
    },
    {
      id: 'managedIdentity', section: 'azure', label: 'User assigned managed identity', kind: 'text', required: true,
      ph: '<input-your-managed-identity-name>',
      help: 'Identity attached to the VMs (node1 too, unless it has its own). Needs Microsoft.Compute/virtualMachines/read, Microsoft.Network/networkInterfaces/read and Microsoft.Network/virtualNetworks/read.',
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
      usedIn: [`${F.p0}: createPublicIp, existingPublicIpName`, `${F.p1}: createPublicIp, existingPublicIpName`, `${F.mop}: SSH target, optional conductor address lookup`],
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
      help: 'Public key (ssh-rsa, at least 2048-bit) used to log in as t128 on both nodes. The MOP runs every node step over SSH with the matching private key.',
      usedIn: [`${F.p0}: adminPublicKeyData`, `${F.p1}: adminPublicKeyData`],
      validate: re(/^(ssh-rsa|ssh-ed25519) [A-Za-z0-9+/]+=*( .*)?$/, 'Paste a single-line OpenSSH public key (ssh-rsa AAAA...)'),
    },

    {
      id: 'node0Name', section: 'nodes', label: 'node0 SSR node name', kind: 'text', def: 'node0',
      help: 'Name of the first conductor node inside SSR: the PCLI prompt, the configuration, show system connectivity and global.init. Letters, digits and hyphens. The node\'s hostname and asset ID become <conductor name>-<node name>. The MOP keeps calling this node "node0".',
      usedIn: [`${F.c0}: initializer-overrides.node-name, name, pdc-key-comment`, `${F.c1}: initializer-overrides.ha-peer-name`, `${F.mop}: PCLI node name and asset ID`],
      validate: re(NODE_NAME, 'Letters, digits and hyphens only, starting and ending with a letter or digit (max 63)'),
    },
    {
      id: 'node1Name', section: 'nodes', label: 'node1 SSR node name', kind: 'text', def: 'node1',
      help: 'Name of the second conductor node inside SSR, with the same rules as node0\'s. Must differ from node0\'s. The MOP keeps calling this node "node1".',
      usedIn: [`${F.c1}: initializer-overrides.node-name, name, pdc-key-comment`, `${F.mop}: PCLI node name and asset ID`],
      validate: re(NODE_NAME, 'Letters, digits and hyphens only, starting and ending with a letter or digit (max 63)'),
    },
    {
      id: 'node0VmName', section: 'nodes', label: 'node0 VM name', kind: 'text', def: 'conductor-node0',
      help: 'Azure VM name of the primary node (also prefixes its NIC/NSG/disk names).',
      usedIn: [`${F.p0}: instanceName`, `${F.mop}: rollback commands`],
      validate: re(VM_NAME, 'Not a valid Azure VM name'),
    },
    {
      id: 'node0PrivateIp', section: 'nodes', label: 'node0 private IP', kind: 'text', required: true,
      ph: '<input-node0-private-ip>',
      help: 'Free static IP in the control subnet for node0. It is node0\'s conductor address and its HA address.',
      usedIn: [`${F.p0}: controlPrivateIp`, `${F.p1}: haPeerPrivateIp`, `${F.c0}: initializer-overrides.node-ip`, `${F.c1}: initializer-overrides.ha-peer-ip`, `${F.mop}: SSH target, optional conductor-address`],
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
      usedIn: [`${F.p1}: instanceName`, `${F.mop}: rollback commands`],
      validate: re(VM_NAME, 'Not a valid Azure VM name'),
    },
    {
      id: 'node1PrivateIp', section: 'nodes', label: 'node1 private IP', kind: 'text', required: true,
      ph: '<input-node1-private-ip>',
      help: 'Free static IP in the control subnet for node1.',
      usedIn: [`${F.p1}: controlPrivateIp`, `${F.p0}: haPeerPrivateIp`, `${F.c1}: initializer-overrides.node-ip`, `${F.mop}: SSH target, open and close HA peer access (sshd Match Address), optional conductor-address`],
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
      id: 'node1ResourceGroup', section: 'node1rg', label: 'node1 resource group', kind: 'text', def: '',
      help: 'Existing resource group for node1\'s VM, NIC, NSG (and public IP) when it differs from node0\'s. Empty = same resource group as node0. When set, node1 can also use its own region, VNet, subnet and managed identity below.',
      usedIn: [`${F.mop}: --resource-group of node1 az commands`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'node1Location', section: 'node1rg', label: 'node1 Azure region', kind: 'text', def: '',
      when: NODE1_OWN_RG,
      fallback: (values) => resolve(values, 'location'),
      help: 'Region of node1\'s VNet when it differs from node0\'s. Empty = node0\'s region. A different region needs its own VNet.',
      usedIn: [`${F.p1}: location`],
      validate: re(/^[a-z0-9]+$/, 'Use the region short name, e.g. westus2'),
    },
    {
      id: 'node1VirtualNetworkName', section: 'node1rg', label: 'node1 VNet name', kind: 'text', def: '',
      when: NODE1_OWN_RG,
      fallback: (values) => resolve(values, 'virtualNetworkName'),
      help: 'Existing VNet for node1 when it differs from node0\'s. Empty = node0\'s VNet. Separate VNets must be peered (or otherwise connected) so the nodes reach each other on their private IPs.',
      usedIn: [`${F.p1}: virtualNetworkName`],
      validate: re(AZ_NAME, 'Not a valid VNet name'),
    },
    {
      id: 'node1VirtualNetworkResourceGroup', section: 'node1rg', label: 'node1 VNet resource group', kind: 'text', def: '',
      when: NODE1_OWN_RG,
      fallback: (values) => linkedResourceGroup(values, 1, 'virtualNetwork', true),
      help: 'Resource group of node1\'s VNet. Empty = node1\'s resource group when node1 VNet name is set, otherwise the resource group of node0\'s VNet.',
      usedIn: [`${F.p1}: virtualNetworkResourceGroup`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },
    {
      id: 'node1ControlSubnetName', section: 'node1rg', label: 'node1 control subnet name', kind: 'text', def: '',
      when: NODE1_OWN_RG,
      fallback: (values) => resolve(values, 'controlSubnetName'),
      help: 'Existing subnet in node1\'s VNet for node1\'s control interface. Empty = same subnet name as node0.',
      usedIn: [`${F.p1}: controlSubnetName`],
      validate: re(AZ_NAME, 'Not a valid subnet name'),
    },
    {
      id: 'node1ManagedIdentity', section: 'node1rg', label: 'node1 user assigned managed identity', kind: 'text', def: '',
      when: NODE1_OWN_RG,
      fallback: (values) => resolve(values, 'managedIdentity'),
      help: 'Identity attached to node1 when it differs from node0\'s, with the same read permissions. Empty = node0\'s identity.',
      usedIn: [`${F.p1}: managedIdentity`],
      validate: re(AZ_NAME, 'Not a valid identity name'),
    },
    {
      id: 'node1ManagedIdentityResourceGroup', section: 'node1rg', label: 'node1 managed identity resource group', kind: 'text', def: '',
      when: NODE1_OWN_RG,
      fallback: (values) => linkedResourceGroup(values, 1, 'managedIdentity', true),
      help: 'Resource group of node1\'s identity. Empty = node1\'s resource group when node1 managed identity is set, otherwise the resource group of node0\'s identity.',
      usedIn: [`${F.p1}: managedIdentityResourceGroup`],
      validate: re(AZ_NAME, 'Not a valid resource group name'),
    },

    {
      id: 'conductorName', section: 'ssr', label: 'Conductor (router) name', kind: 'text', def: 'Conductor',
      help: 'Name of the conductor router. Each node also gets the hostname <name>-<node name> (by default <name>-node0 / <name>-node1), which is also its asset ID (salt minion ID) in the PCLI.',
      usedIn: [`${F.c0}: initializer-overrides.router-name, name, pdc-key-comment`, `${F.c1}: initializer-overrides.router-name, name, pdc-key-comment`, `${F.mop}: PCLI router name and asset IDs`],
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
      usedIn: [`${F.c0}: t128-password`, `${F.c1}: t128-password`, `${F.mop}: close HA peer access (restores t128's password)`],
      validate: re(SHA512_CRYPT, 'Must be a SHA-512 crypt hash: $6$<salt>$<86 chars>'),
    },

    {
      id: 'haPeerPassword', section: 'ha', label: 'Temporary HA peer password', kind: 'secret', required: true, secret: true,
      ph: '<input-temporary-ha-peer-password>',
      help: 'Clear-text, single-use password for t128 on node0. Valid only while node1 joins, between the MOP steps that open and close HA peer access. Use a unique, strong value.',
      usedIn: [`${F.c1}: initializer-overrides.unsafe-ha-peer-password`, `${F.mop}: open HA peer access (temporary t128 password on node0)`],
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
    if (!w) return true;
    return w.set ? String(values[w.field] ?? '').trim() !== '' : values[w.field] === w.equals;
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

  /* SSR node name of the first (0) or second (1) conductor node; an empty input falls back to node0 / node1. */
  function ssrNodeName(values, node) {
    return resolve(values, `node${node}Name`) || `node${node}`;
  }

  /* Hostname of a node, which the bootstrapper also uses as its salt minion ID, i.e. its asset ID. */
  function nodeHostname(values, node) {
    return `${resolve(values, 'conductorName')}-${ssrNodeName(values, node)}`;
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

  /* Azure resource names are case-insensitive. */
  const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  /* True when node1 is deployed to a different resource group than node0. */
  function separateResourceGroups(values) {
    return !sameName(nodeResourceGroup(values, 0), nodeResourceGroup(values, 1));
  }

  /* node1 inputs that replace node0's value for node1 (only while node1 has its own resource group). */
  const NODE1_OVERRIDE = {
    location: 'node1Location',
    virtualNetworkName: 'node1VirtualNetworkName',
    virtualNetworkResourceGroup: 'node1VirtualNetworkResourceGroup',
    controlSubnetName: 'node1ControlSubnetName',
    managedIdentity: 'node1ManagedIdentity',
    managedIdentityResourceGroup: 'node1ManagedIdentityResourceGroup',
  };

  /* A node's region, VNet name, subnet name or identity name: node1's own value, or node0's. */
  function nodeSetting(values, node, id) {
    return (node === 1 && resolve(values, NODE1_OVERRIDE[id])) || resolve(values, id);
  }

  /* Effective resource group of a node's VNet (kind 'virtualNetwork') or managed identity ('managedIdentity').
   * Empty node1 value: node1's resource group if node1 names its own VNet/identity, else wherever node0's one is.
   * ignoreOverride computes that default without node1's own resource group input (for its placeholder). */
  function linkedResourceGroup(values, node, kind, ignoreOverride = false) {
    const rgId = `${kind}ResourceGroup`;
    if (node === 0) return resolve(values, rgId) || nodeResourceGroup(values, 0);
    const own = ignoreOverride ? '' : resolve(values, NODE1_OVERRIDE[rgId]);
    if (own) return own;
    const nameId = kind === 'virtualNetwork' ? 'virtualNetworkName' : 'managedIdentity';
    return resolve(values, NODE1_OVERRIDE[nameId]) ? nodeResourceGroup(values, 1) : linkedResourceGroup(values, 0, kind);
  }

  /* Template *ResourceGroup parameter of a node: '' means the node's own (deployment) resource group. */
  function linkedResourceGroupParam(values, node, kind) {
    if (node === 0 || !resolve(values, 'node1ResourceGroup')) return resolve(values, `${kind}ResourceGroup`);
    const rg = linkedResourceGroup(values, 1, kind);
    return sameName(rg, nodeResourceGroup(values, 1)) ? '' : rg;
  }

  function separateRegions(values) {
    return !sameName(nodeSetting(values, 0, 'location'), nodeSetting(values, 1, 'location'));
  }

  function separateVnets(values) {
    return !sameName(nodeSetting(values, 0, 'virtualNetworkName'), nodeSetting(values, 1, 'virtualNetworkName'))
      || !sameName(linkedResourceGroup(values, 0, 'virtualNetwork'), linkedResourceGroup(values, 1, 'virtualNetwork'));
  }

  function separateSubnets(values) {
    return separateVnets(values) || !sameName(nodeSetting(values, 0, 'controlSubnetName'), nodeSetting(values, 1, 'controlSubnetName'));
  }

  function separateIdentities(values) {
    return !sameName(nodeSetting(values, 0, 'managedIdentity'), nodeSetting(values, 1, 'managedIdentity'))
      || !sameName(linkedResourceGroup(values, 0, 'managedIdentity'), linkedResourceGroup(values, 1, 'managedIdentity'));
  }

  /* Placeholder text of a field with a fallback, for the form. */
  function fallbackValue(values, id) {
    const f = FIELD_BY_ID[id];
    return f.fallback ? f.fallback(values) : null;
  }

  function onboardingConfig(values, node) {
    const s = (id) => resolve(values, id);
    const hostName = nodeHostname(values, node);
    const cfg = {
      mode: 'conductor',
      name: hostName,
      // The bootstrapper's schema only accepts node0 / node1 here; the SSR node name is set in initializer-overrides.
      'node-name': `node${node}`,
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
      'node-name': ssrNodeName(values, node),
      'node-ip': s(node === 0 ? 'node0PrivateIp' : 'node1PrivateIp'),
    };
    if (node === 1) {
      Object.assign(overrides, {
        'ha-peer-ip': s('node0PrivateIp'),
        'ha-peer-name': ssrNodeName(values, 0),
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
      `# SSR node name: ${ssrNodeName(values, node)} (initializer-overrides.node-name; the top-level node-name must stay node${node})`,
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
        location: p(nodeSetting(values, node, 'location')),
        instanceName: p(s(`${self}VmName`)),
        instanceSize: p(s('instanceSize')),
        availabilityZone: p(s(`${self}Zone`)),
        availabilitySetName: p(s('availabilitySetName')),
        managedIdentity: p(nodeSetting(values, node, 'managedIdentity')),
        managedIdentityResourceGroup: p(linkedResourceGroupParam(values, node, 'managedIdentity')),
        virtualNetworkName: p(nodeSetting(values, node, 'virtualNetworkName')),
        virtualNetworkResourceGroup: p(linkedResourceGroupParam(values, node, 'virtualNetwork')),
        controlSubnetName: p(nodeSetting(values, node, 'controlSubnetName')),
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

  /* ---------- MOP ----------
   * Azure operations run as single-line PowerShell commands in Azure Cloud Shell. Everything on a node runs in an SSH
   * root shell on that node: the node reboots during initialization, and az vm run-command (one command at a time per
   * VM) easily gets stuck behind a command sent while the VM was rebooting. */
  const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

  /* az command line; every option value is PowerShell single-quoted. */
  function az(words, options) {
    const parts = ['az', ...words];
    for (const [flag, ...vals] of options) parts.push(flag, ...vals.map(psq));
    return parts.join(' ');
  }

  /* Where a MOP step runs: the label shown in the MOP and the web app, and the code block language. */
  const WHERE = {
    cloudshell: { label: 'Azure Cloud Shell (PowerShell)', lang: 'powershell' },
    terminal: { label: 'Your terminal (SSH client)', lang: 'bash' },
    node0: { label: 'node0 root shell', lang: 'bash' },
    node1: { label: 'node1 root shell', lang: 'bash' },
    pcli0: { label: 'node0 PCLI (admin)', lang: 'pcli' },
  };

  /* Prints the initialization phase once a minute until READY or FAILED, then the conductors in global.init. */
  const STATUS_BLOCK = [
    'while :; do',
    "  if systemctl is-failed --quiet 128T-hardware-bootstrapper; then phase='FAILED: the bootstrapper stopped with an error, see Troubleshooting'",
    "  elif ! rpm -q --quiet 128T; then phase='INSTALLING: downloading and installing SSR, the VM reboots when done'",
    "  elif systemctl is-active --quiet 128T-hardware-bootstrapper; then phase='INITIALIZING: setting up the conductor, the VM reboots when done'",
    "  elif [ -f /etc/128technology/global.init ] && systemctl is-active --quiet 128T; then phase='READY'",
    "  else phase='STARTING: waiting for the bootstrapper or SSR to start'; fi",
    '  echo "$(date +%H:%M:%S)  $(uptime -p)  ${phase}"',
    '  case "$phase" in READY|FAILED*) break ;; esac',
    '  sleep 60',
    'done',
    "python3 -c 'import json; c = json.load(open(\"/etc/128technology/global.init\"))[\"init\"].get(\"conductor\", {}); print(\"conductors in global.init:\", \", \".join(\"%s=%s\" % (n, v[\"host\"]) for n, v in sorted(c.items())))' 2>/dev/null",
    "pending=$(t128-salt-key --no-color -l unaccepted 2>/dev/null | sed 1d | paste -sd ' ' -)",
    'echo "pending assets (not yet accepted): ${pending:-none}"',
  ].join('\n');

  const SSHD_BLOCK_DELETE = "sed -i --follow-symlinks '/^# BEGIN ha-peer$/,/^# END ha-peer$/d' /etc/ssh/sshd_config";
  /* grep reads all of sshd's output (no -q), so pipefail cannot trip on SIGPIPE. */
  const sshdPasswordAuth = (ip) => `sshd -T -C user=t128,host=node1,addr=${ip} | grep -x 'passwordauthentication yes' >/dev/null`;

  /* Script run with bash -e from a quoted here-document: nothing in it is expanded by the interactive shell, and an
   * error stops the script without closing the root shell. */
  function shellScript(delimiter, lines) {
    return [`bash -euo pipefail <<'${delimiter}'`, ...lines, delimiter].join('\n');
  }

  /* node0 must accept t128's password from node1, and sudo must prompt for it: node1's initializer opens its SFTP
   * session with `sudo --stdin`, which breaks if sudo does not ask. See the HA doc "Configure Node A".
   * The zz-ha-peer rule sorts after every other sudoers.d file (cloud-init's 90-cloud-init-users, waagent, ...), and
   * sudo applies the last matching rule. */
  function openPeerBlock(password, node1Ip) {
    return shellScript('HA_PEER_OPEN', [
      `printf '%s\\n' ${shq(`t128:${password}`)} | chpasswd`,
      "printf '%s\\n' 't128 ALL=(ALL) ALL' > /etc/sudoers.d/zz-ha-peer",
      'chmod 440 /etc/sudoers.d/zz-ha-peer',
      'visudo -cq',
      SSHD_BLOCK_DELETE,
      `printf '%s\\n' '# BEGIN ha-peer' ${shq(`Match User t128 Address ${node1Ip}/32`)} '    PasswordAuthentication yes' '# END ha-peer' >> /etc/ssh/sshd_config`,
      'sshd -t',
      'systemctl reload sshd',
      "if su - t128 -c 'sudo -k; sudo -n true' >/dev/null 2>&1; then echo 'ERROR: sudo still lets t128 run commands without a password'; exit 1; fi",
      `${sshdPasswordAuth(node1Ip)} || { echo 'ERROR: sshd does not accept a password for t128 from node1'; exit 1; }`,
      'echo HA_PEER_ACCESS_OPEN',
    ]);
  }

  function closePeerBlock(t128Hash, node1Ip) {
    return shellScript('HA_PEER_CLOSE', [
      SSHD_BLOCK_DELETE,
      'sshd -t',
      'systemctl reload sshd',
      'rm -f /etc/sudoers.d/zz-ha-peer',
      'visudo -cq',
      `usermod -p ${shq(t128Hash)} t128`,
      `if ${sshdPasswordAuth(node1Ip)}; then echo 'WARNING: another sshd setting still accepts passwords for t128, see Troubleshooting'; fi`,
      'echo HA_PEER_ACCESS_CLOSED',
    ]);
  }

  /* Ordered MOP steps: [{ title, where, text, cmd, expect }] */
  function mopSteps(values) {
    const s = (id) => resolve(values, id);
    const rgOf = (n) => ['--resource-group', nodeResourceGroup(values, n)];
    const vm = [s('node0VmName'), s('node1VmName')];
    const ip = [s('node0PrivateIp'), s('node1PrivateIp')];
    const hasPublicIp = publicIp(values, 0).mode !== 'none';
    const router = s('conductorName');
    /* The salt minion ID, and so the asset ID, is the hostname the bootstrapper sets: <router name>-<node name>. */
    const name = [ssrNodeName(values, 0), ssrNodeName(values, 1)];
    const asset = [nodeHostname(values, 0), nodeHostname(values, 1)];
    const deploy = (n) => az(['deployment', 'group', 'create'], [
      rgOf(n), ['--name', `ssr-conductor-node${n}`], ['--template-file', F.template],
      ['--parameters', `@conductor-node${n}-params.json`, `customData=@conductor-node${n}-cloud-init.txt`],
      ['--query', '[properties.provisioningState, properties.outputs.SSHLogin.value]'], ['--output', 'tsv'],
    ]);
    const steps = [];
    const step = (where, title, text, cmd, expect, optional = false) => steps.push({ where, title, text, cmd, expect, optional });
    /* Cross-reference to another step, resolved to its number once all steps exist. */
    const ref = (title) => `{{step:${title}}}`;
    const connect = (n, deployTitle) => step('terminal', `Connect to node${n}`,
      `Open an SSH session to ${vm[n]} and become root. Keep this session for every "node${n} root shell" step. SSH usually answers 2-5 minutes after step ${ref(deployTitle)}; if it refuses or times out, wait a minute and retry. `
        + (hasPublicIp
          ? `Use the public IP printed by step ${ref(deployTitle)}, or the private IP ${ip[n]} if your terminal can reach it.`
          : `Your terminal must reach the private IP ${ip[n]} (VNet peering, VPN, ExpressRoute or a jump host in the VNet).`)
        + ' If the private key that matches the SSH public key in the parameters files is not your SSH client\'s default key or loaded in ssh-agent, add `-i <private key file>`.'
        + (n === 0 ? '' : ' Keep the node0 session open too.'),
      [`ssh t128@${hasPublicIp ? `<node${n}-public-ip>` : ip[n]}`, 'sudo -i'].join('\n'),
      `A root prompt on ${vm[n]}. The hostname is still \`${vm[n]}\` until the conductor is initialized.`);

    step('cloudshell', 'Confirm the Azure subscription',
      `Make sure Cloud Shell targets the subscription that contains the resource group${separateResourceGroups(values) ? 's' : ''}. If not, run \`az account set --subscription <name-or-id>\`.`,
      az(['account', 'show'], [['--query', '[name, id]'], ['--output', 'tsv']]),
      'The target subscription name and ID.');
    step('cloudshell', 'Accept the marketplace image terms',
      'Required once per subscription for the BYOL image. Safe to repeat.',
      az(['vm', 'image', 'terms', 'accept'], [['--publisher', 'juniper-networks'],
        ['--offer', 'session-smart-networking-payg'], ['--plan', 'session-smart-networking-public-gen2-byol'],
        ['--query', 'accepted'], ['--output', 'tsv']]),
      '`true`');
    /* What happens after a deploy command returns, and how to watch it. */
    const afterDeploy = (n) => `The deployment takes up to about 2 minutes. The node then installs and initializes SSR on its own and reboots twice, which typically takes 5-15 minutes (longer if the software download is slow). To watch the reboot cycle, attach to the VM's serial console: in the Azure portal open ${vm[n]} and select Help > Serial console, or run \`az serial-console connect --resource-group '${nodeResourceGroup(values, n)}' --name '${vm[n]}'\` in Cloud Shell (boot diagnostics, which the serial console needs, is enabled by the template).`;
    step('cloudshell', 'Deploy node0',
      `Creates ${vm[0]} from the template. The cloud-init file is passed as the template's \`customData\` parameter. ${afterDeploy(0)}`,
      deploy(0),
      '`Succeeded` and the SSH command for node0, after up to about 2 minutes.');
    connect(0, 'Deploy node0');
    step('node0', 'Wait until node0 is initialized',
      'Paste once and leave it running: it prints the phase every minute (see "Timing and what to expect"). The VM reboots by itself at least twice, which closes your SSH session. That is expected: wait 2-3 minutes, reconnect with step '
        + `${ref('Connect to node0')}, and paste this command again. Do not restart or redeploy the VM, and do not use \`az vm run-command\`, while it is INSTALLING, STARTING or INITIALIZING.`,
      STATUS_BLOCK,
      `\`READY\`, then \`conductors in global.init: ${name[0]}=${ip[0]}\` and the pending assets: \`${asset[0]}\` (node0's own asset, accepted in the next step; it can take a few minutes after \`READY\` to appear). \`FAILED\` means the bootstrapper stopped with an error (see Troubleshooting).`);
    const pcliIntro = `In the node0 root shell, enter these commands one at a time, pressing Enter after each one. \`su admin\` opens the PCLI (the prompt becomes \`admin@${name[0]}.${router}#\`; if it shows a different router name, use that name in the commands), and \`quit\` returns to the root shell.`;
    /* A PCLI step's commands: opened with su admin from the root shell, closed with quit. */
    const pcli = (...lines) => ['su admin', ...lines, 'quit'].join('\n');
    step('pcli0', 'Accept node0\'s asset',
      `${pcliIntro} Setting node0's asset ID in the configuration accepts node0's pending asset: its salt minion key is accepted automatically as soon as the asset ID is configured. The status command in step ${ref('Wait until node0 is initialized')} listed the pending asset; if its ID differs from \`${asset[0]}\`, use that ID. \`commit force\` skips the confirmation prompt; validation still runs.`,
      pcli(`config authority router ${router} node ${name[0]} asset-id ${asset[0]}`, 'commit force', 'show assets'),
      `\`Configuration committed\`. In \`show assets\`, node0 with asset ID \`${asset[0]}\` moves through \`Synchronizing\` to \`Running\` within a few minutes; run \`show assets\` again before \`quit\` to follow it.`);
    step('pcli0', 'Add node1 to the conductor configuration',
      `${pcliIntro} Adds node1 (SSR node \`${name[1]}\`) as the second conductor node of the conductor router, so that node1 finds its own node in the configuration it receives from node0 when it joins. node1 is reported as not connected until then, which is expected.`,
      pcli(`config authority router ${router} node ${name[1]} role conductor`, 'commit force'),
      '`Configuration committed`, then the node0 root shell prompt.');
    step('node0', 'Open temporary HA peer access on node0',
      `Lets node1 (${ip[1]}) log in to node0 as t128 with the temporary HA peer password, which node1's initializer needs to copy the conductor setup from node0. It sets the temporary password, makes sudo ask t128 for it, allows SSH password login for t128 only from node1, and then tests both. This automates "Configure Node A" in the Conductor HA for Cloud Deployments documentation. Paste the whole block. Keep this root shell open: from now on \`sudo -i\` on node0 asks for the temporary password. Step ${ref('Close HA peer access on node0')} reverts it.`,
      openPeerBlock(s('haPeerPassword'), ip[1]),
      '`HA_PEER_ACCESS_OPEN`. If it prints `ERROR: ...` instead, fix that first (see Troubleshooting); do not deploy node1 yet.');
    step('cloudshell', 'Deploy node1',
      `Creates ${vm[1]}. Only run this after step ${ref('Open temporary HA peer access on node0')} printed \`HA_PEER_ACCESS_OPEN\`: node1's initializer logs in to node0 once, and a failed login stops it. ${afterDeploy(1)}`,
      deploy(1),
      '`Succeeded` and the SSH command for node1, after up to about 2 minutes.');
    connect(1, 'Deploy node1');
    step('node1', 'Wait until node1 has joined',
      `The same status command as step ${ref('Wait until node0 is initialized')}, with the same reboots and reconnects. node1 also logs in to node0 to copy the conductor setup.`,
      STATUS_BLOCK,
      `\`READY\`, then \`conductors in global.init: ${name[0]}=${ip[0]}, ${name[1]}=${ip[1]}\`.`);
    step('node0', 'Close HA peer access on node0',
      `Removes the SSH password exception and the sudo rule, and resets t128 to the password from the onboarding configuration. The temporary password stops working. Paste the whole block. If your node0 session was closed since step ${ref('Open temporary HA peer access on node0')} (for example while node1 was joining), reconnect with step ${ref('Connect to node0')}: \`sudo -i\` now asks for t128's password, which at this point is the temporary HA peer password (the \`unsafe-ha-peer-password\` in node1's cloud-init file).`,
      closePeerBlock(s('t128PasswordHash'), ip[1]),
      '`HA_PEER_ACCESS_CLOSED`');
    step('node0', 'Restart node0',
      'node0 must restart to recognize node1. Your SSH session closes.',
      'systemctl reboot',
      'The session closes.');
    step('node0', 'Wait until node0 is back',
      `Wait 2-3 minutes, reconnect to node0 with step ${ref('Connect to node0')}, and run the status command.`,
      STATUS_BLOCK,
      `\`READY\`, \`conductors in global.init: ${name[0]}=${ip[0]}, ${name[1]}=${ip[1]}\`, and \`${asset[1]}\` among the pending assets (it can take a few minutes to appear; it is accepted in the next step either way).`);
    step('pcli0', 'Accept node1\'s asset',
      `${pcliIntro} Setting node1's asset ID accepts node1's pending asset. If the pending asset listed in step ${ref('Wait until node0 is back')} has a different ID than \`${asset[1]}\`, use that ID.`,
      pcli(`config authority router ${router} node ${name[1]} asset-id ${asset[1]}`, 'commit force', 'show assets'),
      `\`Configuration committed\`. In \`show assets\`, node1 with asset ID \`${asset[1]}\` moves through \`Synchronizing\` to \`Running\` within a few minutes.`);
    step('pcli0', 'Verify the HA pair',
      `${pcliIntro} Wait until both assets are \`Running\` (repeat \`show assets\`), then check that the conductor nodes see each other.`,
      pcli('show system connectivity', 'show assets'),
      `\`show system connectivity\` lists ${name[0]} and ${name[1]} as connected, and \`show assets\` shows \`${asset[0]}\` and \`${asset[1]}\` as \`Running\`.`);

    // Optional: conductor addresses for managed routers. Public IPs are only known after deployment.
    if (hasPublicIp) {
      const ips = (n) => az(['vm', 'list-ip-addresses'], [rgOf(n), ['--name', vm[n]],
        ['--query', '[0].virtualMachine.network.[privateIpAddresses[0], publicIpAddresses[0].ipAddress]'], ['--output', 'tsv']]);
      step('cloudshell', 'Look up the conductor addresses',
        'Prints the private and the public IP of each node (node0 first). Note the address the managed routers will use to reach each node: the public IP when routers connect over the Internet, the private IP when they reach the VNet privately (VNet peering, VPN or ExpressRoute).',
        [ips(0), ips(1)].join('\n'),
        `One line per node: the private IP (\`${ip[0]}\`, then \`${ip[1]}\`) and the public IP.`, true);
    }
    const addr = hasPublicIp ? ['<node0-address>', '<node1-address>'] : ip;
    step('pcli0', 'Set the conductor addresses for managed routers',
      `${pcliIntro} Adds both conductor nodes to \`authority conductor-address\`. Managed routers receive this list in their configuration and connect to both conductor nodes, so a router keeps its conductor connection when one node is down. `
        + (hasPublicIp
          ? `Replace \`<node0-address>\` and \`<node1-address>\` with the addresses chosen in step ${ref('Look up the conductor addresses')}. `
          : `The commands use the private IPs, which routers reach through VNet peering, VPN or ExpressRoute; use other addresses (for example a NAT or DNS name) if that is how routers reach the nodes. `)
        + 'Do this before onboarding routers; it can also be done later. It changes the configuration of every managed router, and a conductor address can be an IP address or a DNS name.',
      pcli(`config authority conductor-address ${addr[0]}`, `config authority conductor-address ${addr[1]}`, 'commit force'),
      '`Configuration committed`, then the node0 root shell prompt.', true);
    const numbers = Object.fromEntries(steps.map((st, i) => [st.title, i + 1]));
    const resolveRefs = (text) => text.replace(/\{\{step:([^}]+)\}\}/g, (_, title) => {
      if (!numbers[title]) throw new Error(`unknown MOP step: ${title}`);
      return String(numbers[title]);
    });
    return steps.map((st) => ({ ...st, text: resolveRefs(st.text), expect: resolveRefs(st.expect) }));
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
        ssr: [where || 'no zone or availability set', `SSR router ${router}, node ${ssrNodeName(values, n)}`, `hostname ${nodeHostname(values, n)}`, '', `ge-0-0  ${ip}`, '  conductor address + HA sync'],
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
    const ownVnets = separateVnets(values);
    const ownSubnets = separateSubnets(values);
    const bus = `${'═'.repeat(width)}${ownVnets ? '<── peered ──>' : '═'.repeat(GAP)}${'═'.repeat(width)}`.split('');
    bus[LINK] = '╧';
    bus[width + GAP + LINK] = '╧';

    const created = `VM, NIC, NSG${mode === 'create' ? ', public IP' : ''}`;
    const region = (n) => nodeSetting(values, n, 'location');
    let rgText;
    if (separateResourceGroups(values) || separateRegions(values)) {
      const where = (n) => `node${n} in resource group ${nodeResourceGroup(values, n)}${separateRegions(values) ? ` (${region(n)})` : ''}`;
      rgText = `${where(0)}, ${where(1)}${separateRegions(values) ? '' : ` (${region(0)})`}`;
    } else {
      rgText = `Resource group ${s('resourceGroup')} (${region(0)})`;
    }
    const subnetOf = (n) => `subnet ${nodeSetting(values, n, 'controlSubnetName')} in VNet ${nodeSetting(values, n, 'virtualNetworkName')}`
      + ` (existing, resource group ${linkedResourceGroup(values, n, 'virtualNetwork')})`;
    let subnetLines;
    if (ownSubnets) {
      subnetLines = [` node0: ${subnetOf(0)}`, ` node1: ${subnetOf(1)}`];
      if (ownVnets) subnetLines.push(' The VNets are peered (or otherwise connected) so the nodes reach each other on their private IPs.');
    } else {
      const vnetRg = s('virtualNetworkResourceGroup') || separateResourceGroups(values) ? linkedResourceGroup(values, 0, 'virtualNetwork') : '';
      subnetLines = [` Subnet ${s('controlSubnetName')} in VNet ${s('virtualNetworkName')} (existing${vnetRg ? `, resource group ${vnetRg}` : ''})`];
    }
    const nsgRows = [
      ['routers', 'TCP 930, 933, 4505-4506', `from ${s('controlAllowedCidr')}`],
      ['admins', 'TCP 22, 443', `from ${s('adminAllowedCidr')}`],
      ['HA peer', 'all ports', 'from the other node\'s IP only (/32)'],
    ];
    return [
      `${rgText} - created per node: ${created}`,
      '',
      ...pair(vms[0], vms[1], gap),
      pair([link], [link])[0],
      ...pair(nics[0], nics[1]),
      bus.join(''),
      ...subnetLines,
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
    const regionDetail = separateRegions(values)
      ? ` node0 runs in region ${c(nodeSetting(values, 0, 'location'))}, node1 in ${c(nodeSetting(values, 1, 'location'))}.`
      : '';
    const identityDetail = separateIdentities(values)
      ? ` node0 uses managed identity ${c(nodeSetting(values, 0, 'managedIdentity'))}, node1 ${c(nodeSetting(values, 1, 'managedIdentity'))}.`
      : '';
    const subnetOf = (n) => `subnet ${c(nodeSetting(values, n, 'controlSubnetName'))} in VNet ${c(nodeSetting(values, n, 'virtualNetworkName'))} (resource group ${c(linkedResourceGroup(values, n, 'virtualNetwork'))})`;
    const networkRow = separateSubnets(values)
      ? [`node0: ${subnetOf(0)}; node1: ${subnetOf(1)}`, `Existing, not created by the template. Each subnet needs outbound HTTPS for the SSR download.${separateVnets(values) ? ' The two VNets must be peered (or otherwise connected), and their NSGs and routes must allow traffic between the two node IPs.' : ' Traffic between the two nodes must be allowed.'}`]
      : [`VNet ${c(s('virtualNetworkName'))}, subnet ${c(s('controlSubnetName'))}`, 'Existing, not created by the template. Needs outbound HTTPS for the SSR download and must allow traffic between the two nodes.'];
    const pip = [publicIp(values, 0), publicIp(values, 1)];
    const pipNames = pip.map((p) => c(p.name)).join(' / ');
    const pipRg = s('publicIpResourceGroup');
    const publicIpRow = {
      none: ['No public IP', 'Routers and administrators reach the nodes on their private IPs (VNet peering, VPN or ExpressRoute).'],
      create: [`New public IPs ${pipNames}`, 'Created by the template: Standard SKU, static, in the node\'s zone, one per NIC. Use them when routers or administrators reach the conductor over the Internet; the NSG rules apply to them too.'],
      existing: [`Existing public IPs ${pipNames}${pipRg ? ` (resource group ${c(pipRg)})` : ''}`, 'Already created; the template only attaches them to the NICs, and the MOP rollback does not delete them. Use them when routers or administrators reach the conductor over the Internet; the NSG rules apply to them too.'],
    }[pip[0].mode];
    return [
      `Each SSR conductor node is one Azure VM with a **single NIC** in ${separateSubnets(values) ? 'an existing subnet' : 'the same existing subnet'}. Inside the VM, SSR sees that NIC as \`ge-0-0\`, and it carries both the conductor (control) traffic from managed routers and the HA sync between the two nodes. No separate HA sync or fabric NIC is deployed.`,
      '',
      `${FENCE}text`,
      topologyDiagram(values),
      FENCE,
      '',
      '| SSR term (inside the VM) | Azure resource (outside the VM) | Details |',
      '|---|---|---|',
      `| Conductor router ${c(router)}, nodes ${c(ssrNodeName(values, 0))} / ${c(ssrNodeName(values, 1))} | VMs ${c(vm[0])} / ${c(vm[1])}${whereText} | One VM per node from the BYOL marketplace image, deployed from the same ARM template.${rgDetail}${regionDetail}${identityDetail} Hostnames (also the asset IDs) ${c(nodeHostname(values, 0))} / ${c(nodeHostname(values, 1))}. The MOP calls the nodes node0 and node1 whatever their SSR node names are. |`,
      `| Interface ${c('ge-0-0')} | NICs ${nic} | The only NIC on each VM, so SSR names it ${c('ge-0-0')} (NICs become ${c('ge-0-0')}, ${c('ge-0-1')}, ... in attach order). Tagged ${c('SSR-ROLE=MGMT')}; accelerated networking and IP forwarding enabled. |`,
      `| Node IP (${c('node-ip')}), the conductor address | Static private IPs ${c(ip[0])} / ${c(ip[1])} | The NIC IP (template ${c('controlPrivateIp')}) and the cloud-init ${c('node-ip')} are the same value. Managed routers connect to both addresses. |`,
      `| HA sync interface (node1 ${c('ha-peer-ip')} = ${c(ip[0])}) | Same NIC and IP; no HA sync NIC | Conductor-to-conductor sync runs over ${c('ge-0-0')} through the subnet. Hardware conductors use a dedicated HA sync NIC on ${c('169.254.253.x')} (${c('clustered')}), which an Azure VNet cannot carry. |`,
      `| HA fabric interface | None | Conductors do not forward session traffic, so there is no fabric link. |`,
      `| - | NSGs ${nic}, one per NIC | Inbound allow: TCP 22, 443 from ${c(s('adminAllowedCidr'))}; TCP 930 (router control), 933 (secure onboarding), 4505-4506 (salt) from ${c(s('controlAllowedCidr'))}; all traffic from the HA peer's IP. |`,
      `| - | ${publicIpRow[0]} | ${publicIpRow[1]} |`,
      `| - | ${networkRow[0]} | ${networkRow[1]} |`,
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
      ? [`- The existing public IPs ${pipNames} are ${pipWhere} and ${separateRegions(values) ? 'in their node\'s region' : `region \`${s('location')}\``}, are Standard SKU with static allocation, are not attached to any other resource, and are zone-redundant or in their node's zone. Your account needs \`Microsoft.Network/publicIPAddresses/join/action\` on them.`]
      : [];
    const perNode = (separate, value) => (separate ? `node0 ${value(0)}, node1 ${value(1)}` : value(0));
    const code = (x) => `\`${x}\``;
    const ownVnets = separateVnets(values);
    const ownSubnets = separateSubnets(values);
    const ownIdentities = separateIdentities(values);
    const existText = split || ownSubnets || ownIdentities
      ? `- The resource group${split ? 's' : ''}, VNet${ownVnets ? 's' : ''}, subnet${ownSubnets ? 's' : ''} and managed identit${ownIdentities ? 'ies' : 'y'} listed above exist. Each node IP is free in its node's subnet.`
      : '- The resource group, VNet, subnet and managed identity listed above exist. The two node IPs are free in the subnet.';
    const prereqPeering = ownVnets
      ? [`- The VNets \`${nodeSetting(values, 0, 'virtualNetworkName')}\` and \`${nodeSetting(values, 1, 'virtualNetworkName')}\` are peered (or otherwise connected), and nothing between them blocks traffic between \`${s('node0PrivateIp')}\` and \`${s('node1PrivateIp')}\`.`]
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
      `| Region | ${perNode(separateRegions(values), (n) => code(nodeSetting(values, n, 'location')))} |`,
      `| VNet / subnet | ${perNode(ownSubnets, (n) => `${code(nodeSetting(values, n, 'virtualNetworkName'))} / ${code(nodeSetting(values, n, 'controlSubnetName'))}`)} |`,
      `| Managed identity | ${perNode(ownIdentities, (n) => code(nodeSetting(values, n, 'managedIdentity')))} |`,
      `| node0 | SSR node \`${ssrNodeName(values, 0)}\` (hostname and asset ID \`${nodeHostname(values, 0)}\`), VM \`${s('node0VmName')}\`, IP \`${s('node0PrivateIp')}\`, zone ${zone(0)} |`,
      `| node1 | SSR node \`${ssrNodeName(values, 1)}\` (hostname and asset ID \`${nodeHostname(values, 1)}\`), VM \`${s('node1VmName')}\`, IP \`${s('node1PrivateIp')}\`, zone ${zone(1)} |`,
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
      existText,
      ownSubnets
        ? '- Each subnet has outbound HTTPS access to download the SSR software, and allows traffic between the two nodes.'
        : '- The subnet has outbound HTTPS access to download the SSR software, and allows traffic between the two nodes.',
      ...prereqPeering,
      ...prereqPublicIp,
      `- Azure Cloud Shell (PowerShell) with permission to deploy to ${split ? 'both resource groups' : 'the resource group'}.`,
      '- The five deployment files below, uploaded to one Cloud Shell directory (Manage files > Upload). Run every Cloud Shell command from that directory.',
      `- A terminal with an SSH client and the private key that matches the SSH public key in the parameters files. It must reach the nodes on TCP 22 ${pip[0].mode === 'none' ? `at their private IPs (\`${s('node0PrivateIp')}\`, \`${s('node1PrivateIp')}\`)` : 'at their public IPs, or at their private IPs'}, from an address inside the admin allowed range \`${s('adminAllowedCidr')}\`.`,
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
      '### Where each command runs',
      '',
      'Azure Cloud Shell is only used for Azure operations: deploying the two VMs and, if needed, rolling them back. Everything that happens on a node runs in an SSH session on that node, as root, or in the SSR command line (PCLI) opened from that session. Each step says where it runs:',
      '',
      '| Run in | What it is |',
      '|---|---|',
      `| ${WHERE.cloudshell.label} | \`az\` commands, one per line. Copy the whole block. |`,
      `| ${WHERE.terminal.label} | Opens the SSH session to a node and becomes root with \`sudo -i\`. |`,
      `| ${WHERE.node0.label} / ${WHERE.node1.label} | The root session on that node. Multi-line blocks are pasted as a whole. Keep both sessions open until the end. |`,
      `| ${WHERE.pcli0.label} | The SSR command line on node0, used to accept the conductor assets and add node1 to the configuration. Each PCLI step starts with \`su admin\` in the node0 root shell, which opens the PCLI (the prompt becomes \`admin@${ssrNodeName(values, 0)}.${s('conductorName')}#\`), and ends with \`quit\`, which returns to the root shell. Enter PCLI commands one at a time, pressing Enter after each one. |`,
      '',
      '### Timing and what to expect',
      '',
      'Allow about 60 minutes in total. Each deployment command takes up to about 2 minutes. The node then downloads, installs and initializes SSR by itself and **reboots twice**: once into the newly installed SSR software, and once after the conductor is initialized. This typically takes 5-15 minutes per node, and longer if the software download is slow. Each reboot closes your SSH session with a message such as `Connection to ... closed by remote host`. That is normal and not a failure. To watch the reboot cycle, attach to the VM\'s serial console (Azure portal: the VM > Help > Serial console); the template enables the boot diagnostics it needs.',
      '',
      'The status command prints one line per minute with the time, the uptime (it drops back to a few minutes after each reboot) and the phase:',
      '',
      '| Phase | What the node is doing | Typical duration |',
      '|---|---|---|',
      '| `INSTALLING` | Downloading and installing the SSR software. Ends with the first reboot. | Most of the 5-15 minutes; longer on a slow download |',
      '| `STARTING` | Booting, or waiting for the bootstrapper or SSR to start. | 1-3 minutes after each reboot |',
      '| `INITIALIZING` | Setting up the conductor (on node1: copying the setup from node0). Ends with the second reboot. | A few minutes |',
      '| `READY` | Done. The status command stops and lists the conductors. | - |',
      '| `FAILED` | The bootstrapper stopped with an error. See Troubleshooting. | - |',
      '',
      'While a node is `INSTALLING`, `STARTING` or `INITIALIZING`:',
      '',
      '- **Let it work.** When your session closes, wait 2-3 minutes, reconnect, run `sudo -i`, and paste the status command again.',
      '- **Do not** restart, stop or redeploy the VM.',
      '- **Do not** use `az vm run-command`. Azure runs only one run-command per VM at a time, and a command sent while the VM is rebooting can stay pending for a long time and block every command after it.',
      '- Only act when the status shows `FAILED`, or when the node has not reached `READY` after 60 minutes.',
    ];
    const steps = mopSteps(values);
    const lastRequired = steps.filter((st) => !st.optional).length;
    steps.forEach((step, i) => {
      const where = WHERE[step.where];
      if (step.optional && !steps[i - 1].optional) {
        out.push('', '### Optional: conductor addresses for managed routers', '',
          `The HA conductor is complete after step ${lastRequired}. The following steps tell managed routers to use both conductor nodes. They are optional at this point because the addresses routers use (for example public IPs) may only be known after deployment.`);
      }
      out.push('', `### Step ${i + 1}${step.optional ? ' (optional)' : ''}: ${step.title}`, '', `**Run in:** ${where.label}`, '', step.text, '', `${FENCE}${where.lang}`, step.cmd, FENCE, '', `Expected: ${step.expect}`);
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
      'Run these in the root shell of the affected node.',
      '',
      `${FENCE}bash`,
      '# Which bootstrapper task failed',
      'cat /var/log/128T-hardware-bootstrapper/128T-hardware-bootstrapper.txt',
      '# Download, install and onboarding errors',
      'grep -nE "ERROR|Exiting with|stderr" /var/log/128T-hardware-bootstrapper/128T-hardware-bootstrapper.log | tail -n 30',
      '# Conductor and HA setup errors',
      'grep -iE "error|fail|invalid" /var/log/128technology/initializer.log | tail -n 30',
      '# SSR download progress',
      'journalctl -u ember --no-pager | tail -n 40',
      '# Onboarding configuration not written by cloud-init',
      'tail -n 30 /var/log/cloud-init-output.log',
      FENCE,
      '',
      '- **`INSTALLING` for more than 60 minutes:** check the SSR download progress. Usual causes are a wrong repository user or token, or no outbound HTTPS from the subnet.',
      '- **`FAILED`:** the task table shows which task failed. When the initializer fails, the bootstrapper log reports it as `Error enabling release repo`; the real cause is in the `stderr` part of that line and in the initializer log. On failure, a tech-support bundle is saved at `/var/log/128T-hardware-bootstrapper/hardware-bootstrapper-tech-support.zip`.',
      `- **node1 \`FAILED\` with \`Error initializing SFTP client: EOF during negotiation\` or \`Invalid credentials for user 't128@${s('node0PrivateIp')}'\`:** node1 could not use the temporary HA peer access on node0 (sudo on node0 did not ask t128 for the password, or access was not open). On node0, run the open HA peer access step again until it prints \`HA_PEER_ACCESS_OPEN\`. Then retry on node1 without redeploying it: run \`systemctl start --no-block 128T-hardware-bootstrapper\` and the status command.`,
      '- **`ERROR: sudo still lets t128 run commands without a password`:** a sudoers rule that sorts after `zz-ha-peer` grants t128 passwordless sudo. Find it with `grep -rn NOPASSWD /etc/sudoers /etc/sudoers.d/`, move it aside, and run the step again. Put it back after HA peer access is closed.',
      '- **`ERROR: sshd does not accept a password for t128 from node1`:** another sshd setting overrides the exception. Check `sshd -T -C user=t128,host=node1,addr=' + s('node1PrivateIp') + ' | grep -i authentication`.',
      '- **`WARNING: another sshd setting still accepts passwords for t128`:** find it with `grep -rni passwordauthentication /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ /etc/128technology/ssh/sshd_config.d/` and remove it.',
      `- **An asset stays \`Pending\`, or \`show assets\` shows a configured asset that never connects:** the asset ID in the configuration must equal the node's salt minion ID, which is its hostname (\`${nodeHostname(values, 0)}\` / \`${nodeHostname(values, 1)}\`). In the node0 root shell, \`t128-salt-key -L\` lists the IDs that are waiting (\`Unaccepted Keys\`) and accepted. Set the asset ID in the PCLI to the listed ID and commit again. A pending key that is not accepted within 10 minutes is dropped and sent again by the node, so it can briefly disappear from the list.`,
      '- **SSH refused or timing out:** the node is booting or rebooting; wait 2-3 minutes. If it persists, check that your terminal\'s address is inside the admin allowed range and that nothing else (a subnet NSG, a firewall) blocks TCP 22.',
      `- **No SSH access at all:** as a last resort, read a log from Cloud Shell with \`az vm run-command invoke --resource-group '<resource group>' --name '<vm>' --command-id RunShellScript --scripts 'tail -n 50 <log file>' --query 'value[0].message' --output tsv\`. Send one command at a time, wait for it to return, and never send one while the node is rebooting.`,
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
    if (v('node0Name') && v('node0Name').toLowerCase() === v('node1Name').toLowerCase()) {
      fieldErrors.node1Name = 'node0 and node1 need different SSR node names';
    }
    for (const n of [0, 1]) {
      const host = nodeHostname(values, n);
      if (!fieldErrors[`node${n}Name`] && host.length > 63) {
        fieldErrors[`node${n}Name`] = `Hostname ${host} is longer than 63 characters; shorten the node or conductor name`;
      }
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
    if (v('node1ResourceGroup') && v('node1Location') && separateRegions(values) && !separateVnets(values)) {
      fieldErrors.node1VirtualNetworkName = 'node1 is in another region, so it needs a VNet in that region';
    }
    if (separateVnets(values)) {
      warnings.push('node0 and node1 are in different VNets: peer them (or otherwise connect them) so the nodes reach each other on their private IPs.');
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
    ssrNodeName,
    nodeHostname,
    separateResourceGroups,
    nodeSetting,
    linkedResourceGroup,
    fallbackValue,
    onboardingConfig,
    buildGeneratedFiles,
    buildAllFiles,
    mopSteps,
    WHERE,
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
