// Game state
let targetId = null;
let guessCount = 0;
let gameWon = false;
let distroList = [];
let guessedDistros = [];
let guessHistory = [];
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
const VALID_DIFFICULTIES = ['Very Easy', 'Easy', 'Medium', 'Hard', 'Extreme'];
const DEFAULT_DIFFICULTY = 'Hard';
let gameOptions = {
    difficulty: DEFAULT_DIFFICULTY,
    includeDiscontinued: false,
    includeNonLinux: false
};

// DOM elements
const guessInput = document.getElementById('guess-input');
const guessBtn = document.getElementById('guess-btn');
const newGameBtn = document.getElementById('new-game-btn');
const feedbackContainer = document.getElementById('feedback-container');
const feedbackHeader = document.getElementById('feedback-header');
const distroListElement = document.getElementById('distro-list');
const victoryModal = document.getElementById('victory-modal');
const closeVictoryBtn = document.getElementById('close-victory-btn');
const solvedDistroBanner = document.getElementById('solved-distro-banner');
const guessCountElement = document.getElementById('guess-count');
const playAgainBtn = document.getElementById('play-again-btn');
const shareBtn = document.getElementById('share-btn');
const sharePreview = document.getElementById('share-preview');
const firstGuessHelp = document.getElementById('first-guess-help');
const toggleDiscontinued = document.getElementById('toggle-discontinued');
const toggleNonLinux = document.getElementById('toggle-non-linux');
const toggleNonLinuxLabel = document.getElementById('toggle-non-linux-label');
const difficultySelect = document.getElementById('difficulty-select');
const howToPlayBtn = document.getElementById('how-to-play-btn');
const instructionsModal = document.getElementById('instructions-modal');
const closeInstructionsBtn = document.getElementById('close-instructions-btn');
const optionsPanel = document.getElementById('options-panel');
const optionsToggleBtn = document.getElementById('options-toggle-btn');

const OPTIONS_PANEL_COLLAPSED_KEY = 'distrodleOptionsPanelCollapsed';

function getOptionQuery() {
    return `difficulty=${encodeURIComponent(gameOptions.difficulty)}&includeDiscontinued=${gameOptions.includeDiscontinued}&includeNonLinux=${gameOptions.includeNonLinux}`;
}

function applyOptionConstraints() {
    const isExtreme = gameOptions.difficulty === 'Extreme';
    if (toggleNonLinux) {
        toggleNonLinux.disabled = !isExtreme;
    }
    if (toggleNonLinuxLabel) {
        toggleNonLinuxLabel.classList.toggle('disabled', !isExtreme);
        toggleNonLinuxLabel.title = isExtreme ? 'Include Beyond Linux (Unix/BSD) distributions in Extreme mode' : 'Available in Extreme difficulty only';
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

        // Migrate from older option shapes.
        // Legacy v1 (4 tiers: Easy/Medium/Hard/Extreme): old "Easy" was a
        // smaller pool (High + Very High only); that pool is now "Very Easy",
        // so map it to preserve the user's prior experience.
        // Legacy v0 (very old { includeVeryLow } shape): map to closest match.
        if (parsed && typeof parsed === 'object') {
            if (typeof parsed.difficulty === 'string') {
                if (parsed.difficulty === 'Easy') {
                    // Old "Easy" -> "Very Easy" (same small pool as before)
                    gameOptions.difficulty = 'Very Easy';
                } else if (VALID_DIFFICULTIES.includes(parsed.difficulty)) {
                    gameOptions.difficulty = parsed.difficulty;
                } else if (parsed.includeVeryLow === true) {
                    gameOptions.difficulty = 'Extreme';
                } else {
                    gameOptions.difficulty = DEFAULT_DIFFICULTY;
                }
            } else if (parsed.includeVeryLow === true) {
                gameOptions.difficulty = 'Extreme';
            }
        }

        if (parsed && typeof parsed.includeDiscontinued === 'boolean') {
            gameOptions.includeDiscontinued = parsed.includeDiscontinued;
        }
        if (parsed && typeof parsed.includeNonLinux === 'boolean') {
            gameOptions.includeNonLinux = parsed.includeNonLinux;
        }
        applyOptionConstraints();
    } catch (error) {
        console.warn('Failed to load options, using defaults:', error);
    }
}

function saveOptions() {
    localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify(gameOptions));
}

function loadOptionsPanelState() {
    try {
        const raw = localStorage.getItem(OPTIONS_PANEL_COLLAPSED_KEY);
        if (raw === null) {
            return true;
        }
        return raw === 'true';
    } catch (error) {
        return true;
    }
}

function saveOptionsPanelState(isCollapsed) {
    localStorage.setItem(OPTIONS_PANEL_COLLAPSED_KEY, String(isCollapsed));
}

function renderOptionsPanelState() {
    if (!optionsPanel || !optionsToggleBtn) return;

    const isCollapsed = optionsPanel.classList.contains('options-collapsed');
    optionsPanel.classList.toggle('options-expanded', !isCollapsed);
    optionsToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    optionsToggleBtn.textContent = isCollapsed ? 'Show' : 'Hide';
}

function setOptionsPanelCollapsed(isCollapsed) {
    if (!optionsPanel) return;
    optionsPanel.classList.toggle('options-collapsed', isCollapsed);
    optionsPanel.classList.toggle('options-expanded', !isCollapsed);
    renderOptionsPanelState();
    saveOptionsPanelState(isCollapsed);
}

function toggleOptionsPanelCollapsed() {
    if (!optionsPanel) return;
    const isCollapsed = optionsPanel.classList.contains('options-collapsed');
    setOptionsPanelCollapsed(!isCollapsed);
}

function renderOptions() {
    if (difficultySelect && difficultySelect.value !== gameOptions.difficulty) {
        difficultySelect.value = gameOptions.difficulty;
    }
    if (toggleDiscontinued) {
        toggleDiscontinued.checked = gameOptions.includeDiscontinued;
    }
    if (toggleNonLinux) {
        toggleNonLinux.checked = gameOptions.includeNonLinux;
    }
    applyOptionConstraints();
}

function setDifficulty(difficulty) {
    if (!VALID_DIFFICULTIES.includes(difficulty)) return;
    if (gameOptions.difficulty === difficulty) return;
    gameOptions.difficulty = difficulty;
    saveOptions();
    renderOptions();
    applyOptionsAndRestart();
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
    } else if (type === 'nearMiss') {
        // Triumphant-but-tense C-major triangle chord (C-E-G), staggered
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, i) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, audioContext.currentTime + i * 0.05);
            gain.gain.setValueAtTime(0.18, audioContext.currentTime + i * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + i * 0.05 + 0.55);
            osc.start(audioContext.currentTime + i * 0.05);
            osc.stop(audioContext.currentTime + i * 0.05 + 0.6);
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
        setOptionsPanelCollapsed(loadOptionsPanelState());

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
        guessHistory = [];
        if (sharePreview) {
            sharePreview.innerHTML = '';
        }
        if (solvedDistroBanner) {
            solvedDistroBanner.textContent = '';
        }
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
                setTimeout(() => showVictory(data.matchedName || matchedName), 500);
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

    // Near-miss: every attribute is correct except the distro name.
    // Highlight the row, fire a celebratory toast, and play a chord.
    const allOtherCorrect = attributes
        .filter(a => a.key !== 'name')
        .every(a => feedback[a.key].status === 'correct');
    const nameWrong = feedback.name.status !== 'correct';
    if (allOtherCorrect && nameWrong) {
        row.classList.add('near-miss');
        showToast('🔥 All attributes match — so close!', 'info');
        playSound('nearMiss');
    }

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

    // Save attribute statuses for shareable emoji grid
    const rowFeedback = attributes.map(attr => feedback[attr.key]?.status || 'incorrect');
    guessHistory.push(rowFeedback);
}

// Show hint when 5, 10, 15... misses
function showHint(hint) {
    showToast(`💡 Hint: ${hint.displayField} - ${hint.value}`, 'info');
}

// Show victory modal
function showVictory(targetName) {
    const tries = guessedDistros.length || guessCount;
    guessCountElement.textContent = tries;
    
    if (solvedDistroBanner) {
        const name = targetName || (guessedDistros.length > 0 ? guessedDistros[guessedDistros.length - 1] : '');
        solvedDistroBanner.textContent = name ? `🐧 ${name}` : '';
    }

    victoryModal.classList.remove('hidden');
    guessInput.disabled = true;
    guessBtn.disabled = true;
    
    // Play victory sound
    playSound('victory');
    
    // Create confetti explosion
    createConfetti();
    
    // Render emoji preview in victory modal
    if (sharePreview) {
        const statusEmojiMap = {
            correct: '🟩',
            partial: '🟨',
            incorrect: '🟥'
        };
        const previewHtml = guessHistory
            .map(row => `<div class="share-row">${row.map(status => `<span class="share-cell">${statusEmojiMap[status] || '🟥'}</span>`).join('')}</div>`)
            .join('');
        sharePreview.innerHTML = previewHtml;
    }
    
    // Add typing effect to the victory message
    const victoryTitle = document.querySelector('#victory-modal h2');
    if (victoryTitle) {
        typeWriterEffect(victoryTitle, 'Solved!', 100);
    }
}

// Generate shareable Wordle-style text summary
function generateShareText() {
    const statusEmojiMap = {
        correct: '🟩',
        partial: '🟨',
        incorrect: '🟥'
    };

    let optionsText = gameOptions.difficulty;
    const extras = [];
    if (gameOptions.includeDiscontinued) extras.push('Discontinued');
    if (gameOptions.includeNonLinux) extras.push('Beyond Linux');
    if (extras.length > 0) {
        optionsText += ` (${extras.join(', ')})`;
    }

    const tries = guessedDistros.length || guessCount || 1;
    const triesLabel = tries === 1 ? '1 try' : `${tries} tries`;

    const grid = guessHistory
        .map(row => row.map(status => statusEmojiMap[status] || '🟥').join(''))
        .join('\n');

    let url = '';
    try {
        if (typeof window !== 'undefined' && window.location && window.location.href) {
            url = window.location.href
                .split('?')[0]
                .split('#')[0]
                .replace(/\/index\.html$/i, '')
                .replace(/\/+$/, '');
        }
    } catch (e) {
        // Fallback
    }
    if (!url) {
        url = typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'https://distro.fedesito.me';
    }

    return `Distrodle 🐧 ${optionsText} — ${triesLabel}\n\n${grid}\n\n${url}`;
}

// Copy results to clipboard with fallback
async function copyShareText() {
    const text = generateShareText();
    let copied = false;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            copied = true;
        } else {
            throw new Error('Clipboard API unavailable');
        }
    } catch (err) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            copied = document.execCommand('copy');
        } catch (copyErr) {
            console.error('Fallback copy failed:', copyErr);
        }
        document.body.removeChild(textArea);
    }

    if (copied) {
        playSound('correct');
        showToast('📋 Copied results to clipboard!', 'info');
        if (shareBtn) {
            const originalHTML = shareBtn.innerHTML;
            shareBtn.innerHTML = '<span class="share-icon">✅</span> Copied!';
            shareBtn.classList.add('copied');
            setTimeout(() => {
                shareBtn.innerHTML = originalHTML;
                shareBtn.classList.remove('copied');
            }, 2000);
        }
    } else {
        showToast('Could not copy to clipboard automatically.', 'error');
    }
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

// Distrodex (Interactive catalog & family tree of every distro)
let distrodexTree = null;
let distrodexDistros = null;
let distrodexViewMode = 'tree'; // 'tree' or 'list'
let distrodexSortBy = 'name-asc';

const DEFAULT_DISTRODEX_FILTERS = {
    search: '',
    category: 'all',
    parent: 'all',
    difficulty: 'all',
    status: 'active', // 'active', 'discontinued', 'all'
    paid: 'all',      // 'all', 'free', 'paid'
    packageManager: 'all',
    initSystem: 'all',
    desktop: 'all',
    releaseType: 'all',
    popularity: 'all',
    architecture: 'all',
    ecosystem: 'all'
};

let distrodexFilters = { ...DEFAULT_DISTRODEX_FILTERS };
let distrodexSearchDebounceTimer = null;

// DOM elements
const distrodexModal = document.getElementById('distrodex-modal');
const distrodexBtn = document.getElementById('distrodex-btn');
const closeDistrodexBtn = document.getElementById('close-distrodex-btn');
const distrodexTreeContainer = document.getElementById('distrodex-tree-container');
const distrodexListContainer = document.getElementById('distrodex-list-container');
const distrodexTreeControls = document.getElementById('distrodex-tree-controls');
const distrodexListControls = document.getElementById('distrodex-list-controls');
const distrodexViewTreeBtn = document.getElementById('distrodex-view-tree-btn');
const distrodexViewListBtn = document.getElementById('distrodex-view-list-btn');
const distrodexResultsCount = document.getElementById('distrodex-results-count');
const distrodexResetFiltersBtn = document.getElementById('distrodex-reset-filters-btn');
const distrodexActiveFilterBadge = document.getElementById('distrodex-active-filter-badge');
const distrodexActiveTagsContainer = document.getElementById('distrodex-active-tags');

// Search & filter inputs
const distrodexSearchInput = document.getElementById('distrodex-search');
const distrodexSearchClearBtn = document.getElementById('distrodex-search-clear');
const distrodexAdvToggleBtn = document.getElementById('distrodex-advanced-toggle-btn');
const distrodexAdvFiltersPanel = document.getElementById('distrodex-advanced-filters');

const distrodexCategoryFilter = document.getElementById('distrodex-category-filter');
const distrodexParentFilter = document.getElementById('distrodex-parent-filter');
const distrodexDifficultyFilter = document.getElementById('distrodex-difficulty-filter');
const distrodexStatusFilter = document.getElementById('distrodex-status-filter');
const distrodexPaidFilter = document.getElementById('distrodex-paid-filter');

const distrodexPkgFilter = document.getElementById('distrodex-pkg-filter');
const distrodexInitFilter = document.getElementById('distrodex-init-filter');
const distrodexDesktopFilter = document.getElementById('distrodex-desktop-filter');
const distrodexReleaseFilter = document.getElementById('distrodex-release-filter');
const distrodexPopularityFilter = document.getElementById('distrodex-popularity-filter');
const distrodexArchFilter = document.getElementById('distrodex-arch-filter');
const distrodexEcosystemFilter = document.getElementById('distrodex-ecosystem-filter');
const distrodexSortSelect = document.getElementById('distrodex-sort-select');

const distrodexExpandAllBtn = document.getElementById('distrodex-expand-all');
const distrodexCollapseAllBtn = document.getElementById('distrodex-collapse-all');

function buildDistroTree(distros) {
    const distroMap = new Map();

    distros.forEach(distro => {
        distroMap.set(distro.name, {
            ...distro,
            children: [],
            isExpanded: true
        });
    });

    // Handle parent-child relationships
    distros.forEach(distro => {
        const node = distroMap.get(distro.name);
        let parentName = distro.parentDistro;

        if (parentName === 'Mandriva' && !distroMap.has('Mandriva')) {
            parentName = 'Mandriva Linux';
        }

        if (parentName !== 'Independent' && distroMap.has(parentName)) {
            const parent = distroMap.get(parentName);
            parent.children.push(node);
        }
    });

    // Root nodes (independent distros) sorted by year
    const roots = Array.from(distroMap.values())
        .filter(d => d.parentDistro === 'Independent')
        .sort((a, b) => (a.yearReleased || 0) - (b.yearReleased || 0));

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
    const categories = (category || '').toLowerCase();
    if (categories.includes('bsd')) return 'cat-bsd';
    if (categories.includes('router') || categories.includes('firewall')) return 'cat-router';
    if (categories.includes('gaming')) return 'cat-gaming';
    if (categories.includes('security') || categories.includes('penetration') || categories.includes('forensics')) return 'cat-security';
    if (categories.includes('enterprise')) return 'cat-enterprise';
    if (categories.includes('server')) return 'cat-server';
    if (categories.includes('desktop')) return 'cat-desktop';
    return '';
}

function getDifficultyClass(difficulty) {
    const diff = (difficulty || '').toLowerCase();
    if (diff === 'beginner') return 'diff-beginner';
    if (diff === 'intermediate') return 'diff-intermediate';
    if (diff === 'advanced') return 'diff-advanced';
    if (diff === 'expert') return 'diff-expert';
    return '';
}

function getNodeSymbols(node) {
    let symbols = [];
    if (node.parentDistro === 'Independent') {
        symbols.push('<span class="symbol" title="Independent / Root">◆</span>');
    }
    if (node.paid) {
        symbols.push('<span class="symbol symbol-paid" title="Commercial / Paid">$</span>');
    }
    if (node.category && node.category.toLowerCase().includes('gaming')) {
        symbols.push('<span class="symbol symbol-gaming" title="Gaming Distribution">★</span>');
    }
    if (node.discontinued === 'Yes') {
        symbols.push('<span class="symbol symbol-discontinued" title="Discontinued">⚠</span>');
    }
    return symbols.join(' ');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !text) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    // If searchTerm contains field prefix (e.g. pkg:pacman), extract the value part for highlighting
    let query = searchTerm.trim();
    if (query.includes(':')) {
        const parts = query.split(':');
        query = parts[parts.length - 1].trim();
    }
    if (!query) return escapedText;

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<mark class="search-highlight">$1</mark>');
}

function distrodexMatchesFilters(node) {
    if (!node) return false;

    // Discontinued / Status filter
    if (distrodexFilters.status === 'active' && node.discontinued === 'Yes') {
        return false;
    }
    if (distrodexFilters.status === 'discontinued' && node.discontinued !== 'Yes') {
        return false;
    }

    // Pricing filter
    if (distrodexFilters.paid === 'free' && node.paid) {
        return false;
    }
    if (distrodexFilters.paid === 'paid' && !node.paid) {
        return false;
    }

    // Category filter
    if (distrodexFilters.category !== 'all') {
        const catFilter = distrodexFilters.category.toLowerCase();
        const nodeCat = (node.category || '').toLowerCase();
        if (catFilter === 'bsd') {
            if (!nodeCat.includes('bsd') && !node.isBsd) return false;
        } else if (catFilter === 'router') {
            if (!nodeCat.includes('router') && !nodeCat.includes('firewall')) return false;
        } else if (!nodeCat.includes(catFilter)) {
            return false;
        }
    }

    // Parent distro filter
    if (distrodexFilters.parent !== 'all') {
        const parentFilter = distrodexFilters.parent.toLowerCase();
        const nodeParent = (node.parentDistro || '').toLowerCase();
        if (distrodexFilters.parent === 'Independent') {
            if (node.parentDistro !== 'Independent') return false;
        } else if (!nodeParent.includes(parentFilter)) {
            return false;
        }
    }

    // Difficulty filter
    if (distrodexFilters.difficulty !== 'all') {
        if ((node.difficulty || '').toLowerCase() !== distrodexFilters.difficulty.toLowerCase()) {
            return false;
        }
    }

    // Package manager filter
    if (distrodexFilters.packageManager !== 'all') {
        const pkgFilter = distrodexFilters.packageManager.toLowerCase();
        const nodePkg = (node.packageManager || '').toLowerCase();
        if (!nodePkg.includes(pkgFilter)) return false;
    }

    // Init system filter
    if (distrodexFilters.initSystem !== 'all') {
        const initFilter = distrodexFilters.initSystem.toLowerCase();
        const nodeInit = (node.initSystem || '').toLowerCase();
        if (!nodeInit.includes(initFilter)) return false;
    }

    // Desktop environment filter
    if (distrodexFilters.desktop !== 'all') {
        const deskFilter = distrodexFilters.desktop.toLowerCase();
        const nodeDesk = (node.desktopEnvironment || '').toLowerCase();
        if (!nodeDesk.includes(deskFilter)) return false;
    }

    // Release type filter
    if (distrodexFilters.releaseType !== 'all') {
        const relFilter = distrodexFilters.releaseType.toLowerCase();
        const nodeRel = (node.releaseType || '').toLowerCase();
        if (!nodeRel.includes(relFilter)) return false;
    }

    // Popularity filter
    if (distrodexFilters.popularity !== 'all') {
        if ((node.popularity || '').toLowerCase() !== distrodexFilters.popularity.toLowerCase()) {
            return false;
        }
    }

    // Architecture filter
    if (distrodexFilters.architecture !== 'all') {
        const archFilter = distrodexFilters.architecture.toLowerCase();
        const nodeArch = (node.architecture || '').toLowerCase();
        if (!nodeArch.includes(archFilter)) return false;
    }

    // Ecosystem filter
    if (distrodexFilters.ecosystem !== 'all') {
        if (distrodexFilters.ecosystem === 'linux' && (node.isBsd || node.isUnix)) {
            return false;
        }
        if (distrodexFilters.ecosystem === 'bsd' && !node.isBsd) {
            return false;
        }
        if (distrodexFilters.ecosystem === 'beyond-linux' && !node.isBsd && !node.isUnix) {
            return false;
        }
    }

    // Free text search filter (supports multi-term and field queries like 'pkg:pacman', 'cat:gaming', 'year:2004')
    if (distrodexFilters.search) {
        const terms = distrodexFilters.search.split(/\s+/).filter(Boolean);
        const matchesAllTerms = terms.every(term => {
            const lowerTerm = term.toLowerCase();
            if (lowerTerm.includes(':')) {
                const [key, ...valParts] = lowerTerm.split(':');
                const val = valParts.join(':').trim();
                if (!val) return true;

                switch (key) {
                    case 'name':
                        return (node.name || '').toLowerCase().includes(val);
                    case 'cat':
                    case 'category':
                        return (node.category || '').toLowerCase().includes(val);
                    case 'parent':
                    case 'base':
                        return (node.parentDistro || '').toLowerCase().includes(val);
                    case 'pkg':
                    case 'package':
                    case 'packagemanager':
                        return (node.packageManager || '').toLowerCase().includes(val);
                    case 'init':
                    case 'initsystem':
                        return (node.initSystem || '').toLowerCase().includes(val);
                    case 'desk':
                    case 'desktop':
                        return (node.desktopEnvironment || '').toLowerCase().includes(val);
                    case 'arch':
                    case 'architecture':
                        return (node.architecture || '').toLowerCase().includes(val);
                    case 'year':
                        return String(node.yearReleased || '').includes(val);
                    case 'diff':
                    case 'difficulty':
                        return (node.difficulty || '').toLowerCase().includes(val);
                    case 'pop':
                    case 'popularity':
                        return (node.popularity || '').toLowerCase().includes(val);
                    case 'release':
                    case 'releasetype':
                        return (node.releaseType || '').toLowerCase().includes(val);
                    case 'paid':
                        return val === 'yes' || val === 'true' ? node.paid : !node.paid;
                    case 'status':
                        return val === 'active' ? node.discontinued !== 'Yes' : node.discontinued === 'Yes';
                    default:
                        break;
                }
            }

            const searchable = [
                node.name,
                node.parentDistro,
                node.category,
                node.packageManager,
                node.initSystem,
                node.desktopEnvironment,
                node.architecture,
                node.releaseType,
                node.popularity,
                node.difficulty,
                String(node.yearReleased || ''),
                node.paid ? 'paid commercial' : 'free',
                node.discontinued === 'Yes' ? 'discontinued' : 'active',
                node.isBsd ? 'bsd' : '',
                node.isUnix ? 'unix' : ''
            ].join(' ').toLowerCase();

            return searchable.includes(lowerTerm);
        });

        if (!matchesAllTerms) {
            return false;
        }
    }

    return true;
}

function distrodexHasMatchingDescendants(node) {
    if (distrodexMatchesFilters(node)) {
        return true;
    }
    return node.children && node.children.some(distrodexHasMatchingDescendants);
}

function countMatchingDescendants(node) {
    let count = distrodexMatchesFilters(node) ? 1 : 0;
    if (node.children) {
        node.children.forEach(child => {
            count += countMatchingDescendants(child);
        });
    }
    return count;
}

function countTotalMatchingDistros() {
    if (!distrodexDistros) return 0;
    return distrodexDistros.filter(distrodexMatchesFilters).length;
}

function isAnyFilterActive() {
    return (
        distrodexFilters.search !== '' ||
        distrodexFilters.category !== 'all' ||
        distrodexFilters.parent !== 'all' ||
        distrodexFilters.difficulty !== 'all' ||
        distrodexFilters.status !== 'active' ||
        distrodexFilters.paid !== 'all' ||
        distrodexFilters.packageManager !== 'all' ||
        distrodexFilters.initSystem !== 'all' ||
        distrodexFilters.desktop !== 'all' ||
        distrodexFilters.releaseType !== 'all' ||
        distrodexFilters.popularity !== 'all' ||
        distrodexFilters.architecture !== 'all' ||
        distrodexFilters.ecosystem !== 'all'
    );
}

function updateActiveFilterBadges() {
    let activeCount = 0;
    const activeTags = [];

    if (distrodexFilters.search) {
        activeCount++;
        activeTags.push({ label: `"${distrodexFilters.search}"`, key: 'search' });
    }
    if (distrodexFilters.category !== 'all') {
        activeCount++;
        activeTags.push({ label: `Cat: ${distrodexFilters.category}`, key: 'category' });
    }
    if (distrodexFilters.parent !== 'all') {
        activeCount++;
        activeTags.push({ label: `Base: ${distrodexFilters.parent}`, key: 'parent' });
    }
    if (distrodexFilters.difficulty !== 'all') {
        activeCount++;
        activeTags.push({ label: `Diff: ${distrodexFilters.difficulty}`, key: 'difficulty' });
    }
    if (distrodexFilters.status !== 'active') {
        activeCount++;
        activeTags.push({ label: `Status: ${distrodexFilters.status}`, key: 'status' });
    }
    if (distrodexFilters.paid !== 'all') {
        activeCount++;
        activeTags.push({ label: `Pricing: ${distrodexFilters.paid}`, key: 'paid' });
    }
    if (distrodexFilters.packageManager !== 'all') {
        activeCount++;
        activeTags.push({ label: `Pkg: ${distrodexFilters.packageManager}`, key: 'packageManager' });
    }
    if (distrodexFilters.initSystem !== 'all') {
        activeCount++;
        activeTags.push({ label: `Init: ${distrodexFilters.initSystem}`, key: 'initSystem' });
    }
    if (distrodexFilters.desktop !== 'all') {
        activeCount++;
        activeTags.push({ label: `Desktop: ${distrodexFilters.desktop}`, key: 'desktop' });
    }
    if (distrodexFilters.releaseType !== 'all') {
        activeCount++;
        activeTags.push({ label: `Release: ${distrodexFilters.releaseType}`, key: 'releaseType' });
    }
    if (distrodexFilters.popularity !== 'all') {
        activeCount++;
        activeTags.push({ label: `Popularity: ${distrodexFilters.popularity}`, key: 'popularity' });
    }
    if (distrodexFilters.architecture !== 'all') {
        activeCount++;
        activeTags.push({ label: `Arch: ${distrodexFilters.architecture}`, key: 'architecture' });
    }
    if (distrodexFilters.ecosystem !== 'all') {
        activeCount++;
        activeTags.push({ label: `OS: ${distrodexFilters.ecosystem}`, key: 'ecosystem' });
    }

    if (distrodexActiveFilterBadge) {
        if (activeCount > 0) {
            distrodexActiveFilterBadge.textContent = activeCount;
            distrodexActiveFilterBadge.classList.remove('hidden');
        } else {
            distrodexActiveFilterBadge.classList.add('hidden');
        }
    }

    if (distrodexResetFiltersBtn) {
        if (isAnyFilterActive()) {
            distrodexResetFiltersBtn.classList.remove('hidden');
        } else {
            distrodexResetFiltersBtn.classList.add('hidden');
        }
    }

    if (distrodexSearchClearBtn) {
        if (distrodexFilters.search) {
            distrodexSearchClearBtn.classList.remove('hidden');
        } else {
            distrodexSearchClearBtn.classList.add('hidden');
        }
    }

    // Render active tag chips
    if (distrodexActiveTagsContainer) {
        if (activeTags.length > 0) {
            distrodexActiveTagsContainer.innerHTML = activeTags.map(tag => `
                <span class="active-filter-tag" data-filter-key="${tag.key}">
                    ${escapeHtml(tag.label)} <button type="button" class="tag-remove-btn" aria-label="Remove filter">×</button>
                </span>
            `).join('');

            distrodexActiveTagsContainer.querySelectorAll('.active-filter-tag').forEach(tagEl => {
                tagEl.addEventListener('click', () => {
                    const key = tagEl.dataset.filterKey;
                    resetSingleFilter(key);
                });
            });
        } else {
            distrodexActiveTagsContainer.innerHTML = '';
        }
    }
}

function resetSingleFilter(key) {
    if (key === 'search') {
        distrodexFilters.search = '';
        if (distrodexSearchInput) distrodexSearchInput.value = '';
    } else if (key in DEFAULT_DISTRODEX_FILTERS) {
        distrodexFilters[key] = DEFAULT_DISTRODEX_FILTERS[key];
        syncFilterControlsFromState();
    }
    applyDistrodexFilters();
}

function syncFilterControlsFromState() {
    if (distrodexSearchInput) distrodexSearchInput.value = distrodexFilters.search;
    if (distrodexCategoryFilter) distrodexCategoryFilter.value = distrodexFilters.category;
    if (distrodexParentFilter) distrodexParentFilter.value = distrodexFilters.parent;
    if (distrodexDifficultyFilter) distrodexDifficultyFilter.value = distrodexFilters.difficulty;
    if (distrodexStatusFilter) distrodexStatusFilter.value = distrodexFilters.status;
    if (distrodexPaidFilter) distrodexPaidFilter.value = distrodexFilters.paid;
    if (distrodexPkgFilter) distrodexPkgFilter.value = distrodexFilters.packageManager;
    if (distrodexInitFilter) distrodexInitFilter.value = distrodexFilters.initSystem;
    if (distrodexDesktopFilter) distrodexDesktopFilter.value = distrodexFilters.desktop;
    if (distrodexReleaseFilter) distrodexReleaseFilter.value = distrodexFilters.releaseType;
    if (distrodexPopularityFilter) distrodexPopularityFilter.value = distrodexFilters.popularity;
    if (distrodexArchFilter) distrodexArchFilter.value = distrodexFilters.architecture;
    if (distrodexEcosystemFilter) distrodexEcosystemFilter.value = distrodexFilters.ecosystem;
}

function resetAllDistrodexFilters() {
    distrodexFilters = { ...DEFAULT_DISTRODEX_FILTERS };
    syncFilterControlsFromState();
    applyDistrodexFilters();
}

function setQuickFilter(key, value) {
    if (key in distrodexFilters) {
        distrodexFilters[key] = value;
        syncFilterControlsFromState();
        applyDistrodexFilters();
    }
}

function renderTreeNode(node, level = 0, isLastChild = true, prefix = '', filterActive = false) {
    if (!distrodexHasMatchingDescendants(node)) {
        return '';
    }

    const nodeMatches = distrodexMatchesFilters(node);
    const categoryClass = getCategoryClass(node.category);
    const difficultyClass = getDifficultyClass(node.difficulty);
    const symbols = getNodeSymbols(node);
    const hasChildren = node.children && node.children.length > 0;
    
    // In search/filter mode with matches, automatically expand branches that lead to matching children
    const isExpanded = (filterActive && distrodexHasMatchingDescendants(node)) ? true : node.isExpanded;
    const expandIcon = hasChildren ? (isExpanded ? '▼' : '▶') : '';
    const expandIconClass = hasChildren ? '' : 'no-children';

    const lineChar = isLastChild ? '└─' : '├─';
    const fullPrefix = level > 0 ? prefix + lineChar + ' ' : '';

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

    const displayName = highlightSearchTerm(node.name, distrodexFilters.search);
    const nodeStateClass = nodeMatches ? 'node-matched' : 'node-ancestor';

    let html = `<div class="tree-node ${categoryClass} ${difficultyClass} ${nodeStateClass}" data-node-id="${node.id}">`;
    html += `  <div class="tree-node-content">`;
    html += `    <span class="tree-line-prefix">${fullPrefix}</span>`;
    html += `    <span class="tree-expand-icon ${expandIconClass}">${expandIcon}</span>`;
    html += `    <span class="tree-node-name" data-distro='${distroData}'>${displayName}</span>`;
    if (node.yearReleased) {
        html += `    <span class="tree-node-year">(${node.yearReleased})</span>`;
    }
    if (symbols) {
        html += `    <span class="tree-node-symbols">${symbols}</span>`;
    }
    if (!nodeMatches) {
        const matchCount = countMatchingDescendants(node);
        html += `    <span class="tree-node-descendant-count">${matchCount} match${matchCount === 1 ? '' : 'es'}</span>`;
    }
    html += `  </div>`;

    if (hasChildren) {
        const childPrefix = level > 0 ? prefix + (isLastChild ? '  ' : '│ ') : '';
        const childrenClass = isExpanded ? '' : 'collapsed';
        html += `  <div class="tree-children ${childrenClass}">`;
        node.children.forEach((child, index) => {
            const isLast = index === node.children.length - 1;
            html += renderTreeNode(child, level + 1, isLast, childPrefix, filterActive);
        });
        html += `  </div>`;
    }

    html += `</div>`;
    return html;
}

function renderDistrodexTree() {
    if (!distrodexTree || !distrodexTreeContainer) return;

    const filterActive = isAnyFilterActive();
    let html = '';

    distrodexTree.forEach(root => {
        html += renderTreeNode(root, 0, true, '', filterActive);
    });

    if (html === '') {
        html = `
            <div class="distrodex-empty-state">
                <div class="empty-prompt">$ distrodex --find: No distributions match the selected filters.</div>
                <button type="button" class="btn btn-small" id="distrodex-empty-reset-btn">Reset All Filters</button>
            </div>
        `;
    }

    distrodexTreeContainer.innerHTML = html;

    // Attach click handlers
    distrodexTreeContainer.querySelectorAll('.tree-node').forEach(nodeEl => {
        const nodeId = nodeEl.dataset.nodeId;
        const expandIcon = nodeEl.querySelector('.tree-expand-icon');

        if (expandIcon && !expandIcon.classList.contains('no-children')) {
            expandIcon.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDistrodexNode(nodeId);
            });
        }
    });

    const emptyResetBtn = document.getElementById('distrodex-empty-reset-btn');
    if (emptyResetBtn) {
        emptyResetBtn.addEventListener('click', resetAllDistrodexFilters);
    }

    setupDistrodexTooltips();
}

function sortDistroList(list, sortBy) {
    const sorted = [...list];
    const popRank = { 'Very High': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Very Low': 0 };
    const diffRank = { 'Beginner': 0, 'Intermediate': 1, 'Advanced': 2, 'Expert': 3 };

    switch (sortBy) {
        case 'name-asc':
            return sorted.sort((a, b) => a.name.localeCompare(b.name));
        case 'name-desc':
            return sorted.sort((a, b) => b.name.localeCompare(a.name));
        case 'year-desc':
            return sorted.sort((a, b) => (b.yearReleased || 0) - (a.yearReleased || 0));
        case 'year-asc':
            return sorted.sort((a, b) => (a.yearReleased || 0) - (b.yearReleased || 0));
        case 'popularity-desc':
            return sorted.sort((a, b) => (popRank[b.popularity] ?? 0) - (popRank[a.popularity] ?? 0));
        case 'difficulty-asc':
            return sorted.sort((a, b) => (diffRank[a.difficulty] ?? 0) - (diffRank[b.difficulty] ?? 0));
        default:
            return sorted;
    }
}

function renderDistrodexList() {
    if (!distrodexDistros || !distrodexListContainer) return;

    const matchedDistros = distrodexDistros.filter(distrodexMatchesFilters);
    const sortedDistros = sortDistroList(matchedDistros, distrodexSortBy);

    if (sortedDistros.length === 0) {
        distrodexListContainer.innerHTML = `
            <div class="distrodex-empty-state">
                <div class="empty-prompt">$ distrodex --find: No distributions match the selected filters.</div>
                <button type="button" class="btn btn-small" id="distrodex-empty-reset-list-btn">Reset All Filters</button>
            </div>
        `;
        const emptyBtn = document.getElementById('distrodex-empty-reset-list-btn');
        if (emptyBtn) {
            emptyBtn.addEventListener('click', resetAllDistrodexFilters);
        }
        return;
    }

    let html = '<div class="distrodex-card-grid">';

    sortedDistros.forEach(distro => {
        const catClass = getCategoryClass(distro.category);
        const diffClass = getDifficultyClass(distro.difficulty);
        const symbols = getNodeSymbols(distro);
        const displayName = highlightSearchTerm(distro.name, distrodexFilters.search);
        const paidStatus = distro.paid ? 'Paid' : 'Free';
        const statusBadge = distro.discontinued === 'Yes' ? '<span class="status-pill discontinued">Discontinued</span>' : '<span class="status-pill active">Active</span>';

        html += `
            <div class="distro-card ${catClass} ${diffClass}" data-distro-id="${distro.id}">
                <div class="distro-card-header">
                    <div class="distro-card-title-row">
                        <span class="distro-card-name">${displayName}</span>
                        <span class="distro-card-year">${distro.yearReleased || 'N/A'}</span>
                    </div>
                    <div class="distro-card-pills">
                        ${statusBadge}
                        <span class="pricing-pill ${distro.paid ? 'paid' : 'free'}">${paidStatus}</span>
                        ${symbols ? `<span class="card-symbols">${symbols}</span>` : ''}
                    </div>
                </div>

                <div class="distro-card-body">
                    <div class="distro-card-prop">
                        <span class="prop-label">Base:</span>
                        <button type="button" class="tag-link" data-filter="parent" data-val="${distro.parentDistro}">${escapeHtml(distro.parentDistro)}</button>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Category:</span>
                        <button type="button" class="tag-link" data-filter="category" data-val="${distro.category.split(',')[0].trim()}">${escapeHtml(distro.category)}</button>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Difficulty:</span>
                        <button type="button" class="tag-link" data-filter="difficulty" data-val="${distro.difficulty}">${escapeHtml(distro.difficulty)}</button>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Package:</span>
                        <span class="prop-val">${escapeHtml(distro.packageManager)}</span>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Init:</span>
                        <span class="prop-val">${escapeHtml(distro.initSystem)}</span>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Desktop:</span>
                        <span class="prop-val">${escapeHtml(distro.desktopEnvironment)}</span>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Release:</span>
                        <span class="prop-val">${escapeHtml(distro.releaseType)}</span>
                    </div>
                    <div class="distro-card-prop">
                        <span class="prop-label">Popularity:</span>
                        <span class="prop-val">${escapeHtml(distro.popularity)}</span>
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    distrodexListContainer.innerHTML = html;

    // Attach quick-filter link click handlers
    distrodexListContainer.querySelectorAll('.tag-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const filterKey = btn.dataset.filter;
            const filterVal = btn.dataset.val;
            setQuickFilter(filterKey, filterVal);
        });
    });
}

let distrodexTooltipElement = null;

function setupDistrodexTooltips() {
    const distroNames = distrodexTreeContainer.querySelectorAll('.tree-node-name');
    distroNames.forEach(nameEl => {
        nameEl.addEventListener('mouseenter', showDistrodexTooltip);
        nameEl.addEventListener('mousemove', moveDistrodexTooltip);
        nameEl.addEventListener('mouseleave', hideDistrodexTooltip);
    });
}

function showDistrodexTooltip(e) {
    if (!e.target.dataset.distro) return;
    const distroData = JSON.parse(e.target.dataset.distro);

    distrodexTooltipElement = document.createElement('div');
    distrodexTooltipElement.className = 'distro-tooltip';

    const paidStatus = distroData.paid ? 'Commercial / Paid' : 'Free';
    const discontinuedStatus = distroData.discontinued === 'Yes' ? 'Discontinued' : 'Active';

    distrodexTooltipElement.innerHTML = `
        <div class="distro-tooltip-header">${escapeHtml(distroData.name)}</div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Year Released:</span>
            <span class="distro-tooltip-value">${distroData.yearReleased || 'N/A'}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Parent:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.parentDistro)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Category:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.category)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Difficulty:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.difficulty)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Package Manager:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.packageManager)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Init System:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.initSystem)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Desktop:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.desktopEnvironment)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Release Type:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.releaseType)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Architecture:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.architecture)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Popularity:</span>
            <span class="distro-tooltip-value">${escapeHtml(distroData.popularity)}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Pricing:</span>
            <span class="distro-tooltip-value">${paidStatus}</span>
        </div>
        <div class="distro-tooltip-row">
            <span class="distro-tooltip-label">Status:</span>
            <span class="distro-tooltip-value">${discontinuedStatus}</span>
        </div>
    `;

    document.body.appendChild(distrodexTooltipElement);
    moveDistrodexTooltip(e);
}

function moveDistrodexTooltip(e) {
    if (!distrodexTooltipElement) return;

    const tooltipWidth = distrodexTooltipElement.offsetWidth;
    const tooltipHeight = distrodexTooltipElement.offsetHeight;
    const padding = 15;

    let left = e.clientX + padding;
    let top = e.clientY + padding;

    if (left + tooltipWidth > window.innerWidth) {
        left = e.clientX - tooltipWidth - padding;
    }
    if (top + tooltipHeight > window.innerHeight) {
        top = e.clientY - tooltipHeight - padding;
    }

    distrodexTooltipElement.style.left = left + 'px';
    distrodexTooltipElement.style.top = top + 'px';
}

function hideDistrodexTooltip() {
    if (distrodexTooltipElement) {
        distrodexTooltipElement.remove();
        distrodexTooltipElement = null;
    }
}

function toggleDistrodexNode(nodeId) {
    function toggleInTree(nodes) {
        for (const node of nodes) {
            if (node.id === nodeId) {
                node.isExpanded = !node.isExpanded;
                return true;
            }
            if (node.children && node.children.length > 0 && toggleInTree(node.children)) {
                return true;
            }
        }
        return false;
    }

    toggleInTree(distrodexTree);
    renderDistrodexTree();
}

function expandAllDistrodexNodes(nodes) {
    nodes.forEach(node => {
        node.isExpanded = true;
        if (node.children && node.children.length > 0) {
            expandAllDistrodexNodes(node.children);
        }
    });
}

function collapseAllDistrodexNodes(nodes) {
    nodes.forEach(node => {
        node.isExpanded = false;
        if (node.children && node.children.length > 0) {
            collapseAllDistrodexNodes(node.children);
        }
    });
}

function updateResultsCount() {
    if (!distrodexResultsCount || !distrodexDistros) return;
    const matchedCount = countTotalMatchingDistros();
    const totalCount = distrodexDistros.length;

    if (isAnyFilterActive()) {
        distrodexResultsCount.textContent = `Showing ${matchedCount} of ${totalCount} distros`;
        distrodexResultsCount.classList.add('highlight');
    } else {
        distrodexResultsCount.textContent = `${totalCount} distros`;
        distrodexResultsCount.classList.remove('highlight');
    }
}

function applyDistrodexFilters() {
    updateActiveFilterBadges();
    updateResultsCount();

    if (distrodexViewMode === 'tree') {
        renderDistrodexTree();
    } else {
        renderDistrodexList();
    }
}

function switchDistrodexView(view) {
    distrodexViewMode = view;
    if (view === 'tree') {
        if (distrodexViewTreeBtn) distrodexViewTreeBtn.classList.add('active');
        if (distrodexViewListBtn) distrodexViewListBtn.classList.remove('active');
        if (distrodexTreeContainer) distrodexTreeContainer.classList.remove('hidden');
        if (distrodexListContainer) distrodexListContainer.classList.add('hidden');
        if (distrodexTreeControls) distrodexTreeControls.classList.remove('hidden');
        if (distrodexListControls) distrodexListControls.classList.add('hidden');
        renderDistrodexTree();
    } else {
        if (distrodexViewTreeBtn) distrodexViewTreeBtn.classList.remove('active');
        if (distrodexViewListBtn) distrodexViewListBtn.classList.add('active');
        if (distrodexTreeContainer) distrodexTreeContainer.classList.add('hidden');
        if (distrodexListContainer) distrodexListContainer.classList.remove('hidden');
        if (distrodexTreeControls) distrodexTreeControls.classList.add('hidden');
        if (distrodexListControls) distrodexListControls.classList.remove('hidden');
        renderDistrodexList();
    }
}

async function openDistrodex() {
    if (!distrodexModal) return;

    if (!distrodexDistros) {
        try {
            const response = await fetch('/api/distros/full');
            if (!response.ok) {
                showToast('Failed to load distros for the Distrodex', 'error');
                return;
            }
            distrodexDistros = await response.json();
        } catch (error) {
            console.error('Error loading distros:', error);
            showToast('Failed to load distros for the Distrodex', 'error');
            return;
        }
    }

    if (!distrodexTree) {
        distrodexTree = buildDistroTree(distrodexDistros);
    }

    syncFilterControlsFromState();
    applyDistrodexFilters();
    distrodexModal.classList.remove('hidden');

    if (distrodexSearchInput) {
        distrodexSearchInput.focus();
    }
}

function closeDistrodex() {
    if (!distrodexModal) return;
    distrodexModal.classList.add('hidden');
    hideDistrodexTooltip();
}

// Event Listeners
if (distrodexBtn) {
    distrodexBtn.addEventListener('click', openDistrodex);
}

if (closeDistrodexBtn) {
    closeDistrodexBtn.addEventListener('click', closeDistrodex);
}

if (distrodexModal) {
    distrodexModal.addEventListener('click', (e) => {
        if (e.target === distrodexModal) {
            closeDistrodex();
        }
    });
}

if (distrodexViewTreeBtn) {
    distrodexViewTreeBtn.addEventListener('click', () => switchDistrodexView('tree'));
}

if (distrodexViewListBtn) {
    distrodexViewListBtn.addEventListener('click', () => switchDistrodexView('list'));
}

if (distrodexAdvToggleBtn && distrodexAdvFiltersPanel) {
    distrodexAdvToggleBtn.addEventListener('click', () => {
        distrodexAdvFiltersPanel.classList.toggle('hidden');
        distrodexAdvToggleBtn.classList.toggle('active');
    });
}

if (distrodexResetFiltersBtn) {
    distrodexResetFiltersBtn.addEventListener('click', resetAllDistrodexFilters);
}

if (distrodexSearchInput) {
    distrodexSearchInput.addEventListener('input', (e) => {
        clearTimeout(distrodexSearchDebounceTimer);
        distrodexSearchDebounceTimer = setTimeout(() => {
            distrodexFilters.search = e.target.value.trim();
            applyDistrodexFilters();
        }, 200);
    });
}

if (distrodexSearchClearBtn) {
    distrodexSearchClearBtn.addEventListener('click', () => {
        distrodexFilters.search = '';
        if (distrodexSearchInput) {
            distrodexSearchInput.value = '';
            distrodexSearchInput.focus();
        }
        applyDistrodexFilters();
    });
}

// Filter change listeners
if (distrodexCategoryFilter) {
    distrodexCategoryFilter.addEventListener('change', (e) => {
        distrodexFilters.category = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexParentFilter) {
    distrodexParentFilter.addEventListener('change', (e) => {
        distrodexFilters.parent = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexDifficultyFilter) {
    distrodexDifficultyFilter.addEventListener('change', (e) => {
        distrodexFilters.difficulty = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexStatusFilter) {
    distrodexStatusFilter.addEventListener('change', (e) => {
        distrodexFilters.status = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexPaidFilter) {
    distrodexPaidFilter.addEventListener('change', (e) => {
        distrodexFilters.paid = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexPkgFilter) {
    distrodexPkgFilter.addEventListener('change', (e) => {
        distrodexFilters.packageManager = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexInitFilter) {
    distrodexInitFilter.addEventListener('change', (e) => {
        distrodexFilters.initSystem = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexDesktopFilter) {
    distrodexDesktopFilter.addEventListener('change', (e) => {
        distrodexFilters.desktop = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexReleaseFilter) {
    distrodexReleaseFilter.addEventListener('change', (e) => {
        distrodexFilters.releaseType = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexPopularityFilter) {
    distrodexPopularityFilter.addEventListener('change', (e) => {
        distrodexFilters.popularity = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexArchFilter) {
    distrodexArchFilter.addEventListener('change', (e) => {
        distrodexFilters.architecture = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexEcosystemFilter) {
    distrodexEcosystemFilter.addEventListener('change', (e) => {
        distrodexFilters.ecosystem = e.target.value;
        applyDistrodexFilters();
    });
}

if (distrodexSortSelect) {
    distrodexSortSelect.addEventListener('change', (e) => {
        distrodexSortBy = e.target.value;
        if (distrodexViewMode === 'list') {
            renderDistrodexList();
        }
    });
}

if (distrodexExpandAllBtn) {
    distrodexExpandAllBtn.addEventListener('click', () => {
        if (distrodexTree) {
            expandAllDistrodexNodes(distrodexTree);
            renderDistrodexTree();
        }
    });
}

if (distrodexCollapseAllBtn) {
    distrodexCollapseAllBtn.addEventListener('click', () => {
        if (distrodexTree) {
            collapseAllDistrodexNodes(distrodexTree);
            renderDistrodexTree();
        }
    });
}

// Global key handlers for Distrodex modal
document.addEventListener('keydown', (e) => {
    if (distrodexModal && !distrodexModal.classList.contains('hidden')) {
        if (e.key === 'Escape') {
            closeDistrodex();
        } else if (e.key === '/' && document.activeElement !== distrodexSearchInput) {
            e.preventDefault();
            if (distrodexSearchInput) distrodexSearchInput.focus();
        }
    }
});

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

if (toggleDiscontinued) {
    toggleDiscontinued.addEventListener('change', async () => {
        gameOptions.includeDiscontinued = toggleDiscontinued.checked;
        applyOptionConstraints();
        saveOptions();
        renderOptions();
        await applyOptionsAndRestart();
    });
}

if (toggleNonLinux) {
    toggleNonLinux.addEventListener('change', async () => {
        gameOptions.includeNonLinux = toggleNonLinux.checked;
        applyOptionConstraints();
        saveOptions();
        renderOptions();
        await applyOptionsAndRestart();
    });
}

if (difficultySelect) {
    difficultySelect.addEventListener('change', () => {
        setDifficulty(difficultySelect.value);
    });
}

newGameBtn.addEventListener('click', startNewGame);

playAgainBtn.addEventListener('click', startNewGame);

if (shareBtn) {
    shareBtn.addEventListener('click', copyShareText);
}

if (howToPlayBtn) {
    howToPlayBtn.addEventListener('click', toggleInstructionsModal);
}

if (closeInstructionsBtn) {
    closeInstructionsBtn.addEventListener('click', closeInstructionsModal);
}

if (optionsToggleBtn) {
    optionsToggleBtn.addEventListener('click', toggleOptionsPanelCollapsed);
}

if (closeVictoryBtn) {
    closeVictoryBtn.addEventListener('click', () => {
        victoryModal.classList.add('hidden');
    });
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
        victoryModal.classList.add('hidden');
        closeInstructionsModal();
        closeDistrodex();
    }
});

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', initGame);
