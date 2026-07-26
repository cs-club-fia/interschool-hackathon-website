// Embedded code editor for the question page. Mounts CodeMirror in place of
// the old file upload, blocks paste/drop/right-click to discourage copying
// in a pre-written solution, flags large single-keystroke insertions (a
// common way to defeat client-side paste blocking) to the admin dashboard,
// and periodically autosaves a draft so a crash/refresh/timeout doesn't
// lose in-progress work.
//
// Paste blocking here is a deterrent, not a guarantee -- it can be bypassed
// via devtools or a userscript calling the editor's API directly. The
// large-insertion flag exists to catch exactly that class of bypass and
// surface it for human review, not to auto-block it.

var PASTE_FLAG_THRESHOLD = 40; // chars inserted in one CodeMirror-attributed input event
var AUTOSAVE_INTERVAL_MS = 10000;
var PASTE_FLAG_DEBOUNCE_MS = 3000;

var CM_MODE_BY_EXT = {
    py: 'python',
    cpp: 'text/x-c++',
    java: 'text/x-java'
};

function initCodeEditor(config) {
    // config: { textareaId, expectedExt, qname, csrfToken, draftUrl, pasteFlagUrl }
    var mode = CM_MODE_BY_EXT[config.expectedExt] || 'python';
    var textarea = document.getElementById(config.textareaId);

    var cm = CodeMirror.fromTextArea(textarea, {
        mode: mode,
        lineNumbers: true,
        matchBrackets: true,
        indentUnit: 4,
        theme: 'hackathon-dark',
        extraKeys: {
            'Ctrl-Enter': function () {
                var runBtn = document.getElementById('runBtn');
                if (runBtn && typeof runBtn.click === 'function') runBtn.click();
            },
            'Cmd-Enter': function () {
                var runBtn = document.getElementById('runBtn');
                if (runBtn && typeof runBtn.click === 'function') runBtn.click();
            }
        }
    });

    var localKey = 'hackathon_code_draft_' + config.qname;
    try {
        var localVal = localStorage.getItem(localKey);
        if (localVal && localVal.trim().length > 0 && (!textarea || !textarea.value || !textarea.value.trim().length)) {
            cm.setValue(localVal);
        }
    } catch (e) { /* ignore */ }

    setTimeout(function () {
        try { cm.refresh(); } catch (e) { }
    }, 50);

    var wrapper = cm.getWrapperElement();
    wrapper.addEventListener('paste', function (e) { e.preventDefault(); });
    wrapper.addEventListener('drop', function (e) { e.preventDefault(); });
    wrapper.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    var lastFlagSent = 0;
    cm.on('beforeChange', function (instance, changeObj) {
        try {
            var insertedLen = changeObj.text.join('\n').length;
            var suspicious = (changeObj.origin === '+input' || changeObj.origin === 'paste') &&
                insertedLen >= PASTE_FLAG_THRESHOLD;
            if (!suspicious) return;
            var now = Date.now();
            if (now - lastFlagSent < PASTE_FLAG_DEBOUNCE_MS) return;
            lastFlagSent = now;
            fetch(config.pasteFlagUrl, {
                method: 'POST',
                headers: { 'X-CSRFToken': config.csrfToken },
                credentials: 'same-origin'
            }).catch(function () { /* best-effort, never block editing */ });
        } catch (e) { /* never let flagging logic break editing */ }
    });

    function saveDraft(useKeepalive) {
        try {
            var val = cm.getValue();
            if (val) {
                localStorage.setItem(localKey, val);
            }
            fetch(config.draftUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': config.csrfToken
                },
                body: new URLSearchParams({ qname: config.qname, code: val }),
                credentials: 'same-origin',
                keepalive: !!useKeepalive
            }).catch(function () { /* best-effort */ });
        } catch (e) { /* ignore */ }
    }

    setInterval(function () { saveDraft(false); }, AUTOSAVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) saveDraft(false);
    });
    window.addEventListener('beforeunload', function () { saveDraft(true); });

    return cm;
}
