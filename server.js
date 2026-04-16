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

function getFilteredDistros(options = {}) {
    const includeVeryLow = options.includeVeryLow === true || options.includeDiscontinued === true;
    const includeDiscontinued = options.includeDiscontinued === true;

    return distros.filter((distro) => {
        if (!includeVeryLow && distro.popularity === 'Very Low') {
            return false;
        }

        if (!includeDiscontinued && distro.discontinued === 'Yes') {
            return false;
        }

        return true;
    });
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
    const includeVeryLow = parseBooleanOption(req.query.includeVeryLow, false);
    const includeDiscontinued = parseBooleanOption(req.query.includeDiscontinued, false);
    const filteredDistros = getFilteredDistros({ includeVeryLow, includeDiscontinued });

    res.json(filteredDistros.map(d => d.name));
});

// Get random target distro
app.get('/api/target', (req, res) => {
    const gameState = getGameState(req);
    if (!gameState) {
        return res.status(400).json({ error: 'Missing client id' });
    }

    const includeVeryLow = parseBooleanOption(req.query.includeVeryLow, false);
    const includeDiscontinued = parseBooleanOption(req.query.includeDiscontinued, false);
    const availableDistros = getFilteredDistros({ includeVeryLow, includeDiscontinued });

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
    
    // Select new random target
    const randomDistro = availableDistros[Math.floor(Math.random() * availableDistros.length)];
    
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
            status: getStatus(guess.parentDistro, target.parentDistro)
        },
        packageManager: {
            value: guess.packageManager,
            status: getStatus(guess.packageManager, target.packageManager)
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
            value: guess.desktopEnvironment,
            status: getStatus(guess.desktopEnvironment, target.desktopEnvironment)
        },
        popularity: {
            value: guess.popularity,
            status: getPopularityStatus(guess.popularity, target.popularity)
        },
        architecture: {
            value: guess.architecture,
            status: getStatus(guess.architecture, target.architecture)
        },
        category: {
            value: sortCategoryValues(guess.category),
            status: getCategoryStatus(guess.category, target.category)
        }
    };
}

function getStatus(guess, target) {
    if (guess === target) return 'correct';
    return 'incorrect';
}

// Helper function to sort category values alphabetically
function sortCategoryValues(category) {
    if (!category || typeof category !== 'string') return category;
    return category
        .split(',')
        .map(s => s.trim())
        .sort((a, b) => a.localeCompare(b))
        .join(', ');
}

// Helper function to compare categories with partial matching
function getCategoryStatus(guessCategory, targetCategory) {
    const sortedGuess = sortCategoryValues(guessCategory);
    const sortedTarget = sortCategoryValues(targetCategory);
    
    // If exact match after sorting, return correct
    if (sortedGuess === sortedTarget) return 'correct';
    
    // Split into arrays for comparison
    const guessItems = sortedGuess.split(', ').map(s => s.trim()).filter(s => s);
    const targetItems = sortedTarget.split(', ').map(s => s.trim()).filter(s => s);
    
    // Check if there's at least one common element
    const hasCommonElement = guessItems.some(item => targetItems.includes(item));
    
    if (hasCommonElement) return 'partial';
    return 'incorrect';
}

function getParentStatus(guess, target) {
    if (guess === target) return 'correct';
    if (target.parentDistro === 'Independent' || guess === target.baseFor) return 'partial';
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

app.listen(PORT, () => {
    console.log(`Distrodle server running on http://localhost:${PORT}`);
});
