// File: /api/games.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    // 🔑 כאן המפתח יושב ישירות בקוד
    const API_KEY = "f25c67ba69a80dfdf01a5473a8523871ed994145e618fba46117fa021caaacea";

    const sportsUrl = `https://api.the-odds-api.com/v4/sports?apiKey=${API_KEY}`;

    // 1. משיכת רשימת ספורט זמינים
    const sportsRes = await fetch(sportsUrl);
    const sports = await sportsRes.json();

    if (!Array.isArray(sports)) {
      return res.status(500).json({ success: false, error: "Failed to load sports list" });
    }

    let allGames = [];
    let errors = [];
    let apiCalls = 0;

    // 2. ניקח רק כדורגל וכדורסל
    const wantedSports = sports.filter(s =>
      ["soccer", "basketball"].some(type => s.key.includes(type))
    );

    for (const sport of wantedSports) {
      try {
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h,spreads,totals&oddsFormat=decimal`;
        const oddsRes = await fetch(oddsUrl);
        apiCalls++;

        if (!oddsRes.ok) {
          errors.push({ league: sport.title, error: oddsRes.statusText });
          continue;
        }

        const games = await oddsRes.json();

        // נוסיף שדות מזהים
        games.forEach(g => {
          g.sport = sport.group.toLowerCase().includes("basketball") ? "basketball" : "soccer";
          g.league = sport.title || sport.group;
        });

        allGames = allGames.concat(games);

      } catch (err) {
        errors.push({ league: sport.title, error: err.message });
      }
    }

    // 3. מחזיר JSON ל-Frontend
    res.status(200).json({
      success: true,
      total_games: allGames.length,
      games: allGames,
      api_calls_made: apiCalls,
      errors: errors
    });

  } catch (err) {
    console.error("❌ API handler error:", err);
    res.status(500).json({
      success: false,
      error: "Server error: " + err.message
    });
  }
}
