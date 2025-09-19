// YakirBet Enhanced Backend - Real API Data Only
const ODDS_API_KEY = 'f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea';
const CACHE_DURATION = 45 * 60 * 1000; // 45 minutes for live line updates
const LIVE_CACHE_DURATION = 30 * 1000; // 30 seconds for live games

// Enhanced cache system
let gameCache = {
    data: null,
    timestamp: null,
    expires: null,
    liveGames: new Map(), // Separate cache for live games
    lastLiveUpdate: null
};

// All sports and leagues from the images you showed
const PRIORITY_SPORTS = [
    // Soccer - Major European Leagues
    'soccer_epl', // Premier League
    'soccer_spain_la_liga', // La Liga
    'soccer_italy_serie_a', // Serie A
    'soccer_germany_bundesliga', // Bundesliga
    'soccer_france_ligue_one', // Ligue 1
    'soccer_uefa_champs_league', // Champions League
    'soccer_uefa_europa_league', // Europa League
    'soccer_netherlands_eredivisie', // Eredivisie
    'soccer_portugal_primeira_liga', // Primeira Liga
    
    // International Soccer
    'soccer_brazil_serie_a', // Brazilian Serie A
    'soccer_argentina_primera_division', // Argentine Primera
    'soccer_mexico_liga_mx', // Liga MX
    'soccer_mls', // MLS
    
    // Basketball
    'basketball_nba', // NBA
    'basketball_euroleague', // EuroLeague
    'basketball_wnba', // WNBA
    'basketball_ncaab', // NCAA Basketball
    'basketball_nbl', // NBL Australia
    
    // Tennis
    'tennis_atp', // ATP
    'tennis_wta', // WTA
    'tennis_atp_french_open', // French Open
    'tennis_atp_wimbledon', // Wimbledon
    'tennis_atp_us_open', // US Open
    
    // American Football
    'americanfootball_nfl', // NFL
    'americanfootball_ncaaf', // NCAA Football
    
    // Baseball
    'baseball_mlb', // MLB
    'baseball_ncaa', // NCAA Baseball
    
    // Hockey
    'icehockey_nhl', // NHL
    'icehockey_khl', // KHL
    'icehockey_ncaa', // NCAA Hockey
    
    // Combat Sports
    'mma_mixed_martial_arts', // UFC/MMA
    'boxing_heavyweight', // Boxing
    
    // Other Sports
    'golf_pga_championship', // Golf
    'cricket_big_bash', // Cricket
    'rugby_union_world_cup', // Rugby
    'aussierules_afl' // AFL
];

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const now = new Date();
        const { force = false, liveOnly = false } = req.query;

        // Handle live-only requests for frequent updates
        if (liveOnly === 'true') {
            const liveData = await fetchLiveGamesOnly();
            if (liveData.games.length > 0) {
                return res.status(200).json({
                    ...liveData,
                    live_update: true,
                    timestamp: now.toISOString()
                });
            }
        }

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
                message: `נתונים מהמטמון (${cacheAge} דקות)`
            });
        }

        console.log('🔄 Fetching fresh data from all available leagues...');
        const freshData = await fetchAllLeaguesData();

        if (!freshData || freshData.games.length === 0) {
            // NO DEMO DATA - Return empty response
            return res.status(200).json({
                success: false,
                total_games: 0,
                games: [],
                timestamp: now.toISOString(),
                message: 'לא נמצאו משחקים זמינים - בדוק חיבור לאינטרנט',
                error: 'No games available from API'
            });
        }

        // Update cache
        const expiresAt = new Date(now.getTime() + CACHE_DURATION);
        gameCache = {
            data: freshData,
            timestamp: now.toISOString(),
            expires: expiresAt
        };

        return res.status(200).json({
            ...freshData,
            cached: false,
            cache_updated: now.toISOString(),
            next_update: expiresAt.toISOString(),
            message: 'נתונים חדשים נטענו בהצלחה'
        });

    } catch (error) {
        console.error('❌ Handler error:', error);
        
        // Serve stale cache if available
        if (gameCache.data && gameCache.data.games.length > 0) {
            const cacheAge = Math.round((new Date() - new Date(gameCache.timestamp)) / 1000 / 60);
            return res.status(200).json({
                ...gameCache.data,
                cached: true,
                stale: true,
                cache_age_minutes: cacheAge,
                error: 'שגיאת חיבור - מוצגים נתונים ישנים',
                message: `נתונים ישנים (${cacheAge} דקות) בגלל שגיאת API`
            });
        }
        
        // NO DEMO FALLBACK - Return error
        return res.status(503).json({
            success: false,
            total_games: 0,
            games: [],
            timestamp: new Date().toISOString(),
            error: 'שירות לא זמין - בדוק חיבור לאינטרנט',
            message: 'לא ניתן להתחבר לשרת הנתונים'
        });
    }
}

async function fetchAllLeaguesData() {
    const allGames = [];
    const errors = [];
    let totalApiCalls = 0;
    let sportsProcessed = 0;
    const baseUrl = 'https://api.the-odds-api.com/v4';

    console.log('📡 Step 1: Get available sports from API...');
    
    try {
        const sportsUrl = `${baseUrl}/sports?apiKey=${ODDS_API_KEY}`;
        totalApiCalls++;
        
        const sportsResponse = await fetch(sportsUrl, { 
            headers: { 'Accept': 'application/json' },
            timeout: 10000 
        });
        
        if (!sportsResponse.ok) {
            throw new Error(`Sports API returned ${sportsResponse.status}`);
        }
        
        const availableSports = await sportsResponse.json();
        console.log(`✅ Got ${availableSports.length} sports from API`);

        // Filter to our priority sports that actually exist in API
        const sportsToFetch = availableSports.filter(sport => 
            PRIORITY_SPORTS.includes(sport.key) || 
            PRIORITY_SPORTS.some(priority => sport.key.includes(priority.split('_')[0]))
        );

        console.log(`🎯 Processing ${sportsToFetch.length} relevant sports...`);

        // Process each sport with rate limiting
        for (const [index, sport] of sportsToFetch.entries()) {
            try {
                console.log(`🏃 [${index + 1}/${sportsToFetch.length}] Processing ${sport.key}...`);
                
                const oddsUrl = `${baseUrl}/sports/${sport.key}/odds?apiKey=${ODDS_API_KEY}&regions=us,uk,eu&markets=h2h&oddsFormat=decimal&bookmakers=bet365,pinnacle,williamhill,betfair`;
                totalApiCalls++;
                
                const oddsResponse = await fetch(oddsUrl, { 
                    headers: { 'Accept': 'application/json' },
                    timeout: 8000 
                });
                
                if (!oddsResponse.ok) {
                    console.log(`⚠️  ${sport.key}: ${oddsResponse.status}`);
                    continue;
                }
                
                const gamesData = await oddsResponse.json();
                console.log(`📊 ${sport.key}: ${gamesData.length} games`);

                if (gamesData && gamesData.length > 0) {
                    // Process games for this sport
                    for (const gameData of gamesData.slice(0, 10)) { // Max 10 per sport
                        const processedGame = processGameData(gameData, sport.key);
                        if (processedGame) {
                            allGames.push(processedGame);
                        }
                    }
                    sportsProcessed++;
                }
                
                // Rate limiting - respect API limits
                if ((totalApiCalls % 10) === 0) {
                    await delay(1000); // Pause every 10 calls
                }
                
            } catch (err) {
                console.error(`❌ Error with ${sport.key}:`, err.message);
                errors.push({ 
                    sport: sport.key, 
                    error: err.message, 
                    timestamp: new Date().toISOString() 
                });
            }
        }

        // Sort by commence time
        allGames.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

        console.log(`🏆 Fetch complete: ${allGames.length} games from ${sportsProcessed} sports`);

        return {
            success: true,
            total_games: allGames.length,
            games: allGames,
            timestamp: new Date().toISOString(),
            source: 'The-Odds-API.com',
            api_calls_made: totalApiCalls,
            sports_processed: sportsProcessed,
            available_sports: sportsToFetch.length,
            cache_duration_minutes: CACHE_DURATION / (60 * 1000),
            errors: errors.length > 0 ? errors.slice(-3) : undefined
        };

    } catch (error) {
        console.error('❌ Failed to fetch sports data:', error);
        return null;
    }
}

async function fetchLiveGamesOnly() {
    // Quick update for live games only
    const now = new Date();
    
    if (!gameCache.data || !gameCache.data.games) {
        return { games: [], message: 'אין נתונים זמינים' };
    }

    const liveGames = gameCache.data.games.filter(game => game.is_live);
    
    if (liveGames.length === 0) {
        return { games: [], message: 'אין משחקים לייב כרגע' };
    }

    // Update odds for live games only
    const updatedLiveGames = [];
    let apiCalls = 0;
    
    for (const game of liveGames.slice(0, 5)) { // Limit to 5 live games
        try {
            const updatedGame = await updateGameOdds(game);
            if (updatedGame) {
                updatedLiveGames.push(updatedGame);
                apiCalls++;
            }
        } catch (err) {
            console.log(`Failed to update ${game.id}:`, err.message);
        }
        
        if (apiCalls >= 5) break; // Limit API calls
    }

    return {
        games: updatedLiveGames,
        live_games_count: updatedLiveGames.length,
        api_calls_used: apiCalls,
        last_update: now.toISOString()
    };
}

function processGameData(rawGame, sportKey) {
    try {
        const now = new Date();
        const gameTime = new Date(rawGame.commence_time);
        const isLive = (now - gameTime > 0) && (now - gameTime < (4 * 60 * 60 * 1000)); // 4 hours window
        
        const bookmakers = [];
        
        if (rawGame.bookmakers && rawGame.bookmakers.length > 0) {
            for (const bookmaker of rawGame.bookmakers.slice(0, 4)) {
                if (bookmaker.markets && bookmaker.markets.length > 0) {
                    const market = bookmaker.markets.find(m => m.key === 'h2h');
                    if (market && market.outcomes) {
                        bookmakers.push({
                            key: bookmaker.key,
                            title: bookmaker.title,
                            last_update: bookmaker.last_update,
                            markets: [{
                                key: market.key,
                                last_update: market.last_update,
                                outcomes: market.outcomes.map(outcome => ({
                                    name: outcome.name,
                                    price: parseFloat(outcome.price) || 1.0
                                }))
                            }]
                        });
                    }
                }
            }
        }

        if (bookmakers.length === 0) {
            return null; // Skip games without odds
        }

        return {
            id: rawGame.id,
            sport: extractBaseSport(sportKey),
            sport_key: sportKey.toLowerCase(),
            sport_title: formatSportTitle(sportKey),
            league: formatLeagueName(sportKey),
            home_team: rawGame.home_team,
            away_team: rawGame.away_team,
            teams: [rawGame.home_team, rawGame.away_team],
            commence_time: rawGame.commence_time,
            is_live: isLive,
            status: isLive ? 'live' : 'upcoming',
            bookmakers,
            fetched_at: new Date().toISOString(),
            data_source: 'real-api'
        };
    } catch (err) {
        console.error('Error processing game:', err);
        return null;
    }
}

async function updateGameOdds(game) {
    // Update odds for a specific game (for live line)
    try {
        const baseUrl = 'https://api.odds-api.io/v3';
        const url = `${baseUrl}/sports/${game.sport_key}/odds?apiKey=${ODDS_API_KEY}&eventIds=${game.id}&regions=us,uk,eu&markets=h2h&oddsFormat=decimal`;
        
        const response = await fetch(url, { 
            headers: { 'Accept': 'application/json' },
            timeout: 5000 
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
                return processGameData(data[0], game.sport_key);
            }
        }
        
        return game; // Return original if update failed
    } catch (err) {
        console.log(`Failed to update odds for ${game.id}`);
        return game;
    }
}

// Utility functions
function extractBaseSport(sportKey) {
    if (!sportKey) return 'unknown';
    const key = sportKey.toLowerCase();
    if (key.includes('soccer')) return 'soccer';
    if (key.includes('basketball')) return 'basketball';
    if (key.includes('americanfootball')) return 'americanfootball';
    if (key.includes('tennis')) return 'tennis';
    if (key.includes('baseball')) return 'baseball';
    if (key.includes('icehockey')) return 'hockey';
    if (key.includes('mma') || key.includes('boxing')) return 'mma';
    if (key.includes('golf')) return 'golf';
    if (key.includes('cricket')) return 'cricket';
    return sportKey.split('_')[0] || 'unknown';
}

function formatSportTitle(sportKey) {
    const sportNames = {
        'soccer_epl': 'Premier League',
        'soccer_spain_la_liga': 'La Liga',
        'soccer_italy_serie_a': 'Serie A',
        'soccer_germany_bundesliga': 'Bundesliga',
        'soccer_france_ligue_one': 'Ligue 1',
        'soccer_uefa_champs_league': 'Champions League',
        'basketball_nba': 'NBA',
        'basketball_euroleague': 'EuroLeague',
        'tennis_atp': 'ATP',
        'tennis_wta': 'WTA',
        'americanfootball_nfl': 'NFL',
        'baseball_mlb': 'MLB',
        'icehockey_nhl': 'NHL'
    };
    
    return sportNames[sportKey] || sportKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatLeagueName(sportKey) {
    return formatSportTitle(sportKey);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}