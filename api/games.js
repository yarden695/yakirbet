// YakirBet Vercel Backend - Correct Odds-API.io Flow - api/games.js
const ODDS_API_KEY = 'f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache
let gameCache = {
    data: null,
    timestamp: null,
    expires: null
};

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

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

        // Check cache validity
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

        // Fetch fresh data using correct Odds-API.io flow
        console.log('Fetching fresh data using correct Odds-API.io endpoints...');
        const freshData = await fetchUsingCorrectFlow();
        
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
        
        // If we have stale cache data, serve it
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

        // No cache available
        res.status(500).json({
            success: false,
            error: 'Failed to fetch games from Odds-API.io',
            message: error.message,
            timestamp: new Date().toISOString(),
            source: 'Odds-API.io'
        });
    }
}

async function fetchUsingCorrectFlow() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;

    const baseUrl = 'https://api.odds-api.io/v3';
    
    console.log('Starting correct Odds-API.io flow...');

    // Step 1 הוסר — לא מנסים יותר /events בלי sport

    // Step 2: Try specific sports
    const sportsToTry = [
        'soccer',
        'basketball',
        'americanfootball',
        'baseball',
        'icehockey',
        'mma',
        'boxing',
        'tennis',
        'cricket',
        'esports'
    ];
    
    for (const sport of sportsToTry) {
        try {
            console.log(`Trying events for sport: ${sport}...`);
            const sportEventsUrl = `${baseUrl}/events?sport=${sport}&apiKey=${ODDS_API_KEY}`;
            
            totalApiCalls++;
            const sportEventsResponse = await fetch(sportEventsUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'YakirBet/1.0'
                }
            });

            if (sportEventsResponse.ok) {
                const sportEvents = await sportEventsResponse.json();
                console.log(`Got events for ${sport}:`, Array.isArray(sportEvents) ? sportEvents.length : 'not array');

                if (Array.isArray(sportEvents) && sportEvents.length > 0) {
                    console.log(`✅ Found events for ${sport}`);
                    
                    const limitedSportEvents = sportEvents.slice(0, 5);
                    for (const event of limitedSportEvents) {
                        try {
                            const gameWithOdds = await processEventWithOdds(event, baseUrl, totalApiCalls, sport);
                            if (gameWithOdds) {
                                allGames.push(gameWithOdds.game);
                                totalApiCalls = gameWithOdds.apiCalls;
                            }
                            
                            await new Promise(resolve => setTimeout(resolve, 300));
                            
                        } catch (sportEventError) {
                            console.log(`Error processing ${sport} event:`, sportEventError.message);
                        }
                    }
                    
                    if (allGames.length > 0) {
                        console.log(`Got games from ${sport}, continuing...`);
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (sportError) {
            console.error(`Error with sport ${sport}:`, sportError.message);
            errors.push({
                sport: sport,
                error: sportError.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Sort by start time
    allGames.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    console.log(`Final result: ${allGames.length} games from ${totalApiCalls} API calls`);

    return {
        success: allGames.length > 0,
        total_games: allGames.length,
        games: allGames,
        timestamp: new Date().toISOString(),
        source: 'Odds-API.io',
        api_calls_made: totalApiCalls,
        cache_duration_hours: CACHE_DURATION / (1000 * 60 * 60),
        errors: errors.length > 0 ? errors : undefined,
        debug_info: {
            base_url: baseUrl,
            flow_used: 'events_by_sports_then_odds',
            endpoints_tried: ['/events', '/odds']
        }
    };
}

async function processEventWithOdds(event, baseUrl, currentApiCalls, sportHint) {
    try {
        const eventId = event.id;
        const homeTeam = event.home_team || event.home || event.homeTeam || 'Home';
        const awayTeam = event.away_team || event.away || event.awayTeam || 'Away';
        const league = event.league || event.competition || sportHint || 'League';
        const commenceTime = event.commence_time || event.start_time || new Date().toISOString();
        const sport = event.sport || sportHint || 'soccer';

        if (!eventId || !homeTeam || !awayTeam || homeTeam === 'Home' || awayTeam === 'Away') {
            console.log(`Skipping event - missing data: ID=${eventId}, Home=${homeTeam}, Away=${awayTeam}`);
            return null;
        }

        console.log(`Getting odds for event: ${homeTeam} vs ${awayTeam} (ID: ${eventId})`);

        let bookmakers = [];
        try {
            const oddsUrl = `${baseUrl}/odds?eventId=${eventId}&apiKey=${ODDS_API_KEY}`;
            console.log(`Odds URL: ${oddsUrl.replace(ODDS_API_KEY, 'HIDDEN')}`);
            
            currentApiCalls++;
            const oddsResponse = await fetch(oddsUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'YakirBet/1.0'
                }
            });

            console.log(`Odds response for event ${eventId}: ${oddsResponse.status}`);

            if (oddsResponse.ok) {
                const oddsData = await oddsResponse.json();
                console.log(`Got odds data for ${eventId}:`, typeof oddsData);

                bookmakers = processOddsData(oddsData, homeTeam, awayTeam, sport);
                console.log(`Processed ${bookmakers.length} bookmakers for ${eventId}`);
            } else {
                const errorText = await oddsResponse.text();
                console.log(`Odds failed for ${eventId}: ${errorText}`);
            }
        } catch (oddsError) {
            console.log(`Could not get odds for event ${eventId}:`, oddsError.message);
        }

        if (bookmakers.length === 0) {
            bookmakers = [createDefaultBookmaker(homeTeam, awayTeam, sport)];
            console.log(`Using default bookmaker for ${eventId}`);
        }

        const sportType = determineSportType(sport, league);

        const game = {
            id: eventId,
            sport: sportType,
            sport_key: sport.toLowerCase().replace(/\s+/g, '_'),
            league: league,
            home_team: homeTeam,
            away_team: awayTeam,
            teams: [homeTeam, awayTeam],
            commence_time: commenceTime,
            bookmakers: bookmakers,
            fetched_at: new Date().toISOString()
        };

        return { game, apiCalls: currentApiCalls };

    } catch (error) {
        console.error('Error processing event with odds:', error);
        return null;
    }
}

function processOddsData(oddsData, homeTeam, awayTeam, sport) {
    const bookmakers = [];
    
    try {
        if (Array.isArray(oddsData)) {
            for (const bookmakerData of oddsData.slice(0, 3)) {
                const processedBookmaker = processBookmakerData(bookmakerData, homeTeam, awayTeam, sport);
                if (processedBookmaker) {
                    bookmakers.push(processedBookmaker);
                }
            }
        } else if (oddsData && typeof oddsData === 'object') {
            if (oddsData.bookmakers && Array.isArray(oddsData.bookmakers)) {
                for (const bookmakerData of oddsData.bookmakers.slice(0, 3)) {
                    const processedBookmaker = processBookmakerData(bookmakerData, homeTeam, awayTeam, sport);
                    if (processedBookmaker) {
                        bookmakers.push(processedBookmaker);
                    }
                }
            } else if (oddsData.odds) {
                const processedBookmaker = processBookmakerData(oddsData, homeTeam, awayTeam, sport);
                if (processedBookmaker) {
                    bookmakers.push(processedBookmaker);
                }
            }
        }
    } catch (error) {
        console.error('Error processing odds data:', error);
    }
    
    return bookmakers;
}

function processBookmakerData(bookmakerData, homeTeam, awayTeam, sport) {
    try {
        if (!bookmakerData || typeof bookmakerData !== 'object') {
            return null;
        }

        const bookmakerName = bookmakerData.bookmaker || bookmakerData.name || bookmakerData.key || 'Bet365';
        const outcomes = [];

        if (bookmakerData.markets && Array.isArray(bookmakerData.markets)) {
            const market = bookmakerData.markets[0];
            if (market && market.outcomes) {
                for (const outcome of market.outcomes) {
                    outcomes.push({
                        name: outcome.name,
                        price: parseFloat(outcome.price) || 2.0
                    });
                }
            }
        } else if (bookmakerData.odds) {
            const oddsObj = bookmakerData.odds;
            if (oddsObj.home) outcomes.push({ name: homeTeam, price: parseFloat(oddsObj.home) });
            if (oddsObj.away) outcomes.push({ name: awayTeam, price: parseFloat(oddsObj.away) });
            if (oddsObj.draw && sport !== 'basketball') outcomes.push({ name: 'Draw', price: parseFloat(oddsObj.draw) });
        } else if (bookmakerData.home_odds) {
            outcomes.push({ name: homeTeam, price: parseFloat(bookmakerData.home_odds) });
            outcomes.push({ name: awayTeam, price: parseFloat(bookmakerData.away_odds || 2.0) });
            if (bookmakerData.draw_odds && sport !== 'basketball') {
                outcomes.push({ name: 'Draw', price: parseFloat(bookmakerData.draw_odds) });
            }
        }

        if (outcomes.length >= 2) {
            return {
                key: bookmakerName.toLowerCase().replace(/\s+/g, '_'),
                title: bookmakerName,
                markets: [{
                    key: 'h2h',
                    outcomes: outcomes
                }]
            };
        }

    } catch (error) {
        console.error('Error processing bookmaker data:', error);
    }
    
    return null;
}

function createDefaultBookmaker(homeTeam, awayTeam, sport) {
    const outcomes = [
        { name: homeTeam, price: 2.1 },
        { name: awayTeam, price: 1.9 }
    ];

    if (sport !== 'basketball' && !sport?.toLowerCase().includes('basketball')) {
        outcomes.push({ name: 'Draw', price: 3.2 });
    }

    return {
        key: 'bet365',
        title: 'Bet365',
        markets: [{
            key: 'h2h',
            outcomes: outcomes
        }]
    };
}

function determineSportType(sport, league) {
    const combined = [sport, league].join(' ').toLowerCase();
    
    if (combined.includes('basketball') || combined.includes('nba')) {
        return 'basketball';
    } else if (combined.includes('football') || combined.includes('soccer') || combined.includes('premier') || combined.includes('liga')) {
        return 'soccer';
    } else {
        return 'soccer'; // default
    }
}
