import { db } from "./firebase-config.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js";
import { escapeHtml, normalizeBook, renderBookCard } from "./common.js";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js";

const profileContent = document.getElementById("profile-content");
const profileLoginNote = document.getElementById("profile-login-note");
const profileEmail = document.getElementById("profile-email");
const favoritesStatus = document.getElementById("favorites-status");
const favoriteBooks = document.getElementById("favorite-books");
const threadsStatus = document.getElementById("threads-status");
const profileThreadList = document.getElementById("profile-thread-list");

let currentUser = null;
let favoriteIds = new Set();

initAuthUi(async (user) => {
    currentUser = user;
    profileContent.classList.toggle("hidden", !user);
    profileLoginNote.classList.toggle("hidden", Boolean(user));

    if (!user) return;

    profileEmail.textContent = `Email: ${user.email}`;
    await loadProfileFavorites();
    await loadProfileThreads();
});

favoriteBooks.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    updateFavoriteButton(button, nextActive);
    await loadProfileFavorites();
});

async function loadProfileFavorites() {
    if (!currentUser) return;

    favoritesStatus.textContent = "Завантаження...";
    favoriteBooks.innerHTML = "";
    favoriteIds = await loadFavoriteIds(currentUser);

    if (!favoriteIds.size) {
        favoritesStatus.textContent = "Вибраних книг поки немає.";
        return;
    }

    const books = [];
    for (const bookId of favoriteIds) {
        const snapshot = await getDoc(doc(db, "books", bookId));
        if (snapshot.exists()) books.push(normalizeBook(snapshot));
    }

    favoritesStatus.textContent = `Вибраних книг: ${books.length}`;
    favoriteBooks.innerHTML = books.map(book => renderBookCard(book, favoriteIds)).join("");
}

async function loadProfileThreads() {
    if (!currentUser) return;

    threadsStatus.textContent = "Завантаження...";
    profileThreadList.innerHTML = "";

    const threadsQuery = query(
        collection(db, "users", currentUser.uid, "chatThreads"),
        orderBy("updatedAt", "desc")
    );
    const snapshot = await getDocs(threadsQuery);
    const threads = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));

    if (!threads.length) {
        threadsStatus.textContent = "Історія чату порожня.";
        return;
    }

    threadsStatus.textContent = `Розмов: ${threads.length}`;
    profileThreadList.innerHTML = threads.map(thread => `
        <article class="chat-thread">
            <a href="/chat?thread=${encodeURIComponent(thread.id)}">${escapeHtml(thread.title || "Розмова")}</a>
        </article>
    `).join("");
}
