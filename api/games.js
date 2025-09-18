// YakirBet Vercel Backend - Popular Leagues Flow with Live Scores - api/games.js
const ODDS_API_KEY = 'f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea';
const CACHE_DURATION = 60 * 1000; // 1 minute (כדי לעדכן live odds + scores מהר יותר)

// In-memory cache
let gameCache = {
    data: null,
    timestamp: null,
    expires: null
};

// ליגות פופולריות - הורחב כדי לכלול יותר כמו באתרים גדולים
const POPULAR_LEAGUES = {
    football: [
        'england-premier-league',
        'england-championship',
        'spain-primera-division',
        'germany-bundesliga',
        'italy-serie-a',
        'france-ligue-1',
        'netherlands-eredivisie',
        'portugal-primeira-liga',
        'turkey-super-lig',
        'belgium-first-division-a',
        'greece-super-league',
        'israel-ligat-haal',
        'uefa-champions-league',
        'uefa-europa-league',
        'uefa-conference-league',
        'fifa-world-cup-qualification',
        'uefa-euro-qualification'
    ],
    basketball: [
        'nba',
        'euroleague',
        'spain-acb',
        'germany-bbl',
        'italy-legabasket',
        'france-pro-a',
        'israel-super-league'
    ],
    tennis: [
        'atp',
        'wta',
        'itf-men',
        'itf-women',
        'challenger'
    ],
    football_american: [
        'nfl',
        'ncaa'
    ],
    ice_hockey: [
        'nhl',
        'khl',
        'sweden-shl',
        'finland-liiga'
    ]
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

        console.log('Fetching fresh data (popular leagues only)...');
        const freshData = await fetchPopularLeaguesFlow();

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
            error: 'Failed to fetch games from Odds-API.io',
            message: error.message,
            timestamp: new Date().toISOString(),
            source: 'Odds-API.io'
        });
    }
}

async function fetchPopularLeaguesFlow() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;
    const baseUrl = 'https://api.odds-api.io/v3';

    for (const sport of Object.keys(POPULAR_LEAGUES)) {
        for (const league of POPULAR_LEAGUES[sport]) {
            try {
                console.log(`Fetching events for ${sport} - ${league}`);
                const eventsUrl = `${baseUrl}/events?sport=${sport}&league=${league}&status=pending,live&limit=20&apiKey=${ODDS_API_KEY}`;
                totalApiCalls++;
                const eventsRes = await fetch(eventsUrl, { headers: { 'Accept': 'application/json' } });
                if (!eventsRes.ok) {
                    console.log(`❌ Failed ${sport}/${league}:`, await eventsRes.text());
                    continue;
                }
                const events = await eventsRes.json();
                for (const event of events.slice(0, 10)) {
                    const gameWithOdds = await processEventWithOdds(event, baseUrl, totalApiCalls, sport);
                    if (gameWithOdds) {
                        allGames.push(gameWithOdds.game);
                        totalApiCalls = gameWithOdds.apiCalls;
                    }
                    await new Promise(r => setTimeout(r, 200));
                }
            } catch (err) {
                console.error(`Error with ${sport}/${league}:`, err.message);
                errors.push({ sport, league, error: err.message, timestamp: new Date().toISOString() });
            }
        }
    }

    allGames.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    return {
        success: allGames.length > 0,
        total_games: allGames.length,
        games: allGames,
        timestamp: new Date().toISOString(),
        source: 'Odds-API.io',
        api_calls_made: totalApiCalls,
        cache_duration_seconds: CACHE_DURATION / 1000,
        errors: errors.length > 0 ? errors : undefined,
        debug_info: { base_url: baseUrl, flow_used: 'popular_leagues', endpoints_tried: ['/events','/odds'] }
    };
}

async function processEventWithOdds(event, baseUrl, currentApiCalls, sport) {
    try {
        const eventId = event.id;
        const homeTeam = event.home || 'Home';
        const awayTeam = event.away || 'Away';
        const league = event.league?.name || sport;
        const commenceTime = event.date || new Date().toISOString();
        const status = event.status || 'pending';
        const scores = event.scores || null;

        if (!eventId || !homeTeam || !awayTeam) return null;

        const oddsUrl = `${baseUrl}/odds?eventId=${eventId}&apiKey=${ODDS_API_KEY}`;
        currentApiCalls++;
        let bookmakers = [];
        try {
            const oddsRes = await fetch(oddsUrl, { headers: { 'Accept': 'application/json' } });
            if (oddsRes.ok) {
                const oddsData = await oddsRes.json();
                bookmakers = processOddsData(oddsData, homeTeam, awayTeam, sport);
            }
        } catch (err) {
            console.log(`Could not fetch odds for ${eventId}:`, err.message);
        }

        if (bookmakers.length === 0) bookmakers = [createDefaultBookmaker(homeTeam, awayTeam, sport)];

        return {
            game: {
                id: eventId,
                sport,
                sport_key: sport.toLowerCase(),
                league,
                home_team: homeTeam,
                away_team: awayTeam,
                teams: [homeTeam, awayTeam],
                commence_time: commenceTime,
                status,
                scores,
                bookmakers,
                fetched_at: new Date().toISOString()
            },
            apiCalls: currentApiCalls
        };
    } catch (err) {
        console.error('Error processing event with odds:', err);
        return null;
    }
}

function processOddsData(oddsData, homeTeam, awayTeam, sport) {
    const bookmakers = [];
    try {
        if (oddsData && oddsData.bookmakers) {
            for (const key of Object.keys(oddsData.bookmakers)) {
                const list = oddsData.bookmakers[key];
                if (Array.isArray(list)) {
                    for (const bm of list.slice(0, 3)) {
                        bookmakers.push({
                            key: bm.name.toLowerCase().replace(/\s+/g, '_'),
                            title: bm.name,
                            markets: bm.odds ? [{ key: 'h2h', outcomes: buildOutcomes(bm.odds, homeTeam, awayTeam, sport) }] : []
                        });
                    }
                }
            }
        }
    } catch (err) {
        console.error('Error parsing odds data:', err.message);
    }
    return bookmakers;
}

function buildOutcomes(oddsArr, homeTeam, awayTeam, sport) {
    const outcomes = [];
    if (Array.isArray(oddsArr)) {
        for (const o of oddsArr) {
            if (o.home) outcomes.push({ name: homeTeam, price: parseFloat(o.home) || 2.0 });
            if (o.away) outcomes.push({ name: awayTeam, price: parseFloat(o.away) || 2.0 });
            if (o.draw && sport !== 'basketball') outcomes.push({ name: 'Draw', price: parseFloat(o.draw) || 3.0 });
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
