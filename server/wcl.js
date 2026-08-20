/**
 * Warcraft Logs v2 client.
 *
 * Two hops: an OAuth2 client-credentials token, then GraphQL against
 * /api/v2/client. One query per report gets us the fight list (kills and
 * wipes alike) and the ranked parses for every kill.
 *
 * Create a client at https://www.warcraftlogs.com/api/clients/ and put the id
 * and secret in WCL_CLIENT_ID / WCL_CLIENT_SECRET. The registration form also
 * demands a redirect URL: that belongs to the authorization-code flow, which
 * this client does not use, so any URL you control will do and will never be
 * visited. Client credentials read public data only — see fetchReport.
 */

const TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
const GRAPHQL_URL = 'https://www.warcraftlogs.com/api/v2/client';

/** Refresh a little before the token actually lapses. */
const TOKEN_SKEW_MS = 60_000;

export const REPORT_QUERY = `
query ParsedleReport($code: String!) {
  reportData {
    report(code: $code) {
      code
      title
      startTime
      endTime
      zone { id name }
      guild { name server { region { compactName } } }
      fights(killType: Encounters) {
        id
        encounterID
        name
        difficulty
        kill
        startTime
        endTime
      }
      rankings
    }
  }
}`;

/**
 * The guild's roster, one page at a time. Either identify the guild by its
 * numeric id, or by name + realm slug + region.
 */
export const ROSTER_QUERY = `
query ParsedleRoster($id: Int, $name: String, $server: String, $region: String, $page: Int!) {
  guildData {
    guild(id: $id, name: $name, serverSlug: $server, serverRegion: $region) {
      id
      name
      members(limit: 100, page: $page) {
        current_page
        has_more_pages
        data { id name level }
      }
    }
  }
}`;

/** WCL paginates at 100; this caps a runaway loop at a very large guild. */
const MAX_ROSTER_PAGES = 20;

export class WclError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'WclError';
    this.status = status;
    this.details = details;
  }
}

/**
 * @param {{clientId: string, clientSecret: string, fetchImpl?: typeof fetch, now?: () => number}} opts
 */
export function createWclClient({ clientId, clientSecret, fetchImpl = fetch, now = Date.now }) {
  if (!clientId || !clientSecret) {
    throw new WclError('Missing WCL_CLIENT_ID / WCL_CLIENT_SECRET');
  }

  let token = null;
  let tokenExpiresAt = 0;
  let inFlight = null;

  async function requestToken() {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      throw new WclError(`Warcraft Logs rejected the credentials (${res.status})`, { status: res.status });
    }
    const body = await res.json();
    token = body.access_token;
    tokenExpiresAt = now() + (body.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS;
    return token;
  }

  /** Tokens last hours; only one refresh is ever in flight. */
  async function accessToken() {
    if (token && now() < tokenExpiresAt) return token;
    inFlight ??= requestToken().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function graphql(query, variables) {
    const res = await fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401) {
      // The token went stale early; drop it so the next call re-authenticates.
      token = null;
      throw new WclError('Warcraft Logs returned 401', { status: 401 });
    }
    if (!res.ok) {
      throw new WclError(`Warcraft Logs returned ${res.status}`, { status: res.status });
    }

    const body = await res.json();
    if (body.errors?.length) {
      throw new WclError(body.errors[0].message ?? 'GraphQL error', { details: body.errors });
    }
    return body.data;
  }

  return {
    graphql,
    /** @returns {Promise<object>} the raw `reportData.report` node */
    async fetchReport(code) {
      const data = await graphql(REPORT_QUERY, { code });
      const report = data?.reportData?.report;
      if (!report) {
        // A private report is indistinguishable from a missing one here:
        // client-credentials tokens only see public logs. Say so, because the
        // fix is a visibility setting, not a corrected URL.
        throw new WclError(
          `No report found for code ${code} — check the URL, and that the log is not private ` +
            '(client credentials can only read public reports).',
          { status: 404 },
        );
      }
      return report;
    },

    /**
     * Every character on the guild's roster, followed across pages.
     *
     * @param {{id?: number, name?: string, server?: string, region?: string}} guild
     * @returns {Promise<{guild: {id: number, name: string}, members: string[]}>}
     */
    async fetchGuildRoster({ id = null, name = null, server = null, region = null }) {
      if (!id && !(name && server && region)) {
        throw new WclError('Identify the guild by id, or by name + server + region');
      }

      const members = [];
      let guild = null;
      for (let page = 1; page <= MAX_ROSTER_PAGES; page++) {
        const data = await graphql(ROSTER_QUERY, { id, name, server, region, page });
        const node = data?.guildData?.guild;
        if (!node) throw new WclError(`No guild found for ${name ?? id}`, { status: 404 });
        guild ??= { id: node.id, name: node.name };
        for (const member of node.members?.data ?? []) {
          if (member?.name) members.push(member.name);
        }
        if (!node.members?.has_more_pages) break;
      }
      return { guild, members };
    },
  };
}
