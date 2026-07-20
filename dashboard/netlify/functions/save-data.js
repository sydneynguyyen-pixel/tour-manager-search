// Generic "write back to GitHub" endpoint for the dashboard.
//
// The dashboard is a static site with no database of its own — Matthew's
// edits (My Artists entries, and soon genre preferences) only really persist
// once they land in the repo the automation pipeline reads from. This
// function is the one place that's allowed to commit on the dashboard's
// behalf, gated to a small allowlist of data files.
//
// POST body:
//   { filePath: string, content: object, merge?: boolean }
//   { filePath: string, content: object, mergeArrayKey: string, mergeArrayIdField: string }
//   - filePath must be one of ALLOWED_PATHS below, or the request is
//     rejected with 403 — this function must never become a generic
//     "write anywhere in the repo" endpoint.
//   - content is the JSON value to write.
//   - merge (optional): when true, fetches the current file and shallow-
//     merges `content`'s top-level keys into it, leaving every other field
//     untouched. Used by the genre-preferences feature so a save only
//     touches config.json's `genrePreferenceTiers` key, not the seed list or
//     batching state alongside it.
//   - mergeArrayKey/mergeArrayIdField (optional, both required together):
//     content[mergeArrayKey] must be an array of objects. Each incoming item
//     is matched against the current file's content[mergeArrayKey] by
//     item[mergeArrayIdField]; a match is shallow-merged (existing fields
//     survive, incoming fields overwrite/add), a non-match is inserted
//     as-is. The result REPLACES content[mergeArrayKey] — an item present in
//     the current file but absent from the incoming array is dropped (so
//     deletes still work; this is a per-field merge, not a per-item union).
//     Every other top-level key in `content` (e.g. updatedAt) still replaces
//     the current file's value outright, same as the no-merge case. Used by
//     My Artists' sync so a browser whose localStorage lacks a field the
//     backend already has (e.g. it seeded before that field existed) can't
//     silently wipe that field out — see dashboard/src/lib/myArtists.js's
//     ENRICHMENT_FIELDS comment for the incident this exists to prevent.
//   - Without merge or mergeArrayKey, content replaces the file outright.

const REPO_OWNER = 'sydneynguyyen-pixel';
const REPO_NAME = 'tour-manager-search';
const GITHUB_API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;

const ALLOWED_PATHS = new Set([
  'automation/data/my-artists.json',
  'automation/data/dismissed-artists.json',
  'automation/config.json',
]);

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function githubRequest(path, token, init = {}) {
  return fetch(`${GITHUB_API_BASE}/${path}`, {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'tour-manager-search-dashboard',
      ...(init.headers || {}),
    },
  });
}

// Per-item shallow merge, keyed by idField, for mergeArrayKey mode. Built
// FROM the incoming array (not the current one) so an item the caller
// omitted — a real delete, not a stale-browser gap — is genuinely dropped;
// only per-FIELD gaps within a still-present item get backfilled from the
// current file. See the module comment above for the incident this exists
// to prevent: a caller whose local copy of one field lags the backend's
// should never be able to blow that field away just by syncing.
export function mergeArrayByKey(currentArray, incomingArray, idField) {
  const currentById = new Map((currentArray || []).map((item) => [item?.[idField], item]));
  return incomingArray.map((incomingItem) => {
    const existing = currentById.get(incomingItem?.[idField]);
    return existing ? { ...existing, ...incomingItem } : incomingItem;
  });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return jsonResponse(500, { error: 'Server misconfigured: GITHUB_TOKEN is not set' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { filePath, content, merge, mergeArrayKey, mergeArrayIdField } = payload;

  if (typeof filePath !== 'string' || !ALLOWED_PATHS.has(filePath)) {
    return jsonResponse(403, { error: `filePath not allowed: ${filePath}` });
  }
  if (content === undefined) {
    return jsonResponse(400, { error: 'Missing content' });
  }
  if (merge && (typeof content !== 'object' || content === null || Array.isArray(content))) {
    return jsonResponse(400, { error: 'merge mode requires an object content payload' });
  }
  if ((mergeArrayKey == null) !== (mergeArrayIdField == null)) {
    return jsonResponse(400, { error: 'mergeArrayKey and mergeArrayIdField must be provided together' });
  }
  if (mergeArrayKey != null && !Array.isArray(content?.[mergeArrayKey])) {
    return jsonResponse(400, { error: `content.${mergeArrayKey} must be an array for mergeArrayKey mode` });
  }

  try {
    // GitHub requires the current file's blob SHA to update it (409 without
    // one). A 404 here means the file doesn't exist yet — sha stays
    // undefined and the PUT below creates it instead of updating it.
    const getRes = await githubRequest(filePath, token);
    let sha;
    let currentJson = null;
    const needsCurrentContent = merge || mergeArrayKey != null;
    if (getRes.status === 200) {
      const current = await getRes.json();
      sha = current.sha;
      if (needsCurrentContent) {
        currentJson = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'));
      }
    } else if (getRes.status !== 404) {
      const errBody = await getRes.text();
      return jsonResponse(getRes.status, { error: `GitHub GET failed: ${errBody}` });
    }

    let newContent;
    if (mergeArrayKey != null) {
      newContent = {
        ...content,
        [mergeArrayKey]: mergeArrayByKey(currentJson?.[mergeArrayKey], content[mergeArrayKey], mergeArrayIdField),
      };
    } else {
      newContent = merge ? { ...(currentJson || {}), ...content } : content;
    }
    const encoded = Buffer.from(`${JSON.stringify(newContent, null, 2)}\n`, 'utf8').toString('base64');

    const putRes = await githubRequest(filePath, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Update ${filePath} via dashboard`,
        content: encoded,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const errBody = await putRes.text();
      return jsonResponse(putRes.status, { error: `GitHub PUT failed: ${errBody}` });
    }

    const putJson = await putRes.json();
    return jsonResponse(200, {
      success: true,
      commitSha: putJson.commit?.sha,
      contentSha: putJson.content?.sha,
    });
  } catch (err) {
    return jsonResponse(500, { error: `Unexpected error: ${err.message}` });
  }
};
