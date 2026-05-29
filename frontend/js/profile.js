import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=6";
import { applyRatingStats, escapeHtml, normalizeBook, renderBookCard } from "./common.js?v=6";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js?v=6";

const profileContent = document.getElementById("profile-content");
const profileLoginNote = document.getElementById("profile-login-note");
const profileEmail = document.getElementById("profile-email");
const favoritesStatus = document.getElementById("favorites-status");
const favoriteBooks = document.getElementById("favorite-books");
const threadsStatus = document.getElementById("threads-status");
const profileThreadList = document.getElementById("profile-thread-list");
const reviewsStatus = document.getElementById("reviews-status");
const profileReviewsList = document.getElementById("profile-reviews-list");

let currentUser = null;
let favoriteIds = new Set();

initAuthUi(async (user) => {
    currentUser = user;
    profileContent.classList.toggle("hidden", !user);
    profileLoginNote.classList.toggle("hidden", Boolean(user));

    if (!user) return;

    // Fix displayName to match nickname
    const displayName = currentUser.customDisplayName || currentUser.displayName || user.email;
    profileEmail.textContent = `Email: ${user.email} | Нікнейм: ${displayName}`;

    await loadProfileFavorites();
    await loadProfileThreads();
    await loadProfileReviews();
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

if (profileReviewsList) {
    profileReviewsList.addEventListener("click", async (event) => {
        const deleteBtn = event.target.closest(".btn-delete-comment");
        if (!deleteBtn) return;

        const commentId = deleteBtn.dataset.id;
        if (confirm("Ви впевнені, що хочете видалити свій відгук?")) {
            try {
                await deleteDoc(doc(db, "comments", commentId));
                await loadProfileReviews();
                await loadProfileFavorites();
            } catch (error) {
                alert("Помилка видалення: " + error.message);
            }
        }
    });
}

async function loadProfileFavorites() {
    if (!currentUser) return;

    favoritesStatus.textContent = "Завантаження...";
    favoriteBooks.innerHTML = "";
    favoriteIds = await loadFavoriteIds(currentUser);

    if (!favoriteIds.size) {
        favoritesStatus.textContent = "Вибраних книг поки немає.";
        return;
    }

    const [commentsSnapshot] = await Promise.all([
        getDocs(collection(db, "comments")),
    ]);
    const comments = commentsSnapshot.docs.map(item => item.data());
    const books = [];
    for (const bookId of favoriteIds) {
        const snapshot = await getDoc(doc(db, "books", bookId));
        if (snapshot.exists()) books.push(normalizeBook(snapshot));
    }

    favoritesStatus.textContent = `Вибраних книг: ${books.length}`;
    favoriteBooks.innerHTML = applyRatingStats(books, comments)
        .map(book => renderBookCard(book, favoriteIds))
        .join("");
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
        <article class="chat-thread" style="display: flex; gap: 8px;">
            <a href="/chat?thread=${encodeURIComponent(thread.id)}" style="flex:1;">${escapeHtml(thread.title || "Розмова")}</a>
        </article>
    `).join("");
}

async function loadProfileReviews() {
    if (!currentUser || !reviewsStatus || !profileReviewsList) return;

    reviewsStatus.textContent = "Завантаження...";
    profileReviewsList.innerHTML = "";

    try {
        const commentsQuery = query(collection(db, "comments"), where("userId", "==", currentUser.uid));
        const snapshot = await getDocs(commentsQuery);
        const comments = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        if (!comments.length) {
            reviewsStatus.textContent = "Відгуків поки немає.";
            return;
        }

        // Fetch book titles for comments
        const bookCache = {};
        for (const comment of comments) {
            if (!bookCache[comment.bookId]) {
                const bookDoc = await getDoc(doc(db, "books", comment.bookId));
                if (bookDoc.exists()) {
                    bookCache[comment.bookId] = bookDoc.data().title || "Книга";
                } else {
                    bookCache[comment.bookId] = "Невідома книга";
                }
            }
        }

        reviewsStatus.textContent = `Відгуків: ${comments.length}`;
        profileReviewsList.innerHTML = comments.map(comment => `
            <article class="comment">
                <strong><a href="/books/${encodeURIComponent(comment.bookId)}">${escapeHtml(bookCache[comment.bookId])}</a></strong>
                <span class="stars-rating" style="margin-left: 8px; color: #f5c518;">${"★".repeat(comment.rating)}${"☆".repeat(5 - comment.rating)}</span>
                <p>${escapeHtml(comment.text || "")}</p>
                <button class="secondary-button btn-delete-comment" data-id="${escapeHtml(comment.id)}" data-rating="${comment.rating}" data-book-id="${escapeHtml(comment.bookId)}" style="font-size: 12px; padding: 4px 8px; margin-top: 8px;">Видалити відгук</button>
            </article>
        `).join("");
    } catch (error) {
        reviewsStatus.textContent = "Не вдалося завантажити відгуки.";
        console.error(error);
    }
}
