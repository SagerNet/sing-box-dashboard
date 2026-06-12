// Shared between the Tailscale endpoint view and the terminal views.
//
// Mirrors the SharedPreferences.tailscaleSSHRemembered* storage in
// sing-box-for-apple: username and terminal type are always kept for
// prefilling the prompt; `remember` additionally makes Connect skip the
// prompt entirely (quick connect) and lists the peer in the terminal
// session manager's New Session menu.

import type { TailscalePeer } from "../gen/daemon/started_service_pb";

export interface TailscaleSSHPrefs {
  username: string;
  terminalType: string;
  remember: boolean;
}

export interface SSHSessionOptions {
  endpointTag: string;
  peerAddress: string;
  peerName: string;
  username: string;
  terminalType: string;
  hostKeys: string[];
}

const SSH_PREFS_KEY = "sing-box-dashboard.tailscale-ssh";
export const SSH_DEFAULT_USERNAME = "root";
export const SSH_DEFAULT_TERMINAL_TYPE = "xterm-256color";

export function loadSSHPrefs(): Record<string, TailscaleSSHPrefs> {
  try {
    const raw = localStorage.getItem(SSH_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, TailscaleSSHPrefs>;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {
    // fall through
  }
  return {};
}

export function saveSSHPrefs(stableID: string, prefs: TailscaleSSHPrefs) {
  const map = loadSSHPrefs();
  map[stableID] = prefs;
  localStorage.setItem(SSH_PREFS_KEY, JSON.stringify(map));
}

export function peerDisplayName(peer: TailscalePeer | undefined): string {
  if (!peer) {
    return "";
  }
  if (peer.dnsName !== "") {
    return peer.dnsName.split(".")[0];
  }
  return peer.hostName;
}

export function peerSSHAddress(peer: TailscalePeer): string {
  return (
    peer.tailscaleIPs.find((address) => !address.includes(":")) ??
    peer.tailscaleIPs[0] ??
    peer.dnsName
  );
}

export function peerSSHAvailable(peer: TailscalePeer): boolean {
  return peer.online && peer.sshHostKeys.length > 0 && peer.tailscaleIPs.length > 0;
}

export function buildSSHSession(
  endpointTag: string,
  peer: TailscalePeer,
  username: string,
  terminalType: string,
): SSHSessionOptions {
  return {
    endpointTag,
    peerAddress: peerSSHAddress(peer),
    peerName: peerDisplayName(peer),
    username,
    terminalType,
    hostKeys: peer.sshHostKeys,
  };
}
