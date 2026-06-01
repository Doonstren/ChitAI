import { db } from "./firebase-config.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=9";
import { applyRatingStats, normalizeBook, escapeHtml, bookUrl, coverUrl } from "./common.js?v=14";
import { loadFavoriteIds, toggleFavorite } from "./favorites.js?v=9";

const PAGE_SIZE = 10;

const catalogStatus = document.getElementById("catalog-status");
const catalogBooks = document.getElementById("catalog-books");
const catalogPagination = document.getElementById("catalog-pagination");
const searchInput = document.getElementById("catalog-search");
const headerSearch = document.getElementById("hdr-search");
const headerSearchInput = document.getElementById("hdr-search-input");
const genreFilter = document.getElementById("genre-filter");
const yearMinFilter = document.getElementById("year-min-filter");
const yearMaxFilter = document.getElementById("year-max-filter");
const yearRangeFill = document.getElementById("year-range-fill");
const yearMinLabel = document.getElementById("year-min-label");
const yearMaxLabel = document.getElementById("year-max-label");
const findFilters = document.getElementById("find-filters");
const applyFilters = document.getElementById("apply-filters");
const resetFilters = document.getElementById("reset-filters");
const backToTop = document.getElementById("back-to-top");
const loginLink = document.querySelector(".hdr-login");
const registerLink = document.querySelector(".hdr-register");
const sortButtons = [...document.querySelectorAll(".sort-btn")];

let currentUser = null;
let favoriteIds = new Set();
let cachedBooks = [];
let sortKey = "popularity";
let currentPage = getPageFromPath();
let yearBounds = { min: 0, max: 0 };
let selectedGenres = new Set();
let appliedGenres = new Set();
let appliedSearch = "";
let appliedYearRange = { min: 0, max: 0 };

const initialSearch = new URLSearchParams(window.location.search).get("search") || "";
searchInput.value = initialSearch;
headerSearchInput.value = initialSearch;
appliedSearch = initialSearch;

initAuthUi(async (user) => {
    currentUser = user;
    updateHeaderAuth(user);
    favoriteIds = await loadFavoriteIds(user);
    renderCatalog();
});

catalogBooks.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;
    event.preventDefault();

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    setFavIcon(button, nextActive);
});

genreFilter.addEventListener("click", (event) => {
    const row = event.target.closest("[data-genre]");
    if (!row) return;
    const genre = row.dataset.genre;
    if (selectedGenres.has(genre)) selectedGenres.delete(genre);
    else selectedGenres.add(genre);
    renderGenreChecks();
});

yearMinFilter.addEventListener("input", () => {
    const minValue = Number(yearMinFilter.value);
    const maxValue = Number(yearMaxFilter.value);
    if (minValue > maxValue) yearMinFilter.value = String(maxValue);
    renderYearLabels();
});

yearMaxFilter.addEventListener("input", () => {
    const minValue = Number(yearMinFilter.value);
    const maxValue = Number(yearMaxFilter.value);
    if (maxValue < minValue) yearMaxFilter.value = String(minValue);
    renderYearLabels();
});

findFilters.addEventListener("click", applyFilterState);
applyFilters.addEventListener("click", () => {
    applyFilterState();
});

searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        applyFilterState();
    }
});

resetFilters.addEventListener("click", () => {
    searchInput.value = "";
    headerSearchInput.value = "";
    selectedGenres.clear();
    appliedGenres.clear();
    appliedSearch = "";
    yearMinFilter.value = String(yearBounds.min);
    yearMaxFilter.value = String(yearBounds.max);
    appliedYearRange = { ...yearBounds };
    currentPage = 1;
    updatePageUrl(1);
    renderGenreChecks();
    renderYearLabels();
    renderCatalog();
});

headerSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    searchInput.value = headerSearchInput.value.trim();
    applyFilterState();
});

sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
        sortKey = button.dataset.sort;
        currentPage = 1;
        updatePageUrl(1);
        renderSortButtons();
        renderCatalog();
    });
});

backToTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("scroll", updateBackToTop, { passive: true });

loadCatalog();

async function loadCatalog() {
    catalogStatus.textContent = "Завантаження каталогу…";
    catalogBooks.innerHTML = "";

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
        fillFilters(cachedBooks);
        renderSortButtons();
        applyFilterState({ resetPage: false });
        updateBackToTop();
    } catch (error) {
        catalogStatus.textContent = "Не вдалося завантажити каталог.";
        console.error(error);
    }
}

function fillFilters(books) {
    const genres = new Set();
    const years = books.map(getYear).filter(Boolean);

    books.forEach((book) => {
        if (Array.isArray(book.genres)) {
            book.genres.forEach((genre) => {
                if (genre) genres.add(genre);
            });
        }
    });

    yearBounds = {
        min: years.length ? Math.min(...years) : 0,
        max: years.length ? Math.max(...years) : 0,
    };
    genreFilter.dataset.genres = JSON.stringify([...genres].sort((a, b) => a.localeCompare(b, "uk")));
    yearMinFilter.min = String(yearBounds.min);
    yearMinFilter.max = String(yearBounds.max);
    yearMinFilter.value = String(yearBounds.min);
    yearMaxFilter.min = String(yearBounds.min);
    yearMaxFilter.max = String(yearBounds.max);
    yearMaxFilter.value = String(yearBounds.max);
    appliedYearRange = { ...yearBounds };
    renderGenreChecks();
    renderYearLabels();
}

function renderCatalog() {
    if (!cachedBooks.length) {
        catalogStatus.textContent = "Каталог поки порожній.";
        catalogBooks.innerHTML = "";
        catalogPagination.innerHTML = "";
        return;
    }

    const search = appliedSearch.toLocaleLowerCase("uk-UA");
    const minYear = Number(appliedYearRange.min || yearBounds.min);
    const maxYear = Number(appliedYearRange.max || yearBounds.max);

    const filteredBooks = cachedBooks.filter((book) => {
        const title = String(book.title || "").toLocaleLowerCase("uk-UA");
        const author = String(book.author || "").toLocaleLowerCase("uk-UA");
        const description = String(book.description || "").toLocaleLowerCase("uk-UA");
        const genres = Array.isArray(book.genres) ? book.genres : [];
        const year = getYear(book);

        const matchesSearch = !search || title.includes(search) || author.includes(search) || description.includes(search);
        const matchesGenre = appliedGenres.size === 0 || genres.some(genre => appliedGenres.has(genre));
        const matchesYear = !year || (year >= minYear && year <= maxYear);

        return matchesSearch && matchesGenre && matchesYear;
    });

    const sortedBooks = sortBooks(filteredBooks);
    const pageCount = Math.max(1, Math.ceil(sortedBooks.length / PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    const start = (currentPage - 1) * PAGE_SIZE;
    const visibleBooks = sortedBooks.slice(start, start + PAGE_SIZE);

    catalogStatus.textContent = `Знайдено ${sortedBooks.length} ${bookWord(sortedBooks.length)}`;
    catalogBooks.innerHTML = visibleBooks.map(book => renderCatalogCard(book, favoriteIds)).join("");
    renderPagination(pageCount);
    updateBackToTop();
}

function applyFilterState({ resetPage = true } = {}) {
    appliedSearch = searchInput.value.trim();
    headerSearchInput.value = appliedSearch;
    appliedGenres = new Set(selectedGenres);
    appliedYearRange = {
        min: Number(yearMinFilter.value || yearBounds.min),
        max: Number(yearMaxFilter.value || yearBounds.max),
    };
    if (resetPage) {
        currentPage = 1;
        updatePageUrl(1);
    }
    renderCatalog();
}

function sortBooks(books) {
    const list = [...books];
    if (sortKey === "title-asc" || sortKey === "title-desc") {
        return list.sort((a, b) => {
            const result = String(a.title || "").localeCompare(String(b.title || ""), "uk");
            return sortKey === "title-asc" ? result : -result;
        });
    }
    if (sortKey === "year-desc" || sortKey === "year-asc") {
        return list.sort((a, b) => {
            const result = getYear(b) - getYear(a);
            return sortKey === "year-desc" ? result : -result;
        });
    }
    return list.sort((a, b) => {
        const ratingDiff = getAverageRating(b) - getAverageRating(a);
        if (ratingDiff !== 0) return ratingDiff;
        const countDiff = Number(b.ratingCount || 0) - Number(a.ratingCount || 0);
        if (countDiff !== 0) return countDiff;
        return String(a.title || "").localeCompare(String(b.title || ""), "uk");
    });
}

function renderSortButtons() {
    sortButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.sort === sortKey);
    });
}

function renderGenreChecks() {
    const genres = JSON.parse(genreFilter.dataset.genres || "[]");
    genreFilter.innerHTML = genres.map(genre => `
        <button class="checkrow" type="button" data-genre="${escapeAttribute(genre)}">
            <span class="checkbox${selectedGenres.has(genre) ? " on" : ""}">${selectedGenres.has(genre) ? "✓" : ""}</span>
            <span>${escapeHtml(genre)}</span>
        </button>
    `).join("");
}

function renderPagination(pageCount) {
    if (pageCount <= 1) {
        catalogPagination.innerHTML = "";
        return;
    }

    const prevPage = Math.max(1, currentPage - 1);
    const nextPage = Math.min(pageCount, currentPage + 1);
    const pages = Array.from({ length: pageCount }, (_, index) => index + 1);

    catalogPagination.innerHTML = `
        <a class="icon-btn icon-btn-prev${currentPage === 1 ? " is-inactive" : ""}" href="${pageUrl(prevPage)}" aria-label="Попередня сторінка" ${currentPage === 1 ? "aria-disabled=\"true\"" : ""}></a>
        ${pages.map(page => `<a class="pg${page === currentPage ? " active" : ""}" href="${pageUrl(page)}">${page}</a>`).join("")}
        <a class="icon-btn icon-btn-next${currentPage === pageCount ? " is-inactive" : ""}" href="${pageUrl(nextPage)}" aria-label="Наступна сторінка" ${currentPage === pageCount ? "aria-disabled=\"true\"" : ""}></a>
    `;
}

function renderCatalogCard(book, favIds) {
    const id = book.book_id || "";
    const title = book.title || "Книга";
    const author = book.author || "";
    const genres = Array.isArray(book.genres) ? book.genres.slice(0, 4) : [];
    const rating = getAverageRating(book);
    const ratingText = rating > 0 ? rating.toFixed(1) : "—";
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
                <span class="rate"><span class="material-symbols-outlined" style="color:var(--brown);font-variation-settings:'FILL' 1">star</span>${ratingText}</span>
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

function getAverageRating(book) {
    const count = Number(book.ratingCount || 0);
    if (count <= 0) return 0;
    return Number(book.ratingSum || 0) / count;
}

function getYear(book) {
    const value = book.publication_year || book.publication_date || "";
    const match = String(value).match(/\d{4}/);
    return match ? Number(match[0]) : 0;
}

function renderYearLabels() {
    const minValue = Number(yearMinFilter.value || yearBounds.min);
    const maxValue = Number(yearMaxFilter.value || yearBounds.max);
    yearMinLabel.textContent = minValue || "—";
    yearMaxLabel.textContent = maxValue || "—";

    const span = Math.max(1, yearBounds.max - yearBounds.min);
    const left = ((minValue - yearBounds.min) / span) * 100;
    const right = 100 - ((maxValue - yearBounds.min) / span) * 100;
    yearRangeFill.style.left = `${left}%`;
    yearRangeFill.style.right = `${right}%`;
}

function updateBackToTop() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    backToTop.classList.toggle("is-visible", scrollTop > 80);
}

function bookWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return "книгу";
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "книги";
    return "книг";
}

function getPageFromPath() {
    const match = window.location.pathname.match(/\/catalog\/page-(\d+)\/?$/);
    return match ? Math.max(1, Number(match[1])) : 1;
}

function pageUrl(page) {
    return page <= 1 ? "/catalog" : `/catalog/page-${page}`;
}

function updatePageUrl(page) {
    const nextUrl = pageUrl(page);
    if (window.location.pathname !== nextUrl) {
        window.history.replaceState({}, "", nextUrl);
    }
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('"', "&quot;");
}

