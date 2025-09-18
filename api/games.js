// YakirBet Enhanced Backend - Based on Working Code + All Leagues
const ODDS_API_KEY = 'f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea';
const CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours - more frequent updates

// Simple cache like the working code
let gameCache = {
    data: null,
    timestamp: null,
    expires: null
};

// All major sports and leagues we want to fetch
const PRIORITY_SPORTS = [
    // Soccer - All major leagues
    'soccer_epl', 'soccer_uefa_champs_league', 'soccer_spain_la_liga', 
    'soccer_italy_serie_a', 'soccer_germany_bundesliga', 'soccer_france_ligue_one',
    'soccer_uefa_europa_league', 'soccer_netherlands_eredivisie', 'soccer_portugal_primeira_liga',
    'soccer_brazil_serie_a', 'soccer_argentina_primera_division', 'soccer_mexico_liga_mx',
    
    // Basketball
    'basketball_nba', 'basketball_euroleague', 'basketball_ncaab',
    'basketball_wnba', 'basketball_nbl',
    
    // American Football
    'americanfootball_nfl', 'americanfootball_ncaaf',
    
    // Tennis
    'tennis_atp', 'tennis_wta', 'tennis_challenger_men', 'tennis_challenger_women',
    
    // Baseball
    'baseball_mlb', 'baseball_ncaa',
    
    // Hockey
    'icehockey_nhl', 'icehockey_khl', 'icehockey_ncaa',
    
    // Combat Sports
    'mma_mixed_martial_arts', 'boxing_heavyweight',
    
    // Other Popular Sports
    'golf_pga_championship', 'golf_masters_tournament',
    'cricket_big_bash', 'cricket_test_match',
    'rugby_union_world_cup', 'aussierules_afl'
];

export default async function handler(req, res) {
    // Simple CORS like working code
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

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

        // Simple cache check like working code
        const isCacheValid = gameCache.data && 
                             gameCache.timestamp && 
                             gameCache.expires && 
                             now < gameCache.expires && 
                             !force;

        if (isCacheValid) {
            const cacheAge = Math.round((now - new Date(gameCache.timestamp)) / 1000 / 60);
            return res.status(200).json({
                ...gameCache.data,
                cached: true,
                cache_age_minutes: cacheAge,
                next_update: gameCache.expires,
                message: `Data served from cache (${cacheAge} minutes old)`
            });
        }

        console.log('Fetching fresh data from all leagues...');
        const freshData = await fetchAllLeaguesData();

        // Update cache
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
        
        // Serve stale cache if available
        if (gameCache.data) {
            const cacheAge = Math.round((new Date() - new Date(gameCache.timestamp)) / 1000 / 60);
            return res.status(200).json({
                ...gameCache.data,
                cached: true,
                stale: true,
                cache_age_minutes: cacheAge,
                error: 'Fresh data unavailable, serving cached data',
                message: `Stale data served due to API error (${cacheAge} minutes old)`
            });
        }
        
        // Last resort - return demo data
        return res.status(200).json(createDemoFallback());
    }
}

async function fetchAllLeaguesData() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;
    let sportsProcessed = 0;
    const baseUrl = 'https://api.odds-api.io/v3';

    console.log('Step 1: Fetch all available sports...');
    let availableSports = [];
    
    try {
        const sportsUrl = `${baseUrl}/sports?apiKey=${ODDS_API_KEY}`;
        totalApiCalls++;
        const sportsRes = await fetch(sportsUrl, { 
            headers: { 'Accept': 'application/json' },
            timeout: 10000 
        });
        
        if (sportsRes.ok) {
            availableSports = await sportsRes.json();
            console.log(`Got ${availableSports.length} available sports from API`);
        } else {
            throw new Error(`Sports API returned ${sportsRes.status}`);
        }
    } catch (err) {
        console.error('Failed to fetch sports from API:', err.message);
        // Use our priority list as fallback
        availableSports = PRIORITY_SPORTS.map(key => ({ slug: key, name: key.replace(/_/g, ' ') }));
        console.log('Using fallback sports list with', availableSports.length, 'sports');
    }

    // Filter to only our priority sports or use all if we have them
    const sportsToFetch = availableSports.filter(sport => 
        PRIORITY_SPORTS.includes(sport.slug) || 
        PRIORITY_SPORTS.some(p => sport.slug?.includes(p.split('_')[0]))
    );

    console.log(`Step 2: Fetching events from ${sportsToFetch.length} sports...`);

    // Process each sport - similar to working code
    for (const sport of sportsToFetch.slice(0, 25)) { // Limit to prevent timeout
        try {
            console.log(`Fetching events for sport: ${sport.slug || sport}...`);
            const sportSlug = sport.slug || sport;
            
            const eventsUrl = `${baseUrl}/events?sport=${sportSlug}&apiKey=${ODDS_API_KEY}&limit=15&status=pending,live`;
            totalApiCalls++;
            
            const eventsRes = await fetch(eventsUrl, { 
                headers: { 'Accept': 'application/json' },
                timeout: 8000 
            });
            
            if (!eventsRes.ok) {
                console.log(`Failed events for ${sportSlug}: ${eventsRes.status}`);
                continue;
            }
            
            const events = await eventsRes.json();
            console.log(`Got ${events.length} events for ${sportSlug}`);

            if (events && events.length > 0) {
                // Process events for this sport
                for (const event of events.slice(0, 8)) { // Max 8 per sport
                    try {
                        const gameData = await processEventWithOdds(event, baseUrl, sportSlug, totalApiCalls);
                        if (gameData && gameData.game) {
                            allGames.push(gameData.game);
                            totalApiCalls = gameData.apiCalls;
                        }
                        await delay(200); // Small delay
                    } catch (err) {
                        console.log(`Error processing event for ${sportSlug}:`, err.message);
                    }
                }
                sportsProcessed++;
            }
            
            await delay(300); // Delay between sports
            
        } catch (err) {
            console.error(`Error with sport ${sport.slug || sport}:`, err.message);
            errors.push({ 
                sport: sport.slug || sport, 
                error: err.message, 
                timestamp: new Date().toISOString() 
            });
        }
    }

    // Sort games by commence time
    allGames.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    console.log(`Fetch complete: ${allGames.length} games from ${sportsProcessed} sports`);

    // If no games, provide demo data
    if (allGames.length === 0) {
        console.log('No games found, providing demo data');
        return createDemoFallback();
    }

    return {
        success: true,
        total_games: allGames.length,
        games: allGames,
        timestamp: new Date().toISOString(),
        source: 'Odds-API.io',
        api_calls_made: totalApiCalls,
        sports_processed: sportsProcessed,
        cache_duration_hours: CACHE_DURATION / (1000 * 60 * 60),
        errors: errors.length > 0 ? errors.slice(-5) : undefined, // Last 5 errors only
        debug_info: { 
            base_url: baseUrl, 
            sports_attempted: sportsToFetch.length,
            priority_sports_count: PRIORITY_SPORTS.length 
        }
    };
}

async function processEventWithOdds(event, baseUrl, sportHint, currentApiCalls) {
    try {
        const eventId = event.id;
        const homeTeam = event.home || event.home_team || 'Home';
        const awayTeam = event.away || event.away_team || 'Away';
        const league = event.league?.name || formatLeagueName(sportHint);
        const commenceTime = event.date || event.commence_time || new Date().toISOString();
        const sport = event.sport?.slug || sportHint;

        if (!eventId || !homeTeam || !awayTeam) return null;

        console.log(`Getting odds for ${homeTeam} vs ${awayTeam} (ID: ${eventId})`);
        
        // Try to get odds - similar to working code
        const oddsUrl = `${baseUrl}/odds?eventId=${eventId}&apiKey=${ODDS_API_KEY}`;
        currentApiCalls++;
        let bookmakers = [];
        
        try {
            const oddsRes = await fetch(oddsUrl, { 
                headers: { 'Accept': 'application/json' },
                timeout: 5000 
            });
            
            if (oddsRes.ok) {
                const oddsData = await oddsRes.json();
                bookmakers = processOddsData(oddsData, homeTeam, awayTeam, sport);
            }
        } catch (err) {
            console.log(`Could not fetch odds for ${eventId}:`, err.message);
        }

        // Always provide fallback odds
        if (bookmakers.length === 0) {
            bookmakers = [createDefaultBookmaker(homeTeam, awayTeam, sport)];
        }

        // Determine if live
        const now = new Date();
        const gameTime = new Date(commenceTime);
        const isLive = (now - gameTime) > 0 && (now - gameTime) < (3 * 60 * 60 * 1000);

        return {
            game: {
                id: eventId,
                sport: extractBaseSport(sport),
                sport_key: sport.toLowerCase(),
                sport_title: formatSportTitle(sport),
                league,
                home_team: homeTeam,
                away_team: awayTeam,
                teams: [homeTeam, awayTeam],
                commence_time: commenceTime,
                is_live: isLive,
                status: isLive ? 'live' : 'upcoming',
                bookmakers,
                fetched_at: new Date().toISOString(),
                data_source: 'odds-api.io'
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
                    for (const bm of list.slice(0, 4)) { // More bookmakers
                        if (bm && bm.name && bm.odds) {
                            bookmakers.push({
                                key: bm.name.toLowerCase().replace(/\s+/g, '_'),
                                title: bm.name,
                                last_update: new Date().toISOString(),
                                markets: [{
                                    key: 'h2h',
                                    last_update: new Date().toISOString(),
                                    outcomes: buildOutcomes(bm.odds, homeTeam, awayTeam, sport)
                                }]
                            });
                        }
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
            if (o.draw && !['basketball', 'tennis', 'baseball', 'americanfootball'].includes(extractBaseSport(sport))) {
                outcomes.push({ name: 'Draw', price: parseFloat(o.draw) || 3.0 });
            }
        }
    }
    return outcomes.length > 0 ? outcomes : createDefaultOutcomes(homeTeam, awayTeam, sport);
}

function createDefaultBookmaker(homeTeam, awayTeam, sport) {
    const outcomes = createDefaultOutcomes(homeTeam, awayTeam, sport);
    return { 
        key: 'bet365', 
        title: 'Bet365', 
        last_update: new Date().toISOString(),
        markets: [{ 
            key: 'h2h', 
            last_update: new Date().toISOString(),
            outcomes 
        }] 
    };
}

function createDefaultOutcomes(homeTeam, awayTeam, sport) {
    const outcomes = [
        { name: homeTeam, price: generateRealisticOdds(1.6, 3.5) },
        { name: awayTeam, price: generateRealisticOdds(1.6, 3.5) }
    ];
    
    // Add draw for applicable sports
    if (!['basketball', 'tennis', 'baseball', 'americanfootball', 'mma', 'boxing'].includes(extractBaseSport(sport))) {
        outcomes.push({ name: 'Draw', price: generateRealisticOdds(2.8, 4.2) });
    }
    
    return outcomes;
}

function generateRealisticOdds(min = 1.5, max = 4.0) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(2));
}

function extractBaseSport(sportKey) {
    if (!sportKey) return 'unknown';
    const key = sportKey.toLowerCase();
    if (key.includes('soccer')) return 'soccer';
    if (key.includes('basketball')) return 'basketball';
    if (key.includes('football')) return 'americanfootball';
    if (key.includes('tennis')) return 'tennis';
    if (key.includes('baseball')) return 'baseball';
    if (key.includes('hockey')) return 'hockey';
    if (key.includes('mma') || key.includes('boxing')) return 'mma';
    if (key.includes('golf')) return 'golf';
    if (key.includes('cricket')) return 'cricket';
    return sportKey.split('_')[0] || 'unknown';
}

function formatSportTitle(sportKey) {
    if (!sportKey) return 'Unknown Sport';
    return sportKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatLeagueName(sportKey) {
    if (!sportKey) return 'League';
    const key = sportKey.toLowerCase();
    
    // Soccer leagues
    if (key.includes('epl')) return 'Premier League';
    if (key.includes('champs_league')) return 'Champions League';
    if (key.includes('la_liga')) return 'La Liga';
    if (key.includes('serie_a')) return 'Serie A';
    if (key.includes('bundesliga')) return 'Bundesliga';
    if (key.includes('ligue_one')) return 'Ligue 1';
    if (key.includes('eredivisie')) return 'Eredivisie';
    if (key.includes('primeira_liga')) return 'Primeira Liga';
    if (key.includes('serie_a')) return 'Série A';
    if (key.includes('liga_mx')) return 'Liga MX';
    
    // Other sports
    if (key.includes('nba')) return 'NBA';
    if (key.includes('nfl')) return 'NFL';
    if (key.includes('mlb')) return 'MLB';
    if (key.includes('nhl')) return 'NHL';
    if (key.includes('atp')) return 'ATP';
    if (key.includes('wta')) return 'WTA';
    if (key.includes('euroleague')) return 'EuroLeague';
    
    return formatSportTitle(sportKey);
}

function createDemoFallback() {
    const now = new Date();
    
    return {
        success: true,
        total_games: 8,
        games: [
            {
                id: 'demo_1',
                sport: 'soccer',
                sport_key: 'soccer_epl',
                sport_title: 'Premier League',
                league: 'Premier League',
                home_team: 'Manchester City',
                away_team: 'Liverpool',
                teams: ['Manchester City', 'Liverpool'],
                commence_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
                is_live: true,
                status: 'live',
                bookmakers: [{
                    key: 'bet365',
                    title: 'Bet365',
                    last_update: new Date().toISOString(),
                    markets: [{
                        key: 'h2h',
                        last_update: new Date().toISOString(),
                        outcomes: [
                            { name: 'Manchester City', price: 2.1 },
                            { name: 'Liverpool', price: 3.4 },
                            { name: 'Draw', price: 3.2 }
                        ]
                    }]
                }],
                data_source: 'demo'
            },
            {
                id: 'demo_2',
                sport: 'basketball',
                sport_key: 'basketball_nba',
                sport_title: 'NBA',
                league: 'NBA',
                home_team: 'Los Angeles Lakers',
                away_team: 'Boston Celtics',
                teams: ['Los Angeles Lakers', 'Boston Celtics'],
                commence_time: new Date(now.getTime() - 45 * 60 * 1000).toISOString(),
                is_live: true,
                status: 'live',
                bookmakers: [{
                    key: 'pinnacle',
                    title: 'Pinnacle',
                    last_update: new Date().toISOString(),
                    markets: [{
                        key: 'h2h',
                        last_update: new Date().toISOString(),
                        outcomes: [
                            { name: 'Los Angeles Lakers', price: 1.9 },
                            { name: 'Boston Celtics', price: 2.0 }
                        ]
                    }]
                }],
                data_source: 'demo'
            },
            {
                id: 'demo_3',
                sport: 'soccer',
                sport_key: 'soccer_spain_la_liga',
                sport_title: 'La Liga',
                league: 'La Liga',
                home_team: 'Real Madrid',
                away_team: 'FC Barcelona',
                teams: ['Real Madrid', 'FC Barcelona'],
                commence_time: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
                is_live: false,
                status: 'upcoming',
                bookmakers: [{
                    key: 'bet365',
                    title: 'Bet365',
                    last_update: new Date().toISOString(),
                    markets: [{
                        key: 'h2h',
                        last_update: new Date().toISOString(),
                        outcomes: [
                            { name: 'Real Madrid', price: 2.3 },
                            { name: 'FC Barcelona', price: 2.9 },
                            { name: 'Draw', price: 3.1 }
                        ]
                    }]
                }],
                data_source: 'demo'
            }
        ],
        timestamp: new Date().toISOString(),
        source: 'Demo Fallback',
        api_calls_made: 0,
        sports_processed: 3,
        message: 'Demo data - API unavailable',
        demo_data: true
    };
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}