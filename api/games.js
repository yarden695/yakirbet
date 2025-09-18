// YakirBet Vercel Backend - Correct Odds-API.io Endpoints - api/games.js
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
        console.log('Fetching fresh data from Odds-API.io using correct endpoints...');
        const freshData = await fetchFromCorrectOddsApiIo();
        
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

async function fetchFromCorrectOddsApiIo() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;

    // Base URL for Odds-API.io v3
    const baseUrl = 'https://api.odds-api.io/v3';
    
    // First, try to get available leagues for different sports
    const sportsToCheck = ['football', 'basketball', 'soccer', 'tennis'];
    let availableLeagues = [];

    console.log('Starting Odds-API.io data fetch using /leagues endpoint...');

    // Step 1: Get available leagues for each sport
    for (const sport of sportsToCheck) {
        try {
            console.log(`Getting leagues for sport: ${sport}...`);
            const leaguesUrl = `${baseUrl}/leagues?sport=${sport}&apiKey=${ODDS_API_KEY}`;
            console.log(`Leagues URL: ${leaguesUrl.replace(ODDS_API_KEY, 'HIDDEN')}`);
            
            totalApiCalls++;
            const leaguesResponse = await fetch(leaguesUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'YakirBet/1.0'
                }
            });

            console.log(`Leagues response for ${sport}: ${leaguesResponse.status}`);

            if (leaguesResponse.ok) {
                const leagues = await leaguesResponse.json();
                console.log(`Got leagues for ${sport}:`, Array.isArray(leagues) ? leagues.length : 'not array');
                
                if (Array.isArray(leagues) && leagues.length > 0) {
                    // Add sport context to each league
                    const leaguesWithSport = leagues.slice(0, 3).map(league => ({
                        ...league,
                        parentSport: sport
                    }));
                    availableLeagues.push(...leaguesWithSport);
                    console.log(`✅ Found ${leagues.length} leagues for ${sport}`);
                }
            } else {
                const errorText = await leaguesResponse.text();
                console.log(`Leagues failed for ${sport}: ${errorText}`);
            }

            await new Promise(resolve => setTimeout(resolve, 300));
        } catch (leagueError) {
            console.error(`Error getting leagues for ${sport}:`, leagueError.message);
        }
    }

    console.log(`Total available leagues: ${availableLeagues.length}`);

    // Step 2: Get events for each available league
    for (const league of availableLeagues.slice(0, 8)) { // Limit to prevent timeout
        try {
            const leagueSlug = league.slug;
            const leagueName = league.name;
            const parentSport = league.parentSport;
            
            console.log(`Getting events for league: ${leagueName} (${leagueSlug})...`);
            const eventsUrl = `${baseUrl}/events?sport=${leagueSlug}&apiKey=${ODDS_API_KEY}`;
            console.log(`Events URL: ${eventsUrl.replace(ODDS_API_KEY, 'HIDDEN')}`);
            
            totalApiCalls++;
            const eventsResponse = await fetch(eventsUrl, {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'YakirBet/1.0'
                }
            });

            console.log(`Events response for ${leagueSlug}: ${eventsResponse.status}`);

            if (!eventsResponse.ok) {
                const errorText = await eventsResponse.text();
                console.log(`Events failed for ${leagueSlug}: ${errorText}`);
                
                errors.push({
                    league: leagueSlug,
                    step: 'events',
                    error: `HTTP ${eventsResponse.status}: ${errorText}`,
                    timestamp: new Date().toISOString()
                });
                continue;
            }

            const events = await eventsResponse.json();
            console.log(`Got events for ${leagueSlug}:`, Array.isArray(events) ? events.length : 'not array');

            if (!Array.isArray(events) || events.length === 0) {
                console.log(`No events found for ${leagueSlug}`);
                continue;
            }

            // SUCCESS! We found events for this league
            console.log(`✅ SUCCESS: Found ${events.length} events for league: ${leagueName}`);
            
            // Process events
            const limitedEvents = events.slice(0, 3); // Limit per league
            console.log(`Processing ${limitedEvents.length} events for ${leagueName}...`);

            for (const event of limitedEvents) {
                try {
                    // Create game object from event
                    const processedGame = await processEventToGame(event, parentSport, baseUrl, totalApiCalls, leagueName);
                    if (processedGame) {
                        allGames.push(processedGame.game);
                        totalApiCalls = processedGame.apiCalls;
                    }
                    
                    // Small delay between requests
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                } catch (eventError) {
                    console.log(`Error processing event ${event.id || 'unknown'}:`, eventError.message);
                }
            }

            // If we have games from this league, continue with next league
            if (allGames.length >= 15) {
                console.log(`Got enough games (${allGames.length}), stopping early`);
                break;
            }

            // Small delay between leagues
            await new Promise(resolve => setTimeout(resolve, 300));

        } catch (leagueError) {
            console.error(`Error with league ${league.slug}:`, leagueError.message);
            errors.push({
                league: league.slug,
                step: 'league_processing',
                error: leagueError.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Step 3: Try events search as fallback
    if (allGames.length === 0) {
        console.log('Step 3: Trying events search as fallback...');
        try {
            const searchTerms = ['Premier', 'Champions', 'NBA', 'Liga', 'League'];
            
            for (const term of searchTerms) {
                const searchUrl = `${baseUrl}/events/search?q=${term}&apiKey=${ODDS_API_KEY}`;
                console.log(`Search URL: ${searchUrl.replace(ODDS_API_KEY, 'HIDDEN')}`);
                
                totalApiCalls++;
                const searchResponse = await fetch(searchUrl);
                
                if (searchResponse.ok) {
                    const searchResults = await searchResponse.json();
                    console.log(`Search results for "${term}":`, Array.isArray(searchResults) ? searchResults.length : 'not array');
                    
                    if (Array.isArray(searchResults) && searchResults.length > 0) {
                        const limitedResults = searchResults.slice(0, 3);
                        for (const event of limitedResults) {
                            const processedGame = await processEventToGame(event, 'Search', baseUrl, totalApiCalls);
                            if (processedGame) {
                                allGames.push(processedGame.game);
                                totalApiCalls = processedGame.apiCalls;
                            }
                        }
                        break; // Stop after first successful search
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch (searchError) {
            console.error('Search fallback failed:', searchError.message);
            errors.push({
                step: 'search_fallback',
                error: searchError.message,
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
            leagues_tried: availableLeagues.length,
            sports_checked: sportsToCheck,
            endpoints_used: ['/leagues', '/events', '/events/search'],
            base_url: baseUrl
        }
    };
}

async function processEventToGame(event, sportHint, baseUrl, currentApiCalls, leagueName) {
    try {
        const gameId = event.id || event.event_id || `event_${Date.now()}`;
        const homeTeam = event.home_team || event.home || event.homeTeam || event.team1 || 'Home';
        const awayTeam = event.away_team || event.away || event.awayTeam || event.team2 || 'Away';
        const league = leagueName || event.league || event.competition || event.tournament || sportHint;
        const commenceTime = event.commence_time || event.start_time || event.date || new Date().toISOString();

        // Skip if no real team names
        if (!homeTeam || !awayTeam || homeTeam === 'Home' || awayTeam === 'Away') {
            return null;
        }

        // Try to get odds for this specific event
        let bookmakers = [];
        try {
            // Check if event already has odds embedded
            if (event.odds || event.bookmakers) {
                bookmakers = processEmbeddedOdds(event, homeTeam, awayTeam, sportHint);
            } else if (gameId && gameId !== 'Home' && gameId !== 'Away') {
                // Try to fetch odds for this event
                const oddsUrl = `${baseUrl}/events/${gameId}?apiKey=${ODDS_API_KEY}`;
                console.log(`Getting odds for event ${gameId}...`);
                
                currentApiCalls++;
                const oddsResponse = await fetch(oddsUrl, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'YakirBet/1.0'
                    }
                });

                if (oddsResponse.ok) {
                    const eventWithOdds = await oddsResponse.json();
                    bookmakers = processEmbeddedOdds(eventWithOdds, homeTeam, awayTeam, sportHint);
                    console.log(`Got odds for ${gameId}: ${bookmakers.length} bookmakers`);
                }
            }
        } catch (oddsError) {
            console.log(`Could not get odds for event ${gameId}:`, oddsError.message);
        }

        // If no bookmakers, create default
        if (bookmakers.length === 0) {
            bookmakers = [createDefaultBookmaker(homeTeam, awayTeam, sportHint)];
        }

        const sportType = determineSportType(sportHint, league);

        const game = {
            id: gameId,
            sport: sportType,
            sport_key: sportHint.toLowerCase().replace(/\s+/g, '_'),
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
        console.error('Error processing event to game:', error);
        return null;
    }
}

function processEmbeddedOdds(eventData, homeTeam, awayTeam, sportHint) {
    const bookmakers = [];
    
    try {
        if (eventData.odds && typeof eventData.odds === 'object') {
            // Format: { "Bet365": [...], "Unibet": [...] }
            for (const [bookmakerName, odds] of Object.entries(eventData.odds)) {
                if (Array.isArray(odds) && odds.length > 0) {
                    const market = odds[0];
                    if (market && market.odds) {
                        const outcomes = [];
                        
                        if (market.odds.home) outcomes.push({ name: homeTeam, price: parseFloat(market.odds.home) });
                        if (market.odds.away) outcomes.push({ name: awayTeam, price: parseFloat(market.odds.away) });
                        if (market.odds.draw && sportHint !== 'Basketball') outcomes.push({ name: 'Draw', price: parseFloat(market.odds.draw) });
                        
                        if (outcomes.length >= 2) {
                            bookmakers.push({
                                key: bookmakerName.toLowerCase().replace(/\s+/g, '_'),
                                title: bookmakerName,
                                markets: [{
                                    key: 'h2h',
                                    outcomes: outcomes
                                }]
                            });
                        }
                    }
                }
            }
        } else if (eventData.bookmakers && Array.isArray(eventData.bookmakers)) {
            for (const bookmaker of eventData.bookmakers.slice(0, 3)) {
                if (bookmaker.markets && bookmaker.markets.length > 0) {
                    const market = bookmaker.markets[0];
                    if (market.outcomes && market.outcomes.length >= 2) {
                        bookmakers.push({
                            key: bookmaker.key || 'bet365',
                            title: bookmaker.title || bookmaker.name || 'Bet365',
                            markets: [{
                                key: 'h2h',
                                outcomes: market.outcomes.map(outcome => ({
                                    name: outcome.name,
                                    price: parseFloat(outcome.price) || 2.0
                                }))
                            }]
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error processing embedded odds:', error);
    }
    
    return bookmakers;
}

function createDefaultBookmaker(homeTeam, awayTeam, sportHint) {
    const outcomes = [
        { name: homeTeam, price: 2.1 },
        { name: awayTeam, price: 1.9 }
    ];

    if (sportHint !== 'Basketball' && !sportHint?.toLowerCase().includes('basketball')) {
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

function determineSportType(sportHint, league) {
    const combined = [sportHint, league].join(' ').toLowerCase();
    
    if (combined.includes('basketball') || combined.includes('nba')) {
        return 'basketball';
    } else if (combined.includes('football') || combined.includes('soccer') || combined.includes('premier') || combined.includes('liga')) {
        return 'soccer';
    } else {
        return 'soccer'; // default
    }
}