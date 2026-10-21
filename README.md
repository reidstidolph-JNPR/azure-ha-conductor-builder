# Highly Available SSR Conductor on Azure (BYOL, ARM template + cloud-init)

Hand-off kit for deploying a **two-node highly available Session Smart conductor** (node0 + node1) in Azure from the BYOL marketplace image. The customer receives a MOP and five files, and runs a short series of single-line Azure CLI commands from Azure Cloud Shell. No scripts or tooling beyond the Azure CLI are required.

References:
- [Installing a BYOL Conductor in Azure - Cloud-init Onboarding](https://docs.128technology.com/docs/intro_installation_byol_azure_conductor#cloud-init-onboarding-1)
- [Conductor High Availability for Cloud Deployments](https://docs.128technology.com/docs/intro_initialize_HA_conductor)
- [Initialize Your Device - Advanced Workflows (initialize a conductor)](https://docs.128technology.com/docs/initialize_u-iso_adv_workflow/#initialize-a-conductor)

## What gets built

The network topology below is what the MOP deploys, described both in SSR terms (inside each VM) and in Azure terms (the resources around it). The customized MOP repeats this section with the real names and addresses so the customer gets it at hand-off.

<!-- TOPOLOGY:BEGIN -->
Each SSR conductor node is one Azure VM with a **single NIC** in the same existing subnet. Inside the VM, SSR sees that NIC as `ge-0-0`, and it carries both the conductor (control) traffic from managed routers and the HA sync between the two nodes. No separate HA sync or fabric NIC is deployed.

```text
Resource group <input-your-resource-group> (<input-your-azure-region>) - created per node: VM, NIC, NSG

┌─ Azure VM conductor-node0 ───────────┐              ┌─ Azure VM conductor-node1 ───────────┐
│ zone 1                               │              │ zone 2                               │
│ SSR router Conductor, node node0     │              │ SSR router Conductor, node node1     │
│ hostname Conductor-node0             │              │ hostname Conductor-node1             │
│                                      │    HA sync   │                                      │
│ ge-0-0  <input-node0-private-ip>     │<────────────>│ ge-0-0  <input-node1-private-ip>     │
│   conductor address + HA sync        │              │   conductor address + HA sync        │
└───┬──────────────────────────────────┘              └───┬──────────────────────────────────┘
    │ NIC appears in the VM as ge-0-0                     │ NIC appears in the VM as ge-0-0
┌───┴──────────────────────────────────┐              ┌───┴──────────────────────────────────┐
│ NIC conductor-node0-control          │              │ NIC conductor-node1-control          │
│   static IP <input-node0-private-ip> │              │   static IP <input-node1-private-ip> │
│   tag SSR-ROLE=MGMT                  │              │   tag SSR-ROLE=MGMT                  │
│ NSG conductor-node0-control          │              │ NSG conductor-node1-control          │
│ no public IP                         │              │ no public IP                         │
└───┬──────────────────────────────────┘              └───┬──────────────────────────────────┘
════╧═════════════════════════════════════════════════════╧═══════════════════════════════════
 Subnet <input-your-subnet-name> in VNet <input-your-vnet-name> (existing)
 Inbound, allowed by each node's NSG:
   routers  TCP 930, 933, 4505-4506  from 0.0.0.0/0
   admins   TCP 22, 443              from 0.0.0.0/0
   HA peer  all ports                from the other node's IP only (/32)
 Outbound: HTTPS to the SSR software repository (install and upgrades)
```

| SSR term (inside the VM) | Azure resource (outside the VM) | Details |
|---|---|---|
| Conductor router `Conductor`, nodes `node0` / `node1` | VMs `conductor-node0` / `conductor-node1` (zone 1 / zone 2) | One VM per node from the BYOL marketplace image, deployed from the same ARM template. Hostnames (also the asset IDs) `Conductor-node0` / `Conductor-node1`. The MOP calls the nodes node0 and node1 whatever their SSR node names are. |
| Interface `ge-0-0` | NICs `conductor-node0-control` / `conductor-node1-control` | The only NIC on each VM, so SSR names it `ge-0-0` (NICs become `ge-0-0`, `ge-0-1`, ... in attach order). Tagged `SSR-ROLE=MGMT`; accelerated networking and IP forwarding enabled. |
| Node IP (`node-ip`), the conductor address | Static private IPs `<input-node0-private-ip>` / `<input-node1-private-ip>` | The NIC IP (template `controlPrivateIp`) and the cloud-init `node-ip` are the same value. Managed routers connect to both addresses. |
| HA sync interface (node1 `ha-peer-ip` = `<input-node0-private-ip>`) | Same NIC and IP; no HA sync NIC | Conductor-to-conductor sync runs over `ge-0-0` through the subnet. Hardware conductors use a dedicated HA sync NIC on `169.254.253.x` (`clustered`), which an Azure VNet cannot carry. |
| HA fabric interface | None | Conductors do not forward session traffic, so there is no fabric link. |
| - | NSGs `conductor-node0-control` / `conductor-node1-control`, one per NIC | Inbound allow: TCP 22, 443 from `0.0.0.0/0`; TCP 930 (router control), 933 (secure onboarding), 4505-4506 (salt) from `0.0.0.0/0`; all traffic from the HA peer's IP. |
| - | No public IP | Routers and administrators reach the nodes on their private IPs (VNet peering, VPN or ExpressRoute). |
| - | VNet `<input-your-vnet-name>`, subnet `<input-your-subnet-name>` | Existing, not created by the template. Needs outbound HTTPS for the SSR download and must allow traffic between the two nodes. |
<!-- TOPOLOGY:END -->

## Hand-off bundle

| File | Purpose |
|---|---|
| [MOP.md](./MOP.md) | Customer procedure: environment summary, network topology diagram, prerequisites, timing expectations, and every command to run with where to run it and its expected result. |
| [conductor_template.json](./conductor_template.json) | ARM template for **one** conductor node (VM, NIC with static private IP, NSG, and optionally a new public IP or an existing one attached). Deployed once per node. |
| [conductor-node0-params.json](./conductor-node0-params.json) | Template parameters for node0. |
| [conductor-node1-params.json](./conductor-node1-params.json) | Template parameters for node1. |
| [conductor-node0-cloud-init.txt](./conductor-node0-cloud-init.txt) | cloud-init that writes node0's `onboarding-config.json` (first HA node). |
| [conductor-node1-cloud-init.txt](./conductor-node1-cloud-init.txt) | cloud-init that writes node1's `onboarding-config.json` (joins node0 with `learn-from-ha-peer`). |

The files in this directory are samples with `<input-...>` placeholders. To customize them, open [webapp/index.html](./webapp/index.html), a single-page builder for professional services: fill in the form and click **Download all (.zip)** to get the customized MOP and the five files. Alternatively, replace the placeholders by hand using the [inputs reference](#inputs-reference).

## Deploying with cloud-init in one command

`az deployment group create` has no `--custom-data` option (that option belongs to `az vm create`). Instead, the template exposes the cloud-init as a `customData` **secureString** parameter and base64-encodes it into the VM's `osProfile.customData`. The Azure CLI `name=@file` syntax loads a file's content into a parameter, so each node is a single command:

```powershell
az deployment group create --resource-group '<rg>' --name 'ssr-conductor-node0' --template-file 'conductor_template.json' --parameters '@conductor-node0-params.json' 'customData=@conductor-node0-cloud-init.txt'
```

In PowerShell, quote every argument that starts with `@`, otherwise PowerShell treats it as splatting. In Bash the quotes are optional. Because `customData` is a secureString, the cloud-init content (repository token, temporary password) is not stored in the deployment history.

## How the HA pair is formed

In Azure each conductor node has a **single control interface**, which also carries HA sync. The MOP follows the documented cloud HA procedure:

1. **node0** is deployed. On first boot the hardware bootstrapper reads the onboarding config written by cloud-init, installs the requested SSR version, and runs the initializer as a conductor. The `initializer-overrides` set the router name and `node-ip`.
   - **In the node0 PCLI, node0's asset is accepted and node1 is added to the configuration.** After its post-initialization reboot, node0's salt minion (minion ID = hostname = `<router name>-<node0 name>`) registers with node0's own salt master and waits as a pending asset. Configuring `authority router <router name> node <node0 name> asset-id <router name>-<node0 name>` accepts it: the Automated Provisioner accepts a pending key as soon as its asset ID appears in the configuration. In the same PCLI session, `node <node1 name> role conductor` is added, so node1 finds its own node in the configuration it receives when it joins.
2. **node0 is opened to node1 temporarily.** node1's initializer must log in to node0 as `t128` with a password, and its `sudo` must prompt for that password: the initializer opens its SFTP session with `sudo --stdin`, which fails with `EOF during negotiation` when sudo does not ask. Azure images disable password SSH and grant `t128` passwordless sudo (cloud-init's `90-cloud-init-users`, and possibly other files such as the Azure agent's). One block pasted into node0's root shell sets the temporary password, adds `/etc/sudoers.d/zz-ha-peer` (`t128 ALL=(ALL) ALL`, which sorts after every other sudoers file, and sudo applies the last matching rule), allows password SSH for `t128` **only from node1's IP**, and then tests that sudo really asks and sshd really accepts. This automates "Configure Node A" in the HA doc.
3. **node1** is deployed with `learn-from-ha-peer`. Its initializer logs in to node0, exchanges SSH keys, adds node1 to node0's `global.init`, and copies the environment and salt master keys.
4. **node0 is closed again.** A second block removes the SSH exception and `zz-ha-peer`, resets `t128` to the password hash from the onboarding config, and warns if any other setting still accepts passwords. node0 is then restarted so it recognizes node1.
5. **In the node0 PCLI, node1's asset is accepted.** node1's minion (`<router name>-<node1 name>`) is pending once node1 has joined; configuring `node <node1 name> asset-id <router name>-<node1 name>` accepts it. `show system connectivity` and `show assets` (both assets `Running`) confirm the pair.
6. **Optional, in the node0 PCLI: conductor addresses for managed routers.** `authority conductor-address` lists the addresses (up to two) that managed routers use to reach the conductor nodes; routers receive it in their configuration and connect to both nodes. The MOP keeps this as optional steps at the end because the right addresses are often only known after deployment: with public IPs, a Cloud Shell step first prints each node's private and public IP (`az vm list-ip-addresses`), and the PCLI step uses `<node0-address>` / `<node1-address>` placeholders; without public IPs, the PCLI step is prefilled with the private IPs.

Azure Cloud Shell is only used to deploy (and roll back) the VMs. Everything on a node runs in an SSH root shell on that node, opened as soon as the VM answers SSH. Earlier versions of the MOP sent node commands with `az vm run-command`, which proved fragile: Azure runs one run-command per VM at a time, and commands sent while a node was rebooting during initialization stayed pending and blocked the ones after them. Hand-editing those one-liners into shell commands then introduced mistakes.

Progress is watched with a status command in the node's root shell. It prints the phase once a minute (`INSTALLING`, `STARTING`, `INITIALIZING`, `READY` or `FAILED`) together with the uptime, which makes the expected reboots visible. It stops at `READY` or `FAILED` and then lists the conductors in `global.init` and the pending (not yet accepted) assets from `t128-salt-key`, so the asset IDs to accept in the PCLI can be confirmed rather than assumed. The MOP explains up front that each deployment takes up to about 2 minutes, after which the node installs and initializes SSR and reboots twice (typically 5-15 minutes, longer on a slow download), closing the SSH session each time, and that the only right reaction is to reconnect and paste the status command again. The reboot cycle can be watched on the VM's serial console; the template enables the managed boot diagnostics that the serial console requires. PCLI steps start with `su admin` and end with `quit`, and their commands are entered one at a time. node1 must not be deployed before node0 is `READY` and the open step printed `HA_PEER_ACCESS_OPEN`: the initializer checks the peer login once and the bootstrapper does not retry. If node1 still fails at that point, it can be retried without redeploying (`systemctl start --no-block 128T-hardware-bootstrapper`).

### What changed from the original sample files

- The template took no cloud-init: it hard-coded its own `customData` (always `node-name: node0`, no HA). It now takes the cloud-init through the `customData` parameter. The `SSR Version`/artifactory parameters moved into the cloud-init, so each value has a single source.
- `admin-password`, `root-password` and `t128-password` must be **SHA-512 crypt hashes** (`$6$salt$hash`); clear-text values fail the onboarding schema. BYOL also requires `ssr-version` and `cloud-provider: azure`.
- `clustered: true` (from the hardware/USB example) requires a dedicated HASync NIC using `169.254.253.x`, which is not usable in an Azure VNet. In Azure, HA is configured through `initializer-overrides`, which are passed straight to `initialize128t`: `node-ip` on both nodes, plus `ha-peer-ip`, `ha-peer-name`, `learn-from-ha-peer`, `ha-peer-username` and `unsafe-ha-peer-password` on node1. The single Azure NIC is `ge-0-0`, so `interface-name: ge-0-1` is gone too.
- `node-ip` must be known before deployment, so the NIC now uses a **static private IP** (`controlPrivateIp`). Each NSG allows all traffic from the HA peer (`haPeerPrivateIp`).
- Both nodes were pinned to zone `2`. The zone is now a parameter (node0 zone 1, node1 zone 2 by default; leave it empty and use `availabilitySetName` where zones are unavailable).
- node1 can be deployed to its own resource group (`node1 resource group` input); its MOP commands then use that resource group. node1 can then also have its own region, VNet, VNet resource group, control subnet, managed identity and identity resource group; each one left empty uses node0's value, and the web app shows that default as the field's placeholder. An empty node1 VNet or identity resource group means node1's resource group when node1 names its own VNet or identity, and otherwise the resource group of node0's (shared) one, which node1's params file then names explicitly instead of leaving the template default (the deployment resource group). A different region needs a different VNet, and separate VNets must be peered so the nodes reach each other on their private IPs (the MOP lists this as a prerequisite). An availability set cannot be used with separate resource groups, because both VMs must be in the availability set's resource group.
- Each node's `name` (hostname / salt minion ID) is `<router name>-<node name>`, so the nodes do not collide. The real router name is set through `initializer-overrides.router-name`, mirroring the bootstrapper's own hardware HA behavior.
- Smaller fixes: the template's `commandToExecute` was the literal string `['usermod -a -G wheel t128']`, and the extension location now follows the `location` parameter. Optional parameters were added for the VNet / identity resource groups and a public IP: `createPublicIp` creates one, or `existingPublicIpName` (with `existingPublicIpResourceGroup`) attaches a public IP that already exists. An existing public IP must be Standard SKU, static, in the same region, unattached, and zone-redundant or in the node's zone; it is only detached, never deleted, by the MOP rollback.

### Onboarding config differences between the nodes

"node0" and "node1" are the MOP's names for the first and second conductor node. Their SSR node names are inputs (default `node0` / `node1`). The bootstrapper's onboarding schema only accepts `node0` or `node1` as the top-level `node-name`, so that key always keeps the default, and the SSR node name is passed to the initializer as `initializer-overrides.node-name`. The bootstrapper applies `initializer-overrides` last, so the override wins; the initializer writes the name to `global.init`, from which SSR names the node in its configuration. Each node's hostname, and so its asset ID, is `<router name>-<node name>`.

node0:

```json
"initializer-overrides": {
  "router-name": "Conductor",
  "node-name": "<node0 name>",
  "node-ip": "<node0 private IP>"
}
```

node1:

```json
"initializer-overrides": {
  "router-name": "Conductor",
  "node-name": "<node1 name>",
  "node-ip": "<node1 private IP>",
  "ha-peer-ip": "<node0 private IP>",
  "ha-peer-name": "<node0 name>",
  "learn-from-ha-peer": true,
  "ha-peer-username": "t128",
  "unsafe-ha-peer-password": "<temporary password>"
}
```

## Inputs reference

Every input, what it is, and where it goes. The web app shows the same information next to each form field. "File: key" uses dotted paths for the JSON inside the cloud-init files (for example `initializer-overrides.node-ip`).

<!-- INPUTS-TABLE:BEGIN -->
#### Azure deployment (both nodes; node1 can override some below)

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 1 | Resource group | Yes | - | Existing resource group the conductor VMs, NICs, NSGs (and optional public IPs) are created in. node1 uses it too unless "node1 resource group" is set. Placeholder: `<input-your-resource-group>` | `MOP.md: --resource-group of node0 az commands (and node1's by default)`<br>`conductor-node1-params.json: virtualNetworkResourceGroup, managedIdentityResourceGroup (when node1 has its own resource group but uses node0's VNet or identity)` |
| 2 | Azure region | Yes | - | Region of the VNet, lowercase with no spaces (e.g. eastus, westeurope). Also node1's region unless node1 has its own. Placeholder: `<input-your-azure-region>` | `conductor-node0-params.json: location`<br>`conductor-node1-params.json: location` |
| 3 | VNet name | Yes | - | Existing VNet the conductor nodes are attached to (node1 too, unless it has its own). Placeholder: `<input-your-vnet-name>` | `conductor-node0-params.json: virtualNetworkName`<br>`conductor-node1-params.json: virtualNetworkName` |
| 4 | VNet resource group | No | (empty) | Only needed when the VNet lives in a different resource group. Empty = node0's resource group. | `conductor-node0-params.json: virtualNetworkResourceGroup`<br>`conductor-node1-params.json: virtualNetworkResourceGroup` |
| 5 | Control subnet name | Yes | - | Existing subnet for the control interface of node0, and of node1 unless it has its own. Routers must reach it; both nodes must reach each other. Placeholder: `<input-your-subnet-name>` | `conductor-node0-params.json: controlSubnetName`<br>`conductor-node1-params.json: controlSubnetName` |
| 6 | User assigned managed identity | Yes | - | Identity attached to the VMs (node1 too, unless it has its own). Needs Microsoft.Compute/virtualMachines/read, Microsoft.Network/networkInterfaces/read and Microsoft.Network/virtualNetworks/read. Placeholder: `<input-your-managed-identity-name>` | `conductor-node0-params.json: managedIdentity`<br>`conductor-node1-params.json: managedIdentity` |
| 7 | Managed identity resource group | No | (empty) | Only needed when the identity lives in a different resource group. Empty = node0's resource group. | `conductor-node0-params.json: managedIdentityResourceGroup`<br>`conductor-node1-params.json: managedIdentityResourceGroup` |
| 8 | VM size | No | `Standard_F16s_v2` | Size of both conductor VMs. | `conductor-node0-params.json: instanceSize`<br>`conductor-node1-params.json: instanceSize` |
| 9 | Availability set name | No | (empty) | Existing availability set for regions without availability zones. Leave empty when using zones. Both VMs must be in its resource group, so it cannot be combined with a separate node1 resource group. | `conductor-node0-params.json: availabilitySetName`<br>`conductor-node1-params.json: availabilitySetName` |
| 10 | Public IP per node | No | `none` | Public IP on each control interface, needed when routers reach the conductor over the Internet. "Create" adds a static Standard SKU public IP named &lt;VM name&gt;-control; "Attach existing" uses public IPs you already own (for example, addresses already allow-listed by routers). | `conductor-node0-params.json: createPublicIp, existingPublicIpName`<br>`conductor-node1-params.json: createPublicIp, existingPublicIpName`<br>`MOP.md: SSH target, optional conductor address lookup` |
| 11 | Existing public IP resource group | No (only when Public IP per node = `existing`) | (empty) | Only needed when the existing public IPs live in a different resource group than their node. Empty = each node's own resource group. | `conductor-node0-params.json: existingPublicIpResourceGroup`<br>`conductor-node1-params.json: existingPublicIpResourceGroup` |
| 12 | Admin allowed CIDR | No | `0.0.0.0/0` | Source range allowed SSH (22) and HTTPS (443) to the conductor. Restrict this where possible. | `conductor-node0-params.json: adminAllowedCidr`<br>`conductor-node1-params.json: adminAllowedCidr` |
| 13 | Router control allowed CIDR | No | `0.0.0.0/0` | Source range of the managed routers (ports 930, 933, 4505-4506). | `conductor-node0-params.json: controlAllowedCidr`<br>`conductor-node1-params.json: controlAllowedCidr` |
| 14 | SSH public key for t128 | Yes | - | Public key (ssh-rsa, at least 2048-bit) used to log in as t128 on both nodes. The MOP runs every node step over SSH with the matching private key. Placeholder: `<input-your-ssh-public-key>` | `conductor-node0-params.json: adminPublicKeyData`<br>`conductor-node1-params.json: adminPublicKeyData` |

#### Conductor nodes

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 15 | node0 SSR node name | No | `node0` | Name of the first conductor node inside SSR: the PCLI prompt, the configuration, show system connectivity and global.init. Letters, digits and hyphens. The node's hostname and asset ID become &lt;conductor name&gt;-&lt;node name&gt;. The MOP keeps calling this node "node0". | `conductor-node0-cloud-init.txt: initializer-overrides.node-name, name, pdc-key-comment`<br>`conductor-node1-cloud-init.txt: initializer-overrides.ha-peer-name`<br>`MOP.md: PCLI node name and asset ID` |
| 16 | node1 SSR node name | No | `node1` | Name of the second conductor node inside SSR, with the same rules as node0's. Must differ from node0's. The MOP keeps calling this node "node1". | `conductor-node1-cloud-init.txt: initializer-overrides.node-name, name, pdc-key-comment`<br>`MOP.md: PCLI node name and asset ID` |
| 17 | node0 VM name | No | `conductor-node0` | Azure VM name of the primary node (also prefixes its NIC/NSG/disk names). | `conductor-node0-params.json: instanceName`<br>`MOP.md: rollback commands` |
| 18 | node0 private IP | Yes | - | Free static IP in the control subnet for node0. It is node0's conductor address and its HA address. Placeholder: `<input-node0-private-ip>` | `conductor-node0-params.json: controlPrivateIp`<br>`conductor-node1-params.json: haPeerPrivateIp`<br>`conductor-node0-cloud-init.txt: initializer-overrides.node-ip`<br>`conductor-node1-cloud-init.txt: initializer-overrides.ha-peer-ip`<br>`MOP.md: SSH target, optional conductor-address` |
| 19 | node0 availability zone | No | `1` | Zone of node0. Empty when the region has no zones (use an availability set instead). | `conductor-node0-params.json: availabilityZone` |
| 20 | node0 existing public IP name | Yes (only when Public IP per node = `existing`) | - | Existing public IP for node0: Standard SKU, static, same region, not attached to anything else, and zone-redundant or in node0's zone. Placeholder: `<input-node0-existing-public-ip-name>` | `conductor-node0-params.json: existingPublicIpName` |
| 21 | node1 VM name | No | `conductor-node1` | Azure VM name of the secondary node. | `conductor-node1-params.json: instanceName`<br>`MOP.md: rollback commands` |
| 22 | node1 private IP | Yes | - | Free static IP in the control subnet for node1. Placeholder: `<input-node1-private-ip>` | `conductor-node1-params.json: controlPrivateIp`<br>`conductor-node0-params.json: haPeerPrivateIp`<br>`conductor-node1-cloud-init.txt: initializer-overrides.node-ip`<br>`MOP.md: SSH target, open and close HA peer access (sshd Match Address), optional conductor-address` |
| 23 | node1 availability zone | No | `2` | Zone of node1. Use a different zone than node0. | `conductor-node1-params.json: availabilityZone` |
| 24 | node1 existing public IP name | Yes (only when Public IP per node = `existing`) | - | Existing public IP for node1, with the same requirements as node0's. Must differ from node0's. Placeholder: `<input-node1-existing-public-ip-name>` | `conductor-node1-params.json: existingPublicIpName` |

#### node1 in its own resource group (optional)

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 25 | node1 resource group | No | (empty) | Existing resource group for node1's VM, NIC, NSG (and public IP) when it differs from node0's. Empty = same resource group as node0. When set, node1 can also use its own region, VNet, subnet and managed identity below. | `MOP.md: --resource-group of node1 az commands` |
| 26 | node1 Azure region | No (only when node1 resource group is set) | (empty) | Region of node1's VNet when it differs from node0's. Empty = node0's region. A different region needs its own VNet. | `conductor-node1-params.json: location` |
| 27 | node1 VNet name | No (only when node1 resource group is set) | (empty) | Existing VNet for node1 when it differs from node0's. Empty = node0's VNet. Separate VNets must be peered (or otherwise connected) so the nodes reach each other on their private IPs. | `conductor-node1-params.json: virtualNetworkName` |
| 28 | node1 VNet resource group | No (only when node1 resource group is set) | (empty) | Resource group of node1's VNet. Empty = node1's resource group when node1 VNet name is set, otherwise the resource group of node0's VNet. | `conductor-node1-params.json: virtualNetworkResourceGroup` |
| 29 | node1 control subnet name | No (only when node1 resource group is set) | (empty) | Existing subnet in node1's VNet for node1's control interface. Empty = same subnet name as node0. | `conductor-node1-params.json: controlSubnetName` |
| 30 | node1 user assigned managed identity | No (only when node1 resource group is set) | (empty) | Identity attached to node1 when it differs from node0's, with the same read permissions. Empty = node0's identity. | `conductor-node1-params.json: managedIdentity` |
| 31 | node1 managed identity resource group | No (only when node1 resource group is set) | (empty) | Resource group of node1's identity. Empty = node1's resource group when node1 managed identity is set, otherwise the resource group of node0's identity. | `conductor-node1-params.json: managedIdentityResourceGroup` |

#### SSR software and conductor identity

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 32 | Conductor (router) name | No | `Conductor` | Name of the conductor router. Each node also gets the hostname &lt;name&gt;-&lt;node name&gt; (by default &lt;name&gt;-node0 / &lt;name&gt;-node1), which is also its asset ID (salt minion ID) in the PCLI. | `conductor-node0-cloud-init.txt: initializer-overrides.router-name, name, pdc-key-comment`<br>`conductor-node1-cloud-init.txt: initializer-overrides.router-name, name, pdc-key-comment`<br>`MOP.md: PCLI router name and asset IDs` |
| 33 | SSR version | No | `7.2.3` | SSR software version installed on both nodes (6.3.0 or later). | `conductor-node0-cloud-init.txt: ssr-version`<br>`conductor-node1-cloud-init.txt: ssr-version` |
| 34 | Artifactory username | Yes | - | Juniper software repository user used to download SSR. Placeholder: `<input-your-artifactory-username>` | `conductor-node0-cloud-init.txt: artifactory-user`<br>`conductor-node1-cloud-init.txt: artifactory-user` |
| 35 | Artifactory token | Yes | - | Token/password for the artifactory user. Placeholder: `<input-your-artifactory-token>` | `conductor-node0-cloud-init.txt: artifactory-password`<br>`conductor-node1-cloud-init.txt: artifactory-password` |

#### Account passwords (SHA-512 crypt hashes)

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 36 | admin password hash | Yes | - | SHA-512 crypt hash ($6$...) for the SSR admin account (PCLI/GUI). Never a clear-text password. Placeholder: `<input-sha512-crypt-hash-of-admin-password>` | `conductor-node0-cloud-init.txt: admin-password`<br>`conductor-node1-cloud-init.txt: admin-password` |
| 37 | root password hash | Yes | - | SHA-512 crypt hash for the Linux root account. Placeholder: `<input-sha512-crypt-hash-of-root-password>` | `conductor-node0-cloud-init.txt: root-password`<br>`conductor-node1-cloud-init.txt: root-password` |
| 38 | t128 password hash | Yes | - | SHA-512 crypt hash for the Linux t128 account (SSH still uses the key). Also restores t128 on node0 after node1 joins. Placeholder: `<input-sha512-crypt-hash-of-t128-password>` | `conductor-node0-cloud-init.txt: t128-password`<br>`conductor-node1-cloud-init.txt: t128-password`<br>`MOP.md: close HA peer access (restores t128's password)` |

#### HA peer bootstrap credentials (temporary)

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 39 | Temporary HA peer password | Yes | - | Clear-text, single-use password for t128 on node0. Valid only while node1 joins, between the MOP steps that open and close HA peer access. Use a unique, strong value. Placeholder: `<input-temporary-ha-peer-password>` | `conductor-node1-cloud-init.txt: initializer-overrides.unsafe-ha-peer-password`<br>`MOP.md: open HA peer access (temporary t128 password on node0)` |

#### Optional settings

| # | Input | Required | Default | Description | File: key |
|---|---|---|---|---|---|
| 40 | DNS servers | No | (empty) | Comma separated IPv4 DNS servers. Empty = bootstrapper defaults (8.8.8.8, 1.1.1.1). Azure DNS is 168.63.129.16. | `conductor-node0-cloud-init.txt: dns-servers`<br>`conductor-node1-cloud-init.txt: dns-servers` |
| 41 | NTP servers | No | (empty) | Comma separated NTP servers (IP or hostname). Empty = bootstrapper defaults. | `conductor-node0-cloud-init.txt: ntp-servers`<br>`conductor-node1-cloud-init.txt: ntp-servers` |
| 42 | Timezone | No | (empty) | Optional IANA timezone for both nodes, e.g. America/New_York. | `conductor-node0-cloud-init.txt: initializer-overrides.timezone`<br>`conductor-node1-cloud-init.txt: initializer-overrides.timezone` |
| 43 | Customer / project name | No | (empty) | Shown in the MOP title and summary. | `MOP.md: title` |
<!-- INPUTS-TABLE:END -->

Values that are **not inputs** but are fixed by design: `mode: conductor`, `cloud-provider: azure`, the top-level `node-name` (`node0`/`node1`, required by the bootstrapper's schema; the SSR node names are inputs), the VM admin user `t128` (also the HA peer user), `ha-peer-name` (node0's SSR node name) and `learn-from-ha-peer: true` on node1, and the `customData` template parameter (the cloud-init file itself).

### Generating password hashes

The web app has a **Generate…** button next to each hash field; hashes are computed locally in the browser. From a shell:

```bash
openssl passwd -6                          # OpenSSL 1.1.1 or later, prompts for the password
mkpasswd -m sha-512                        # Debian/Ubuntu "whois" package
python3 -c 'import crypt,getpass; print(crypt.crypt(getpass.getpass(), crypt.mksalt(crypt.METHOD_SHA512)))'   # Python 3.12 or earlier
```

The temporary HA peer password is the only clear-text secret. It is valid on node0 only between the MOP steps that open and close HA peer access. Use a unique value.

## Security notes

- The cloud-init files contain the repository token and (node1) the temporary HA peer password. Deliver them over a secure channel and delete them from Cloud Shell afterwards. The MOP's open and close HA peer access blocks also embed the temporary password and the t128 hash, so the MOP itself must be handled as confidential.
- Once HA peer access is closed, the temporary password no longer works on node0. Root-only copies of node1's onboarding data on node1 still contain it, but they cannot be used to log in anywhere.
- `adminAllowedCidr` and `controlAllowedCidr` default to `0.0.0.0/0`, the same as the original template. Narrow them, especially when the nodes have public IPs (new or existing).

## Web app (professional services builder)

[webapp/index.html](./webapp/index.html) is a self-contained page. Open it from disk in a modern browser; it makes no network requests. It has three tabs:

- **Usage**: this guide.
- **Inputs**: a form with validation, a password-hash generator, and the file/key each value is written to. Inputs survive a page reload: they are saved in the browser on every change (`localStorage`), except the secrets (artifactory token, temporary HA peer password), which are kept only for the current tab (`sessionStorage`) and are gone once it is closed. **Clear** also removes the saved inputs. **Export inputs** saves the form to a file without secrets, for another browser or machine.
- **Files & commands**: the customized MOP and the five deployment files as expandable panels, each with **Copy** and **Download**. MOP.md opens in a readable rendered view with a **Raw markdown** toggle. JSON (and the JSON inside the cloud-init files) is syntax highlighted, and unfilled placeholders are marked. **Download all (.zip)** produces the hand-off bundle, and every MOP command is listed with where it runs (Cloud Shell, your terminal, a node's root shell, or the node0 PCLI) and a copy button.

### Maintaining the web app

`webapp/index.html` is built from `index.src.html`, `generator.js` and `app.js`, and embeds `conductor_template.json` and this README. The sample bundle files, the [What gets built](#what-gets-built) topology and the inputs table above are generated from the same field definitions the web app uses.

```bash
cd webapp
node test_generator.js --write   # regenerate MOP.md, the sample node files, and the README topology and inputs table
python3 build.py                 # rebuild webapp/index.html
node test_generator.js           # verify samples, README, MOP commands (PowerShell quoting, bash syntax), crypto, zip and index.html
```
