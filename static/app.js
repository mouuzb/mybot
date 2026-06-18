const tg = window.Telegram.WebApp;
try { tg.expand(); tg.ready(); } catch(e) {}

// tg.showAlert Browser'da ishlamaydi — universal yordamchi
function showMsg(text) {
    try {
        tg.showAlert(text);
    } catch(e) {
        alert(text);
    }
}
function showConfirm(text) {
    try {
        return confirm(text);
    } catch(e) {
        return confirm(text);
    }
}

// Telegram user ma'lumotlarini tekshirish
let _tgUser = tg.initDataUnsafe?.user;

function startGuestMode() {
    _tgUser = { id: 123456789, first_name: "Mehmon (Test)", username: "guest" };
    localStorage.setItem("guest_mode", "true");
    location.reload();
}

if (_tgUser && _tgUser.id) {
    // Haqiqiy Telegram ma'lumotlari kelsa, sinov rejimidan avtomatik chiqamiz!
    localStorage.removeItem("guest_mode");
} else if (localStorage.getItem("guest_mode") === "true") {
    _tgUser = { id: 123456789, first_name: "Mehmon (Test)", username: "guest" };
}

if (!_tgUser || !_tgUser.id) {
    document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;padding:30px;text-align:center;font-family:sans-serif;background:#0f172a;color:#f1f5f9;">
            <div style="font-size:3.5rem;">⚠️</div>
            <h3 style="margin-top:16px;font-family:'Outfit',sans-serif;">Telegram orqali oching</h3>
            <p style="color:#94a3b8;margin-top:8px;font-family:'Inter',sans-serif;font-size:0.9rem;">Bu ilova faqat Telegramdagi bot menyusidan ishlatilishi mumkin.</p>
            <button onclick="startGuestMode()" style="margin-top:24px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;font-size:0.85rem;box-shadow:0 4px 12px rgba(59,130,246,0.3);transition:0.2s;" onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform='scale(1)'">
                🔧 Sinov Rejimi (Developer)
            </button>
        </div>
    `;
    window.startGuestMode = startGuestMode;
    throw new Error("Telegram WebApp context missing");
}

const app = {
    user: {
        id: _tgUser.id,
        first_name: _tgUser.first_name || 'Foydalanuvchi',
        username: _tgUser.username || ''
    },
    currentQuiz: null,
    currentQuestions: [],
    currentQuestionIndex: 0,
    userAnswers: {},
    timerInterval: null,
    chunkRange: '1-25',
    theme: 'light',

    // ------------------------------------------------------------------
    // INIT
    // ------------------------------------------------------------------
    async init() {
        // Theme
        const saved = localStorage.getItem('theme') || 'light';
        this.setTheme(saved);

        // User name & avatar
        const nameEl = document.getElementById('userNameDisplay');
        if (nameEl) nameEl.textContent = this.user.first_name.toUpperCase();
        const av = document.getElementById('avatarCircle');
        if (av) av.textContent = this.user.first_name.charAt(0).toUpperCase();

        // Auth & obuna tekshirish
        const isRestricted = await this.authUser();

        if (!isRestricted) {
            const urlParams = new URLSearchParams(window.location.search);
            const startView = urlParams.get('view') || 'mainMenu';
            this.showView(startView);
            if (startView === 'resultsView') {
                this.loadResults();
            }
            // Muvaffaqiyatli kirish — davriy tekshirishni boshlaymiz
            // (agar foydalanuvchi kanaldan chiqsa, 2 daqiqada bloklanadi)
            this._startPeriodicCheck();
        }

        // joinCodeInput: autocomplete va tarix o'chirish
        const joinInput = document.getElementById('joinCodeInput');
        if (joinInput) {
            joinInput.setAttribute('autocomplete', 'off');
            joinInput.setAttribute('autocorrect', 'off');
            joinInput.setAttribute('autocapitalize', 'off');
            joinInput.setAttribute('spellcheck', 'false');
            joinInput.setAttribute('name', 'quiz_code_' + Date.now());
        }
    },

    async authUser() {
        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: this.user.id,
                    first_name: this.user.first_name,
                    username: this.user.username || null
                })
            });

            if (!res.ok) {
                // Server xato berdi — xavfsizlik uchun kirish bloklanadi
                this._showErrorModal('Server xatoligi yuz berdi. Iltimos, qaytadan urinib ko\'ring.');
                return true;
            }

            const data = await res.json();
            const isAdmin = data.is_admin;
            const isRestricted = data.is_restricted;

            // Admin tugmasini ko'rsatish
            if (isAdmin) {
                const btn = document.getElementById('adminBtn');
                if (btn) btn.style.display = 'flex';
            }

            // Bot cheklangan va foydalanuvchi admin emas
            if (isRestricted && !isAdmin) {
                const msgEl = document.getElementById('maintenanceMessage');
                if (msgEl) msgEl.textContent = data.restriction_message;
                this.showView('maintenanceView');
                // Davriy tekshirishni to'xtatamiz (texnik ishlar paytida)
                this._stopPeriodicCheck();
                return true;
            }

            // Majburiy obuna tekshirish
            if (data.is_subscribed === false && !isAdmin) {
                this._showSubscriptionModal(data.unsubscribed_channels || []);
                return true;
            }

            // Hamma joyida — modalni tozalaymiz
            const modal = document.getElementById('subscriptionModal');
            if (modal) modal.remove();
            return false; // kirish ruxsat berildi

        } catch (e) {
            // MUHIM: Tarmoq xato bo'lsa ham kirish bloklanadi (eski kod false qaytarardi — bu xato edi!)
            console.error('[Auth] Tarmoq xatosi:', e);
            this._showErrorModal('Tarmoq xatosi. Internet aloqangizni tekshiring va qaytadan urinib ko\'ring.');
            return true;
        }
    },

    // Xato modali (tarmoq/server xatolari uchun)
    _showErrorModal(message) {
        const old = document.getElementById('errorModal');
        if (old) old.remove();

        const modal = document.createElement('div');
        modal.id = 'errorModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(2,6,23,0.97);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;';
        modal.innerHTML = `
            <div style="max-width:380px;width:100%;text-align:center;font-family:'Inter',sans-serif;">
                <div style="font-size:3.5rem;margin-bottom:16px;">⚠️</div>
                <h3 style="color:#f1f5f9;font-weight:700;margin-bottom:12px;">Xatolik</h3>
                <p style="color:#94a3b8;font-size:0.9rem;margin-bottom:24px;line-height:1.6;">${message}</p>
                <button onclick="location.reload()"
                    style="width:100%;padding:14px;background:linear-gradient(135deg,#ef4444,#f87171);color:white;border:none;border-radius:14px;font-weight:700;font-size:1rem;cursor:pointer;">
                    🔄 Qayta urinish
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    },

    // Davriy obuna tekshirish (har 2 daqiqada)
    _startPeriodicCheck() {
        this._stopPeriodicCheck();
        this._periodicCheckId = setInterval(async () => {
            const isRestricted = await this.authUser();
            // authUser() o'zi modal ko'rsatadi — bu yerda faqat log
            if (isRestricted) {
                console.log('[PeriodicCheck] Foydalanuvchi bloklanadi');
            }
        }, 2 * 60 * 1000); // 2 daqiqa
    },

    _stopPeriodicCheck() {
        if (this._periodicCheckId) {
            clearInterval(this._periodicCheckId);
            this._periodicCheckId = null;
        }
    },

    _showSubscriptionModal(channels) {
        // Eski modal va xato modallarni o'chirish
        ['subscriptionModal', 'errorModal'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        const channelBtns = channels.length > 0 ? channels.map(ch => `
            <a href="https://t.me/${ch.replace('@', '')}"
               target="_blank"
               style="display:flex;align-items:center;gap:10px;background:#1e293b;border:1px solid #334155;border-radius:14px;padding:14px 18px;color:#f1f5f9;text-decoration:none;font-weight:600;font-size:0.95rem;transition:0.2s;"
               onmouseover="this.style.background='#334155'"
               onmouseout="this.style.background='#1e293b'">
                <span style="font-size:1.5rem;">📢</span>
                <span>${ch}</span>
                <span style="margin-left:auto;font-size:0.8rem;color:#38bdf8;">A'zo bo'lish →</span>
            </a>
        `).join('') : '<p style="color:#94a3b8;font-size:0.85rem;">Kanal ro\'yxati yuklanmoqda...</p>';

        const modal = document.createElement('div');
        modal.id = 'subscriptionModal';
        // Muhim: pointer-events:all va user-select:none — modal yopib bo'lmaydi
        modal.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(2,6,23,0.98);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;user-select:none;';
        modal.innerHTML = `
            <div style="max-width:420px;width:100%;text-align:center;font-family:'Inter',sans-serif;">
                <div style="font-size:3.5rem;margin-bottom:12px;">🔒</div>
                <h2 style="color:#f1f5f9;font-size:1.4rem;font-weight:700;margin-bottom:8px;">Kanalga a'zo bo'ling</h2>
                <p style="color:#94a3b8;font-size:0.9rem;margin-bottom:24px;line-height:1.5;">
                    Botdan foydalanish uchun quyidagi kanal(lar)ga a'zo bo'ling,<br>so'ngra <b style="color:#f1f5f9;">"Tekshirish"</b> tugmasini bosing.
                </p>
                <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:24px;">
                    ${channelBtns}
                </div>
                <button id="checkSubBtn"
                    style="width:100%;padding:16px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:white;border:none;border-radius:14px;font-weight:700;font-size:1rem;cursor:pointer;box-shadow:0 4px 20px rgba(99,102,241,0.4);">
                    ✅ A'zo bo'ldim — Tekshirish
                </button>
                <p style="margin-top:16px;font-size:0.75rem;color:#475569;">
                    Obunasiz botdan foydalanib bo'lmaydi
                </p>
            </div>
        `;

        // Modalni body ga qo'shish — eng oxirida bo'lishi uchun
        document.body.appendChild(modal);

        // Back tugmasini (Android) bloklash
        const blockBack = (e) => e.preventDefault();
        window.addEventListener('popstate', blockBack);
        history.pushState(null, '', location.href);

        // Tekshirish tugmasi
        document.getElementById('checkSubBtn').addEventListener('click', async () => {
            const btn = document.getElementById('checkSubBtn');
            btn.textContent = '⏳ Tekshirilmoqda...';
            btn.disabled = true;

            const isRestricted = await this.authUser();
            if (!isRestricted) {
                // Muvaffaqiyatli — modal authUser() ichida olib tashlandi
                window.removeEventListener('popstate', blockBack);
                const urlParams = new URLSearchParams(window.location.search);
                this.showView(urlParams.get('view') || 'mainMenu');
                this._startPeriodicCheck(); // Davriy tekshirishni boshlaymiz
            } else {
                // Hali obuna bo'lmagan — yangi modal authUser() da ko'rsatildi
                window.removeEventListener('popstate', blockBack);
            }
        });
    },

    // ------------------------------------------------------------------
    // THEME
    // ------------------------------------------------------------------
    setTheme(t) {
        this.theme = t;
        document.documentElement.setAttribute('data-theme', t);
        const btn = document.getElementById('themeToggleBtn');
        if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('theme', t);
    },
    toggleTheme() {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    },

    // ------------------------------------------------------------------
    // VIEWS
    // ------------------------------------------------------------------
    showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const target = document.getElementById(viewId);
        if (target) { target.classList.add('active'); window.scrollTo(0, 0); }
    },

    closeToBot(msg) { tg.showAlert(msg); },

    // ------------------------------------------------------------------
    // CREATE QUIZ
    // ------------------------------------------------------------------
    copyPrompt() {
        const text = document.getElementById('promptText').innerText;
        navigator.clipboard.writeText(text).then(() => {
            showMsg("Prompt nusxalandi! Uni ChatGPT ga yuboring.");
        });
    },

    async createQuiz() {
        const fileInput = document.getElementById('quizJsonFile');
        const timerInput = document.getElementById('timerInput');
        const titleInput = document.getElementById('quizTitleInput');
        const btn = document.getElementById('createBtn');

        if (!titleInput.value.trim()) return showMsg("Iltimos, fan nomini kiriting!");
        if (!fileInput.files[0]) return showMsg("Iltimos, JSON faylni yuklang!");
        if (!showConfirm("Quiz yaratilsinmi?")) return;

        // Loading holati
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Yuklanmoqda...'; }

        const reader = new FileReader();
        reader.onerror = () => {
            if (btn) { btn.disabled = false; btn.textContent = '✅ Yaratish'; }
            showMsg("Faylni o'qib bo'lmadi!");
        };
        reader.onload = async (e) => {
            try {
                let questions;
                try {
                    questions = JSON.parse(e.target.result);
                } catch {
                    if (btn) { btn.disabled = false; btn.textContent = '✅ Yaratish'; }
                    return showMsg("JSON fayl formati noto'g'ri! ChatGPT dan olingan faylni tekshiring.");
                }

                if (!Array.isArray(questions) || questions.length === 0) {
                    if (btn) { btn.disabled = false; btn.textContent = '✅ Yaratish'; }
                    return showMsg("Savollar ro'yxati bo'sh yoki massiv emas!");
                }

                const timerVal = parseInt(timerInput.value) || 30;
                const res = await fetch('/api/quiz', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_id: this.user.id,
                        title: titleInput.value.trim(),
                        timer_per_question: timerVal,
                        questions
                    })
                });

                if (btn) { btn.disabled = false; btn.textContent = '✅ Yaratish'; }

                if (!res.ok) {
                    const errText = await res.text();
                    return showMsg("Server xatosi: " + errText);
                }

                const data = await res.json();
                // Formani tozalash
                titleInput.value = '';
                fileInput.value = '';
                showMsg(`✅ Muvaffaqiyatli yaratildi!\n\nQuiz kodi: ${data.code}\nJami: ${questions.length} ta savol\nHar savol uchun vaqt: ${timerVal}s`);
                this.showView('mainMenu');
            } catch (err) {
                if (btn) { btn.disabled = false; btn.textContent = '✅ Yaratish'; }
                showMsg("Kutilmagan xatolik: " + (err.message || err));
                console.error(err);
            }
        };
        reader.readAsText(fileInput.files[0]);
    },

    // ------------------------------------------------------------------
    // JOIN QUIZ
    // ------------------------------------------------------------------
    async joinQuiz() {
        const codeInput = document.getElementById('joinCodeInput');
        const code = codeInput ? codeInput.value.trim() : '';
        if (code.length !== 6) return showMsg("6 xonali kod kiriting!");

        const joinBtn = document.getElementById('joinBtn');
        if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = '⏳ Tekshirilmoqda...'; }

        try {
            // Faqat metadata olish (questions olmaydi — default end=25 bo'ladi)
            const res = await fetch(`/api/quiz/${code}/meta`);
            if (!res.ok) {
                // /meta endpoint yo'q bo'lsa eski endpoint ishlatamiz
                const res2 = await fetch(`/api/quiz/${code}`);
                if (!res2.ok) throw new Error();
                const data2 = await res2.json();
                this.currentQuiz = data2;
                this._buildChunkList(data2.total_questions);
            } else {
                const data = await res.json();
                this.currentQuiz = data;
                this._buildChunkList(data.total_questions);
            }
        } catch {
            showMsg("Quiz topilmadi! Kodni tekshiring.");
        } finally {
            if (joinBtn) { joinBtn.disabled = false; joinBtn.textContent = 'Keyingi →'; }
        }
    },

    _buildChunkList(total) {
        // Chunk selection ko'rsatish
        document.getElementById('chunkSelection').style.display = 'block';
        const chunkList = document.getElementById('chunkList');
        chunkList.innerHTML = '';

        const chunkSize = 25;
        let chunkNum = 1;
        for (let i = 0; i < total; i += chunkSize) {
            const start = i + 1;
            const end = Math.min(i + chunkSize, total);
            const count = end - start + 1;

            const card = document.createElement('div');
            card.className = 'chunk-card';
            card.innerHTML = `
                <div class="chunk-num">${chunkNum}</div>
                <div class="chunk-range">${start}–${end}</div>
                <div class="chunk-count">${count} ta savol</div>
            `;
            card.onclick = () => this.startQuizChunk(start, end);
            chunkList.appendChild(card);
            chunkNum++;
        }
    },

    // ------------------------------------------------------------------
    // QUIZ CHUNK
    // ------------------------------------------------------------------
    async startQuizChunk(start, end) {
        try {
            const res = await fetch(`/api/quiz/${this.currentQuiz.code}?start=${start}&end=${end}`);
            if (!res.ok) throw new Error('Server xatosi: ' + res.status);
            const data = await res.json();

            // Server: questions ALLAQACHON 25ta random tartibda (shuffle qilingan)
            this.currentQuestions = data.questions;
            this.currentQuestionIndex = 0;
            this.userAnswers = {};
            this.chunkRange = `${start}-${end}`;

            clearInterval(this.timerInterval);
            document.getElementById('questionsScrollContainer').innerHTML = '';
            this.showView('takingQuizView');
            this.renderNextQuestion();
        } catch(e) { showMsg("Xatolik: " + (e.message || e)); }
    },

    // ------------------------------------------------------------------
    // RENDER QUESTION
    // ------------------------------------------------------------------
    renderNextQuestion() {
        // Oldingi timerni to'xtatish
        clearInterval(this.timerInterval);

        if (this.currentQuestionIndex >= this.currentQuestions.length) {
            setTimeout(() => this.finishQuiz(), 500);
            return;
        }

        const q = this.currentQuestions[this.currentQuestionIndex];
        const idx = this.currentQuestionIndex;
        const total = this.currentQuestions.length;

        // Counter & progress
        document.getElementById('questionCounter').textContent = `Savol: ${idx + 1}/${total}`;
        const pct = (idx / total) * 100;
        const fill = document.getElementById('qProgressFill');
        if (fill) fill.style.width = pct + '%';

        // Savol bloklarini pastga qo'shish (o'chirmasdan)
        const container = document.getElementById('questionsScrollContainer');

        const qDiv = document.createElement('div');
        qDiv.className = 'q-block-append';
        qDiv.id = `q-block-${idx}`;

        qDiv.innerHTML = `
            <div class="q-number-badge">${idx + 1} / ${total}</div>
            <p class="q-text">${q.text}</p>
            <div class="options-list" id="opts-${idx}">
                ${['a', 'b', 'c', 'd'].map((opt, i) => `
                    <div id="opt-${idx}-${opt}" class="opt-card"
                         onclick="app.submitAnswer(${idx}, '${opt}')">
                        <div class="opt-label">${String.fromCharCode(65 + i)}</div>
                        <span>${q['option_' + opt]}</span>
                    </div>
                `).join('')}
            </div>
        `;

        container.appendChild(qDiv);
        setTimeout(() => qDiv.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);

        // Timer
        this.startTimer();
    },

    // ------------------------------------------------------------------
    // SUBMIT ANSWER
    // ------------------------------------------------------------------
    submitAnswer(qIdx, opt) {
        if (this.userAnswers[qIdx] !== undefined) return;

        clearInterval(this.timerInterval);
        this.userAnswers[qIdx] = opt;

        const q = this.currentQuestions[qIdx];
        const isCorrect = opt === q.correct_option;

        // Vizual ko'rsatish
        if (opt !== 'none') {
            const selectedEl = document.getElementById(`opt-${qIdx}-${opt}`);
            if (selectedEl) selectedEl.classList.add(isCorrect ? 'correct' : 'wrong');
        }
        if (!isCorrect) {
            const correctEl = document.getElementById(`opt-${qIdx}-${q.correct_option}`);
            if (correctEl) correctEl.classList.add('correct');
        }

        // Barcha kartochkalarni o'chirish (yana bosish mumkin emas)
        ['a','b','c','d'].forEach(o => {
            const el = document.getElementById(`opt-${qIdx}-${o}`);
            if (el) el.style.pointerEvents = 'none';
        });

        this.currentQuestionIndex++;
        // Vaqt tugab o'tganda darhol o'tish, aks holda 600ms ko'rsatib o'tish
        setTimeout(() => this.renderNextQuestion(), opt === 'none' ? 50 : 600);
    },

    // ------------------------------------------------------------------
    // TIMER
    // ------------------------------------------------------------------
    startTimer() {
        clearInterval(this.timerInterval);
        const timerSec = this.currentQuiz?.timer_per_question || 30;
        let timeLeft = timerSec;

        const timerEl = document.getElementById('questionTimer');
        const pill = document.getElementById('timerPill');

        const update = () => {
            if (!timerEl) return;
            const mm = Math.floor(timeLeft / 60).toString().padStart(2, '0');
            const ss = (timeLeft % 60).toString().padStart(2, '0');
            timerEl.textContent = `${mm}:${ss}`;

            // Urgent animatsiya
            if (pill) {
                if (timeLeft <= 5) pill.classList.add('urgent');
                else pill.classList.remove('urgent');
            }

            if (timeLeft <= 0) {
                clearInterval(this.timerInterval);
                this.submitAnswer(this.currentQuestionIndex, 'none');
                return;
            }
            timeLeft--;
        };

        update();
        this.timerInterval = setInterval(update, 1000);
    },

    // ------------------------------------------------------------------
    // FINISH QUIZ
    // ------------------------------------------------------------------
    async finishQuiz() {
        clearInterval(this.timerInterval);
        this.showView('quizResultView');

        let correct = 0;
        this.currentQuestions.forEach((q, i) => {
            if (this.userAnswers[i] === q.correct_option) correct++;
        });
        const wrong = this.currentQuestions.length - correct;
        const perc = Math.round((correct / this.currentQuestions.length) * 100);

        document.getElementById('finalScoreDisplay').textContent = `${perc}%`;
        document.getElementById('finalCorrect').textContent = correct;
        document.getElementById('finalWrong').textContent = wrong;

        const [rangeStart, rangeEnd] = this.chunkRange.split('-');
        document.getElementById('repeatBtnContainer').innerHTML = `
            <button class="btn-primary" style="width:100%;"
                onclick="app.startQuizChunk(${rangeStart}, ${rangeEnd})">🔄 Qayta yechish</button>
        `;

        // Natijani saqlash
        try {
            await fetch('/api/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    telegram_id: this.user.id,
                    quiz_code: this.currentQuiz.code,
                    chunk_range: this.chunkRange,
                    correct_count: correct,
                    incorrect_count: wrong
                })
            });
        } catch {}
    },

    // ------------------------------------------------------------------
    // RESULTS
    // ------------------------------------------------------------------
    async loadResults() {
        const container = document.getElementById('resultsContainer');
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Yuklanmoqda...</p>';
        try {
            const res = await fetch(`/api/results/${this.user.id}`);
            const data = await res.json();

            let tC = 0, tW = 0, tP = 0;
            data.forEach(r => {
                tC += r.correct_count;
                tW += r.incorrect_count;
                const t = r.correct_count + r.incorrect_count;
                if (t > 0) tP += (r.correct_count / t) * 100;
            });

            const avg = data.length > 0 ? Math.round(tP / data.length) : 0;
            document.getElementById('stTotal').textContent = data.length;
            document.getElementById('stCorrect').textContent = tC;
            document.getElementById('stWrong').textContent = tW;

            const circle = document.getElementById('avgCircle');
            if (circle) { circle.style.setProperty('--p', `${avg}%`); circle.setAttribute('data-text', `${avg}%`); }
            document.getElementById('avgText').textContent = avg >= 80 ? "A'lo" : avg >= 60 ? "Yaxshi" : "Past";

            if (data.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Hali natijalar yo\'q.</p>'; return; }

            container.innerHTML = data.map(r => {
                const total = r.correct_count + r.incorrect_count;
                const perc = total > 0 ? Math.round((r.correct_count / total) * 100) : 0;
                const isGood = perc > 60;
                return `
                    <div class="history-item">
                        <div class="h-icon" style="background:${isGood ? '#d1fae5' : '#fee2e2'};color:${isGood ? 'var(--success)' : 'var(--danger)'};">${isGood ? '✅' : '❌'}</div>
                        <div class="h-content">
                            <div class="h-name">KOD: ${r.quiz_code} (${r.chunk_range})</div>
                            <div class="h-date">${new Date(r.date).toLocaleString()}</div>
                            <div style="font-size:0.72rem;color:var(--text-dim);margin-top:3px;">To'g'ri: ${r.correct_count} | Xato: ${r.incorrect_count}</div>
                        </div>
                        <div class="h-score-wrap">
                            <span class="h-perc" style="color:${isGood ? 'var(--success)' : 'var(--danger)'};background:${isGood ? '#f0fdf4' : '#fef2f2'};">${perc}%</span>
                        </div>
                    </div>
                `;
            }).join('');
        } catch { container.innerHTML = '<p style="color:var(--danger);">Xatolik yuz berdi.</p>'; }
    },

    // ------------------------------------------------------------------
    // QUIZ ROOMS — kod ustiga bosib copy
    // ------------------------------------------------------------------
    async loadQuizRooms() {
        const container = document.getElementById('quizRoomsContainer');
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Yuklanmoqda...</p>';
        try {
            const res = await fetch('/api/public/quizzes');
            const data = await res.json();
            if (data.length === 0) {
                container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Hozircha ochiq testlar yo\'q.</p>';
                return;
            }
            container.innerHTML = data.map(q => `
                <div class="room-card" onclick="app.copyQuizCode('${q.code}')">
                    <div style="flex:1;">
                        <div class="h-name">${q.title}</div>
                        <div class="h-date">${q.total_questions} ta savol · ${q.created_at}</div>
                    </div>
                    <div style="text-align:center;">
                        <div class="room-code">${q.code}</div>
                        <div class="copy-hint">📋 bosib nusxalang</div>
                    </div>
                </div>
            `).join('');
        } catch(e) { container.innerHTML = '<p style="color:var(--danger);">Xatolik: ' + e.message + '</p>'; }
    },

    // Kodga bosish — faqat clipboard copy, SCAN oynasi ochilmaydi
    copyQuizCode(code) {
        navigator.clipboard.writeText(code).then(() => {
            showMsg(`✅ Kod nusxalandi: ${code}\n\n"Qo'shilish" bo'limiga o'tib, shu kodni kiriting.`);
        }).catch(() => {
            showMsg("Kod: " + code + "\n\n(Qo'lda nusxalang)");
        });
    },

    // ------------------------------------------------------------------
    // ADMIN
    // ------------------------------------------------------------------
    async verifyAdmin() {
        const pass = document.getElementById('adminPass').value;
        try {
            const res = await fetch(`/api/admin/check/${this.user.id}?password=${pass}`);
            const data = await res.json();
            if (data.is_admin) {
                document.getElementById('adminLogin').style.display = 'none';
                document.getElementById('adminContent').style.display = 'block';
                this.switchAdminTab('quizzes');
            } else {
                tg.showAlert("Parol noto'g'ri!");
            }
        } catch { tg.showAlert("Xatolik!"); }
    },

    switchAdminTab(tab) {
        // Tab buttons
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        const tabBtn = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
        if (tabBtn) tabBtn.classList.add('active');

        // Tab contents
        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
        const content = document.getElementById('adminTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
        if (content) content.classList.add('active');

        // Load data
        if (tab === 'quizzes') this.loadAdminPanel();
        else if (tab === 'users') this.loadAdminUsers();
        else if (tab === 'botControl') this.loadBotControl();
    },

    async loadAdminPanel() {
        const container = document.getElementById('adminDataContainer');
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Yuklanmoqda...</p>';
        try {
            const res = await fetch(`/api/admin/quizzes?telegram_id=${this.user.id}`);
            const data = await res.json();
            if (data.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Quizlar yo\'q.</p>'; return; }
            container.innerHTML = data.map(q => `
                <div class="admin-quiz-card">
                    <div class="admin-quiz-header">
                        <div>
                            <span class="quiz-code-badge">#${q.code}</span>
                            <strong style="margin-left:8px;">${q.title}</strong>
                        </div>
                        <button class="del-btn" onclick="app.deleteQuiz('${q.code}')">✕</button>
                    </div>
                    <div style="font-size:0.75rem;color:var(--text-dim);">
                        ${q.creator_name}${q.creator_username ? ' @'+q.creator_username : ''} · ${q.total_questions} ta savol · ${q.created_at}
                    </div>
                    ${q.participants.length > 0 ? `
                        <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
                            ${q.participants.map(p => `
                                <div style="font-size:0.73rem;margin-bottom:4px;color:var(--text-dim);">
                                    👤 ${p.first_name}${p.username ? ' @'+p.username : ''}: ${p.correct}/${p.correct+p.incorrect} (${p.chunk_range})
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('');
        } catch { container.innerHTML = '<p style="color:var(--danger);">Xatolik.</p>'; }
    },

    async loadAdminUsers() {
        const container = document.getElementById('usersContainer');
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Yuklanmoqda...</p>';
        try {
            const res = await fetch(`/api/admin/users?telegram_id=${this.user.id}`);
            const data = await res.json();

            document.getElementById('usersTotalBadge').textContent = data.length + ' ta';

            if (data.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--text-dim);">Foydalanuvchilar yo\'q.</p>'; return; }

            container.innerHTML = data.map(u => {
                const initial = (u.first_name || 'M').charAt(0).toUpperCase();
                const joinDate = u.joined_at ? new Date(u.joined_at).toLocaleString('uz-UZ', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                return `
                    <div class="user-item">
                        <div class="user-avatar">${initial}</div>
                        <div class="user-info">
                            <div class="user-name">${u.first_name || '—'}${u.is_admin ? ' 🛡️' : ''}</div>
                            ${u.username ? `<div class="user-username">@${u.username}</div>` : ''}
                            <div class="user-meta">📅 ${joinDate}</div>
                        </div>
                        <div class="user-id">${u.telegram_id}</div>
                    </div>
                `;
            }).join('');
        } catch { container.innerHTML = '<p style="color:var(--danger);">Xatolik.</p>'; }
    },

    async deleteQuiz(code) {
        if (!confirm("O'chirilsinmi?")) return;
        try {
            await fetch(`/api/admin/quiz/${code}?telegram_id=${this.user.id}`, { method: 'DELETE' });
            this.loadAdminPanel();
        } catch {}
    },

    // ------------------------------------------------------------------
    // BOT CONTROL
    // ------------------------------------------------------------------
    async loadBotControl() {
        try {
            const res = await fetch(`/api/admin/bot-status?telegram_id=${this.user.id}`);
            const data = await res.json();
            this._updateBotStatusUI(data.is_restricted);

            const rMsg = document.getElementById('restrictionMsgEdit');
            const oMsg = document.getElementById('openMsgEdit');
            if (rMsg) rMsg.value = data.restriction_message || '';
            if (oMsg) oMsg.value = data.open_broadcast_message || '';
        } catch { console.error("Bot status yuklanmadi"); }
        this.loadBotLogs();
    },

    _updateBotStatusUI(isRestricted) {
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const btnR = document.getElementById('btnRestrict');
        const btnO = document.getElementById('btnOpen');
        if (dot) {
            dot.classList.toggle('restricted', isRestricted);
        }
        if (text) {
            text.textContent = isRestricted ? '🔴 Bot cheklangan' : '🟢 Bot ochiq';
            text.style.color = isRestricted ? 'var(--danger)' : 'var(--success)';
        }
        if (btnR) btnR.disabled = isRestricted;
        if (btnO) btnO.disabled = !isRestricted;
    },

    async restrictBot() {
        if (!confirm("Botni cheklash va barcha userlarga texnik ishlar xabarini yuborishni tasdiqlaysizmi?")) return;
        try {
            const res = await fetch(`/api/admin/bot-restrict?telegram_id=${this.user.id}`, { method: 'POST' });
            const data = await res.json();
            this._updateBotStatusUI(true);
            tg.showAlert("✅ " + data.message);
            this.loadBotLogs();
        } catch { tg.showAlert("Xatolik yuz berdi!"); }
    },

    async openBot() {
        if (!confirm("Botni ochish va barcha userlarga broadcast yuborishni tasdiqlaysizmi?")) return;
        try {
            const res = await fetch(`/api/admin/bot-open?telegram_id=${this.user.id}`, { method: 'POST' });
            const data = await res.json();
            this._updateBotStatusUI(false);
            tg.showAlert("✅ " + data.message);
            this.loadBotLogs();
        } catch { tg.showAlert("Xatolik yuz berdi!"); }
    },

    async sendBroadcast() {
        const msgEl = document.getElementById('broadcastMsg');
        const message = msgEl ? msgEl.value.trim() : '';
        if (!message) return tg.showAlert("Xabar bo'sh bo'lishi mumkin emas!");
        if (!confirm(`Xabar barcha foydalanuvchilarga yuboriladi:\n\n"${message.substring(0,100)}..."\n\nDavom etasiziimi?`)) return;
        try {
            const res = await fetch(`/api/admin/bot-broadcast?telegram_id=${this.user.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
            const data = await res.json();
            tg.showAlert("📤 " + data.message);
            if (msgEl) msgEl.value = '';
        } catch { tg.showAlert("Xatolik!"); }
    },

    async saveBotMessages() {
        const rMsg = document.getElementById('restrictionMsgEdit')?.value;
        const oMsg = document.getElementById('openMsgEdit')?.value;
        try {
            const res = await fetch(`/api/admin/bot-messages?telegram_id=${this.user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ restriction_message: rMsg, open_broadcast_message: oMsg })
            });
            const data = await res.json();
            tg.showAlert("✅ Xabarlar saqlandi!");
        } catch { tg.showAlert("Xatolik!"); }
    },

    async loadBotLogs() {
        const container = document.getElementById('botLogsContainer');
        if (!container) return;
        container.innerHTML = '<p style="text-align:center;color:var(--text-dim);font-size:0.8rem;">Yuklanmoqda...</p>';
        try {
            const res = await fetch(`/api/admin/bot-logs?telegram_id=${this.user.id}`);
            const data = await res.json();
            if (data.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--text-dim);font-size:0.8rem;">Loglar yo\'q.</p>'; return; }
            container.innerHTML = data.map(l => {
                const dt = new Date(l.timestamp).toLocaleString('uz-UZ', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
                
                let badgeClass = l.action;
                let badgeText = '⚙️ Tizim';
                if (l.action === 'restrict') {
                    badgeClass = 'restrict';
                    badgeText = '🔴 Cheklandi';
                } else if (l.action === 'open') {
                    badgeClass = 'open';
                    badgeText = '🟢 Ochildi';
                } else if (l.action === 'broadcast') {
                    badgeClass = 'broadcast';
                    badgeText = '📢 E\'lon';
                }

                return `
                    <div class="log-item" style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px; border-bottom:1px solid var(--border); padding-bottom:8px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="log-badge ${badgeClass}">${badgeText}</span>
                            <span class="log-time" style="font-size:0.72rem; color:var(--text-dim);">${dt}</span>
                        </div>
                        <div style="font-size:0.75rem; color:var(--text-dim); display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                            <span>Admin: ${l.admin_telegram_id}</span>
                            ${l.note ? `<span style="font-weight: 500; color: var(--text);">${l.note}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch { container.innerHTML = '<p style="color:var(--danger);font-size:0.8rem;">Xatolik.</p>'; }
    }
};

window.onload = () => app.init();
