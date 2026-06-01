import { db } from "./firebase-config.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=9";
import { applyRatingStats, normalizeBook, escapeHtml, bookUrl, coverUrl } from "./common.js?v=14";
import { loadFavoriteIds, toggleFavorite } from "./favorites.js?v=9";

const homeStatus = document.getElementById("home-status");
const homeBooks = document.getElementById("home-books");
const loginLink = document.querySelector(".hdr-login");
const registerLink = document.querySelector(".hdr-register");

let currentUser = null;
let favoriteIds = new Set();
let cachedBooks = [];

initAuthUi(async (user) => {
    currentUser = user;
    updateHeaderAuth(user);
    favoriteIds = await loadFavoriteIds(user);
    renderHomeBooks();
});

function updateHeaderAuth(user) {
    if (!loginLink || !registerLink) return;

    if (user) {
        loginLink.textContent = "Профіль";
        loginLink.href = "/profile";
        registerLink.style.display = "none";
        revealAuthLinks();
    } else {
        loginLink.textContent = "Вхід";
        registerLink.textContent = "Реєстрація";
        loginLink.href = "/login";
        registerLink.href = "/login#register";
        registerLink.style.display = "";
        revealAuthLinks();
    }
}

function revealAuthLinks() {
    loginLink?.classList.remove("auth-link-pending");
    registerLink?.classList.remove("auth-link-pending");
}

// ── Card (design .bcard markup) ──────────────────────────────────────────
function renderCard(book, favIds) {
    const id = book.book_id || "";
    const title = book.title || "Книга";
    const author = book.author || "";
    const genres = Array.isArray(book.genres) ? book.genres : [];
    const count = Number(book.ratingCount || 0);
    const sum = Number(book.ratingSum || 0);
    const rating = count > 0 ? (sum / count).toFixed(1) : "—";
    const fav = favIds.has(id);

    const cover = book.cover_url
        ? `<a class="cover" href="${bookUrl(id)}" draggable="false" style="background-image:url('${escapeHtml(coverUrl(book.cover_url, 300))}')"></a>`
        : `<a class="cover" href="${bookUrl(id)}" draggable="false"><div class="cover-gen"><div class="ct serif">${escapeHtml(title)}</div><div class="ca">${escapeHtml(author)}</div></div></a>`;

    const tags = genres.map(g => `<span class="tag">${escapeHtml(g)}</span>`).join("");

    return `
        <article class="bcard" data-book-id="${escapeHtml(id)}">
            ${cover}
            <div class="titlerow">
                <div class="ttl">${escapeHtml(title)}</div>
                <button class="addbtn favorite-toggle" type="button" data-book-id="${escapeHtml(id)}" data-active="${fav}" title="${fav ? "У вибраному" : "До вибраного"}" style="${fav ? "color:var(--orange)" : ""}">
                    <span class="material-symbols-outlined">${fav ? "check_circle" : "add_circle"}</span>
                </button>
            </div>
            <div class="meta">
                <div class="auth">${escapeHtml(author)}</div>
                <span class="rate"><span class="material-symbols-outlined" style="color:var(--brown);font-variation-settings:'FILL' 1">star</span>${rating}</span>
            </div>
            <div class="tags">${tags}</div>
            <div class="cta"><a class="btn btn-primary btn-block" draggable="false" href="${bookUrl(id)}">Детальніше</a></div>
        </article>`;
}

function setFavIcon(btn, active) {
    btn.dataset.active = active ? "true" : "false";
    const icon = btn.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = active ? "check_circle" : "add_circle";
    btn.style.color = active ? "var(--orange)" : "";
    btn.title = active ? "У вибраному" : "До вибраного";
}

homeBooks.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;
    event.preventDefault();

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    setFavIcon(button, nextActive);
});

// ── Carousel arrows ──────────────────────────────────────────────────────
document.getElementById("carousel-prev")?.addEventListener("click", () => homeBooks.scrollBy({ left: -460, behavior: "smooth" }));
document.getElementById("carousel-next")?.addEventListener("click", () => homeBooks.scrollBy({ left: 460, behavior: "smooth" }));

let carouselDrag = null;
let suppressCarouselClick = false;
let carouselPointerStartedOnInteractive = false;

homeBooks.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    carouselPointerStartedOnInteractive = Boolean(event.target.closest("a,button"));
    carouselDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        scrollLeft: homeBooks.scrollLeft,
        moved: false,
    };
});

window.addEventListener("pointermove", (event) => {
    if (!carouselDrag || event.pointerId !== carouselDrag.pointerId) return;
    const delta = event.clientX - carouselDrag.startX;
    if (Math.abs(delta) > 6) {
        carouselDrag.moved = true;
        suppressCarouselClick = true;
        homeBooks.classList.add("is-dragging");
        if (carouselPointerStartedOnInteractive) {
            event.preventDefault();
        }
    }
    if (!carouselDrag.moved) return;
    event.preventDefault();
    homeBooks.scrollLeft = carouselDrag.scrollLeft - delta;
});

window.addEventListener("pointerup", finishCarouselDrag);
window.addEventListener("pointercancel", finishCarouselDrag);

homeBooks.addEventListener("click", (event) => {
    if (!suppressCarouselClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressCarouselClick = false;
}, true);

function finishCarouselDrag(event) {
    if (!carouselDrag || event.pointerId !== carouselDrag.pointerId) return;
    homeBooks.classList.remove("is-dragging");
    carouselDrag = null;
}

// ── Search bars ──────────────────────────────────────────────────────────
document.getElementById("hero-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = "/chat";
});
document.getElementById("hdr-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const q = document.getElementById("hdr-search-input").value.trim();
    window.location.href = "/catalog" + (q ? `?search=${encodeURIComponent(q)}` : "");
});

loadHomeBooks();

async function loadHomeBooks() {
    homeStatus.textContent = "Завантаження книг…";
    homeBooks.innerHTML = "";

    try {
        const booksQuery = query(collection(db, "books"), orderBy("title"));
        const [booksSnapshot, commentsSnapshot] = await Promise.all([
            getDocs(booksQuery),
            getDocs(collection(db, "comments")),
        ]);

        cachedBooks = applyRatingStats(
            booksSnapshot.docs.map(normalizeBook),
            commentsSnapshot.docs.map(item => item.data())
        );
        renderHomeBooks();
    } catch (error) {
        homeStatus.textContent = "Не вдалося завантажити книги.";
        console.error(error);
    }
}

function renderHomeBooks() {
    if (!cachedBooks.length) {
        homeStatus.textContent = "Каталог поки порожній.";
        homeBooks.innerHTML = "";
        return;
    }

    homeStatus.textContent = "";
    homeBooks.innerHTML = cachedBooks.slice(0, 12).map(book => renderCard(book, favoriteIds)).join("");
}

