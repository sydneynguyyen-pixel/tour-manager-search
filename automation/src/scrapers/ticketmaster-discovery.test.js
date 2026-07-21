// Unit tests for Ticketmaster tour discovery's pure logic (event attribution,
// festival/non-artist filtering, per-artist grouping, the >5-upcoming-date
// threshold, the upcoming/recent-past split behind recentlyPlayed, dedupe,
// image/genre extraction). Pure/synchronous — no network.
// Run with:  node src/scrapers/ticketmaster-discovery.test.js   (from automation/)

const logger = require('../utils/logger');
const {
  extractBrowseEvent,
  groupToursFromBrowseEvents,
  isFestivalAttraction,
  locationKey,
  pickAttractionImage,
  attractionGenre,
  plausibleOnSaleDate,
} = require('./ticketmaster-discovery');

let failures = 0;
function assert(cond, msg) {
  if (cond) logger.success(`PASS ${msg}`);
  else { failures += 1; logger.error(`FAIL ${msg}`); }
}

// A fixed cutoff, well before every "upcoming" test date (2026-09/10-xx) and
// well after every "recent-past" test date (2025-11/12-xx) below — pins
// upcoming-vs-past classification so these tests don't quietly start failing
// once wall-clock "today" passes 2026-09.
const TODAY = '2026-01-01';

// --- Builders for realistic Ticketmaster Discovery event payloads ------------
function tmEvent({
  artist,
  id,
  date,
  venue = 'The Venue',
  city = 'Anytown',
  onsale,
  url,
  extraAttractions = [],
  images,
  classifications,
  eventClassifications,
}) {
  const headliner = {
    name: artist,
    id: id ?? `attr-${String(artist).toLowerCase().replace(/\s+/g, '-')}`,
    images: images ?? [
      { url: `https://img/${artist}-3x2.jpg`, ratio: '3_2', width: 305, height: 203 },
      { url: `https://img/${artist}-16x9.jpg`, ratio: '16_9', width: 1024, height: 576 },
    ],
    classifications: classifications ?? [{ segment: { name: 'Music' }, genre: { name: 'Pop' } }],
  };
  return {
    name: `${artist} at ${venue}`,
    url: url ?? `https://ticketmaster.com/event/${String(artist).toLowerCase()}-${date}`,
    dates: { start: { localDate: date } },
    sales: onsale ? { public: { startDateTime: onsale } } : undefined,
    // Defaults to an unremarkable, non-festival event classification — real
    // shows carry one, and tests that don't care about it shouldn't need to
    // supply it.
    classifications: eventClassifications ?? [{ segment: { name: 'Music' }, genre: { name: 'Other' } }],
    _embedded: {
      venues: [{ name: venue, city: { name: city } }],
      attractions: [headliner, ...extraAttractions],
    },
  };
}

// A helper to synthesize N upcoming dates (2026-09-xx) for one artist across
// cities/venues.
function tourEvents(artist, n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const day = String(10 + i).padStart(2, '0');
    out.push(tmEvent({ artist, date: `2026-09-${day}`, venue: `Venue ${i}`, city: `City ${i}`, ...opts }));
  }
  return out;
}

// Same, but recent-past dates (2025-11-xx — before TODAY).
function pastEvents(artist, n, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const day = String(1 + i).padStart(2, '0');
    out.push(tmEvent({ artist, date: `2025-11-${day}`, venue: `Old Venue ${i}`, city: `Old City ${i}`, ...opts }));
  }
  return out;
}

// offsetDays past a base "YYYY-MM-DD", via real Date arithmetic so a run of
// 30+ dates (residency tests below) doesn't overflow a month like the
// zero-padded-string approach tourEvents/pastEvents use would.
function dateAt(baseIso, offsetDays) {
  const d = new Date(`${baseIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// N dates, all at the same single venue/city (a residency, e.g. a Las
// Vegas/Sphere run) — same date-arithmetic as dateAt so it scales past a
// month boundary.
function residencyEvents(artist, n, { venue = 'The Sphere', city = 'Las Vegas' } = {}) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push(tmEvent({ artist, date: dateAt('2026-09-01', i), venue, city }));
  }
  return out;
}

// === extractBrowseEvent ======================================================
{
  const rec = extractBrowseEvent(tmEvent({ artist: 'Big Star', date: '2026-09-10', onsale: '2026-07-01T17:00:00Z' }));
  assert(rec && rec.artist === 'Big Star', 'extract: reads headliner name');
  assert(rec.date === '2026-09-10', 'extract: reads event date');
  assert(rec.venue === 'The Venue' && rec.city === 'Anytown', 'extract: reads venue + city');
  assert(rec.onSaleDate === '2026-07-01T17:00:00Z', 'extract: reads plausible on-sale date');
  assert(typeof rec.url === 'string' && rec.url.length > 0, 'extract: carries a ticketing url');
  assert(rec.genre === 'Pop', 'extract: reads genre from classification');
  assert(rec.imageUrl === 'https://img/Big Star-16x9.jpg', 'extract: prefers the wide 16:9 image');
  assert(
    rec.classification && rec.classification.segment === 'Music' && rec.classification.genre === 'Pop',
    'extract: carries attraction classification fields through raw'
  );
}

// Festival / multi-bill (too many attractions) -> not attributable.
{
  const festival = tmEvent({
    artist: 'Headliner',
    date: '2026-09-10',
    extraAttractions: [{ name: 'Act B' }, { name: 'Act C' }, { name: 'Act D' }, { name: 'Act E' }],
  });
  assert(extractBrowseEvent(festival) === null, 'extract: skips festival-sized bills (> 3 attractions)');
}

// No attractions, or no date -> null.
assert(extractBrowseEvent({ dates: { start: { localDate: '2026-09-10' } }, _embedded: { attractions: [] } }) === null, 'extract: null when no attractions');
assert(extractBrowseEvent(tmEvent({ artist: 'No Date', date: undefined })) === null, 'extract: null when no date');

// A co-headline (2 attractions) is still attributable to the first act.
{
  const co = tmEvent({ artist: 'Lead Act', date: '2026-09-10', extraAttractions: [{ name: 'Second Act' }] });
  const rec = extractBrowseEvent(co);
  assert(rec && rec.artist === 'Lead Act', 'extract: co-headline attributes to first-listed act');
}

// 1900 sentinel on-sale date is treated as unknown.
{
  const rec = extractBrowseEvent(tmEvent({ artist: 'Sentinel', date: '2026-09-10', onsale: '1900-01-01T00:00:00Z' }));
  assert(rec.onSaleDate === null, 'extract: 1900 on-sale sentinel -> null');
}

// === plausibleOnSaleDate / image / genre helpers =============================
assert(plausibleOnSaleDate('2026-07-01T17:00:00Z') === '2026-07-01T17:00:00Z', 'onsale: keeps a real date');
assert(plausibleOnSaleDate('1900-01-01T00:00:00Z') === null, 'onsale: rejects the 1900 sentinel');
assert(plausibleOnSaleDate('9999-12-31T06:00:00Z') === null, 'onsale: rejects the 9999 sentinel');
assert(plausibleOnSaleDate(null) === null, 'onsale: null in -> null out');
assert(pickAttractionImage({ images: [] }) === null, 'image: no images -> null');
assert(
  pickAttractionImage({ images: [{ url: 'a', ratio: '3_2', width: 2000 }, { url: 'b', ratio: '16_9', width: 640 }] }) === 'b',
  'image: prefers wide 16:9 even when a larger non-16:9 exists'
);
assert(
  pickAttractionImage({ images: [{ url: 'a', ratio: '3_2', width: 2000 }, { url: 'b', ratio: '4_3', width: 300 }] }) === 'a',
  'image: falls back to the widest when no qualifying 16:9'
);
assert(attractionGenre({ classifications: [{ genre: { name: 'Undefined' }, segment: { name: 'Music' } }] }) === 'Music', 'genre: skips Undefined, falls back to segment');
assert(attractionGenre({ classifications: [{ genre: { name: 'Undefined' }, segment: { name: 'Undefined' } }] }) === null, 'genre: all-Undefined -> null');

// === Festival / non-artist attraction detection ==============================
// Attraction-level "Festival" subType — the Breakaway Music Festival /
// Lollapalooza shape confirmed against the live API.
assert(
  isFestivalAttraction({ classifications: [{ type: { name: 'Event Style' }, subType: { name: 'Festival' } }] }, {}, 'Some Fest Co') === true,
  'isFestivalAttraction: attraction-level subType "Festival"'
);
{
  const rec = extractBrowseEvent(
    tmEvent({
      artist: 'Breakaway Music Festival',
      date: '2026-09-10',
      classifications: [
        { segment: { name: 'Music' }, genre: { name: 'Undefined' }, subGenre: { name: 'Undefined' }, type: { name: 'Event Style' }, subType: { name: 'Festival' } },
      ],
    })
  );
  assert(rec === null, 'extract: skips attraction-level Festival subType (Breakaway shape)');
}

// Event-level "Fairs & Festivals" genre — the Riot Fest shape, where the
// attraction record itself carries no distinguishing classification at all.
assert(
  isFestivalAttraction({}, { classifications: [{ segment: { name: 'Miscellaneous' }, genre: { name: 'Fairs & Festivals' } }] }, 'Some Name') === true,
  'isFestivalAttraction: event-level genre "Fairs & Festivals"'
);
{
  const rec = extractBrowseEvent(
    tmEvent({
      artist: 'Riot Fest',
      date: '2026-09-10',
      classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' } }], // attraction: unremarkable
      eventClassifications: [{ segment: { name: 'Miscellaneous' }, genre: { name: 'Fairs & Festivals' } }],
    })
  );
  assert(rec === null, 'extract: skips event-level Fairs & Festivals genre (Riot Fest shape)');
}

// Name fallback catches what neither metadata field marks — the Eastern
// Festival of Music (tagged as an Orchestra) / Buffalo Traffic Jam (tagged as
// a plain Concert) shapes confirmed against the live API, where both
// attraction- and event-level classifications are unremarkable.
for (const name of ['Eastern Festival of Music', 'Buffalo Traffic Jam', 'Winter Jingle Ball', 'Downtown Block Party', 'County Fair']) {
  const rec = extractBrowseEvent(tmEvent({ artist: name, date: '2026-09-10' }));
  assert(rec === null, `extract: name fallback skips "${name}"`);
}

// Negative control: the name fallback must not false-positive on a real
// artist name that merely contains a festival-ish substring without a word
// boundary (e.g. "Fairview" must not match \bfair\b).
assert(isFestivalAttraction({}, {}, 'Fairview String Band') === false, 'isFestivalAttraction: no false positive on "Fairview"');
{
  const rec = extractBrowseEvent(tmEvent({ artist: 'Fairview String Band', date: '2026-09-10' }));
  assert(rec && rec.artist === 'Fairview String Band', 'extract: keeps a real artist ("Fairview...") the fallback must not catch');
}

// Negative control: a real artist with unremarkable classifications on both
// levels is never flagged.
assert(
  isFestivalAttraction(
    { classifications: [{ type: { name: 'Group' }, subType: { name: 'Band' } }] },
    { classifications: [{ genre: { name: 'Rock' } }] },
    'Subtronics'
  ) === false,
  'isFestivalAttraction: a real artist is never flagged'
);

// === groupToursFromBrowseEvents ==============================================
// Core threshold: exactly 6 upcoming dates qualifies (> 5), 5 does not.
{
  const recs6 = tourEvents('Sixer', 6).map(extractBrowseEvent);
  const recs5 = tourEvents('Fiver', 5).map(extractBrowseEvent);
  const tours = groupToursFromBrowseEvents([...recs6, ...recs5], { todayIso: TODAY });
  const names = tours.map((t) => t.artist);
  assert(names.includes('Sixer'), 'group: 6-date tour qualifies (> 5)');
  assert(!names.includes('Fiver'), 'group: 5-date run is excluded');
  const sixer = tours.find((t) => t.artist === 'Sixer');
  assert(sixer.dateCount === 6, 'group: reports the true date count');
  assert(sixer.events.length === 6 && sixer.events[0].date <= sixer.events[5].date, 'group: events sorted ascending by date');
  assert(sixer.recentlyPlayed === false, 'group: no past dates -> recentlyPlayed false');
}

// Single show is excluded.
{
  const tours = groupToursFromBrowseEvents(tourEvents('Single', 1).map(extractBrowseEvent), { todayIso: TODAY });
  assert(tours.length === 0, 'group: a single show never becomes a tour');
}

// National aggregation: the same artist's dates arrive interleaved (as they
// would from different state queries) and still sum to one tour.
{
  const interleaved = [
    ...tourEvents('Roadshow', 3, {}),
    ...tourEvents('Other Band', 2, {}),
    ...tourEvents('Roadshow', 4, {}).map((e) => ({ ...e, dates: { start: { localDate: e.dates.start.localDate.replace('2026-09', '2026-10') } } })),
  ].map(extractBrowseEvent);
  const tours = groupToursFromBrowseEvents(interleaved, { todayIso: TODAY });
  const road = tours.find((t) => t.artist === 'Roadshow');
  assert(road && road.dateCount === 7, 'group: aggregates one act across interleaved segments (3 + 4 = 7)');
}

// Dedupe by date+venue: the same show listed twice counts once (and so a tour
// padded with duplicates does NOT clear the threshold on dupes alone).
{
  const one = tmEvent({ artist: 'Dupe', date: '2026-09-10', venue: 'Same Hall', city: 'Town' });
  const recs = Array.from({ length: 8 }, () => extractBrowseEvent(one));
  const tours = groupToursFromBrowseEvents(recs, { todayIso: TODAY });
  assert(tours.length === 0, 'group: 8 copies of ONE show dedupe to 1 date -> not a tour');
}

// earliestOnSaleDate is the minimum across the tour's UPCOMING on-sale dates.
{
  const recs = [
    extractBrowseEvent(tmEvent({ artist: 'OnsaleAct', date: '2026-09-10', venue: 'V1', onsale: '2026-07-05T17:00:00Z' })),
    extractBrowseEvent(tmEvent({ artist: 'OnsaleAct', date: '2026-09-11', venue: 'V2', onsale: '2026-06-20T17:00:00Z' })),
    ...tourEvents('OnsaleAct', 5, {}).map(extractBrowseEvent),
  ];
  const tours = groupToursFromBrowseEvents(recs, { todayIso: TODAY });
  const act = tours.find((t) => t.artist === 'OnsaleAct');
  assert(act.earliestOnSaleDate === '2026-06-20T17:00:00Z', 'group: earliestOnSaleDate = min on-sale across the upcoming run');
}

// Sorted biggest-tour-first.
{
  const tours = groupToursFromBrowseEvents(
    [...tourEvents('Small Tour', 6).map(extractBrowseEvent), ...tourEvents('Huge Tour', 20).map(extractBrowseEvent)],
    { todayIso: TODAY }
  );
  assert(tours[0].artist === 'Huge Tour', 'group: sorts biggest tour first');
}

// === Upcoming vs. recent-past split (recentlyPlayed / Bug 1 regression) ======
// An act with dates already played in the recent-past window AND enough
// upcoming dates left is ONGOING material (recentlyPlayed), and the past
// dates never leak into dateCount or the returned events — this is the Don
// Toliver bug: a mid-tour act's remaining leg must not read as a brand-new
// tour just because discovery only used to look forward.
{
  const upcoming = tourEvents('Mid Tour Act', 6); // 2026-09-xx, all after TODAY
  const past = pastEvents('Mid Tour Act', 3); // 2025-11-xx, all before TODAY
  const recs = [...upcoming, ...past].map(extractBrowseEvent);
  const tours = groupToursFromBrowseEvents(recs, { todayIso: TODAY });
  const t = tours.find((x) => x.artist === 'Mid Tour Act');
  assert(t && t.recentlyPlayed === true, 'group: a played recent-past date flags recentlyPlayed');
  assert(t.dateCount === 6, 'group: dateCount counts upcoming dates only, past dates excluded');
  assert(t.events.length === 6 && t.events.every((e) => e.date >= TODAY), 'group: returned events exclude already-played dates');
}

// A past date alone (0 upcoming dates left) never qualifies as a tour, no
// matter how many recent-past dates exist — the > 5 threshold is
// upcoming-only, so a tour that's already wrapped up doesn't get surfaced.
{
  const tours = groupToursFromBrowseEvents(pastEvents('All Played Out', 8).map(extractBrowseEvent), { todayIso: TODAY });
  assert(tours.length === 0, 'group: recent-past-only dates never qualify (no upcoming dates)');
}

// A recent-past date's on-sale field doesn't leak into earliestOnSaleDate —
// a past show's sale window is over and irrelevant to the remaining leg.
{
  const recs = [
    extractBrowseEvent(tmEvent({ artist: 'MixedOnsale', date: '2025-11-01', venue: 'Old Venue', onsale: '2025-01-01T00:00:00Z' })),
    ...tourEvents('MixedOnsale', 6, { onsale: '2026-02-01T00:00:00Z' }).map(extractBrowseEvent),
  ];
  const tours = groupToursFromBrowseEvents(recs, { todayIso: TODAY });
  const t = tours.find((x) => x.artist === 'MixedOnsale');
  assert(t.earliestOnSaleDate === '2026-02-01T00:00:00Z', 'group: earliestOnSaleDate ignores a past-dated on-sale field');
}

// === Must-travel-between-markets (distinctCities / residency exclusion) =====
// locationKey itself: city wins when present (normalized), venue is the
// fallback when city is missing.
assert(locationKey({ city: 'Austin', venue: 'Moody Center' }) === 'austin', 'locationKey: normalizes city (lowercased)');
assert(locationKey({ city: '  Austin  ', venue: 'Moody Center' }) === 'austin', 'locationKey: trims city');
assert(locationKey({ city: null, venue: 'The Sphere' }) === 'the sphere', 'locationKey: falls back to venue when city is null');
assert(locationKey({ city: '', venue: 'The Sphere' }) === 'the sphere', 'locationKey: falls back to venue when city is empty');
assert(locationKey({ city: null, venue: null }) === '', 'locationKey: empty string when neither city nor venue is known');

// A 30-date, single-city residency (the Las Vegas/Sphere shape from the
// feature request) clears the date threshold on count alone but is excluded
// — travel booking doesn't make sense for an act that never leaves one city.
{
  const tours = groupToursFromBrowseEvents(residencyEvents('Sphere Residency Act', 30).map(extractBrowseEvent), { todayIso: TODAY });
  assert(!tours.some((t) => t.artist === 'Sphere Residency Act'), 'group: a 30-date single-city residency is excluded despite clearing the date threshold');
}

// A normal 6-date, 6-city tour (tourEvents' default shape) is kept, and
// distinctCities is reported on the tour for debugging.
{
  const tours = groupToursFromBrowseEvents(tourEvents('Six City Tour', 6).map(extractBrowseEvent), { todayIso: TODAY });
  const t = tours.find((x) => x.artist === 'Six City Tour');
  assert(t && t.distinctCities === 6, 'group: a 6-date/6-city tour is kept, distinctCities reported');
}

// Boundary: exactly MIN_DISTINCT_CITIES (3) distinct cities is kept; one
// fewer (2) is dropped, even with the same total date count.
{
  const threeCityRecs = [];
  for (let i = 0; i < 6; i += 1) {
    threeCityRecs.push(tmEvent({ artist: 'Three City Run', date: dateAt('2026-09-01', i), venue: `Venue ${i % 3}`, city: `City ${i % 3}` }));
  }
  const tours = groupToursFromBrowseEvents(threeCityRecs.map(extractBrowseEvent), { todayIso: TODAY });
  const t = tours.find((x) => x.artist === 'Three City Run');
  assert(t && t.distinctCities === 3, 'group: exactly 3 distinct cities is kept (boundary)');
}
{
  const twoCityRecs = [];
  for (let i = 0; i < 6; i += 1) {
    twoCityRecs.push(tmEvent({ artist: 'Two City Run', date: dateAt('2026-09-01', i), venue: `Venue ${i % 2}`, city: `City ${i % 2}` }));
  }
  const tours = groupToursFromBrowseEvents(twoCityRecs.map(extractBrowseEvent), { todayIso: TODAY });
  assert(!tours.some((t) => t.artist === 'Two City Run'), 'group: only 2 distinct cities is dropped even with 6 dates');
}

// Null-city events fall back to venue for the distinct-location count, so a
// genuine multi-venue tour that's just missing city data isn't wrongly
// collapsed to a single location and excluded.
{
  const noCityRecs = [];
  for (let i = 0; i < 6; i += 1) {
    noCityRecs.push(tmEvent({ artist: 'No City Data', date: dateAt('2026-09-01', i), venue: `Hall ${i % 3}`, city: '' }));
  }
  const tours = groupToursFromBrowseEvents(noCityRecs.map(extractBrowseEvent), { todayIso: TODAY });
  const t = tours.find((x) => x.artist === 'No City Data');
  assert(t && t.distinctCities === 3, 'group: null/empty city falls back to venue for the distinct-location count');
}

// stats.droppedForSingleLocation counts residency-style drops separately
// from stats.droppedForDateThreshold — build-tour-announcements.js's log
// line depends on these being distinct buckets.
{
  const stats = {};
  const recs = [
    ...residencyEvents('Residency Drop', 10),
    ...tourEvents('Short Run', 3), // fails the date threshold instead
    ...tourEvents('Real Tour', 6), // passes both gates
  ].map(extractBrowseEvent);
  const tours = groupToursFromBrowseEvents(recs, { todayIso: TODAY, stats });
  assert(tours.some((t) => t.artist === 'Real Tour'), 'group/stats: a qualifying tour is still kept alongside the drops');
  assert(stats.droppedForSingleLocation === 1, 'group/stats: single-location drop counted separately');
  assert(stats.droppedForDateThreshold === 1, 'group/stats: date-threshold drop counted separately');
}

if (failures > 0) { logger.error(`${failures} discovery check(s) failed.`); process.exit(1); }
logger.success('Ticketmaster discovery checks passed.');
