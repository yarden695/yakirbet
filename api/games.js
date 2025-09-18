// YakirBet Vercel Backend - Fixed Smart Live Flow
const ODDS_API_KEY = 'f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea';
const CACHE_DURATION = 60 * 1000; // 1 minute cache

let gameCache = { data: null, timestamp: null, expires: null };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const now = new Date();
        const { force = false } = req.query;

        const isCacheValid = gameCache.data && gameCache.expires && now < gameCache.expires && !force;
        if (isCacheValid) {
            return res.status(200).json({
                ...gameCache.data,
                cached: true,
                cache_age_seconds: Math.round((now - new Date(gameCache.timestamp)) / 1000),
                next_update: gameCache.expires
            });
        }

        const freshData = await fetchSmartFlow();
        const expiresAt = new Date(now.getTime() + CACHE_DURATION);
        gameCache = { data: freshData, timestamp: now.toISOString(), expires: expiresAt };

        res.status(200).json({
            ...freshData,
            cached: false,
            cache_updated: now.toISOString(),
            next_update: expiresAt.toISOString()
        });

    } catch (error) {
        console.error('Handler error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

async function fetchSmartFlow() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;
    const baseUrl = 'https://api.odds-api.io/v3';

    // 1. Fetch sports list
    let sportsList = [];
    try {
        const sportsUrl = `${baseUrl}/sports?apiKey=${ODDS_API_KEY}`;
        totalApiCalls++;
        const sportsRes = await fetch(sportsUrl);
        if (!sportsRes.ok) throw new Error(await sportsRes.text());
        sportsList = await sportsRes.json();
    } catch (err) {
        return { success: false, games: [], errors: [{ step: 'sports', error: err.message }] };
    }

    // 2. Limit for safety (לא כל 100 ענפים, רק 6-7 עיקריים)
    const limitedSports = sportsList.slice(0, 6);

    for (const sport of limitedSports) {
        try {
            const eventsUrl = `${baseUrl}/events?sport=${sport.slug}&status=live,pending&limit=10&apiKey=${ODDS_API_KEY}`;
            totalApiCalls++;
            const eventsRes = await fetch(eventsUrl);
            if (!eventsRes.ok) continue;
            const events = await eventsRes.json();

            for (const event of events) {
                const gameWithOdds = await processEventWithOdds(event, baseUrl, totalApiCalls, sport.slug);
                if (gameWithOdds) {
                    allGames.push(gameWithOdds.game);
                    totalApiCalls = gameWithOdds.apiCalls;
                }
            }
        } catch (err) {
            errors.push({ sport: sport.slug, error: err.message });
        }
    }

    allGames.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
    return { success: true, total_games: allGames.length, games: allGames, api_calls_made: totalApiCalls, errors };
}

async function processEventWithOdds(event, baseUrl, currentApiCalls, sportHint) {
    const eventId = event.id;
    if (!eventId) return null;

    const homeTeam = event.home || event.home_team || 'Home';
    const awayTeam = event.away || event.away_team || 'Away';
    const league = event.league?.name || sportHint;
    const commenceTime = event.date || new Date().toISOString();
    const status = event.status || 'pending';
    const scores = event.scores || null;
    const sport = event.sport?.slug || sportHint;

    let bookmakers = [];
    try {
        const oddsUrl = `${baseUrl}/odds?eventId=${eventId}&apiKey=${ODDS_API_KEY}`;
        currentApiCalls++;
        const oddsRes = await fetch(oddsUrl);
        if (oddsRes.ok) {
            const oddsData = await oddsRes.json();
            bookmakers = processOddsData(oddsData, homeTeam, awayTeam, sport);
        }
    } catch (err) {
        console.log(`Odds fetch failed for ${eventId}: ${err.message}`);
    }

    if (bookmakers.length === 0) bookmakers = [createDefaultBookmaker(homeTeam, awayTeam, sport)];

    return {
        game: { id: eventId, sport, league, home_team: homeTeam, away_team: awayTeam, commence_time: commenceTime, status, scores, bookmakers },
        apiCalls: currentApiCalls
    };
}

function processOddsData(oddsData, homeTeam, awayTeam, sport) {
    const bookmakers = [];
    if (oddsData && oddsData.bookmakers) {
        for (const key of Object.keys(oddsData.bookmakers)) {
            const list = oddsData.bookmakers[key];
            if (Array.isArray(list)) {
                for (const bm of list.slice(0, 2)) {
                    bookmakers.push({
                        key: bm.name.toLowerCase().replace(/\s+/g, '_'),
                        title: bm.name,
                        markets: bm.odds ? [{ key: 'h2h', outcomes: buildOutcomes(bm.odds, homeTeam, awayTeam, sport) }] : []
                    });
                }
            }
        }
    }
    return bookmakers;
}

function buildOutcomes(oddsArr, homeTeam, awayTeam, sport) {
    const outcomes = [];
    if (Array.isArray(oddsArr)) {
        for (const o of oddsArr) {
            if (o.home) outcomes.push({ name: homeTeam, price: parseFloat(o.home) });
            if (o.away) outcomes.push({ name: awayTeam, price: parseFloat(o.away) });
            if (o.draw && sport !== 'basketball') outcomes.push({ name: 'Draw', price: parseFloat(o.draw) });
        }
    }
    return outcomes.length > 0 ? outcomes : [
        { name: homeTeam, price: 2.1 },
        { name: awayTeam, price: 1.9 }
    ];
}

function createDefaultBookmaker(homeTeam, awayTeam, sport) {
    const outcomes = [
        { name: homeTeam, price: 2.1 },
        { name: awayTeam, price: 1.9 }
    ];
    if (sport !== 'basketball') outcomes.push({ name: 'Draw', price: 3.2 });
    return { key: 'default', title: 'Default', markets: [{ key: 'h2h', outcomes }] };
}
