import { BACKEND_URL, getBookIdFromLocation } from "./common.js?v=9";

const viewer = document.getElementById("viewer");
const stateEl = document.getElementById("reader-state");
const titleEl = document.getElementById("reader-title");
const backLink = document.getElementById("back-link");
const navEl = document.getElementById("reader-nav");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");

const bookId = getBookIdFromLocation();

if (!bookId) {
    showState("Книгу не вказано.");
} else {
    backLink.href = `/books/${encodeURIComponent(bookId)}`;
    loadMeta();
    loadAndRender();
}

function showState(text) {
    stateEl.textContent = text;
    stateEl.style.display = "block";
}
function hideState() {
    stateEl.style.display = "none";
}
function showNav(show) {
    navEl.style.display = show ? "flex" : "none";
}

async function loadMeta() {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/books/${encodeURIComponent(bookId)}`);
        if (!resp.ok) return;
        const book = await resp.json();
        const title = book.title || "Книга";
        titleEl.textContent = title;
        document.title = `${title} — читалка`;
    } catch (_) { /* non-fatal */ }
}

function decodeBytes(buf) {
    let text = new TextDecoder("utf-8").decode(buf);
    const match = text.slice(0, 300).match(/encoding=["']([\w-]+)["']/i);
    if (match && !/utf-?8/i.test(match[1])) {
        try { text = new TextDecoder(match[1]).decode(buf); } catch (_) { /* keep utf-8 */ }
    }
    return text;
}

async function loadAndRender() {
    try {
        const resp = await fetch(`${BACKEND_URL}/api/books/${encodeURIComponent(bookId)}/file`);
        if (resp.status === 404) { showState("Файл книги відсутній на сервері."); return; }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const ctype = (resp.headers.get("content-type") || "").toLowerCase();
        const disp = resp.headers.get("content-disposition") || "";
        const extMatch = disp.match(/filename="?[^"]*\.([a-z0-9]+)"?/i);
        const ext = extMatch ? extMatch[1].toLowerCase() : "";
        const buf = await resp.arrayBuffer();

        hideState();

        if (ctype.includes("pdf") || ext === "pdf") {
            await renderPdf(buf);
        } else if (ctype.includes("epub") || ext === "epub") {
            renderEpub(buf);
        } else if (ctype.includes("fictionbook") || ctype.includes("xml") || ext === "fb2") {
            renderFb2(decodeBytes(buf));
        } else {
            renderTxt(decodeBytes(buf));
        }
    } catch (error) {
        console.error(error);
        showState("Не вдалося відкрити книгу. Перевірте, що бекенд доступний.");
    }
}

// ── PDF (pdf.js) ────────────────────────────────────────────────────────
async function renderPdf(buf) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) { showState("Не вдалося завантажити PDF-читалку."); return; }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    viewer.innerHTML = '<div class="pdf-pages"></div>';
    const wrap = viewer.querySelector(".pdf-pages");
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.min(820, viewer.clientWidth) - 24;

    for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const scale = (targetWidth / base.width) * dpr;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page";
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        wrap.appendChild(canvas);

        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }
}

// ── EPUB (epub.js) ──────────────────────────────────────────────────────
function renderEpub(buf) {
    if (!window.ePub) { showState("Не вдалося завантажити EPUB-читалку."); return; }
    viewer.innerHTML = '<div id="epub-area"></div>';

    const book = window.ePub(buf);
    const rendition = book.renderTo("epub-area", {
        width: "100%",
        height: "100%",
        spread: "none",
        flow: "paginated",
    });
    rendition.display();

    showNav(true);
    btnPrev.onclick = () => rendition.prev();
    btnNext.onclick = () => rendition.next();
    document.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft") rendition.prev();
        if (e.key === "ArrowRight") rendition.next();
    });
}

// ── TXT ─────────────────────────────────────────────────────────────────
function renderTxt(text) {
    const div = document.createElement("div");
    div.className = "book-content book-content--txt";
    const pre = document.createElement("pre");
    pre.textContent = text;
    div.appendChild(pre);
    viewer.innerHTML = "";
    viewer.appendChild(div);
}

// ── FB2 (custom XML → HTML) ─────────────────────────────────────────────
function renderFb2(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) {
        showState("Не вдалося розібрати файл FB2.");
        return;
    }

    // Collect embedded images (base64).
    const binaries = {};
    Array.from(xml.getElementsByTagName("binary")).forEach((b) => {
        const id = b.getAttribute("id");
        const ct = b.getAttribute("content-type") || "image/jpeg";
        if (id) binaries[id] = `data:${ct};base64,${(b.textContent || "").replace(/\s+/g, "")}`;
    });

    function imageSrc(el) {
        let href = "";
        for (const attr of Array.from(el.attributes)) {
            if (attr.name.toLowerCase().endsWith("href")) href = attr.value;
        }
        if (href.startsWith("#")) return binaries[href.slice(1)] || "";
        return href;
    }

    function walk(node, parent) {
        node.childNodes.forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
                if (child.nodeValue && child.nodeValue.trim()) {
                    parent.appendChild(document.createTextNode(child.nodeValue));
                }
                return;
            }
            if (child.nodeType !== Node.ELEMENT_NODE) return;

            const tag = child.tagName.toLowerCase().replace(/^.*:/, "");
            let el;
            switch (tag) {
                case "title": el = document.createElement("h2"); el.className = "fb2-title"; break;
                case "subtitle": el = document.createElement("h3"); break;
                case "section": el = document.createElement("section"); break;
                case "p": el = document.createElement("p"); break;
                case "empty-line": parent.appendChild(document.createElement("br")); return;
                case "emphasis": case "i": el = document.createElement("em"); break;
                case "strong": case "b": el = document.createElement("strong"); break;
                case "epigraph": case "cite": el = document.createElement("blockquote"); break;
                case "poem": el = document.createElement("div"); el.className = "fb2-poem"; break;
                case "stanza": el = document.createElement("div"); el.className = "fb2-stanza"; break;
                case "v": el = document.createElement("div"); el.className = "fb2-v"; break;
                case "text-author": el = document.createElement("p"); el.className = "fb2-author"; break;
                case "image": {
                    const src = imageSrc(child);
                    if (src) {
                        const img = document.createElement("img");
                        img.src = src;
                        img.className = "fb2-image";
                        img.alt = "";
                        parent.appendChild(img);
                    }
                    return;
                }
                case "a": el = document.createElement("span"); break; // footnote refs → plain text
                default: el = document.createElement("div");
            }
            walk(child, el);
            parent.appendChild(el);
        });
    }

    const out = document.createElement("div");
    out.className = "book-content";
    // Only main bodies; skip footnote bodies (name="notes").
    Array.from(xml.getElementsByTagName("body")).forEach((body) => {
        if ((body.getAttribute("name") || "").toLowerCase() === "notes") return;
        walk(body, out);
    });

    if (!out.textContent.trim() && !out.querySelector("img")) {
        showState("Книга порожня або у непідтримуваному форматі FB2.");
        return;
    }
    viewer.innerHTML = "";
    viewer.appendChild(out);
}
