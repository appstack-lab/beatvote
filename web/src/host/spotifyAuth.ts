// Spotify Authorization Code flow with PKCE, entirely in the host's browser.
// Each host uses their own Spotify developer app (client ID), see README.
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

const LS = {
  clientId: 'dj.clientId',
  verifier: 'dj.verifier',
  tokens: 'dj.tokens',
};

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// Spotify only allows http for loopback IPs, not for "localhost".
export const redirectUri = () => `${location.protocol}//${location.host}/callback`;
export const isLoopbackIp = () => location.hostname === '127.0.0.1' || location.protocol === 'https:';

// Each host creates their own Spotify app on first start, nothing is built in. The host page always runs on
// http://127.0.0.1:<port> (desktop and Android use 4173), so localStorage keeps the ID across restarts and updates.
export const getClientId = () => localStorage.getItem(LS.clientId) ?? '';
export const setClientId = (id: string) => localStorage.setItem(LS.clientId, id.trim());

export const loadTokens = (): Tokens | null => {
  try {
    return JSON.parse(localStorage.getItem(LS.tokens) ?? 'null');
  } catch {
    return null;
  }
};
const saveTokens = (t: Tokens) => localStorage.setItem(LS.tokens, JSON.stringify(t));
export const logout = () => localStorage.removeItem(LS.tokens);

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function startLogin(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)).buffer);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(LS.verifier, verifier);
  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...body }),
  });
  if (!res.ok) throw new Error(`Spotify-Login fehlgeschlagen (${res.status})`);
  const data = await res.json();
  const tokens: Tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? loadTokens()?.refreshToken ?? '',
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

export async function finishLogin(code: string): Promise<Tokens> {
  const verifier = localStorage.getItem(LS.verifier) ?? '';
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
}

export function refresh(refreshToken: string): Promise<Tokens> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}
