const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Linux distro data
const distros = require('./data/distros.json');

// Game state storage (in-memory, per client)
const clientGames = new Map();

function parseBooleanOption(value, fallback = false) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string') return fallback;

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
    return fallback;
}

// Map difficulty to the minimum popularity rank that should be included.
// Rank: Very Low (0) < Low (1) < Medium (2) < High (3) < Very High (4)
//   Very Easy = High and above (small, popular pool) - uniform
//   Easy      = Medium and above - uniform
//   Medium    = Low and above (everything except Very Low) - uniform
//   Hard      = Low and above (same pool as Medium) - weighted toward Low
//   Extreme   = all popularities (incl. Very Low) - weighted toward Low/Very Low
const POPULARITY_RANK = {
    'Very Low': 0,
    'Low': 1,
    'Medium': 2,
    'High': 3,
    'Very High': 4
};

const DIFFICULTY_MIN_RANK = {
    'Very Easy': 3,
    'Easy': 2,
    'Medium': 1,
    'Hard': 1,
    'Extreme': 0
};

const DEFAULT_DIFFICULTY = 'Hard';
const VALID_DIFFICULTIES = Object.keys(DIFFICULTY_MIN_RANK);

// Popularity selection weights for Hard/Extreme. Very Easy/Easy/Medium use uniform random.
// Order: [Very High, High, Medium, Low, Very Low]
// Roughly uniform, but skewed away from the popular end (Very High / High are
// rare since there are only 3 / 14 distros in those buckets) and toward Medium /
// Low / Very Low which gives more variety in the target.
const DIFFICULTY_WEIGHTS = {
    'Hard':    [0.05, 0.10, 0.45, 0.40, 0.00],
    'Extreme': [0.03, 0.07, 0.25, 0.35, 0.30]
};
const POPULARITY_ORDER = ['Very High', 'High', 'Medium', 'Low', 'Very Low'];

function parseDifficultyOption(value) {
    if (typeof value !== 'string') return DEFAULT_DIFFICULTY;
    const normalized = value.trim();
    if (VALID_DIFFICULTIES.includes(normalized)) return normalized;
    return DEFAULT_DIFFICULTY;
}

function getFilteredDistros(options = {}) {
    const difficulty = parseDifficultyOption(options.difficulty);
    const includeDiscontinued = options.includeDiscontinued === true;
    const minRank = DIFFICULTY_MIN_RANK[difficulty];

    return distros.filter((distro) => {
        const rank = POPULARITY_RANK[distro.popularity];
        if (rank === undefined || rank < minRank) {
            return false;
        }

        if (!includeDiscontinued && distro.discontinued === 'Yes') {
            return false;
        }

        return true;
    });
}

// Get full distro data for the Distrodex (always includes everything).
app.get('/api/distros/full', (req, res) => {
    const filteredDistros = getFilteredDistros({
        difficulty: 'Extreme',
        includeDiscontinued: true
    });

    res.json(filteredDistros);
});

// Pick a random distro from the pool using difficulty-specific selection rules.
// Easy/Medium: uniform random across the whole pool.
// Hard/Extreme: bucket by popularity, pick a bucket with the configured weight,
// then pick a uniform random distro from the chosen bucket. Weights for buckets
// that are empty in the current pool are ignored (weights are renormalized).
function pickTarget(pool, difficulty) {
    if (pool.length === 0) return null;
    if (pool.length === 1) return pool[0];

    const weights = DIFFICULTY_WEIGHTS[difficulty];
    if (!weights) {
        // Easy / Medium / unknown -> uniform
        return pool[Math.floor(Math.random() * pool.length)];
    }

    // Group pool by popularity
    const byPop = new Map();
    for (const d of pool) {
        const bucket = byPop.get(d.popularity) || [];
        bucket.push(d);
        byPop.set(d.popularity, bucket);
    }

    // Build list of (popularity, weight, distros) for buckets that exist in the pool
    const available = POPULARITY_ORDER
        .map((pop, i) => ({ pop, weight: weights[i] || 0, distros: byPop.get(pop) || [] }))
        .filter(item => item.distros.length > 0 && item.weight > 0);

    if (available.length === 0) {
        return pool[Math.floor(Math.random() * pool.length)];
    }

    const totalWeight = available.reduce((sum, x) => sum + x.weight, 0);
    let r = Math.random() * totalWeight;
    for (const item of available) {
        r -= item.weight;
        if (r <= 0) {
            return item.distros[Math.floor(Math.random() * item.distros.length)];
        }
    }

    // Floating point fallback: return from the last available bucket
    const last = available[available.length - 1];
    return last.distros[Math.floor(Math.random() * last.distros.length)];
}

function createInitialGameState() {
    return {
        currentTarget: null,
        wasGuessed: false,
        guessCount: 0,
        missCount: 0,
        revealedHints: [],
        discoveredFields: [],
        // Stats tracking
        totalGames: 0,
        totalWins: 0,
        currentStreak: 0,
        bestStreak: 0
    };
}

function getClientId(req) {
    const headerId = req.get('x-distrodle-client-id');
    if (!headerId || typeof headerId !== 'string' || !headerId.trim()) {
        return null;
    }

    return headerId.trim();
}

function getGameState(req) {
    const clientId = getClientId(req);
    if (!clientId) {
        return null;
    }

    if (!clientGames.has(clientId)) {
        clientGames.set(clientId, createInitialGameState());
    }

    return clientGames.get(clientId);
}

// Get all distro names for autocomplete
app.get('/api/distros', (req, res) => {
    const difficulty = parseDifficultyOption(req.query.difficulty);
    const includeDiscontinued = parseBooleanOption(req.query.includeDiscontinued, false);
    const filteredDistros = getFilteredDistros({ difficulty, includeDiscontinued });

    res.json(filteredDistros.map(d => d.name));
});

// Get full distro data for Learn Mode (always everything)
app.get('/api/distros/full', (req, res) => {
    const filteredDistros = getFilteredDistros({
        difficulty: 'Extreme',
        includeDiscontinued: true
    });

    res.json(filteredDistros);
});

// Get random target distro
app.get('/api/target', (req, res) => {
    const gameState = getGameState(req);
    if (!gameState) {
        return res.status(400).json({ error: 'Missing client id' });
    }

    const difficulty = parseDifficultyOption(req.query.difficulty);
    const includeDiscontinued = parseBooleanOption(req.query.includeDiscontinued, false);
    const availableDistros = getFilteredDistros({ difficulty, includeDiscontinued });

    if (availableDistros.length === 0) {
        return res.status(400).json({ error: 'No distros available for selected filters' });
    }

    // If there was a current target that wasn't guessed, return it as the previous answer
    // This fixes the bug where previousTarget was always 2 games behind
    const previousAnswer = (!gameState.wasGuessed && gameState.currentTarget) ? {
        id: gameState.currentTarget.id,
        name: gameState.currentTarget.name,
        details: gameState.currentTarget
    } : null;
    
    // Update stats: increment total games when starting a new game (not on initial load)
    if (gameState.currentTarget !== null) {
        gameState.totalGames++;
        // If previous game wasn't guessed, reset current streak
        if (!gameState.wasGuessed) {
            gameState.currentStreak = 0;
        }
    }
    
    // Select new random target (difficulty-aware: uniform for Easy/Medium,
    // weighted by popularity for Hard/Extreme)
    const randomDistro = pickTarget(availableDistros, difficulty);

    // Update game state
    gameState.currentTarget = randomDistro;
    gameState.wasGuessed = false;
    gameState.guessCount = 0;
    gameState.missCount = 0;
    gameState.revealedHints = [];
    gameState.discoveredFields = [];
    
    // Calculate hit rate
    const hitRate = gameState.totalGames > 0 ? Math.round((gameState.totalWins / gameState.totalGames) * 100) : 0;
    
    res.json({
        id: randomDistro.id,
        name: randomDistro.name,
        previousAnswer: previousAnswer,
        stats: {
            totalGames: gameState.totalGames,
            totalWins: gameState.totalWins,
            hitRate: hitRate,
            currentStreak: gameState.currentStreak,
            bestStreak: gameState.bestStreak
        }
    });
});

// Check guess against target
app.post('/api/guess', (req, res) => {
    const gameState = getGameState(req);
    if (!gameState) {
        return res.status(400).json({ error: 'Missing client id' });
    }

    const { guessName, targetId } = req.body;

    if (!gameState.currentTarget) {
        return res.status(409).json({ error: 'No active round. Start a new game.' });
    }

    if (String(targetId) !== String(gameState.currentTarget.id)) {
        return res.status(409).json({ error: 'Round changed. Please try again.' });
    }
    
    let guessNameProcessed = guessName.trim();
    
    // Fuzzy matching: if no exact match, find the closest match
    let guess = distros.find(d => d.name.toLowerCase() === guessNameProcessed.toLowerCase());
    
    if (!guess && guessNameProcessed.length > 0) {
        // Find first distro that starts with the input (case-insensitive)
        guess = distros.find(d => d.name.toLowerCase().startsWith(guessNameProcessed.toLowerCase()));
        
        // If no starts-with match, find any distro that contains the input
        if (!guess) {
            guess = distros.find(d => d.name.toLowerCase().includes(guessNameProcessed.toLowerCase()));
        }
    }
    
    const target = gameState.currentTarget;
    
    if (!guess || !target) {
        return res.status(404).json({ error: 'Distribution not found' });
    }
    
    // Compare attributes and generate feedback
    const feedback = compareDistros(guess, target);

    // Persist what the player has already learned this round.
    const hintFields = ['paid', 'initSystem', 'releaseType', 'parentDistro', 'packageManager', 'difficulty', 'yearReleased', 'desktopEnvironment', 'popularity', 'architecture', 'category'];
    const newlyDiscovered = hintFields.filter(f => feedback[f] && feedback[f].status === 'correct');
    gameState.discoveredFields = [...new Set([...gameState.discoveredFields, ...newlyDiscovered])];
    
    // Update game state if correct
    const isCorrect = guess.id === target.id;
    if (isCorrect) {
        gameState.wasGuessed = true;
        gameState.totalWins++;
        gameState.currentStreak++;
        // Update best streak if current streak is higher
        if (gameState.currentStreak > gameState.bestStreak) {
            gameState.bestStreak = gameState.currentStreak;
        }
    } else {
        gameState.missCount++;
    }
    gameState.guessCount++;
    
    // Generate hint if at 5, 10, 15... misses
    const hintLevels = [5, 10, 15, 20, 25];
    const currentMisses = gameState.missCount;
    const targetMisses = hintLevels.find(m => currentMisses === m);
    
    let newHint = null;
    if (targetMisses) {
        newHint = generateNewHint(target, gameState);
    }
    
    res.json({
        guess: guess,
        matchedName: guess.name,
        feedback: feedback,
        isCorrect: isCorrect,
        guessCount: gameState.guessCount,
        missCount: gameState.missCount,
        newHint: newHint,
        revealedHints: gameState.revealedHints
    });
});

function generateNewHint(target, gameState) {
    const hintFields = ['paid', 'initSystem', 'releaseType', 'parentDistro', 'packageManager', 'difficulty', 'yearReleased', 'desktopEnvironment', 'popularity', 'architecture', 'category'];

    const availableHints = hintFields.filter(f => !gameState.discoveredFields.includes(f) && !gameState.revealedHints.includes(f));
    
    if (availableHints.length === 0) return null;
    
    const field = availableHints[Math.floor(Math.random() * availableHints.length)];
    gameState.revealedHints.push(field);
    
    let value = target[field];
    let displayField = field;
    
    if (field === 'popularity') {
        const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
        const idx = levels.indexOf(value);
        value = idx <= 1 ? 'Popularity is Low or Very Low' : (idx >= 3 ? 'Popularity is High or Very High' : 'Popularity is Medium');
    }
    
    return {
        field: displayField,
        value: value,
        displayField: displayField.charAt(0).toUpperCase() + displayField.slice(1).replace(/([A-Z])/g, ' $1').trim()
    };
}

function compareDistros(guess, target) {
    return {
        name: {
            value: guess.name,
            status: guess.id === target.id ? 'correct' : 'incorrect'
        },
        paid: {
            value: guess.paid ? 'Yes' : 'No',
            status: getStatus(guess.paid, target.paid)
        },
        initSystem: {
            value: guess.initSystem,
            status: getStatus(guess.initSystem, target.initSystem)
        },
        releaseType: {
            value: guess.releaseType,
            status: getStatus(guess.releaseType, target.releaseType)
        },
        parentDistro: {
            value: guess.parentDistro,
            status: getParentStatus(guess, target)
        },
        packageManager: {
            value: guess.packageManager,
            status: getPackageManagerStatus(guess.packageManager, target.packageManager)
        },
        difficulty: {
            value: guess.difficulty,
            status: getDifficultyStatus(guess.difficulty, target.difficulty)
        },
        yearReleased: {
            value: guess.yearReleased,
            status: getYearStatus(guess.yearReleased, target.yearReleased),
            direction: getYearDirection(guess.yearReleased, target.yearReleased)
        },
        desktopEnvironment: {
            value: formatMultiValue(guess.desktopEnvironment),
            status: getMultiValueStatus(guess.desktopEnvironment, target.desktopEnvironment)
        },
        popularity: {
            value: guess.popularity,
            status: getPopularityStatus(guess.popularity, target.popularity)
        },
        architecture: {
            value: formatMultiValue(guess.architecture),
            status: getMultiValueStatus(guess.architecture, target.architecture)
        },
        category: {
            value: formatMultiValue(guess.category),
            status: getMultiValueStatus(guess.category, target.category)
        }
    };
}

function getStatus(guess, target) {
    if (guess === target) return 'correct';
    return 'incorrect';
}

// Normalize a comma-separated value into a sorted, trimmed string.
// e.g. "ARM, x86_64" -> "ARM, x86_64"
function formatMultiValue(value) {
    if (!value || typeof value !== 'string') return value;
    return value
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .sort((a, b) => a.localeCompare(b))
        .join(', ');
}

// Split a comma-separated value into a normalized (lowercased, trimmed) array.
function splitMultiValue(value) {
    if (!value || typeof value !== 'string') return [];
    return value
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
}

// Generic status for comma-separated fields (architecture, desktopEnvironment, category).
// Order-insensitive and case-insensitive: "x86_64, ARM" vs "ARM, x86_64" is a match.
// - correct  = same set of values
// - partial  = at least one element in common, but not the same set
// - incorrect = no overlap
function getMultiValueStatus(guess, target) {
    if (guess == null || target == null) return 'incorrect';
    if (typeof guess !== 'string' || typeof target !== 'string') return 'incorrect';

    if (guess === target) return 'correct';

    const guessItems = splitMultiValue(guess);
    const targetItems = splitMultiValue(target);

    if (guessItems.length === 0 || targetItems.length === 0) return 'incorrect';

    const sameSize = guessItems.length === targetItems.length;
    const sameSet = sameSize && guessItems.every(g => targetItems.includes(g));
    if (sameSet) return 'correct';

    const hasCommon = guessItems.some(g => targetItems.includes(g));
    return hasCommon ? 'partial' : 'incorrect';
}

// Package manager comparison is case-insensitive to avoid issues like
// "Pacman" vs "pacman" being treated as different.
function getPackageManagerStatus(guess, target) {
    if (typeof guess !== 'string' || typeof target !== 'string') return 'incorrect';
    if (guess.toLowerCase() === target.toLowerCase()) return 'correct';
    return 'incorrect';
}

// Parent distro: exact match is correct, and we treat being the same upstream
// family (i.e. guessing the target's own parent) as partial. This avoids the
// "Mandriva" / "Mandriva Linux" type name mismatches penalising the player.
function getParentStatus(guess, target) {
    if (!guess || !target) return 'incorrect';
    if (guess.parentDistro === target.parentDistro) return 'correct';
    if (guess.parentDistro === target.name) return 'partial';
    if (target.parentDistro === guess.name) return 'partial';
    return 'incorrect';
}

function getDifficultyStatus(guess, target) {
    const levels = ['Beginner', 'Intermediate', 'Advanced', 'Expert'];
    const guessIndex = levels.indexOf(guess);
    const targetIndex = levels.indexOf(target);
    
    if (guess === target) return 'correct';
    if (Math.abs(guessIndex - targetIndex) === 1) return 'partial';
    return 'incorrect';
}

function getYearStatus(guess, target) {
    if (guess === target) return 'correct';
    if (Math.abs(guess - target) <= 2) return 'partial';
    return 'incorrect';
}

function getYearDirection(guess, target) {
    if (guess === target) return null;
    if (guess < target) return 'up'; // Target is newer (higher year)
    return 'down'; // Target is older (lower year)
}

function getPopularityStatus(guess, target) {
    const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
    const guessIndex = levels.indexOf(guess);
    const targetIndex = levels.indexOf(target);
    
    if (guess === target) return 'correct';
    if (Math.abs(guessIndex - targetIndex) === 1) return 'partial';
    return 'incorrect';
}

function getPopularityDirection(guess, target) {
    const levels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
    const guessIndex = levels.indexOf(guess);
    const targetIndex = levels.indexOf(target);
    
    if (guess === target) return null;
    if (guessIndex < targetIndex) return 'up'; // Target is more popular
    return 'down'; // Target is less popular
}

const HOST = process.env.HOST || '127.0.0.1';

app.listen(PORT, HOST, () => {
    console.log(`Distrodle server running on http://${HOST}:${PORT}`);
});
