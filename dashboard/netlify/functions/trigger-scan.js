// Manually kicks off the weekly-scrape GitHub Actions workflow on demand, so
// Matthew doesn't have to wait for Sunday night's cron. Uses the same
// GITHUB_TOKEN as save-data.js, but against the Actions API instead of the
// Contents API — that requires the token to carry "Actions: Read and write"
// permission (fine-grained PAT) or the classic `repo` scope (classic PAT). If
// GITHUB_TOKEN only has Contents access (e.g. scoped just for save-data.js's
// file writes), this will 403/404 — verify/update the token's permissions in
// GitHub before relying on this endpoint.
//
// No server-side rate limiting here by design — this is a two-person tool;
// double-trigger protection is a client-side button disable (see App.jsx).

const REPO_OWNER = 'sydneynguyyen-pixel';
const REPO_NAME = 'tour-manager-search';
const WORKFLOW_FILE = 'weekly-scrape.yml';
const DISPATCH_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return jsonResponse(500, { error: 'Server misconfigured: GITHUB_TOKEN is not set' });
  }

  try {
    const res = await fetch(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'tour-manager-search-dashboard',
      },
      body: JSON.stringify({ ref: 'main' }),
    });

    // workflow_dispatch returns 204 with no body on success.
    if (res.status !== 204) {
      const errBody = await res.text();
      return jsonResponse(res.status, {
        error: `GitHub workflow dispatch failed (${res.status}): ${errBody}`,
      });
    }

    return jsonResponse(200, { success: true });
  } catch (err) {
    return jsonResponse(500, { error: `Unexpected error: ${err.message}` });
  }
};
