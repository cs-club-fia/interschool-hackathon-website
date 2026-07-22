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

interface LayoutOpts {
  title: string;
  csrfToken: string;
  body: string;
  leaveTracking?: boolean;
}

export function layout(opts: LayoutOpts): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="${esc(opts.csrfToken)}">
    <title>${esc(opts.title)}</title>
    <link rel="stylesheet" href="/static/style.css">
    <script src="/static/timer.js"></script>
</head>
<body>
    <img src="/img/Buildmart.jpeg" alt="Buildmart" class="top-left-logo">
    <img src="/img/FIA.jpeg" alt="FIA" class="top-right-logo">
    <img src="/img/club_logo.png" alt="CLUB_LOGO" class="club-logo">
    ${opts.body}
    ${opts.leaveTracking ? LEAVE_TRACKING_SCRIPT : ""}
</body>
</html>`;
}

export function renderLogin(error: string | null): string {
  const body = `<div class="glass">
    <div class="header">School Hackathon Login</div>
    <form method="post">
        <input type="text" name="username" placeholder="Username" required>
        <input type="password" name="password" placeholder="Password" required>
        <button type="submit">Login</button>
    </form>
    ${error ? `<div class="status">${esc(error)}</div>` : ""}
</div>`;
  // No CSRF on login (session-establishing request; SameSite=Strict guards it).
  return layout({ title: "Login", csrfToken: "", body });
}

export function renderStartTest(username: string, csrfToken: string): string {
  const body = `<div class="glass">
    <div class="header">Welcome to the Hackathon, ${esc(username)}</div>
    <div class="status" style="text-align: left; margin: 20px 0;">
        <p>Important Information:</p>
        <ul style="list-style-type: none; padding: 0;">
            <li>&bull; You will have 5 programming questions</li>
            <li>&bull; Each question has its own timer</li>
            <li>&bull; Once started, you cannot pause the test</li>
            <li>&bull; Write your solution in the in-browser editor</li>
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
        action = `<span style="color: #27ae60;">&#10003; Completed</span>`;
      } else if (o.currentQuestion === q) {
        action = `<form method="get" action="/question" style="display: inline;">
                <input type="hidden" name="qname" value="${esc(q)}">
                <button type="submit" style="width: auto; padding: 5px 15px; margin: 0 0 0 10px;">Continue</button>
            </form>`;
      } else if (!o.currentQuestion && idx === 0) {
        action = `<form method="get" action="/question" style="display: inline;">
                <input type="hidden" name="qname" value="${esc(q)}">
                <button type="submit" style="width: auto; padding: 5px 15px; margin: 0 0 0 10px;">Start</button>
            </form>`;
      } else {
        action = `<span style="color: #7f8c8d;">Locked</span>`;
      }
      return `<div class="question-status" style="margin: 10px 0; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.2);">
        <span style="font-weight: bold;">${esc(cap(q))}:</span>
        ${action}
    </div>`;
    })
    .join("\n");

  const meta =
    o.school || o.language
      ? `<div class="status">${esc(o.school || "")}${o.school && o.language ? " &middot; " : ""}${esc(cap(o.language || ""))}</div>`
      : "";

  const body = `<div class="glass">
    <div class="header">Welcome, ${esc(o.username)}</div>
    ${meta}
    <div class="status">Your Progress</div>
    ${rows}
    <form method="post" action="/logout" style="margin-top: 20px;">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <button type="submit">Logout</button>
    </form>
</div>`;
  return layout({ title: "Dashboard", csrfToken: o.csrfToken, body, leaveTracking: true });
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
<div class="glass" style="max-width: 700px;">
    <div class="header">${esc(cap(o.qname))}</div>
    <div class="status">Time left: <span id="timer">${esc(o.timeLeft)}</span></div>
    <div class="status">${esc(o.questionText)}</div>
    <div class="status">Language: ${esc(cap(o.language))}</div>
    <form id="submitForm" method="post" data-ext="${esc(o.expectedExt)}">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <div id="editorContainer">
            <textarea id="codeArea" name="code" style="display:none;">${esc(o.draftCode)}</textarea>
        </div>
        <button type="button" id="submitBtn" style="background:#27ae60;color:#fff;margin-top:10px;">Submit Answer</button>
    </form>
    ${o.error ? `<div class="status">${esc(o.error)}</div>` : ""}

    <div id="fileMissingModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.3);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:rgba(255,255,255,0.95);border-radius:16px;padding:2rem;box-shadow:0 4px 32px rgba(31,38,135,0.37);max-width:350px;margin:auto;text-align:center;">
        <div style="font-size:1.2rem;margin-bottom:1rem;color:#e74c3c;">Please write some code before submitting!</div>
        <button id="backBtn" style="background:#95a5a6;color:#fff;padding:0.5rem 1.5rem;border:none;border-radius:8px;font-weight:bold;">Back</button>
      </div>
    </div>

    <div id="confirmModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.3);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:rgba(255,255,255,0.95);border-radius:16px;padding:2rem;box-shadow:0 4px 32px rgba(31,38,135,0.37);max-width:350px;margin:auto;text-align:center;">
        <div style="font-size:1.2rem;margin-bottom:1rem;color:#333;">Are you sure you want to submit? You cannot access this question again.</div>
        <button id="confirmYes" style="background:#27ae60;color:#fff;padding:0.5rem 1.5rem;margin-right:1rem;border:none;border-radius:8px;font-weight:bold;">Yes, I'm Sure. Submit</button>
        <button id="confirmNo" style="background:#e74c3c;color:#fff;padding:0.5rem 1.5rem;border:none;border-radius:8px;font-weight:bold;">No, go back</button>
      </div>
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

        startTimer(duration, display, function(){
            display.style.background = '#fffbe6';
        }, function(){
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
            cm.save();
            document.getElementById('submitForm').submit();
        };
    };
</script>`;
  return layout({ title: cap(o.qname), csrfToken: o.csrfToken, body, leaveTracking: true });
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
        ? `<span style="color: #27ae60;">&#10003; Submitted${
            d.submitTime ? " at " + esc(formatTime(d.submitTime)) : ""
          }</span>`
        : `<span style="color: #e74c3c;">&#10007; Not attempted</span>`;
      return `<div class="question-status" style="margin: 15px 0; padding: 15px; border-radius: 8px; background: rgba(255,255,255,0.2);">
        <span style="font-weight: bold;">Question ${esc(qname.slice(-1))}:</span>
        ${status}
    </div>`;
    })
    .join("\n");

  const body = `<div class="glass">
    <div class="header">Final Review</div>
    <div class="status">Test Completion Summary</div>
    ${items}
    <form method="post" action="/logout" style="margin-top: 20px;">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <button type="submit">Finish &amp; Logout</button>
    </form>
</div>`;
  return layout({ title: "Review", csrfToken: o.csrfToken, body, leaveTracking: true });
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
  const headerCols = o.questions.map((q) => `<th data-sort="string">${esc(cap(q))}</th>`).join("");
  const rows = Object.entries(o.submissions)
    .map(([user, subs]) => {
      const info = o.studentInfo[user] || {};
      const cells = o.questions
        .map((q) => {
          if (subs[q]) {
            return `<td><a href="/admin/download/${encodeURIComponent(user)}/${encodeURIComponent(
              q,
            )}" style="color:#27ae60;text-decoration:none;">&#10004;</a></td>`;
          }
          return `<td><span style="color:#e74c3c;">&#10008;</span></td>`;
        })
        .join("");
      return `<tr>
            <td>${esc(user)}</td>
            <td>${esc(info.school || "")}</td>
            <td>${esc(cap(info.language || ""))}</td>
            <td>${esc(o.leaveCounts[user] ?? 0)}</td>
            <td>${esc(o.pasteFlagCounts[user] ?? 0)}</td>
            ${cells}
        </tr>`;
    })
    .join("\n");

  const successBlock = o.successMessage
    ? `<div class="status" style="background: #27ae60; color: white; margin: 1rem 0;">${esc(o.successMessage)}</div>`
    : "";

  const body = `<div class="glass">
    <div class="header">Admin Dashboard</div>
    ${successBlock}
    <div class="status">Active Users: ${esc(o.userCount)}</div>
    <div class="status">Submissions:</div>
    <div style="margin: 0.5rem 0;">
        <input type="text" id="tableSearch" placeholder="Search users..." style="padding:6px;width:240px;">
        <a href="/admin/download-all" style="margin-left:10px;"><button type="button" style="width:auto;padding:6px 14px;background:#2980b9;color:#fff;">Download all (ZIP)</button></a>
    </div>
    <table id="subTable" style="width:100%;background:rgba(255,255,255,0.5);border-radius:8px;">
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

    <div class="status">System Status: <span id="systemStatus">Active users: ${esc(
      o.activeUsers,
    )} | Submissions: ${esc(o.totalSubmissions)}</span></div>

    <div class="admin-controls" style="margin-top: 2rem; padding: 1rem; background: rgba(255,255,255,0.1); border-radius: 8px;">
        <h3>Database Management</h3>
        <button id="resetBtn" style="background: #c0392b; color: white; margin-top: 1rem;">Reset All Submissions</button>
    </div>

    <div id="resetModal" style="display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.3);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:rgba(255,255,255,0.95);border-radius:16px;padding:2rem;box-shadow:0 4px 32px rgba(31,38,135,0.37);max-width:350px;margin:auto;text-align:center;">
            <h3 style="color:#c0392b;margin-bottom:1rem;">Warning: Database Reset</h3>
            <p>This will delete ALL submissions and reset the database.</p>
            <p>This action cannot be undone.</p>
            <div style="margin-top:1.5rem">
                <form method="post" action="/admin/reset">
                    <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
                    <button type="submit" style="background:#c0392b;color:white;margin-right:1rem">Yes, Reset Everything</button>
                </form>
                <button onclick="document.getElementById('resetModal').style.display='none'" style="background:#7f8c8d;color:white">Cancel</button>
            </div>
        </div>
    </div>

    <form method="post" action="/admin/logout" style="margin-top: 1rem;">
        <input type="hidden" name="csrf_token" value="${esc(o.csrfToken)}">
        <button type="submit">Logout</button>
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
