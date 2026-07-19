// Client setup for the two external APIs used by the scrapers:
//   - Spotify Web API   (OAuth client-credentials flow)
//   - Setlist.fm REST   (static API-key header)
//
// Both are built on axios so they run natively in Node. (The installed
// spotify-web-api-js package is browser-only — it relies on XMLHttpRequest,
// which does not exist in Node — so it is intentionally not used here.)

require('dotenv').config({ quiet: true });
const axios = require('axios');

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SETLISTFM_API_BASE = 'https://api.setlist.fm/rest/1.0';

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------
function assertEnv() {
  // Only Setlist.fm is strictly required. Deezer + TheAudioDB need no key;
  // Last.fm (LASTFM_API_KEY) and Discogs (DISCOGS_TOKEN) are supplementary and
  // degrade gracefully when unset. The Spotify client below is retained only for
  // the archived spotify-scraper.js and is not part of the active pipeline.
  const required = ['SETLISTFM_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required env vars: ${missing.join(', ')}. ` +
        'Copy automation/.env.example to automation/.env and fill it in.'
    );
  }
}

// ---------------------------------------------------------------------------
// Spotify (client-credentials OAuth)
// ---------------------------------------------------------------------------
let cachedToken = null;
let tokenExpiresAt = 0; // epoch ms

async function getSpotifyToken() {
  // Reuse the cached token until ~1 minute before it expires.
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const creds = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString('base64');

  const res = await axios.post(
    SPOTIFY_TOKEN_URL,
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15_000,
    }
  );

  cachedToken = res.data.access_token;
  tokenExpiresAt = Date.now() + res.data.expires_in * 1000;
  return cachedToken;
}

// Authenticated GET against the Spotify Web API. Refreshes the token as needed.
async function spotifyGet(path, params = {}) {
  const token = await getSpotifyToken();
  const res = await axios.get(`${SPOTIFY_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
    timeout: 15_000,
  });
  return res.data;
}

const spotify = {
  getToken: getSpotifyToken,
  get: spotifyGet,
  getArtist: (id) => spotifyGet(`/artists/${id}`),
  searchArtists: (q, limit = 5) => spotifyGet('/search', { q, type: 'artist', limit }),
};

// ---------------------------------------------------------------------------
// Setlist.fm (API-key header)
// ---------------------------------------------------------------------------
// Setlist.fm requires the API key header, a JSON Accept header (it defaults to
// XML), and a descriptive User-Agent.
const setlistfm = axios.create({
  baseURL: SETLISTFM_API_BASE,
  headers: {
    'x-api-key': process.env.SETLISTFM_API_KEY,
    Accept: 'application/json',
    'User-Agent': 'tour-manager-search/1.0',
  },
  timeout: 15_000,
});

module.exports = { spotify, setlistfm, getSpotifyToken, assertEnv };
