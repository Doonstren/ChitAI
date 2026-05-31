import { db } from "./firebase-config.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=9";
import { applyRatingStats, normalizeBook, escapeHtml, bookUrl } from "./common.js?v=10";
import { loadFavoriteIds, toggleFavorite } from "./favorites.js?v=9";

const catalogStatus = document.getElementById("catalog-status");
const catalogBooks = document.getElementById("catalog-books");
const searchInput = document.getElementById("catalog-search");
const headerSearch = document.getElementById("hdr-search");
const headerSearchInput = document.getElementById("hdr-search-input");
const genreFilter = document.getElementById("genre-filter");
const authorFilter = document.getElementById("author-filter");
const resetFilters = document.getElementById("reset-filters");
const loginLink = document.querySelector(".hdr-login");
const registerLink = document.querySelector(".hdr-register");
const sortButtons = [...document.querySelectorAll(".sort-btn")];

let currentUser = null;
let favoriteIds = new Set();
let cachedBooks = [];
let sortState = {
    key: "popularity",
    titleDirection: "asc",
    yearDirection: "desc",
};

const initialSearch = new URLSearchParams(window.location.search).get("search") || "";
searchInput.value = initialSearch;
headerSearchInput.value = initialSearch;

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

[searchInput, genreFilter, authorFilter].forEach((element) => {
    element.addEventListener("input", renderCatalog);
});

resetFilters.addEventListener("click", () => {
    searchInput.value = "";
    headerSearchInput.value = "";
    genreFilter.value = "";
    authorFilter.value = "";
    renderCatalog();
});

headerSearch.addEventListener("submit", (event) => {
    event.preventDefault();
    searchInput.value = headerSearchInput.value.trim();
    renderCatalog();
});

sortButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const nextKey = button.dataset.sort;
        if (nextKey === "title") {
            sortState.titleDirection = sortState.key === "title" && sortState.titleDirection === "asc" ? "desc" : "asc";
        }
        if (nextKey === "year") {
            sortState.yearDirection = sortState.key === "year" && sortState.yearDirection === "desc" ? "asc" : "desc";
        }
        sortState.key = nextKey;
        renderSortButtons();
        renderCatalog();
    });
});

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
        renderCatalog();
    } catch (error) {
        catalogStatus.textContent = "Не вдалося завантажити каталог.";
        console.error(error);
    }
}

function fillFilters(books) {
    const genres = new Set();
    const authors = new Set();

    books.forEach((book) => {
        if (Array.isArray(book.genres)) {
            book.genres.forEach((genre) => {
                if (genre) genres.add(genre);
            });
        }
        if (book.author) authors.add(book.author);
    });

    genreFilter.innerHTML = `<option value="">Усі жанри</option>${optionList([...genres].sort((a, b) => a.localeCompare(b, "uk")))}`;
    authorFilter.innerHTML = `<option value="">Усі автори</option>${optionList([...authors].sort((a, b) => a.localeCompare(b, "uk")))}`;
}

function renderCatalog() {
    if (!cachedBooks.length) {
        catalogStatus.textContent = "Каталог поки порожній.";
        catalogBooks.innerHTML = "";
        return;
    }

    const search = searchInput.value.trim().toLocaleLowerCase("uk-UA");
    const selectedGenre = genreFilter.value;
    const selectedAuthor = authorFilter.value;

    const filteredBooks = cachedBooks.filter((book) => {
        const title = String(book.title || "").toLocaleLowerCase("uk-UA");
        const author = String(book.author || "").toLocaleLowerCase("uk-UA");
        const description = String(book.description || "").toLocaleLowerCase("uk-UA");
        const genres = Array.isArray(book.genres) ? book.genres : [];

        const matchesSearch = !search || title.includes(search) || author.includes(search) || description.includes(search);
        const matchesGenre = !selectedGenre || genres.includes(selectedGenre);
        const matchesAuthor = !selectedAuthor || book.author === selectedAuthor;

        return matchesSearch && matchesGenre && matchesAuthor;
    });

    const sortedBooks = sortBooks(filteredBooks);
    catalogStatus.textContent = `Знайдено книг: ${sortedBooks.length}`;
    catalogBooks.innerHTML = sortedBooks.map(book => renderCatalogCard(book, favoriteIds)).join("");
}

function sortBooks(books) {
    const list = [...books];
    if (sortState.key === "title") {
        return list.sort((a, b) => {
            const result = String(a.title || "").localeCompare(String(b.title || ""), "uk");
            return sortState.titleDirection === "asc" ? result : -result;
        });
    }
    if (sortState.key === "year") {
        return list.sort((a, b) => {
            const result = getYear(b) - getYear(a);
            return sortState.yearDirection === "desc" ? result : -result;
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
        button.classList.toggle("active", button.dataset.sort === sortState.key);
    });
    document.getElementById("sort-title").textContent = sortState.titleDirection === "asc" ? "Назва А-Я" : "Назва Я-А";
    document.getElementById("sort-year").textContent = sortState.yearDirection === "desc" ? "Рік новіші" : "Рік старіші";
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
        ? `<a class="cover" href="${bookUrl(id)}" draggable="false" style="background-image:url('${escapeHtml(book.cover_url)}')"></a>`
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
        registerLink.style.display = "none";
    } else {
        loginLink.textContent = "Вхід";
        registerLink.textContent = "Реєстрація";
        registerLink.href = "/profile";
        registerLink.style.display = "";
    }
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

function optionList(values) {
    return values.map(value => `<option value="${escapeAttribute(value)}">${escapeHtml(value)}</option>`).join("");
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('"', "&quot;");
}
