// Game state
let targetId = null;
let guessCount = 0;
let gameWon = false;
let distroList = [];
let guessedDistros = [];
let isProcessing = false;
let isInitialLoad = true;
let hasGuessedThisRound = false;
const STATS_STORAGE_KEY = 'distrodleStats';
let playerStats = {
    gamesPlayed: 0,
    gamesWon: 0
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

        // Load distro list for autocomplete
        const response = await fetch('/api/distros');
        distroList = await response.json();
        
        // Populate datalist
        updateDistroList();
        
        // Update footer stats
        const totalDistrosElement = document.getElementById('total-distros');
        if (totalDistrosElement) {
            totalDistrosElement.textContent = `${distroList.length} distros in database`;
        }
        
        // Start new game
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
    try {
        // Starting a new round after guessing but before solving counts as a loss.
        if (!isInitialLoad && !gameWon && hasGuessedThisRound) {
            recordLoss();
        }

        const response = await fetch('/api/target');
        const data = await response.json();
        targetId = data.id;
        
        // Show previous answer if there was one that wasn't guessed and not initial page load
        if (data.previousAnswer && !isInitialLoad) {
            showPreviousAnswer(data.previousAnswer);
        }
        isInitialLoad = false;
        
        // Reset game state
        guessCount = 0;
        gameWon = false;
        hasGuessedThisRound = false;
        guessedDistros = [];
        feedbackContainer.innerHTML = '';
        updateDistroList();
        // Keep header visible so users know what each column means
        victoryModal.classList.add('hidden');
        guessInput.value = '';
        guessInput.disabled = false;
        guessBtn.disabled = false;
        
        console.log('New game started! Target:', data.name);
    } catch (error) {
        console.error('Error starting new game:', error);
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

// Handle guess submission
async function handleGuess() {
    if (isProcessing) return;
    
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
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                guessName: matchedName,
                targetId: targetId
            })
        });
        
        const data = await response.json();
        
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
            guessCount = data.guessCount;
            guessedDistros.push(matchedName);
            updateDistroList();
            
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
    guessCountElement.textContent = guessCount;
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

newGameBtn.addEventListener('click', startNewGame);

playAgainBtn.addEventListener('click', startNewGame);

// Close modal when clicking outside
victoryModal.addEventListener('click', (e) => {
    if (e.target === victoryModal) {
        victoryModal.classList.add('hidden');
    }
});

// Start new game on Enter when victory modal is shown
document.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !victoryModal.classList.contains('hidden')) {
        startNewGame();
    }
});

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', initGame);
