import { db } from "./firebase-config.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=7";
import { applyRatingStats, normalizeBook, renderBookCard } from "./common.js?v=7";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js?v=7";

const catalogStatus = document.getElementById("catalog-status");
const catalogBooks = document.getElementById("catalog-books");
const searchInput = document.getElementById("catalog-search");
const genreFilter = document.getElementById("genre-filter");
const authorFilter = document.getElementById("author-filter");
const resetFilters = document.getElementById("reset-filters");

let currentUser = null;
let favoriteIds = new Set();
let cachedBooks = [];

initAuthUi(async (user) => {
    currentUser = user;
    favoriteIds = await loadFavoriteIds(user);
    renderCatalog();
});

catalogBooks.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    updateFavoriteButton(button, nextActive);
});

[searchInput, genreFilter, authorFilter].forEach((element) => {
    element.addEventListener("input", renderCatalog);
});

resetFilters.addEventListener("click", () => {
    searchInput.value = "";
    genreFilter.value = "";
    authorFilter.value = "";
    renderCatalog();
});

loadCatalog();

async function loadCatalog() {
    catalogStatus.textContent = "Завантаження каталогу...";
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

    genreFilter.innerHTML = `<option value="">Усі жанри</option>${optionList([...genres].sort())}`;
    authorFilter.innerHTML = `<option value="">Усі автори</option>${optionList([...authors].sort())}`;
}

function optionList(values) {
    return values.map(value => `<option value="${escapeAttribute(value)}">${escapeText(value)}</option>`).join("");
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

    catalogStatus.textContent = `Знайдено книг: ${filteredBooks.length}`;
    catalogBooks.innerHTML = filteredBooks.map(book => renderBookCard(book, favoriteIds)).join("");
}

function escapeText(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
    return escapeText(value).replaceAll('"', "&quot;");
}
