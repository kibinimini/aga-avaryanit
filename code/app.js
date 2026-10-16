const STORAGE_KEYS = { best: "aga-best-score", session: "aga-session" };
const OPTION_COUNT = 4;
const STOP_WORDS = new Set([
    "של", "או", "עם", "את", "על", "אם", "זה", "לא", "גם", "הוא", "היא", "הם", "הן", "יותר", "כל",
    "אחד", "אחת", "אדם", "כינוי", "סם", "לסם", "בסם", "הסם", "סמים", "מאוד", "כמו", "כדי", "בין",
    "אחר", "לאחר", "שלו", "שלה", "שלהם", "יש", "אין", "בו", "בה", "לו", "לה", "מה", "מי", "וכו",
]);

const WORDS = buildWords();
const WORD_BY_KEY = new Map(WORDS.map((word) => [wordKey(word), word]));
const app = document.getElementById("app");

let session = loadSession();
let lastResult = null;

window.addEventListener("hashchange", render);
document.addEventListener("keydown", onKeyDown);
render();

/* ---------- words and questions ---------- */

function buildWords() {
    const words = [];
    const seen = new Set();
    TOPICS.forEach((topic, topicIndex) => {
        for (const section of topic.sections) {
            for (const group of section.groups) {
                for (const line of group.words) {
                    const word = parseWord(line);
                    if (!word) {
                        console.warn("שורה לא תקינה בקובץ התוכן:", line);
                        continue;
                    }
                    const key = wordKey(word);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    words.push({
                        ...word,
                        topic: topicIndex,
                        tokens: tokenize(word.def),
                        normTerm: normalize(word.term),
                        normDef: normalize(word.def),
                    });
                }
            }
        }
    });
    return words;
}

function parseWord(line) {
    const match = line.match(/^(.+?)\s*-\s+([\s\S]+)$/);
    return match ? { term: match[1].trim(), def: match[2].trim() } : null;
}

function wordKey(word) {
    return word.term + "|" + word.def;
}

function normalize(text) {
    return text
        .replace(/['"׳״]/g, "")
        .replace(/[^\u05D0-\u05EAa-zA-Z0-9]+/g, " ")
        .trim()
        .toLowerCase();
}

function tokenize(text) {
    return normalize(text)
        .split(" ")
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
        .map((token) => (token.length > 3 && "ובלהמשכ".includes(token[0]) ? token.slice(1) : token))
        .filter((token) => !STOP_WORDS.has(token));
}

function sharesToken(a, b) {
    return a.some((x) =>
        b.some((y) => x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))))
    );
}

function wordsOfTopics(topicIndexes) {
    return WORDS.filter((word) => topicIndexes.includes(word.topic));
}

function makeQuestion(word) {
    const showsTerm = Math.random() < 0.5;
    const options = shuffle([word, ...pickDistractors(word, showsTerm)]);
    return {
        term: word.term,
        def: word.def,
        showsTerm,
        prompt: showsTerm ? word.term : word.def,
        options: options.map((w) => (showsTerm ? w.def : w.term)),
        answer: options.indexOf(word),
    };
}

// Distractors must not share meaning with the right answer, or two options could both be correct.
function pickDistractors(word, showsTerm) {
    const label = (w) => (showsTerm ? w.normDef : w.normTerm);
    const isSafe = (other) =>
        other !== word &&
        other.normTerm !== word.normTerm &&
        other.normDef !== word.normDef &&
        !sharesToken(word.tokens, other.tokens);

    const sameTopic = shuffle(WORDS.filter((w) => w.topic === word.topic && isSafe(w)));
    const otherTopics = shuffle(WORDS.filter((w) => w.topic !== word.topic && isSafe(w)));
    const fallback = shuffle(WORDS.filter((w) => w !== word && label(w) !== label(word)));

    const picked = [];
    const usedLabels = new Set([label(word)]);
    for (const candidate of [...sameTopic, ...otherTopics, ...fallback]) {
        if (picked.length === OPTION_COUNT - 1) break;
        const text = label(candidate);
        if (usedLabels.has(text) || picked.some((p) => sharesToken(p.tokens, candidate.tokens))) continue;
        usedLabels.add(text);
        picked.push(candidate);
    }
    return picked;
}

function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/* ---------- storage ---------- */

function readJSON(key) {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch {
        return null;
    }
}

function writeJSON(key, value) {
    try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage can be unavailable in private browsing */
    }
}

function loadSession() {
    const saved = readJSON(STORAGE_KEYS.session);
    const valid =
        saved &&
        (saved.mode === "practice" || saved.mode === "test") &&
        Array.isArray(saved.questions) &&
        saved.questions.length > 0 &&
        Array.isArray(saved.picks) &&
        saved.index >= 0 &&
        saved.index < saved.questions.length;
    return valid ? saved : null;
}

function saveSession() {
    writeJSON(STORAGE_KEYS.session, session);
}

function getBestScore() {
    const best = readJSON(STORAGE_KEYS.best);
    return best && typeof best.percent === "number" ? best : null;
}

/* ---------- quiz flow ---------- */

function startQuiz(mode, words) {
    session = {
        mode,
        questions: shuffle(words).map(makeQuestion),
        picks: [],
        index: 0,
    };
    saveSession();
    if (location.hash === "#quiz") render();
    else location.hash = "quiz";
}

function correctCount(s) {
    return s.picks.filter((pick, i) => pick === s.questions[i].answer).length;
}

function choose(optionIndex) {
    if (!session || session.picks[session.index] !== undefined) return;
    session.picks[session.index] = optionIndex;
    saveSession();
    const isRight = optionIndex === session.questions[session.index].answer;
    if (navigator.vibrate) navigator.vibrate(isRight ? 25 : [70, 50, 70]);
    render({ justAnswered: true });
}

function nextQuestion() {
    if (!session) return;
    if (session.index < session.questions.length - 1) {
        session.index++;
        saveSession();
        render();
    } else {
        finishQuiz();
    }
}

function finishQuiz() {
    const total = session.questions.length;
    const correct = correctCount(session);
    const percent = Math.round((correct / total) * 100);
    const mistakes = session.questions
        .filter((q, i) => session.picks[i] !== q.answer)
        .map((q) => ({ term: q.term, def: q.def }));

    let previousBest = null;
    let isRecord = false;
    if (session.mode === "test") {
        previousBest = getBestScore();
        isRecord =
            !previousBest ||
            percent > previousBest.percent ||
            (percent === previousBest.percent && correct > previousBest.correct);
        if (isRecord) writeJSON(STORAGE_KEYS.best, { percent, correct, total, date: new Date().toISOString() });
    }

    lastResult = { mode: session.mode, total, correct, percent, mistakes, previousBest, isRecord };
    session = null;
    saveSession();
    location.replace("#result");
}

function practiceMistakes() {
    const words = lastResult.mistakes.map((m) => WORD_BY_KEY.get(wordKey(m))).filter(Boolean);
    if (words.length) startQuiz("practice", words);
}

function onKeyDown(event) {
    if (location.hash !== "#quiz" || !session || event.ctrlKey || event.metaKey || event.altKey) return;
    const answered = session.picks[session.index] !== undefined;
    const question = session.questions[session.index];
    const number = Number(event.key);
    if (!answered && number >= 1 && number <= question.options.length) {
        event.preventDefault();
        choose(number - 1);
    } else if (answered && event.key === "Enter" && !(document.activeElement instanceof HTMLButtonElement)) {
        event.preventDefault();
        nextQuestion();
    }
}

/* ---------- rendering ---------- */

function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value == null || value === false) continue;
        if (key === "class") el.className = value;
        else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
        else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : String(child));
    }
    return el;
}

function render(options = {}) {
    const [route, param] = location.hash.slice(1).split("/");
    let view;
    switch (route) {
        case "":
            view = openingView();
            break;
        case "home":
            view = homeView();
            break;
        case "topic":
            view = topicView(Number(param));
            break;
        case "practice":
            view = practiceSetupView();
            break;
        case "test":
            view = testIntroView();
            break;
        case "quiz":
            view = session ? quizView(options) : null;
            break;
        case "result":
            view = lastResult ? resultView() : null;
            break;
        case "about":
            view = aboutView();
            break;
    }
    if (!view) {
        location.replace("#home");
        return;
    }
    app.replaceChildren(view);
    if (!options.justAnswered) window.scrollTo(0, 0);
    if (route !== "quiz") document.title = "לומדת " + TITLE;
}

function go(hash) {
    return () => (location.hash = hash);
}

function backButton(hash, text = "חזרה") {
    return h("button", { class: "back-btn", type: "button", onclick: go(hash) }, h("span", { "aria-hidden": "true" }, "→"), text);
}

function pluralWords(count) {
    return count === 1 ? "מונח אחד" : `${count} מונחים`;
}

function formatDate(iso) {
    try {
        return new Date(iso).toLocaleDateString("he-IL");
    } catch {
        return "";
    }
}

function openingView() {
    return h(
        "section",
        { class: "screen opening" },
        h("img", { class: "opening-classification", src: "assets/images/opening/Balmas_txt.svg", alt: 'בלמ"ס' }),
        h("h1", { class: "opening-title" }, TITLE),
        h("p", { class: "opening-subtitle" }, SUBTITLE),
        h("p", { class: "opening-count" }, `${WORDS.length} מונחים · ${TOPICS.length} נושאים`),
        h("button", { class: "btn btn-light btn-big", type: "button", onclick: go("home") }, "כניסה ללומדה")
    );
}

function homeView() {
    const best = getBestScore();
    return h(
        "section",
        { class: "screen home" },
        h(
            "header",
            { class: "home-header" },
            h("div", {}, h("h1", { class: "page-title" }, TITLE), h("p", { class: "page-subtitle" }, "בחרו נושא ללמידה, ואז תרגלו או היבחנו")),
            h("button", { class: "icon-btn", type: "button", onclick: go("about"), "aria-label": "אודות" }, "i")
        ),
        session && resumeBanner(),
        h(
            "div",
            { class: "topic-grid" },
            TOPICS.map((topic, i) =>
                h(
                    "button",
                    { class: "topic-card", type: "button", onclick: go("topic/" + i) },
                    h("img", { class: "topic-icon", src: topic.icon, alt: "" }),
                    h("span", { class: "topic-name" }, topic.name),
                    h("span", { class: "topic-count" }, pluralWords(wordsOfTopics([i]).length))
                )
            )
        ),
        h(
            "div",
            { class: "home-actions" },
            h(
                "button",
                { class: "action-card", type: "button", onclick: go("practice") },
                h("span", { class: "action-title" }, "תרגול"),
                h("span", { class: "action-text" }, "בוחרים נושאים, ורואים מיד אם צדקתם")
            ),
            h(
                "button",
                { class: "action-card action-test", type: "button", onclick: go("test") },
                h("span", { class: "action-title" }, "מבחן"),
                h("span", { class: "action-text" }, `כל ${WORDS.length} המונחים, בסדר אקראי`),
                h("span", { class: "best-chip" }, best ? `השיא שלך: ${best.percent}%` : "עוד אין שיא")
            )
        )
    );
}

function resumeBanner() {
    const label = session.mode === "test" ? "מבחן" : "תרגול";
    return h(
        "div",
        { class: "resume-banner" },
        h("span", {}, `יש לך ${label} באמצע - שאלה ${session.index + 1} מתוך ${session.questions.length}`),
        h(
            "div",
            { class: "resume-actions" },
            h("button", { class: "btn btn-small", type: "button", onclick: go("quiz") }, "המשך"),
            h(
                "button",
                {
                    class: "btn btn-small btn-ghost",
                    type: "button",
                    onclick: () => {
                        session = null;
                        saveSession();
                        render();
                    },
                },
                "מחיקה"
            )
        )
    );
}

function topicView(index) {
    const topic = TOPICS[index];
    if (!topic) return null;
    const sectionId = (i) => `section-${i}`;
    return h(
        "section",
        { class: "screen screen-wide topic" },
        backButton("home"),
        h(
            "header",
            { class: "topic-header" },
            h("img", { class: "topic-header-icon", src: topic.icon, alt: "" }),
            h("div", {}, h("h1", { class: "page-title" }, topic.name), h("p", { class: "page-subtitle" }, pluralWords(wordsOfTopics([index]).length)))
        ),
        topic.sections.length > 1 &&
            h(
                "nav",
                { class: "chips", "aria-label": "תתי נושאים" },
                topic.sections.map((section, i) =>
                    h(
                        "button",
                        {
                            class: "chip",
                            type: "button",
                            onclick: () => document.getElementById(sectionId(i)).scrollIntoView({ behavior: "smooth" }),
                        },
                        section.name
                    )
                )
            ),
        topic.sections.map((section, i) =>
            h(
                "div",
                { class: "topic-section", id: sectionId(i) },
                h("h2", { class: "section-title" }, section.name),
                h("div", { class: "group-grid" }, section.groups.map(groupCard))
            )
        ),
        h(
            "div",
            { class: "sticky-bar" },
            h(
                "button",
                { class: "btn btn-light btn-big", type: "button", onclick: () => startQuiz("practice", wordsOfTopics([index])) },
                `תרגול על ${topic.name}`
            )
        )
    );
}

function groupCard(group) {
    return h(
        "article",
        { class: "group-card" },
        group.pic && h("img", { class: "group-pic", src: group.pic, alt: group.name, loading: "lazy" }),
        h("h3", { class: "group-title" }, group.name),
        h(
            "dl",
            { class: "word-list" },
            group.words.map(parseWord).filter(Boolean).map((word) =>
                h("div", { class: "word" }, h("dt", {}, word.term), h("dd", {}, word.def))
            )
        )
    );
}

function practiceSetupView() {
    const selected = new Set(TOPICS.map((_, i) => i));
    const startButton = h("button", { class: "btn btn-light btn-big", type: "button", onclick: () => startQuiz("practice", wordsOfTopics([...selected])) });

    const update = () => {
        const count = wordsOfTopics([...selected]).length;
        startButton.disabled = count === 0;
        startButton.textContent = count ? `התחלת תרגול (${count} שאלות)` : "בחרו לפחות נושא אחד";
    };
    update();

    return h(
        "section",
        { class: "screen setup" },
        backButton("home"),
        h("h1", { class: "page-title" }, "תרגול"),
        h("p", { class: "page-subtitle" }, "כל המונחים של הנושאים שתבחרו, בסדר אקראי. אחרי כל תשובה תראו מיד אם צדקתם."),
        h(
            "div",
            { class: "panel" },
            TOPICS.map((topic, i) =>
                h(
                    "label",
                    { class: "check-row" },
                    h("input", {
                        type: "checkbox",
                        checked: true,
                        onchange: (event) => {
                            if (event.target.checked) selected.add(i);
                            else selected.delete(i);
                            update();
                        },
                    }),
                    h("img", { class: "check-icon", src: topic.icon, alt: "" }),
                    h("span", { class: "check-name" }, topic.name),
                    h("span", { class: "check-count" }, pluralWords(wordsOfTopics([i]).length))
                )
            )
        ),
        startButton
    );
}

function testIntroView() {
    const best = getBestScore();
    return h(
        "section",
        { class: "screen setup" },
        backButton("home"),
        h("h1", { class: "page-title" }, "מבחן"),
        h(
            "div",
            { class: "panel" },
            h(
                "ul",
                { class: "rules" },
                h("li", {}, `המבחן כולל את כל ${WORDS.length} המונחים מכל הנושאים.`),
                h("li", {}, "השאלות והתשובות מעורבבות מחדש בכל מבחן."),
                h("li", {}, "אין הגבלת זמן. אפשר לצאת באמצע ולהמשיך מאותה שאלה."),
                h("li", {}, "בסוף תקבלו ציון ורשימה של המונחים שטעיתם בהם.")
            ),
            h(
                "p",
                { class: "best-line" },
                best ? `השיא שלך: ${best.percent}% (${best.correct} מתוך ${best.total}), ${formatDate(best.date)}` : "עוד אין לך שיא. זה הזמן לקבוע אחד."
            )
        ),
        h("button", { class: "btn btn-light btn-big", type: "button", onclick: () => startQuiz("test", WORDS) }, "התחלת מבחן")
    );
}

function quizView({ justAnswered }) {
    const q = session.questions[session.index];
    const pick = session.picks[session.index];
    const answered = pick !== undefined;
    const isRight = pick === q.answer;
    const total = session.questions.length;
    const done = session.index + (answered ? 1 : 0);
    const isLast = session.index === total - 1;
    const modeLabel = session.mode === "test" ? "מבחן" : "תרגול";
    document.title = `${modeLabel} ${session.index + 1}/${total} - ${TITLE}`;

    const optionButtons = q.options.map((text, i) => {
        let state = "";
        if (answered && i === q.answer) state = "is-correct";
        else if (answered && i === pick) state = "is-wrong";
        else if (answered) state = "is-dim";
        return h(
            "button",
            {
                class: `option ${state}`,
                type: "button",
                disabled: answered,
                onclick: () => choose(i),
            },
            h("span", { class: "option-key", "aria-hidden": "true" }, state === "is-correct" ? "✓" : state === "is-wrong" ? "✗" : i + 1),
            h("span", { class: "option-text" }, text)
        );
    });

    const nextButton =
        answered &&
        h("button", { class: "btn btn-next", type: "button", onclick: nextQuestion }, isLast ? "לתוצאות" : "לשאלה הבאה", h("span", { "aria-hidden": "true" }, " ←"));

    const view = h(
        "section",
        { class: "screen quiz" },
        h(
            "header",
            { class: "quiz-top" },
            h("button", { class: "back-btn", type: "button", onclick: go("home") }, h("span", { "aria-hidden": "true" }, "→"), "יציאה"),
            h("span", { class: "quiz-mode" }, modeLabel),
            h("span", { class: "quiz-score" }, `${correctCount(session)} נכונות`)
        ),
        h(
            "div",
            { class: "progress", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done },
            h("div", { class: "progress-fill", style: `width:${(done / total) * 100}%` })
        ),
        h("p", { class: "quiz-counter" }, `שאלה ${session.index + 1} מתוך ${total}`),
        h(
            "div",
            { class: `question-card ${answered ? (isRight ? "card-correct" : "card-wrong") : "enter"} ${justAnswered && !isRight ? "shake" : ""}` },
            h("p", { class: "question-label" }, q.showsTerm ? "מה פירוש המונח?" : "איזה מונח מתאים לפירוש?"),
            h("p", { class: `question-prompt ${q.showsTerm ? "is-term" : ""}` }, q.prompt),
            h("div", { class: "options" }, optionButtons),
            answered &&
                h(
                    "div",
                    { class: "explain" },
                    h("span", { class: "explain-term" }, q.term),
                    " - ",
                    h("span", {}, q.def)
                )
        ),
        answered &&
            h(
                "div",
                { class: `feedback ${isRight ? "feedback-correct" : "feedback-wrong"} ${justAnswered ? "pop" : ""}`, role: "status" },
                h("span", { class: "feedback-icon", "aria-hidden": "true" }, isRight ? "✓" : "✗"),
                h("span", { class: "feedback-text" }, isRight ? "נכון!" : "לא נכון"),
                nextButton
            )
    );

    if (answered) {
        requestAnimationFrame(() => {
            nextButton.focus({ preventScroll: true });
            if (justAnswered) view.querySelector(".feedback").scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
    }
    return view;
}

function resultView() {
    const r = lastResult;
    const isTest = r.mode === "test";
    const best = getBestScore();
    let verdict = "כדאי לחזור על החומר ולנסות שוב";
    if (r.percent === 100) verdict = "מושלם! ידעתם הכל";
    else if (r.percent >= 85) verdict = "מצוין!";
    else if (r.percent >= 70) verdict = "יפה מאוד";
    else if (r.percent >= 50) verdict = "בכיוון הנכון";

    return h(
        "section",
        { class: "screen result" },
        h("h1", { class: "page-title" }, isTest ? "סיום המבחן" : "סיום התרגול"),
        h(
            "div",
            { class: "panel result-panel" },
            h("div", { class: "score-ring", style: `--p:${r.percent}` }, h("span", {}, `${r.percent}%`)),
            h("p", { class: "result-verdict" }, verdict),
            h("p", { class: "result-line" }, `ענית נכון על ${r.correct} מתוך ${r.total}`),
            isTest && r.isRecord && h("p", { class: "record" }, r.previousBest ? `שיא חדש! השיא הקודם היה ${r.previousBest.percent}%` : "שיא ראשון נשמר!"),
            isTest && !r.isRecord && best && h("p", { class: "best-line" }, `השיא שלך: ${best.percent}%`)
        ),
        r.mistakes.length > 0 &&
            h(
                "div",
                { class: "panel" },
                h("h2", { class: "section-title dark" }, `מונחים לחזרה (${r.mistakes.length})`),
                h(
                    "dl",
                    { class: "word-list" },
                    r.mistakes.map((m) => h("div", { class: "word" }, h("dt", {}, m.term), h("dd", {}, m.def)))
                )
            ),
        h(
            "div",
            { class: "result-actions" },
            r.mistakes.length > 0 && h("button", { class: "btn btn-light btn-big", type: "button", onclick: practiceMistakes }, "תרגול רק על הטעויות"),
            isTest
                ? h("button", { class: "btn btn-outline", type: "button", onclick: () => startQuiz("test", WORDS) }, "מבחן חדש")
                : h("button", { class: "btn btn-outline", type: "button", onclick: go("practice") }, "תרגול חדש"),
            h("button", { class: "btn btn-outline", type: "button", onclick: go("home") }, "לדף הבית")
        )
    );
}

function aboutView() {
    return h(
        "section",
        { class: "screen about" },
        backButton("home"),
        h("h1", { class: "page-title" }, "אודות"),
        h(
            "div",
            { class: "panel" },
            h(
                "dl",
                { class: "credits" },
                CREDITS.map(([role, name]) => h("div", {}, h("dt", {}, role), h("dd", {}, name))),
                h("div", {}, h("dt", {}, "צור קשר"), h("dd", {}, h("a", { href: "mailto:" + CONTACT_EMAIL }, CONTACT_EMAIL)))
            )
        ),
        h(
            "div",
            { class: "logos" },
            h("img", { src: "assets/images/opening/madorTill_header.svg", alt: 'מדור טי"ל' }),
            h("img", { src: "assets/images/opening/bhd13.svg", alt: 'בה"ד 13' })
        )
    );
}
