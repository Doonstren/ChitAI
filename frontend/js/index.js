import { db } from "./firebase-config.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=6";
import { applyRatingStats, normalizeBook, renderBookCard } from "./common.js?v=6";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js?v=6";

const catalogStatus = document.getElementById("catalog-status");
const catalogBooks = document.getElementById("catalog-books");

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
        renderCatalog();
    } catch (error) {
        catalogStatus.textContent = "Не вдалося завантажити каталог.";
        console.error(error);
    }
}

function renderCatalog() {
    if (!cachedBooks.length) {
        catalogStatus.textContent = "Каталог поки порожній.";
        catalogBooks.innerHTML = "";
        return;
    }

    catalogStatus.textContent = `Книг у каталозі: ${cachedBooks.length}`;
    catalogBooks.innerHTML = cachedBooks.map(book => renderBookCard(book, favoriteIds)).join("");
}
