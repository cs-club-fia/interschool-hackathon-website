// Server-side HTML rendering, ported from the Flask Jinja templates. Every
// interpolated value is HTML-escaped via esc(). Client asset paths and the
// leave/draft/paste-flag endpoints are identical to the originals, so the
// vendored editor.js / timer.js / base leave-script work unchanged.

import { EVENT_TIMEZONE } from "./data/questions";

const AMP = /&/g,
  LT = /</g,
  GT = />/g,
  QUOT = /"/g,
  APOS = /'/g;

export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(AMP, "&amp;")
    .replace(LT, "&lt;")
    .replace(GT, "&gt;")
    .replace(QUOT, "&quot;")
    .replace(APOS, "&#39;");
}

// Jinja's `capitalize`: first char upper, rest lower.
export function cap(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Student page-leave instrumentation (verbatim from base.html). No backticks / ${}.
const LEAVE_TRACKING_SCRIPT = `<script>
(function(){
    var csrfToken = document.querySelector('meta[name="csrf-token"]').content;
    function sendLeaveEvent(){
        try{
            var last = parseInt(sessionStorage.getItem('lastLeaveSent') || '0', 10);
            var now = Date.now();
            if (now - last < 1000) return;
            fetch('/student/leave', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': csrfToken }
            }).then(function(){
                sessionStorage.setItem('lastLeaveSent', String(Date.now()));
            }).catch(function(e){});
        }catch(e){}
    }
    document.addEventListener('visibilitychange', function(){
        if (document.hidden) sendLeaveEvent();
    });
    window.addEventListener('blur', function(){ sendLeaveEvent(); });
    window.addEventListener('beforeunload', function(){
        try{
            fetch('/student/leave', {
                method: 'POST',
                keepalive: true,
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': csrfToken }
            });
        }catch(e){}
    });
})();
</script>`;

// Interactive constellation background rendered on every page (styled via #bg-fx
// in style.css). Like LEAVE_TRACKING_SCRIPT above, this string is embedded inside
// a template literal, so it MUST contain no backticks and no ${...} sequences.
// The animation mode ("full" | "calm") is read at runtime from the canvas's
// data-mode attribute rather than interpolated in.
const BG_FX_SCRIPT = `<script>
(function(){
    var canvas = document.getElementById('bg-fx');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var calm = (canvas.dataset.mode || 'full') === 'calm';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var CYAN = '59, 130, 246';
    var linkDist = calm ? 105 : 145;
    var mouseDist = 190;
    var speed = calm ? 0.22 : 0.55;
    var pointAlpha = calm ? 0.35 : 0.65;
    var lineAlpha = calm ? 0.12 : 0.25;

    var W = 0, H = 0, DPR = 1;
    var points = [];
    var mouse = { x: 0, y: 0, active: false };
    var parX = 0, parY = 0;

    function resize(){
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        build();
    }

    function build(){
        var count = Math.round((W * H) / 16000);
        var max = calm ? 45 : 90;
        if (count > max) count = max;
        if (count < 12) count = 12;
        points = [];
        for (var i = 0; i < count; i++){
            points.push({
                x: Math.random() * W,
                y: Math.random() * H,
                vx: (Math.random() - 0.5) * speed,
                vy: (Math.random() - 0.5) * speed,
                r: Math.random() * 1.6 + 0.8
            });
        }
    }

    function step(){
        var tx = mouse.active ? (mouse.x - W / 2) * 0.012 : 0;
        var ty = mouse.active ? (mouse.y - H / 2) * 0.012 : 0;
        parX += (tx - parX) * 0.05;
        parY += (ty - parY) * 0.05;

        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(parX, parY);

        var i, j, p, q, dx, dy, d, a;
        for (i = 0; i < points.length; i++){
            p = points[i];
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
            if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + CYAN + ',' + pointAlpha + ')';
            ctx.fill();
        }

        for (i = 0; i < points.length; i++){
            p = points[i];
            for (j = i + 1; j < points.length; j++){
                q = points[j];
                dx = p.x - q.x; dy = p.y - q.y;
                d = Math.sqrt(dx * dx + dy * dy);
                if (d < linkDist){
                    a = lineAlpha * (1 - d / linkDist);
                    ctx.strokeStyle = 'rgba(' + CYAN + ',' + a + ')';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(q.x, q.y);
                    ctx.stroke();
                }
            }
            if (!calm && mouse.active){
                var mx = mouse.x - parX, my = mouse.y - parY;
                dx = p.x - mx; dy = p.y - my;
                d = Math.sqrt(dx * dx + dy * dy);
                if (d < mouseDist){
                    a = 0.33 * (1 - d / mouseDist);
                    ctx.strokeStyle = 'rgba(' + CYAN + ',' + a + ')';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(mx, my);
                    ctx.stroke();
                }
            }
        }
        ctx.restore();
    }

    var running = false;
    function loop(){
        if (!running) return;
        step();
        requestAnimationFrame(loop);
    }
    function start(){
        if (running || reduce) return;
        running = true;
        requestAnimationFrame(loop);
    }
    function stop(){ running = false; }

    window.addEventListener('resize', resize);
    document.addEventListener('mousemove', function(e){
        mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
        var el = document.documentElement;
        el.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 100) + '%');
        el.style.setProperty('--my', ((e.clientY / window.innerHeight) * 100) + '%');
    });
    document.addEventListener('mouseleave', function(){ mouse.active = false; });
    document.addEventListener('visibilitychange', function(){
        if (document.hidden) stop(); else start();
    });

    resize();
    if (reduce) step(); else start();
})();
</script>`;

// Polls which question the student should be on and redirects into it. This is
// how an admin "reopen" pulls the student back to the reopened question. Embedded
// in a template literal, so no backticks and no ${...}. The current page's
// question (empty on non-question pages) is read from the current-qname meta.
const REDIRECT_POLL_SCRIPT = `<script>
(function(){
    var metaQ = document.querySelector('meta[name="current-qname"]');
    var current = metaQ ? (metaQ.content || '') : '';
    function check(){
        fetch('/student/active', { credentials: 'same-origin' })
            .then(function(r){ return r.ok ? r.json() : null; })
            .then(function(data){
                if (!data) return;
                var q = data.q;
                if (q && q !== current) {
                    window.location.href = '/question?qname=' + encodeURIComponent(q);
                }
            })
            .catch(function(){});
    }
    setInterval(check, 4000);
})();
</script>`;

interface LayoutOpts {
  title: string;
  csrfToken: string;
  body: string;
  leaveTracking?: boolean;
  bg?: "full" | "calm";
  activeRedirect?: boolean;
  currentQname?: string;
}

export function layout(opts: LayoutOpts): string {
  const bg = opts.bg ?? "full";
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="${esc(opts.csrfToken)}">
    <meta name="current-qname" content="${esc(opts.currentQname || "")}">
    <title>${esc(opts.title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/static/style.css">
    <script src="/static/timer.js"></script>
</head>
<body>
    <canvas id="bg-fx" data-mode="${bg}" aria-hidden="true"></canvas>

    <!-- Side Floating Organizer Logos (Desktop) -->
    <aside class="side-logo-bg left-logo-bg" aria-hidden="true">
      <img src="/img/FIA.png" alt="FIA Logo" class="side-logo-img">
    </aside>
    <aside class="side-logo-bg right-logo-bg" aria-hidden="true">
      <img src="/img/club_logo.png" alt="FIA CS Club Logo" class="side-logo-img">
    </aside>

    <!-- Mobile Header Logos -->
    <header class="mobile-app-header">
      <img src="/img/FIA.png" alt="FIA Logo" class="mobile-header-logo">
      <img src="/img/club_logo.png" alt="FIA CS Club Logo" class="mobile-header-logo">
    </header>

    <main>
    ${opts.body}
    </main>

    <footer class="app-footer">
      <div class="footer-sponsor-title">Sponsored by</div>
      <div class="footer-sponsors">
        <img src="/img/FIA.png" alt="Fravashi International Academy" class="sponsor-logo">
        <img src="/img/winjit.png" alt="Winjit" class="sponsor-logo">
      </div>
    </footer>
    ${opts.leaveTracking ? LEAVE_TRACKING_SCRIPT : ""}
    ${opts.activeRedirect ? REDIRECT_POLL_SCRIPT : ""}
    ${BG_FX_SCRIPT}
</body>
</html>`;
}

export function renderLogin(error: string | null): string {
  const body = `<div class="glass">
    <div class="header">FIA CS Club Hackathon Login</div>
    <form method="post">
        <div style="margin-bottom: 1rem; text-align: left;">
            <label style="display:block; font-size:0.875rem; font-weight:600; margin-bottom:0.375rem; color:var(--text);">Username</label>
            <input type="text" name="username" placeholder="Enter your username" required>
        </div>
        <div style="margin-bottom: 1.25rem; text-align: left;">
            <label style="display:block; font-size:0.875rem; font-weight:600; margin-bottom:0.375rem; color:var(--text);">Password</label>
            <input type="password" name="password" placeholder="Enter password" required>
        </div>
        <button type="submit">Log In</button>
    </form>
    ${error ? `<div class="status" style="background:rgba(239, 68, 68, 0.15); border-color:rgba(239, 68, 68, 0.3); color:#FCA5A5; margin-top:1rem;">${esc(error)}</div>` : ""}
</div>`;
  // No CSRF on login (session-establishing request; SameSite=Strict guards it).
  return layout({ title: "Login", csrfToken: "", body });
}

export function renderStartTest(username: string, csrfToken: string): string {
  const body = `<div class="glass">
    <div class="header">Welcome, ${esc(username)}</div>
    <div class="status" style="text-align: left; margin: 1.25rem 0; background: #0D1117; border: 1px solid var(--border);">
        <p style="font-weight:600; color:var(--text); margin-bottom: 0.5rem;">Important Guidelines:</p>
        <ul style="list-style-type: none; padding: 0; color:var(--text-muted); font-size: 0.9rem; display: flex; flex-direction: column; gap: 0.5rem;">
            <li style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--primary);"></span>
                5 programming questions in sequence
            </li>
            <li style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--primary);"></span>
                Each question has an authoritative individual timer
            </li>
            <li style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--primary);"></span>
                Once started, timer cannot be paused
            </li>
            <li style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--primary);"></span>
                Write & autosave your code in the built-in editor
            </li>
            <li style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--primary);"></span>
                The test runs in fullscreen; leaving fullscreen is recorded
            </li>
            <li style="display: flex; align-items: flex-start; gap: 0.5rem; color:#FBBF24;">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#F59E0B; margin-top:0.4rem; flex-shrink:0;"></span>
                <span><b>Switching tabs or windows will auto-submit the current question</b> (even if empty) &mdash; you cannot return to it</span>
            </li>
        </ul>
    </div>
    <form method="get" action="/question">
        <input type="hidden" name="qname" value="question1">
        <button type="submit" class="start-button">Start Test</button>
    </form>
</div>
<script>
    document.querySelector('.start-button').addEventListener('click', function(e) {
        e.preventDefault();
        e.target.closest('form').submit();
    });
</script>`;
  return layout({ title: "Start Test", csrfToken, body, leaveTracking: true });
}

interface DashboardOpts {
  username: string;
  school?: string;
  language?: string;
  questions: string[];
  submitted: Record<string, boolean>;
  currentQuestion: string | null;
  csrfToken: string;
}

export function renderDashboard(o: DashboardOpts): string {
  const rows = o.questions
    .map((q, idx) => {
      let action: string;
      if (o.submitted[q]) {
        action = `<span style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:600; color:#34D399; background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.3); padding:0.25rem 0.75rem; border-radius:9999px; font-size:0.85rem;">&#10003; Completed</span>`;
      } else if (o.currentQuestion === q) {
        action = `<form method="get" action="/question" style="display: inline;">
                <input type="hidden" name="qname" value="${esc(q)}">
                <button type="submit" style="width: auto; padding: 0.375rem 1rem; margin: 0; font-size:0.875rem;">Continue</button>
            </form>`;
      } else if (!o.currentQuestion && idx === 0) {
        action = `<form method="get" action="/question" style="display: inline;">
                <input type="hidden" name="qname" value="${esc(q)}">
                <button type="submit" style="width: auto; padding: 0.375rem 1rem; margin: 0; font-size:0.875rem;">Start</button>
            </form>`;
      } else {
        action = `<span style="color: #64748B; background: #161F2E; padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.85rem; font-weight: 500;">Locked</span>`;
      }
      return `<div class="question-status">
        <span style="font-weight: 600; color: var(--text);">${esc(cap(q))}</span>
        ${action}
    </div>`;
    })
    .join("\n");

  const meta =
    o.school || o.language
      ? `<div class="status" style="background:rgba(59, 130, 246, 0.15); border-color:rgba(59, 130, 246, 0.3); color:#93C5FD; font-weight:600;">
           ${esc(o.school || "")}${o.school && o.language ? " &middot; " : ""}${esc(cap(o.language || ""))}
         </div>`
      : "";

  const body = `<div class="glass">
    <div class="header">Welcome, ${esc(o.username)}</div>
    ${meta}
    <div class="status" style="text-align:left; font-weight:600; margin-bottom:0.75rem;">Your Progress</div>
    ${rows}
    <form method="post" action="/logout" style="margin-top: 1.5rem;">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <button type="submit" style="background:#161F2E; color:#94A3B8; border-color:#243042;">Log Out</button>
    </form>
</div>`;
  return layout({ title: "Dashboard", csrfToken: o.csrfToken, body, leaveTracking: true, activeRedirect: true });
}

interface QuestionOpts {
  qname: string;
  timeLeft: number;
  questionText: string;
  expectedExt: string;
  language: string;
  draftCode: string;
  csrfToken: string;
  error?: string | null;
}

export function renderQuestion(o: QuestionOpts): string {
  const body = `<link rel="stylesheet" href="/static/codemirror/lib/codemirror.css">
<link rel="stylesheet" href="/static/editor-theme.css">
<div class="glass" style="max-width: 800px;">
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border);">
        <div style="font-size:1.5rem; font-weight:700; color:var(--text);">${esc(cap(o.qname))}</div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
            <span style="font-size:0.875rem; color:var(--text-muted); font-weight:500;">Time left:</span>
            <span class="timer-badge" id="timer">${esc(o.timeLeft)}</span>
        </div>
    </div>
    <div class="status" style="text-align:left; background:#0D1117; border:1px solid var(--border); color:var(--text); font-size:0.95rem; line-height:1.6; margin-bottom:1rem;">
        ${esc(o.questionText)}
    </div>
    <div style="display:inline-block; font-size:0.8125rem; font-weight:600; color:#93C5FD; background:rgba(59, 130, 246, 0.15); border:1px solid rgba(59, 130, 246, 0.3); padding:0.2rem 0.65rem; border-radius:9999px; margin-bottom:1rem;">
        Language: ${esc(cap(o.language))}
    </div>
    <form id="submitForm" method="post" data-ext="${esc(o.expectedExt)}">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <div id="editorContainer">
            <textarea id="codeArea" name="code" style="display:none;">${esc(o.draftCode)}</textarea>
        </div>
        <div id="runPanel">
            <button type="button" id="stdinToggle" class="run-sub" aria-expanded="false">&#9656; Input (stdin)</button>
            <textarea id="stdinArea" class="run-stdin" placeholder="Standard input passed to your program (optional)" spellcheck="false" style="display:none;"></textarea>
            <div class="run-bar">
                <button type="button" id="runBtn" class="run-button">&#9654; Run Code</button>
                <span id="runStatus" class="run-status"></span>
            </div>
            <div class="run-out-label">Output</div>
            <pre id="runOutput" class="run-output" aria-live="polite" tabindex="0"></pre>
        </div>
        <button type="button" id="submitBtn" style="background:#10B981; border-color:#059669; color:#fff; margin-top:1rem; font-size:1rem; padding:0.75rem 1.5rem;">Submit Answer</button>
    </form>
    ${o.error ? `<div class="status" style="background:rgba(239, 68, 68, 0.15); border-color:rgba(239, 68, 68, 0.3); color:#FCA5A5; margin-top:1rem;">${esc(o.error)}</div>` : ""}

    <div id="fileMissingModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(3,7,18,0.75);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#151D2A;border-radius:12px;padding:2rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);max-width:380px;margin:auto;text-align:center;border:1px solid var(--border);">
        <div style="font-size:1.125rem;font-weight:600;margin-bottom:1rem;color:#F87171;">Please write some code before submitting!</div>
        <button id="backBtn" style="background:#334155;border-color:#475569;color:#fff;padding:0.5rem 1.5rem;border-radius:8px;font-weight:600;">Back to Editor</button>
      </div>
    </div>

    <div id="confirmModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(3,7,18,0.75);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:#151D2A;border-radius:12px;padding:2rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);max-width:400px;margin:auto;text-align:center;border:1px solid var(--border);">
        <div style="font-size:1.125rem;font-weight:600;margin-bottom:0.75rem;color:var(--text);">Confirm Submission</div>
        <div style="font-size:0.9rem;color:var(--text-muted);margin-bottom:1.5rem;">Are you sure you want to submit? You cannot return to or re-edit this question once submitted.</div>
        <div style="display:flex;gap:0.75rem;justify-content:center;">
            <button id="confirmYes" style="background:#10B981;border-color:#059669;color:#fff;padding:0.5rem 1.25rem;border-radius:8px;font-weight:600;width:auto;">Yes, Submit</button>
            <button id="confirmNo" style="background:#161F2E;border-color:#243042;color:#94A3B8;padding:0.5rem 1.25rem;border-radius:8px;font-weight:600;width:auto;">Cancel</button>
        </div>
      </div>
    </div>
</div>

<div id="fsGate">
    <div class="glass" style="max-width:460px;">
        <div class="header" style="font-size:1.7rem;">Fullscreen Required</div>
        <div class="status">This test must be taken in fullscreen. Leaving fullscreen is recorded as a violation.</div>
        <div class="status" style="color:#FBBF24;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.15);">&#9888; Warning: switching to another tab or window will <b>immediately submit</b> the current question &mdash; even if it is empty &mdash; and you will not be able to return to it.</div>
        <div class="status">Click below to enter fullscreen and continue.</div>
        <button type="button" id="fsGateBtn" class="start-button">Enter Fullscreen &amp; Continue</button>
    </div>
</div>

<script src="/static/codemirror/lib/codemirror.js"></script>
<script src="/static/codemirror/mode/python/python.js"></script>
<script src="/static/codemirror/mode/clike/clike.js"></script>
<script src="/static/codemirror/addon/edit/matchbrackets.js"></script>
<script src="/static/editor.js"></script>
<script>
    window.onload = function() {
        var duration = ${Number(o.timeLeft)};
        var display = document.getElementById('timer');
        var csrfToken = document.querySelector('meta[name="csrf-token"]').content;

        var cm = initCodeEditor({
            textareaId: 'codeArea',
            expectedExt: document.getElementById('submitForm').dataset.ext,
            qname: ${JSON.stringify(o.qname)},
            csrfToken: csrfToken,
            draftUrl: '/question/draft',
            pasteFlagUrl: '/student/paste-flag'
        });

        var isSubmitting = false;
        function autoSubmit(){
            if (isSubmitting) return;
            isSubmitting = true;
            fetch(window.location.href, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrfToken
                },
                body: new URLSearchParams({ 'auto_submit': '1', 'code': cm.getValue() }),
                credentials: 'same-origin'
            }).then(function(resp){
                if (resp.redirected) { window.location.href = resp.url; }
                else { window.location.reload(); }
            }).catch(function(err){
                console.error('Auto-submit failed', err);
                window.location.reload();
            });
        }

        // Auto-submit on timer expiry.
        startTimer(duration, display, function(){
            display.style.background = 'rgba(245, 158, 11, 0.15)';
            display.style.color = '#FBBF24';
            display.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        }, autoSubmit);

        // Anti-cheat: switching tab / minimizing the window auto-submits the
        // current question immediately (even if empty) -- it cannot be revisited.
        document.addEventListener('visibilitychange', function(){
            if (document.hidden) autoSubmit();
        });
        // Also auto-submit when the window loses focus (switching to another app
        // or window). Re-check after a short delay so a transient blur -- e.g.
        // the fullscreen transition -- that immediately regains focus is ignored.
        window.addEventListener('blur', function(){
            setTimeout(function(){ if (!document.hasFocus()) autoSubmit(); }, 250);
        });

        var submitBtn = document.getElementById('submitBtn');
        var fileMissingModal = document.getElementById('fileMissingModal');
        var confirmModal = document.getElementById('confirmModal');
        var backBtn = document.getElementById('backBtn');
        var confirmYes = document.getElementById('confirmYes');
        var confirmNo = document.getElementById('confirmNo');

        submitBtn.onclick = function(e) {
            if (!cm.getValue().trim().length) { fileMissingModal.style.display = 'flex'; }
            else { confirmModal.style.display = 'flex'; }
        };
        backBtn.onclick = function() { fileMissingModal.style.display = 'none'; };
        confirmNo.onclick = function() { confirmModal.style.display = 'none'; };
        confirmYes.onclick = function() {
            if (isSubmitting) return;
            isSubmitting = true;
            cm.save();
            document.getElementById('submitForm').submit();
        };

        // --- Interpreter / Run panel ---
        // Runs the current editor code (+ optional stdin) via the Worker, which
        // proxies to the self-hosted Piston runner, and shows stdout/stderr. This
        // is an in-page fetch (no focus change), so it never trips the anti-cheat
        // blur/tab auto-submit above. Output is written with textContent, so
        // program output can never inject HTML.
        var runBtn = document.getElementById('runBtn');
        var runStatus = document.getElementById('runStatus');
        var runOutput = document.getElementById('runOutput');
        var stdinToggle = document.getElementById('stdinToggle');
        var stdinArea = document.getElementById('stdinArea');
        var isRunning = false;

        stdinToggle.onclick = function() {
            var open = stdinArea.style.display !== 'none';
            stdinArea.style.display = open ? 'none' : 'block';
            stdinToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
            stdinToggle.textContent = (open ? '▸' : '▾') + ' Input (stdin)';
        };

        function setRunStatus(text, cls) {
            runStatus.textContent = text;
            runStatus.className = 'run-status' + (cls ? ' ' + cls : '');
        }

        runBtn.onclick = function() {
            if (isRunning || isSubmitting) return;
            if (!cm.getValue().trim().length) {
                runOutput.textContent = '';
                setRunStatus('Write some code first', 'err');
                return;
            }
            isRunning = true;
            runBtn.disabled = true;
            runOutput.textContent = '';
            setRunStatus('Running…', 'running');
            fetch('/question/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRFToken': csrfToken
                },
                body: new URLSearchParams({ code: cm.getValue(), stdin: stdinArea.value }),
                credentials: 'same-origin'
            }).then(function(resp) {
                return resp.json().then(function(data) { return { status: resp.status, data: data }; });
            }).then(function(res) {
                var data = res.data || {};
                if (res.status !== 200 || data.error) {
                    runOutput.textContent = data.error || ('Run failed (HTTP ' + res.status + ').');
                    setRunStatus('Error', 'err');
                    return;
                }
                var out = (data.output != null && data.output !== '')
                    ? data.output
                    : ((data.stdout || '') + (data.stderr || ''));
                runOutput.textContent = out.length ? out : '(no output)';
                var killed = !!data.signal;
                var ok = data.exitCode === 0 && !killed;
                var label = killed
                    ? ('Killed (' + data.signal + ')')
                    : ('Exit ' + (data.exitCode == null ? '?' : data.exitCode));
                setRunStatus(label, ok ? 'ok' : 'err');
            }).catch(function() {
                runOutput.textContent = 'Could not reach the code runner. Check your connection and try again.';
                setRunStatus('Error', 'err');
            }).then(function() {
                isRunning = false;
                runBtn.disabled = false;
            });
        };
    };
</script>
<script>
// Fullscreen anti-cheat lock: once the test starts, the question page must be in
// fullscreen. If it can't be entered (unsupported browser) the gate is dropped so
// students are never locked out. Leaving fullscreen re-shows the gate and is logged
// via /student/leave (same endpoint/debounce as the tab-leave tracker).
(function(){
    var gate = document.getElementById('fsGate');
    var btn = document.getElementById('fsGateBtn');
    var docEl = document.documentElement;
    var canFs = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);
    if (!gate || !btn || !canFs) { if (gate) gate.style.display = 'none'; return; }

    function fsElement(){ return document.fullscreenElement || document.webkitFullscreenElement || null; }
    function requestFs(){
        try {
            if (docEl.requestFullscreen) return docEl.requestFullscreen();
            if (docEl.webkitRequestFullscreen) return docEl.webkitRequestFullscreen();
        } catch (e) {}
    }

    var meta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = meta ? meta.content : '';
    var lastFlag = 0;
    function logExit(){
        var now = Date.now();
        if (now - lastFlag < 1000) return;
        lastFlag = now;
        try {
            fetch('/student/leave', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-CSRFToken': csrfToken }
            }).catch(function(){});
        } catch (e) {}
    }

    function showGate(){ gate.style.display = 'flex'; }
    function hideGate(){ gate.style.display = 'none'; }

    if (fsElement()) hideGate(); else showGate();

    btn.addEventListener('click', function(){
        var p = requestFs();
        if (p && p.then) p.then(function(){ hideGate(); }).catch(function(){});
    });

    function onChange(){
        if (fsElement()) hideGate();
        else { showGate(); logExit(); }
    }
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
})();
</script>`;
  return layout({ title: cap(o.qname), csrfToken: o.csrfToken, body, leaveTracking: true, bg: "calm", activeRedirect: true, currentQname: o.qname });
}

interface ReviewOpts {
  review: Record<string, { submitted: boolean; submitTime: number | null }>;
  order: string[];
  csrfToken: string;
}

export function renderReview(o: ReviewOpts): string {
  const items = o.order
    .map((qname) => {
      const d = o.review[qname];
      const status = d.submitted
        ? `<span style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:600; color:#34D399; background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.3); padding:0.25rem 0.75rem; border-radius:9999px; font-size:0.85rem;">
             &#10003; Submitted${d.submitTime ? " at " + esc(formatTime(d.submitTime)) : ""}
           </span>`
        : `<span style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:600; color:#F87171; background:rgba(239, 68, 68, 0.15); border:1px solid rgba(239, 68, 68, 0.3); padding:0.25rem 0.75rem; border-radius:9999px; font-size:0.85rem;">
             &#10007; Not attempted
           </span>`;
      return `<div class="question-status">
        <span style="font-weight: 600; color: var(--text);">Question ${esc(qname.slice(-1))}</span>
        ${status}
    </div>`;
    })
    .join("\n");

  const body = `<div class="glass">
    <div class="header">Final Review</div>
    <div class="status" style="text-align:left; font-weight:600; margin-bottom:0.75rem;">Test Completion Summary</div>
    ${items}
    <form method="post" action="/logout" style="margin-top: 1.5rem;">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <button type="submit">Finish &amp; Log Out</button>
    </form>
</div>`;
  return layout({ title: "Review", csrfToken: o.csrfToken, body, leaveTracking: true, activeRedirect: true });
}

interface AdminOpts {
  userCount: number;
  submissions: Record<string, Record<string, boolean>>;
  questions: string[];
  studentInfo: Record<string, { school?: string; language?: string }>;
  leaveCounts: Record<string, number>;
  pasteFlagCounts: Record<string, number>;
  activeUsers: number;
  totalSubmissions: number;
  csrfToken: string;
  successMessage?: string | null;
}

export function renderAdmin(o: AdminOpts): string {
  const headerCols = o.questions
    .map((q) => `<th data-sort="string" title="${esc(cap(q))}">${esc(q.replace(/^question/i, "Q"))}</th>`)
    .join("");
  const rows = Object.entries(o.submissions)
    .map(([user, subs]) => {
      const info = o.studentInfo[user] || {};
      const cells = o.questions
        .map((q) => {
          if (subs[q]) {
            return `<td style="white-space:nowrap;"><a href="/admin/download/${encodeURIComponent(
              user,
            )}/${encodeURIComponent(
              q,
            )}" title="Download submission" style="color:#34D399;text-decoration:none;font-weight:bold;">&#10004;</a><form method="post" action="/admin/reopen" style="display:inline;margin:0;" onsubmit="return confirm('Reopen this question for this student? They will be sent back to it with a timer and their work restored.');"><input type="hidden" name="csrf_token" value="${esc(
              o.csrfToken,
            )}"><input type="hidden" name="username" value="${esc(user)}"><input type="hidden" name="question" value="${esc(
              q,
            )}"><button type="submit" title="Reopen (undo submission)" style="width:auto;margin:0 0 0 6px;padding:0 5px;background:none;border:none;box-shadow:none;color:#FBBF24;cursor:pointer;font-size:1rem;line-height:1;">&#8634;</button></form></td>`;
          }
          return `<td><span style="color:#64748B;">&#10008;</span></td>`;
        })
        .join("");
      return `<tr>
            <td style="font-weight:600;">${esc(user)}</td>
            <td>${esc(info.school || "")}</td>
            <td>${esc(cap(info.language || ""))}</td>
            <td>${esc(o.leaveCounts[user] ?? 0)}</td>
            <td>${esc(o.pasteFlagCounts[user] ?? 0)}</td>
            ${cells}
        </tr>`;
    })
    .join("\n");

  const successBlock = o.successMessage
    ? `<div class="status" style="background: rgba(16, 185, 129, 0.15); border-color: rgba(16, 185, 129, 0.3); color: #34D399; margin-bottom: 1rem;">${esc(o.successMessage)}</div>`
    : "";

  const body = `<div class="glass" style="max-width: 1040px;">
    <div class="header">Admin Dashboard</div>
    ${successBlock}
    <div style="display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1.5rem;">
        <div class="status" style="flex:1; margin:0; text-align:left; background:#0D1117;">
            <div style="font-size:0.75rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">Active Users</div>
            <div style="font-size:1.5rem; font-weight:700; color:var(--text);">${esc(o.userCount)}</div>
        </div>
        <div class="status" style="flex:1; margin:0; text-align:left; background:#0D1117;">
            <div style="font-size:0.75rem; font-weight:600; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.05em;">Total Submissions</div>
            <div style="font-size:1.5rem; font-weight:700; color:var(--text);">${esc(o.totalSubmissions)}</div>
        </div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; gap:1rem; flex-wrap:wrap;">
        <input type="text" id="tableSearch" placeholder="Search team or school..." style="margin:0; max-width:280px;">
        <a href="/admin/download-all" style="text-decoration:none;"><button type="button" style="width:auto; padding:0.625rem 1.25rem; background:#3B82F6; color:#fff; border-color:#2563EB;">Download all (ZIP)</button></a>
    </div>
    <div class="table-wrap">
    <table id="subTable">
        <thead>
        <tr>
            <th data-sort="string">User</th>
            <th data-sort="string">School</th>
            <th data-sort="string">Language</th>
            <th data-sort="int">Leaves</th>
            <th data-sort="int">Paste Flags</th>
            ${headerCols}
        </tr>
        </thead>
        <tbody>
        ${rows}
        </tbody>
    </table>
    </div>

    <div class="status" style="margin-top:1rem; text-align:left; background:#0D1117;">
        System Status: <span id="systemStatus" style="font-weight:600; color:var(--text);">Active users: ${esc(
          o.activeUsers,
        )} | Submissions: ${esc(o.totalSubmissions)}</span>
    </div>

    <div class="admin-controls" style="margin-top: 2rem; padding: 1.25rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius);">
        <h3 style="color:#F87171; font-size:1.125rem; font-weight:700; margin-bottom:0.5rem;">Database Management</h3>
        <p style="color:#FCA5A5; font-size:0.875rem; margin-bottom:1rem;">Clear all candidate submissions, drafts, and metrics for a fresh test run.</p>
        <button id="resetBtn" style="background: #EF4444; border-color:#DC2626; color: white; width:auto; padding:0.5rem 1.25rem;">Reset All Submissions</button>
    </div>

    <div id="resetModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(3,7,18,0.75);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:#151D2A;border-radius:12px;padding:2rem;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);max-width:400px;margin:auto;text-align:center;border:1px solid var(--border);">
            <h3 style="color:#F87171;font-size:1.25rem;font-weight:700;margin-bottom:0.75rem;">Warning: Database Reset</h3>
            <p style="color:var(--text);font-size:0.9375rem;margin-bottom:0.5rem;">This will permanently delete ALL team submissions, code drafts, and anti-cheat log metrics.</p>
            <p style="color:var(--text-muted);font-size:0.875rem;margin-bottom:1.5rem;">This action cannot be undone.</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;">
                <form method="post" action="/admin/reset" style="margin:0;">
                    <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
                    <button type="submit" style="background:#EF4444;border-color:#DC2626;color:white;width:auto;padding:0.5rem 1.25rem;">Yes, Reset Everything</button>
                </form>
                <button onclick="document.getElementById('resetModal').style.display='none'" style="background:#161F2E;border-color:#243042;color:#94A3B8;width:auto;padding:0.5rem 1.25rem;">Cancel</button>
            </div>
        </div>
    </div>

    <form method="post" action="/admin/logout" style="margin-top: 1.5rem;">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <button type="submit" style="background:#161F2E; color:#94A3B8; border-color:#243042;">Log Out</button>
    </form>
</div>

<script>
document.getElementById('resetBtn').onclick = function() {
    document.getElementById('resetModal').style.display = 'flex';
};

setInterval(function() {
    fetch(window.location.href, { credentials: 'same-origin' })
        .then(function(response){ return response.text(); })
        .then(function(html){
            var parser = new DOMParser();
            var doc = parser.parseFromString(html, 'text/html');
            document.querySelector('table').outerHTML = doc.querySelector('table').outerHTML;
        }).catch(function(err){ console.error('Failed to refresh submissions:', err); });
}, 30000);

function updateStats() {
    fetch('/admin/stats', { credentials: 'same-origin' })
        .then(function(r){ if (!r.ok) throw new Error('Failed to fetch stats'); return r.json(); })
        .then(function(data){
            var el = document.getElementById('systemStatus');
            if (el && data && typeof data.activeUsers !== 'undefined') {
                el.textContent = 'Active users: ' + data.activeUsers + ' | Submissions: ' + data.totalSubmissions;
            }
        }).catch(function(err){ console.error('Could not update stats:', err); });
}
updateStats();
setInterval(updateStats, 5000);

window.onclick = function(event) {
    var modal = document.getElementById('resetModal');
    if (event.target == modal) { modal.style.display = 'none'; }
};

document.getElementById('tableSearch').addEventListener('input', function(e){
    var q = e.target.value.toLowerCase();
    var rows = document.querySelectorAll('#subTable tbody tr');
    rows.forEach(function(r){
        var text = r.textContent.toLowerCase();
        r.style.display = text.indexOf(q) === -1 ? 'none' : '';
    });
});

document.querySelectorAll('#subTable thead th').forEach(function(th, idx){
    th.style.cursor = 'pointer';
    th.addEventListener('click', function(){
        var table = document.getElementById('subTable');
        var tbody = table.tBodies[0];
        var rows = Array.from(tbody.querySelectorAll('tr'));
        var type = th.getAttribute('data-sort') || 'string';
        var asc = !th.classList.contains('asc');
        table.querySelectorAll('th').forEach(function(h){ h.classList.remove('asc','desc'); });
        th.classList.add(asc ? 'asc' : 'desc');
        rows.sort(function(a,b){
            var A = a.children[idx].textContent.trim();
            var B = b.children[idx].textContent.trim();
            if (type === 'int') {
                return asc ? (parseInt(A||0)-parseInt(B||0)) : (parseInt(B||0)-parseInt(A||0));
            }
            A = A.toLowerCase(); B = B.toLowerCase();
            if (A < B) return asc ? -1 : 1;
            if (A > B) return asc ? 1 : -1;
            return 0;
        });
        rows.forEach(function(r){ tbody.appendChild(r); });
    });
});
</script>`;
  return layout({ title: "Admin Dashboard", csrfToken: o.csrfToken, body });
}

function formatTime(unixSec: number): string {
  // Workers run in UTC; render in the event's timezone (see EVENT_TIMEZONE).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EVENT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(unixSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
