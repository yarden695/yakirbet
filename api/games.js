// YakirBet Vercel Backend - All Leagues with Live Scores - api/games.js
const ODDS_API_KEY = 'f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea';
const CACHE_DURATION = 60 * 1000; // 1 minute cache for near real-time updates

// In-memory cache
let gameCache = {
    data: null,
    timestamp: null,
    expires: null
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const now = new Date();
        const { force = false } = req.query;

        const isCacheValid = gameCache.data && 
                             gameCache.timestamp && 
                             gameCache.expires && 
                             now < gameCache.expires && 
                             !force;

        if (isCacheValid) {
            const cacheAge = Math.round((now - new Date(gameCache.timestamp)) / 1000);
            return res.status(200).json({
                ...gameCache.data,
                cached: true,
                cache_age_seconds: cacheAge,
                next_update: gameCache.expires,
                message: `Data served from cache (${cacheAge} seconds old)`
            });
        }

        console.log('Fetching fresh data (all sports & leagues)...');
        const freshData = await fetchAllSports();

        const expiresAt = new Date(now.getTime() + CACHE_DURATION);
        gameCache = {
            data: freshData,
            timestamp: now.toISOString(),
            expires: expiresAt
        };

        res.status(200).json({
            ...freshData,
            cached: false,
            cache_updated: now.toISOString(),
            next_update: expiresAt.toISOString(),
            message: 'Fresh data fetched and cached'
        });

    } catch (error) {
        console.error('Handler error:', error);
        if (gameCache.data) {
            const cacheAge = Math.round((new Date() - new Date(gameCache.timestamp)) / 1000);
            return res.status(200).json({
                ...gameCache.data,
                cached: true,
                stale: true,
                cache_age_seconds: cacheAge,
                error: 'Fresh data unavailable, serving cached data',
                message: `Stale data served due to API error (${cacheAge} seconds old)`
            });
        }
        res.status(500).json({
            success: false,
            error: 'Failed to fetch games',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

async function fetchAllSports() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;
    const baseUrl = 'https://api.odds-api.io/v3';

    let sportsList = [];
    try {
        const sportsUrl = `${baseUrl}/sports?apiKey=${ODDS_API_KEY}`;
        totalApiCalls++;
        const sportsRes = await fetch(sportsUrl, { headers: { 'Accept': 'application/json' } });
        if (!sportsRes.ok) throw new Error(await sportsRes.text());
        sportsList = await sportsRes.json();
    } catch (err) {
        console.error('Failed to fetch sports:', err.message);
        return { success: false, total_games: 0, games: [], api_calls_made: totalApiCalls, errors };
    }

    for (const sport of sportsList) {
        try {
            const eventsUrl = `${baseUrl}/events?sport=${sport.slug}&apiKey=${ODDS_API_KEY}&status=pending,live&limit=50`;
            totalApiCalls++;
            const eventsRes = await fetch(eventsUrl, { headers: { 'Accept': 'application/json' } });
            if (!eventsRes.ok) continue;
            const events = await eventsRes.json();

            for (const event of events) {
                const gameWithOdds = await processEventWithOdds(event, baseUrl, totalApiCalls, sport.slug);
                if (gameWithOdds) {
                    allGames.push(gameWithOdds.game);
                    totalApiCalls = gameWithOdds.apiCalls;
                }
                await new Promise(r => setTimeout(r, 200));
            }
        } catch (err) {
            errors.push({ sport: sport.slug, error: err.message, timestamp: new Date().toISOString() });
        }
    }

    return {
        success: allGames.length > 0,
        total_games: allGames.length,
        games: allGames.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time)),
        api_calls_made: totalApiCalls,
        errors
    };
}

async function processEventWithOdds(event, baseUrl, currentApiCalls, sportHint) {
    try {
        const eventId = event.id;
        const homeTeam = event.home || 'Home';
        const awayTeam = event.away || 'Away';
        const league = event.league?.name || sportHint;
        const commenceTime = event.date || new Date().toISOString();
        const status = event.status || 'pending';
        const scores = event.scores || null;

        if (!eventId) return null;

        const oddsUrl = `${baseUrl}/odds?eventId=${eventId}&apiKey=${ODDS_API_KEY}`;
        currentApiCalls++;
        let bookmakers = [];
        try {
            const oddsRes = await fetch(oddsUrl, { headers: { 'Accept': 'application/json' } });
            if (oddsRes.ok) {
                const oddsData = await oddsRes.json();
                bookmakers = processOddsData(oddsData, homeTeam, awayTeam, sportHint);
            }
        } catch {}

        if (bookmakers.length === 0) bookmakers = [createDefaultBookmaker(homeTeam, awayTeam, sportHint)];

        return {
            game: {
                id: eventId,
                sport: sportHint,
                league,
                home_team: homeTeam,
                away_team: awayTeam,
                commence_time: commenceTime,
                status,
                scores,
                bookmakers,
                fetched_at: new Date().toISOString()
            },
            apiCalls: currentApiCalls
        };
    } catch {
        return null;
    }
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
    return { key: 'bet365', title: 'Bet365', markets: [{ key: 'h2h', outcomes }] };
}
