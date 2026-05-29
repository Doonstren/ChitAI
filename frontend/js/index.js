import { db } from "./firebase-config.js";
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=9";
import { applyRatingStats, normalizeBook, renderBookCard } from "./common.js?v=9";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js?v=9";

const homeStatus = document.getElementById("home-status");
const homeBooks = document.getElementById("home-books");

let currentUser = null;
let favoriteIds = new Set();
let cachedBooks = [];

initAuthUi(async (user) => {
    currentUser = user;
    favoriteIds = await loadFavoriteIds(user);
    renderHomeBooks();
});

homeBooks.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    updateFavoriteButton(button, nextActive);
});

loadHomeBooks();

async function loadHomeBooks() {
    homeStatus.textContent = "Завантаження книг...";
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

    homeStatus.textContent = `Книг у каталозі: ${cachedBooks.length}`;
    homeBooks.innerHTML = cachedBooks.map(book => renderBookCard(book, favoriteIds)).join("");
}
