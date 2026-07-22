// Real-time countdown timer for questions
// signature: startTimer(durationSeconds, displayEl, warningCallback, timeoutCallback)
function startTimer(duration, display, warningCallback, timeoutCallback) {
    let timer = duration, minutes, seconds;
    let interval = setInterval(function () {
        minutes = parseInt(timer / 60, 10);
        seconds = parseInt(timer % 60, 10);
        display.textContent = minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
        if (timer <= 30) {
            display.style.color = '#e74c3c';
            if (warningCallback) warningCallback();
        }
        if (--timer < 0) {
            clearInterval(interval);
            display.textContent = "Time's up!";
            try {
                if (timeoutCallback) timeoutCallback();
            } catch (e) {
                console.error('timeoutCallback error', e);
            }
        }
    }, 1000);
}

// No fullscreen functionality: removed per request
