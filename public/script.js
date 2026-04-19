// Game state
let targetId = null;
let guessCount = 0;
let gameWon = false;
let distroList = [];
let guessedDistros = [];
let isProcessing = false;
let isInitialLoad = true;
let gameStats = {
    totalGames: 0,
    totalWins: 0,
    hitRate: 0,
    currentStreak: 0,
    bestStreak: 0
};
let hasGuessedThisRound = false;
const STATS_STORAGE_KEY = 'distrodleStats';
let playerStats = {
    gamesPlayed: 0,
    gamesWon: 0
};
let newGameRequestSeq = 0;
let isStartingNewGame = false;
let currentRoundToken = 0;
let distroListRequestSeq = 0;
const CLIENT_ID_STORAGE_KEY = 'distrodleClientId';
const OPTIONS_STORAGE_KEY = 'distrodleOptions';
let gameOptions = {
    includeVeryLow: false,
    includeDiscontinued: false
};

// DOM elements
const guessInput = document.getElementById('guess-input');
const guessBtn = document.getElementById('guess-btn');
const newGameBtn = document.getElementById('new-game-btn');
const feedbackContainer = document.getElementById('feedback-container');
const feedbackHeader = document.getElementById('feedback-header');
const distroListElement = document.getElementById('distro-list');
const victoryModal = document.getElementById('victory-modal');
const guessCountElement = document.getElementById('guess-count');
const playAgainBtn = document.getElementById('play-again-btn');
const firstGuessHelp = document.getElementById('first-guess-help');
const toggleVeryLow = document.getElementById('toggle-very-low');
const toggleDiscontinued = document.getElementById('toggle-discontinued');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const instructionsModal = document.getElementById('instructions-modal');
const closeInstructionsBtn = document.getElementById('close-instructions-btn');

function getOptionQuery() {
    return `includeVeryLow=${gameOptions.includeVeryLow}&includeDiscontinued=${gameOptions.includeDiscontinued}`;
}

function applyOptionConstraints() {
    // Discontinued pool is a strict subset that requires Very Low to be enabled.
    if (gameOptions.includeDiscontinued) {
        gameOptions.includeVeryLow = true;
    }
}

async function loadDistroList() {
    const requestSeq = ++distroListRequestSeq;
    const response = await fetch(`/api/distros?${getOptionQuery()}`);
    if (!response.ok) {
        let message = 'Failed to load distro pool';
        try {
            const payload = await response.json();
            if (payload && payload.error) {
                message = payload.error;
            }
        } catch (error) {
            // Keep fallback message when payload is not JSON.
        }
        throw new Error(message);
    }

    const nextList = await response.json();
    // Ignore stale responses from older option/new-game requests.
    if (requestSeq !== distroListRequestSeq) {
        return;
    }

    distroList = nextList;
    displayStats();
}

function loadOptions() {
    try {
        const raw = localStorage.getItem(OPTIONS_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        gameOptions.includeVeryLow = parsed.includeVeryLow === true;
        gameOptions.includeDiscontinued = parsed.includeDiscontinued === true;
        applyOptionConstraints();
    } catch (error) {
        console.warn('Failed to load options, using defaults:', error);
    }
}

function saveOptions() {
    localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(gameOptions));
}

function renderOptions() {
    if (toggleVeryLow) {
        toggleVeryLow.checked = gameOptions.includeVeryLow;
        toggleVeryLow.disabled = gameOptions.includeDiscontinued;
        toggleVeryLow.title = gameOptions.includeDiscontinued
            ? 'Required while Discontinued is enabled'
            : 'Include unpopular distros';
    }
    if (toggleDiscontinued) {
        toggleDiscontinued.checked = gameOptions.includeDiscontinued;
    }
}

async function applyOptionsAndRestart() {
    if (isStartingNewGame || isProcessing) return;

    try {
        await loadDistroList();
        updateDistroList();
        await startNewGame();
    } catch (error) {
        console.error('Error applying options:', error);
        showToast(error.message || 'Failed to apply options', 'error');
    }
}

function getClientId() {
    let clientId = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (clientId && typeof clientId === 'string' && clientId.trim()) {
        return clientId;
    }

    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        clientId = window.crypto.randomUUID();
    } else {
        clientId = `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
    return clientId;
}

// Sound effects (using Web Audio API)
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'correct') {
        // High pitch success sound
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.3);
    } else if (type === 'partial') {
        // Medium pitch
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } else if (type === 'incorrect') {
        // Low pitch
        oscillator.frequency.setValueAtTime(300, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.2);
    } else if (type === 'victory') {
        // Victory fanfare
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C major arpeggio
        notes.forEach((freq, i) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.frequency.setValueAtTime(freq, audioContext.currentTime + i * 0.1);
            gain.gain.setValueAtTime(0.2, audioContext.currentTime + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.1 + 0.3);
            osc.start(audioContext.currentTime + i * 0.1);
            osc.stop(audioContext.currentTime + i * 0.1 + 0.3);
        });
    }
}

// Initialize game
async function initGame() {
    try {
        loadStats();
        renderStats();
        loadOptions();
        renderOptions();

        // Load distro list for autocomplete
        await loadDistroList();
        
        // Populate datalist
        updateDistroList();
        
        // Start new game (this will also load and display stats)
        startNewGame();
    } catch (error) {
        console.error('Error initializing game:', error);
        showToast('Failed to load game. Please refresh the page.', 'error');
    }
}

// Update datalist with filtered matches and exclude already-guessed distros
function updateDistroList(filterText = '') {
    distroListElement.innerHTML = '';

    const query = filterText.trim().toLowerCase();
    if (!query) {
        return;
    }

    const availableDistros = distroList.filter(d => !guessedDistros.includes(d));
    availableDistros.forEach(name => {
        if (name.toLowerCase().includes(query)) {
            const option = document.createElement('option');
            option.value = name;
            distroListElement.appendChild(option);
        }
    });
}

// Start a new game
async function startNewGame() {
    if (isStartingNewGame) return;

    isStartingNewGame = true;
    const requestSeq = ++newGameRequestSeq;
    currentRoundToken += 1;

    try {
        // Starting a new round after guessing but before solving counts as a loss.
        if (!isInitialLoad && !gameWon && hasGuessedThisRound) {
            recordLoss();
        }

        newGameBtn.disabled = true;
        playAgainBtn.disabled = true;

        // Always refresh pool from current options before starting a new round.
        await loadDistroList();

        const response = await fetch(`/api/target?${getOptionQuery()}`, {
            headers: {
                'x-distrodle-client-id': getClientId()
            }
        });
        const data = await response.json();

        if (!response.ok) {
            showToast(data.error || 'Failed to start new game', 'error');
            return;
        }

        // Ignore stale responses from older in-flight requests.
        if (requestSeq !== newGameRequestSeq) {
            return;
        }

        targetId = data.id;
        
        // Show previous answer if there was one that wasn't guessed and not initial page load
        if (data.previousAnswer && !isInitialLoad) {
            showPreviousAnswer(data.previousAnswer);
        }
        isInitialLoad = false;
        
        // Update stats from server
        if (data.stats) {
            gameStats = data.stats;
            displayStats();
        }
        
        // Reset game state
        guessCount = 0;
        gameWon = false;
        hasGuessedThisRound = false;
        guessedDistros = [];
        feedbackContainer.innerHTML = '';
        displayStats();
        updateDistroList();
        if (firstGuessHelp) {
            firstGuessHelp.classList.remove('hidden');
        }
        // Keep header visible so users know what each column means
        victoryModal.classList.add('hidden');
        guessInput.value = '';
        guessInput.disabled = false;
        guessBtn.disabled = false;
        
    } catch (error) {
        console.error('Error starting new game:', error);
    } finally {
        if (requestSeq === newGameRequestSeq) {
            newGameBtn.disabled = false;
            playAgainBtn.disabled = false;
            isStartingNewGame = false;
        }
    }
}

// Show the previous answer when user didn't guess it
function showPreviousAnswer(previousAnswer) {
    // Clear any existing previous answer elements
    document.querySelectorAll('.previous-answer-wrapper').forEach(el => el.remove());
    
    const wrapper = document.createElement('div');
    wrapper.className = 'previous-answer-wrapper';
    wrapper.id = 'previous-answer';
    
    // Simpler banner text
    const banner = document.createElement('div');
    banner.className = 'previous-answer-banner';
    banner.innerHTML = `<span>[Previous Answer: ${previousAnswer.name}]</span>`;
    wrapper.appendChild(banner);
    
    // Insert before the feedback header
    feedbackHeader.parentNode.insertBefore(wrapper, feedbackHeader);
}

// Display game stats in the footer
function displayStats() {
    const totalDistrosElement = document.getElementById('total-distros');
    if (totalDistrosElement) {
        const statsText = `${distroList.length} distros | ` +
            `Win Rate: ${gameStats.hitRate}% (${gameStats.totalWins}/${gameStats.totalGames}) | ` +
            `Streak: ${gameStats.currentStreak} | ` +
            `Best: ${gameStats.bestStreak}`;
        totalDistrosElement.textContent = statsText;
    }
}

// Handle guess submission
async function handleGuess() {
    if (isProcessing || isStartingNewGame) return;

    const guessRoundToken = currentRoundToken;
    
    const guess = guessInput.value.trim();
    
    // Clear datalist to prevent it from showing
    distroListElement.innerHTML = '';
    
    if (!guess) {
        shakeInput();
        playSound('incorrect');
        showToast('Please enter a Linux distribution name', 'error');
        return;
    }
    
    // Find exact match first, otherwise find first partial match
    let matchedName = null;
    const lowerGuess = guess.toLowerCase();
    const availableDistros = distroList.filter(d => !guessedDistros.includes(d));
    
    const exactMatch = availableDistros.find(name => name.toLowerCase() === lowerGuess);
    
    if (exactMatch) {
        matchedName = exactMatch;
    } else {
        // Find first distro that starts with the input
        matchedName = availableDistros.find(name => name.toLowerCase().startsWith(lowerGuess));
        // If no starts-with match, find first distro that contains the input
        if (!matchedName) {
            matchedName = availableDistros.find(name => name.toLowerCase().includes(lowerGuess));
        }
    }
    
    if (!matchedName) {
        shakeInput();
        playSound('incorrect');
        showToast('Please select a valid Linux distribution from the list', 'error');
        return;
    }
    
    if (guessedDistros.includes(matchedName)) {
        shakeInput();
        playSound('incorrect');
        showToast('You have already guessed this distribution', 'error');
        return;
    }
    
    isProcessing = true;
    guessBtn.disabled = true;
    guessBtn.classList.add('loading');
    
    try {
        const response = await fetch('/api/guess', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-distrodle-client-id': getClientId()
            },
            body: JSON.stringify({
                guessName: matchedName,
                targetId: targetId
            })
        });
        
        const data = await response.json();

        // Ignore responses that belong to an older round.
        if (guessRoundToken !== currentRoundToken) {
            return;
        }
        
        if (response.ok) {
            hasGuessedThisRound = true;

            // Play sound based on result
            if (data.isCorrect) {
                playSound('correct');
            } else {
                // Check if any attributes are correct
                const hasCorrect = Object.values(data.feedback).some(f => f.status === 'correct');
                const hasPartial = Object.values(data.feedback).some(f => f.status === 'partial');
                
                if (hasCorrect) {
                    playSound('correct');
                } else if (hasPartial) {
                    playSound('partial');
                } else {
                    playSound('incorrect');
                }
            }
            
            displayFeedback(data.feedback, data.matchedName);
            guessedDistros.push(matchedName);
            // Keep tries aligned with the guesses accepted in this round.
            guessCount = guessedDistros.length;
            updateDistroList();

            if (firstGuessHelp && guessedDistros.length === 1) {
                firstGuessHelp.classList.add('hidden');
            }
            
            // Remove previous answer wrapper after first guess
            document.querySelectorAll('.previous-answer-wrapper').forEach(el => el.remove());
            
            if (data.newHint) {
                showHint(data.newHint);
            }
            
            if (data.isCorrect) {
                if (!gameWon) {
                    recordWin();
                }
                gameWon = true;
                setTimeout(() => showVictory(), 500);
            }
            
            guessInput.value = '';
            guessInput.focus();
        } else {
            shakeInput();
            playSound('incorrect');
            showToast(data.error || 'Error processing guess', 'error');
        }
    } catch (error) {
        console.error('Error submitting guess:', error);
        shakeInput();
        playSound('incorrect');
        showToast('Failed to submit guess. Please try again.', 'error');
    } finally {
        isProcessing = false;
        guessBtn.disabled = false;
        guessBtn.classList.remove('loading');
    }
}

// Toast notification system
function showToast(message, type = 'info') {
    // Remove existing toasts
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    const colors = {
        info: '#4a9eff',
        success: '#4ade80',
        error: '#ef4444',
        warning: '#facc15'
    };
    
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 0.75rem 1rem;
        background: #252525;
        border: 2px solid ${colors[type]};
        border-radius: 2px;
        color: ${colors[type]};
        font-weight: bold;
        font-size: 0.85rem;
        z-index: 10000;
        animation: slideInRight 0.3s ease-out;
    `;
    
    document.body.appendChild(toast);
    
    // Add animation style if not exists
    if (!document.querySelector('#toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOutRight {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function loadStats() {
    try {
        const raw = localStorage.getItem(STATS_STORAGE_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        const gamesPlayed = Number.isFinite(parsed.gamesPlayed) ? Math.max(0, Math.floor(parsed.gamesPlayed)) : 0;
        const gamesWon = Number.isFinite(parsed.gamesWon) ? Math.max(0, Math.floor(parsed.gamesWon)) : 0;

        playerStats.gamesPlayed = gamesPlayed;
        playerStats.gamesWon = Math.min(gamesWon, gamesPlayed);
        saveStats();
    } catch (error) {
        console.warn('Failed to load stats, resetting:', error);
        playerStats = { gamesPlayed: 0, gamesWon: 0 };
        saveStats();
    }
}

function saveStats() {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(playerStats));
}

function getWinRatePercent() {
    if (playerStats.gamesPlayed === 0) {
        return 0;
    }

    const ratio = playerStats.gamesWon / playerStats.gamesPlayed;
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function renderStats() {
    const statsElement = document.getElementById('player-stats');
    if (!statsElement) {
        return;
    }

    statsElement.textContent = `Games: ${playerStats.gamesPlayed} | Wins: ${playerStats.gamesWon} | Win Rate: ${getWinRatePercent()}%`;
}

function recordWin() {
    playerStats.gamesPlayed += 1;
    playerStats.gamesWon += 1;
    saveStats();
    renderStats();
}

function recordLoss() {
    playerStats.gamesPlayed += 1;
    saveStats();
    renderStats();
}

// Display feedback for a guess
function displayFeedback(feedback, matchedName) {
    const row = document.createElement('div');
    row.className = 'feedback-row';
    
    // Create cells for each attribute
    const attributes = [
        { key: 'name', label: 'Distro' },
        { key: 'paid', label: 'Paid' },
        { key: 'initSystem', label: 'Init' },
        { key: 'releaseType', label: 'Release' },
        { key: 'parentDistro', label: 'Parent' },
        { key: 'packageManager', label: 'Pkg' },
        { key: 'difficulty', label: 'Difficulty' },
        { key: 'yearReleased', label: 'Year' },
        { key: 'desktopEnvironment', label: 'Desktop' },
        { key: 'popularity', label: 'Popularity' },
        { key: 'architecture', label: 'Arch' },
        { key: 'category', label: 'Category' }
    ];
    
    attributes.forEach((attr, index) => {
        const cell = document.createElement('div');
        cell.className = `feedback-cell ${feedback[attr.key].status}`;
        
        let displayValue = feedback[attr.key].value;
        
        // Add direction arrow for year
        if (attr.key === 'yearReleased' && feedback[attr.key].direction) {
            const arrow = feedback[attr.key].direction === 'up' ? '↑' : '↓';
            const hint = feedback[attr.key].direction === 'up' ? ' (target is newer)' : ' (target is older)';
            displayValue = `${displayValue} ${arrow}`;
            cell.title = `${attr.label}: ${feedback[attr.key].value}${hint} (${feedback[attr.key].status})`;
        } else {
            cell.title = `${attr.label}: ${feedback[attr.key].value} (${feedback[attr.key].status})`;
        }
        
        cell.textContent = displayValue;
        cell.dataset.label = attr.label;
        
        cell.style.setProperty('--cell-index', index);
        cell.classList.add('feedback-cell-animated');
        
        row.appendChild(cell);
    });
    
    // Add cell animation style if not exists
    if (!document.querySelector('#cell-style')) {
        const style = document.createElement('style');
        style.id = 'cell-style';
        style.textContent = `
            @keyframes cellPop {
                0% { transform: scale(0.8); opacity: 0; }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add row to container (at the top)
    feedbackContainer.insertBefore(row, feedbackContainer.firstChild);
}

// Show hint when 5, 10, 15... misses
function showHint(hint) {
    showToast(`💡 Hint: ${hint.displayField} - ${hint.value}`, 'info');
}

// Show victory modal
function showVictory() {
    const tries = guessedDistros.length || guessCount;
    guessCountElement.textContent = tries;
    victoryModal.classList.remove('hidden');
    guessInput.disabled = true;
    guessBtn.disabled = true;
    
    // Play victory sound
    playSound('victory');
    
    // Create confetti explosion
    createConfetti();
    
    // Add typing effect to the victory message
    const victoryTitle = document.querySelector('.modal-content h2');
    typeWriterEffect(victoryTitle, 'Solved!', 100);
}

function openInstructionsModal() {
    if (!instructionsModal) return;
    instructionsModal.classList.remove('hidden');
}

function closeInstructionsModal() {
    if (!instructionsModal) return;
    instructionsModal.classList.add('hidden');
}

function toggleInstructionsModal() {
    if (!instructionsModal) return;
    if (instructionsModal.classList.contains('hidden')) {
        openInstructionsModal();
    } else {
        closeInstructionsModal();
    }
}

// Learn Mode state and functions
let learnModeTree = null;
let learnModeDistros = null;
let learnModeFilters = {
    search: '',
    category: 'all',
    paidOnly: false,
    activeOnly: true
};
let searchDebounceTimer = null;

const learnModeModal = document.getElementById('learn-mode-modal');
const learnModeBtn = document.getElementById('learn-mode-btn');
const closeLearnModeBtn = document.getElementById('close-learn-mode-btn');
const learnTreeContainer = document.getElementById('learn-tree-container');
const learnSearchInput = document.getElementById('learn-search');
const learnCategoryFilter = document.getElementById('learn-category-filter');
const learnPaidOnlyCheckbox = document.getElementById('learn-paid-only');
const learnActiveOnlyCheckbox = document.getElementById('learn-active-only');
const learnExpandAllBtn = document.getElementById('learn-expand-all');
const learnCollapseAllBtn = document.getElementById('learn-collapse-all');

function buildDistroTree(distros) {
    // Create a map of all distros
    const distroMap = new Map();

    distros.forEach(distro => {
        distroMap.set(distro.name, {
            ...distro,
            children: [],
            isExpanded: true
        });
    });

    // Handle special case: Mageia references "Mandriva" but the name is "Mandriva Linux"
    distros.forEach(distro => {
        const node = distroMap.get(distro.name);
        let parentName = distro.parentDistro;

        // Special case for Mageia
        if (parentName === 'Mandriva' && !distroMap.has('Mandriva')) {
            parentName = 'Mandriva Linux';
        }

        if (parentName !== 'Independent' && distroMap.has(parentName)) {
            const parent = distroMap.get(parentName);
            parent.children.push(node);
        }
    });

    // Get root nodes (independent distros) and sort by year
    const roots = Array.from(distroMap.values())
        .filter(d => d.parentDistro === 'Independent')
        .sort((a, b) => a.yearReleased - b.yearReleased);

    // Sort children alphabetically for each node
    function sortChildren(node) {
        if (node.children.length > 0) {
            node.children.sort((a, b) => a.name.localeCompare(b.name));
            node.children.forEach(sortChildren);
        }
    }

    roots.forEach(sortChildren);

    return roots;
}

function getCategoryClass(category) {
    const categories = category.toLowerCase();
    if (categories.includes('gaming')) return 'cat-gaming';
    if (categories.includes('security') || categories.includes('penetration')) return 'cat-security';
    if (categories.includes('enterprise')) return 'cat-enterprise';
    if (categories.includes('server')) return 'cat-server';
    if (categories.includes('desktop')) return 'cat-desktop';
    return '';
}

function getDifficultyClass(difficulty) {
    const diff = difficulty.toLowerCase();
    if (diff === 'beginner') return 'diff-beginner';
    if (diff === 'intermediate') return 'diff-intermediate';
    if (diff === 'advanced') return 'diff-advanced';
    if (diff === 'expert') return 'diff-expert';
    return '';
}

function getNodeSymbols(node) {
    let symbols = [];

    if (node.parentDistro === 'Independent') {
        symbols.push('◆');
    }
    if (node.paid) {
        symbols.push('$');
    }
    if (node.category && node.category.toLowerCase().includes('gaming')) {
        symbols.push('★');
    }
    if (node.discontinued === 'Yes') {
        symbols.push('⚠');
    }

    return symbols.join(' ');
}

function matchesFilters(node) {
    // Search filter
    if (learnModeFilters.search) {
        const searchLower = learnModeFilters.search.toLowerCase();
        if (!node.name.toLowerCase().includes(searchLower)) {
            return false;
        }
    }

    // Category filter
    if (learnModeFilters.category !== 'all') {
        if (!node.category.toLowerCase().includes(learnModeFilters.category.toLowerCase())) {
            return false;
        }
    }

    // Paid filter
    if (learnModeFilters.paidOnly && !node.paid) {
        return false;
    }

    // Active filter
    if (learnModeFilters.activeOnly && node.discontinued === 'Yes') {
        return false;
    }

    return true;
}

function hasMatchingDescendants(node) {
    if (matchesFilters(node)) {
        return true;
    }

    return node.children.some(hasMatchingDescendants);
}

function renderTreeNode(node, level = 0, isLastChild = true, prefix = '') {
    // Check if this node or any descendants match filters
    if (!hasMatchingDescendants(node)) {
        return '';
    }

    const nodeMatches = matchesFilters(node);
    const categoryClass = getCategoryClass(node.category);
    const difficultyClass = getDifficultyClass(node.difficulty);
    const symbols = getNodeSymbols(node);
    const hasChildren = node.children.length > 0;
    const expandIcon = hasChildren ? (node.isExpanded ? '▼' : '▶') : '';
    const expandIconClass = hasChildren ? '' : 'no-children';

    // Build tree line prefix
    const lineChar = isLastChild ? '└─' : '├─';
    const fullPrefix = level > 0 ? prefix + lineChar + ' ' : '';

    // Store distro data for tooltip
    const distroData = JSON.stringify({
        name: node.name,
        yearReleased: node.yearReleased,
        parentDistro: node.parentDistro,
        category: node.category,
        difficulty: node.difficulty,
        paid: node.paid,
        discontinued: node.discontinued,
        initSystem: node.initSystem,
        packageManager: node.packageManager,
        desktopEnvironment: node.desktopEnvironment,
        popularity: node.popularity,
        architecture: node.architecture,
        releaseType: node.releaseType
    }).replace(/"/g, '&quot;');

    let html = '';

    if (nodeMatches) {
        html += `<div class="tree-node ${categoryClass} ${difficultyClass}" data-node-id="${node.id}">`;
        html += `  <div class="tree-node-content">`;
        html += `    <span class="tree-line-prefix">${fullPrefix}</span>`;
        html += `    <span class="tree-expand-icon ${expandIconClass}">${expandIcon}</span>`;
        html += `    <span class="tree-node-name" data-distro='${distroData}'>${node.name}</span>`;
        if (symbols) {
            html += `    <span class="tree-node-symbols">${symbols}</span>`;
        }
        html += `  </div>`;

        if (hasChildren) {
            const childPrefix = level > 0 ? prefix + (isLastChild ? '  ' : '│ ') : '';
            const childrenClass = node.isExpanded ? '' : 'collapsed';
            html += `  <div class="tree-children ${childrenClass}">`;
            node.children.forEach((child, index) => {
                const isLast = index === node.children.length - 1;
                html += renderTreeNode(child, level + 1, isLast, childPrefix);
            });
            html += `  </div>`;
        }

        html += `</div>`;
    } else if (hasChildren) {
        // Node doesn't match but has children that might match
        const childPrefix = level > 0 ? prefix + (isLastChild ? '  ' : '│ ') : '';
        node.children.forEach((child, index) => {
            const isLast = index === node.children.length - 1;
            html += renderTreeNode(child, level, isLast, prefix);
        });
    }

    return html;
}

function renderLearnModeTree() {
    if (!learnModeTree || !learnTreeContainer) return;

    let html = '';
    learnModeTree.forEach(root => {
        html += renderTreeNode(root, 0, true, '');
    });

    if (html === '') {
        html = '<div style="padding: 2rem; text-align: center; color: var(--text-secondary);">No distros match the current filters.</div>';
    }

    learnTreeContainer.innerHTML = html;

    // Add click handlers for expand/collapse
    learnTreeContainer.querySelectorAll('.tree-node').forEach(nodeEl => {
        const nodeId = nodeEl.dataset.nodeId;
        const expandIcon = nodeEl.querySelector('.tree-expand-icon');

        if (expandIcon && !expandIcon.classList.contains('no-children')) {
            expandIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleNodeExpansion(nodeId);
            });
        }
    });

    // Add tooltip handlers for distro names
    setupDistroTooltips();
}

let tooltipElement = null;

function setupDistroTooltips() {
    const distroNames = learnTreeContainer.querySelectorAll('.tree-node-name');

    distroNames.forEach(nameEl => {
        nameEl.addEventListener('mouseenter', showDistroTooltip);
        nameEl.addEventListener('mousemove', moveDistroTooltip);
        nameEl.addEventListener('mouseleave', hideDistroTooltip);
    });
}

function showDistroTooltip(e) {
    const distroData = JSON.parse(e.target.dataset.distro);

    // Create tooltip element
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'distro-tooltip';

    const paidStatus = distroData.paid ? 'Yes' : 'No';
    const discontinuedStatus = distroData.discontinued;

    tooltipElement.innerHTML = `
        <div class="distro-tooltip-header">${distroData.name}</div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Year Released:</span>
            <span class="distro-tooltip-value">${distroData.yearReleased}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Parent:</span>
            <span class="distro-tooltip-value">${distroData.parentDistro}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Category:</span>
            <span class="distro-tooltip-value">${distroData.category}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Difficulty:</span>
            <span class="distro-tooltip-value">${distroData.difficulty}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Package Manager:</span>
            <span class="distro-tooltip-value">${distroData.packageManager}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Init System:</span>
            <span class="distro-tooltip-value">${distroData.initSystem}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Desktop:</span>
            <span class="distro-tooltip-value">${distroData.desktopEnvironment}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Release Type:</span>
            <span class="distro-tooltip-value">${distroData.releaseType}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Architecture:</span>
            <span class="distro-tooltip-value">${distroData.architecture}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Popularity:</span>
            <span class="distro-tooltip-value">${distroData.popularity}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Paid:</span>
            <span class="distro-tooltip-value">${paidStatus}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Status:</span>
            <span class="distro-tooltip-value">${discontinuedStatus === 'Yes' ? 'Discontinued' : 'Active'}</span>
        </div>
    `;

    document.body.appendChild(tooltipElement);
    moveDistroTooltip(e);
}

function moveDistroTooltip(e) {
    if (!tooltipElement) return;

    const tooltipWidth = tooltipElement.offsetWidth;
    const tooltipHeight = tooltipElement.offsetHeight;
    const padding = 15;

    let left = e.clientX + padding;
    let top = e.clientY + padding;

    // Adjust if tooltip goes off right edge
    if (left + tooltipWidth > window.innerWidth) {
        left = e.clientX - tooltipWidth - padding;
    }

    // Adjust if tooltip goes off bottom edge
    if (top + tooltipHeight > window.innerHeight) {
        top = e.clientY - tooltipHeight - padding;
    }

    tooltipElement.style.left = left + 'px';
    tooltipElement.style.top = top + 'px';
}

function hideDistroTooltip() {
    if (tooltipElement) {
        tooltipElement.remove();
        tooltipElement = null;
    }
}

function toggleNodeExpansion(nodeId) {
    // Find and toggle the node in the tree
    function toggleInTree(nodes) {
        for (const node of nodes) {
            if (node.id === nodeId) {
                node.isExpanded = !node.isExpanded;
                return true;
            }
            if (node.children.length > 0 && toggleInTree(node.children)) {
                return true;
            }
        }
        return false;
    }

    toggleInTree(learnModeTree);
    renderLearnModeTree();
}

function expandAllNodes(nodes) {
    nodes.forEach(node => {
        node.isExpanded = true;
        if (node.children.length > 0) {
            expandAllNodes(node.children);
        }
    });
}

function collapseAllNodes(nodes) {
    nodes.forEach(node => {
        node.isExpanded = false;
        if (node.children.length > 0) {
            collapseAllNodes(node.children);
        }
    });
}

async function openLearnMode() {
    if (!learnModeModal) return;

    // Fetch distros if not already loaded
    if (!learnModeDistros) {
        try {
            const response = await fetch('/api/distros/full?includeVeryLow=true&includeDiscontinued=true');
            if (!response.ok) {
                showToast('Failed to load distros for Learn Mode', 'error');
                return;
            }
            learnModeDistros = await response.json();
        } catch (error) {
            console.error('Error loading distros:', error);
            showToast('Failed to load distros for Learn Mode', 'error');
            return;
        }
    }

    // Build tree if not already built
    if (!learnModeTree) {
        learnModeTree = buildDistroTree(learnModeDistros);
    }

    // Render tree
    renderLearnModeTree();

    // Show modal
    learnModeModal.classList.remove('hidden');
}

function closeLearnMode() {
    if (!learnModeModal) return;
    learnModeModal.classList.add('hidden');
    hideDistroTooltip();
}

function applyLearnModeFilters() {
    renderLearnModeTree();
}

// Event listeners for Learn Mode
if (learnModeBtn) {
    learnModeBtn.addEventListener('click', openLearnMode);
}

if (closeLearnModeBtn) {
    closeLearnModeBtn.addEventListener('click', closeLearnMode);
}

if (learnModeModal) {
    learnModeModal.addEventListener('click', (e) => {
        if (e.target === learnModeModal) {
            closeLearnMode();
        }
    });
}

if (learnSearchInput) {
    learnSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            learnModeFilters.search = e.target.value.trim();
            applyLearnModeFilters();
        }, 300);
    });
}

if (learnCategoryFilter) {
    learnCategoryFilter.addEventListener('change', (e) => {
        learnModeFilters.category = e.target.value;
        applyLearnModeFilters();
    });
}

if (learnPaidOnlyCheckbox) {
    learnPaidOnlyCheckbox.addEventListener('change', (e) => {
        learnModeFilters.paidOnly = e.target.checked;
        applyLearnModeFilters();
    });
}

if (learnActiveOnlyCheckbox) {
    learnActiveOnlyCheckbox.addEventListener('change', (e) => {
        learnModeFilters.activeOnly = e.target.checked;
        applyLearnModeFilters();
    });
}

if (learnExpandAllBtn) {
    learnExpandAllBtn.addEventListener('click', () => {
        expandAllNodes(learnModeTree);
        renderLearnModeTree();
    });
}

if (learnCollapseAllBtn) {
    learnCollapseAllBtn.addEventListener('click', () => {
        collapseAllNodes(learnModeTree);
        renderLearnModeTree();
    });
}

// Confetti effect
function createConfetti() {
    const colors = ['#4a9eff', '#4ade80', '#facc15'];
    const confettiCount = 30;
    
    for (let i = 0; i < confettiCount; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.width = '8px';
            confetti.style.height = '8px';
            confetti.style.borderRadius = '2px';
            confetti.style.animationDuration = '2s';
            document.body.appendChild(confetti);
            
            setTimeout(() => confetti.remove(), 2000);
        }, i * 30);
    }
}

// Typewriter effect
function typeWriterEffect(element, text, speed = 100) {
    const originalText = text;
    element.textContent = '';
    let i = 0;
    
    function type() {
        if (i < originalText.length) {
            element.textContent += originalText.charAt(i);
            i++;
            setTimeout(type, speed);
        }
    }
    
    type();
}

// Shake animation for wrong input
function shakeInput() {
    guessInput.style.animation = 'shake 0.5s';
    setTimeout(() => {
        guessInput.style.animation = '';
    }, 500);
}

// Add shake animation to CSS dynamically
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
        20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
`;
document.head.appendChild(shakeStyle);

// Event listeners
guessBtn.addEventListener('click', handleGuess);

guessInput.addEventListener('input', () => {
    updateDistroList(guessInput.value);
});

guessInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        distroListElement.innerHTML = '';
        setTimeout(() => {
            distroListElement.innerHTML = '';
        }, 10);
        handleGuess();
    }
});

guessInput.addEventListener('focus', () => {
    if (guessInput.value.length === 0) {
        distroListElement.innerHTML = '';
    }
});

guessInput.addEventListener('blur', () => {
    distroListElement.innerHTML = '';
});

if (toggleVeryLow) {
    toggleVeryLow.addEventListener('change', async () => {
        gameOptions.includeVeryLow = toggleVeryLow.checked;
        applyOptionConstraints();
        saveOptions();
        renderOptions();
        await applyOptionsAndRestart();
    });
}

if (toggleDiscontinued) {
    toggleDiscontinued.addEventListener('change', async () => {
        gameOptions.includeDiscontinued = toggleDiscontinued.checked;
        applyOptionConstraints();
        saveOptions();
        renderOptions();
        await applyOptionsAndRestart();
    });
}

newGameBtn.addEventListener('click', startNewGame);

playAgainBtn.addEventListener('click', startNewGame);

if (howToPlayBtn) {
    howToPlayBtn.addEventListener('click', toggleInstructionsModal);
}

if (closeInstructionsBtn) {
    closeInstructionsBtn.addEventListener('click', closeInstructionsModal);
}

// Close modal when clicking outside
victoryModal.addEventListener('click', (e) => {
    if (e.target === victoryModal) {
        victoryModal.classList.add('hidden');
    }
});

if (instructionsModal) {
    instructionsModal.addEventListener('click', (e) => {
        if (e.target === instructionsModal) {
            closeInstructionsModal();
        }
    });
}

// Start new game on Enter when victory modal is shown
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !victoryModal.classList.contains('hidden')) {
        startNewGame();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeInstructionsModal();
        closeLearnMode();
    }
});

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', initGame);
