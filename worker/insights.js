// Website insights from Cloudflare Web Analytics, through the GraphQL
// Analytics API. The beacon on the public site reports page loads to a
// Web Analytics site; this reads them back, grouped by day, page, referrer,
// country and device, with bots left out.
const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

const QUERY = `
query Insights($account: string!, $site: string!, $from: Time!, $to: Time!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      byDay: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $site, bot: 0, datetime_geq: $from, datetime_leq: $to }
        limit: 100
        orderBy: [date_ASC]
      ) { count sum { visits } dimensions { date } }
      pages: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $site, bot: 0, datetime_geq: $from, datetime_leq: $to }
        limit: 12
        orderBy: [count_DESC]
      ) { count sum { visits } dimensions { requestPath } }
      referrers: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $site, bot: 0, datetime_geq: $from, datetime_leq: $to }
        limit: 12
        orderBy: [sum_visits_DESC]
      ) { count sum { visits } dimensions { refererHost } }
      countries: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $site, bot: 0, datetime_geq: $from, datetime_leq: $to }
        limit: 12
        orderBy: [sum_visits_DESC]
      ) { count sum { visits } dimensions { countryName } }
      devices: rumPageloadEventsAdaptiveGroups(
        filter: { siteTag: $site, bot: 0, datetime_geq: $from, datetime_leq: $to }
        limit: 6
        orderBy: [sum_visits_DESC]
      ) { count sum { visits } dimensions { deviceType } }
    }
  }
}`;

const rows = (list, key) =>
  (list || []).map((g) => ({
    label: g.dimensions?.[key] || '',
    views: g.count || 0,
    visits: g.sum?.visits || 0,
  }));

/**
 * @param {object} args { token, accountId, siteTag, days, now?, fetchImpl? }
 */
export async function fetchInsights({
  token,
  accountId,
  siteTag,
  days,
  now = new Date(),
  fetchImpl = fetch,
}) {
  const span = Math.min(90, Math.max(1, Number(days) || 7));
  const to = new Date(now);
  const from = new Date(now.getTime() - span * 24 * 3600 * 1000);
  const res = await fetchImpl(GRAPHQL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        account: accountId,
        site: siteTag,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.errors && data.errors.length))
    throw new Error(
      `Cloudflare analytics → ${res.status}: ${(data.errors || [])
        .map((e) => e.message)
        .join('; ')
        .slice(0, 300)}`,
    );
  const acc = data.data?.viewer?.accounts?.[0] || {};
  const byDay = rows(acc.byDay, 'date');
  // Every day in the window, including the quiet ones, so the chart is honest.
  const perDay = new Map(byDay.map((d) => [d.label, d]));
  const series = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const date = new Date(to.getTime() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const d = perDay.get(date);
    series.push({ date, views: d?.views || 0, visits: d?.visits || 0 });
  }
  return {
    days: span,
    from: from.toISOString(),
    to: to.toISOString(),
    totals: {
      views: series.reduce((n, d) => n + d.views, 0),
      visits: series.reduce((n, d) => n + d.visits, 0),
    },
    byDay: series,
    pages: rows(acc.pages, 'requestPath'),
    referrers: rows(acc.referrers, 'refererHost').map((r) => ({
      ...r,
      label: r.label || 'Direct / none',
    })),
    countries: rows(acc.countries, 'countryName'),
    devices: rows(acc.devices, 'deviceType'),
  };
}
