import { auth, db } from "./firebase-config.js";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js";
import { BACKEND_URL, escapeHtml, getBookIdFromLocation } from "./common.js";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js";

const bookStatus = document.getElementById("book-status");
const bookDetail = document.getElementById("book-detail");
const readerSection = document.getElementById("reader-section");
const readerStatus = document.getElementById("reader-status");
const readerContent = document.getElementById("reader-content");
const commentsStatus = document.getElementById("comments-status");
const commentsList = document.getElementById("comments-list");
const commentForm = document.getElementById("comment-form");
const commentLoginNote = document.getElementById("comment-login-note");
const commentRating = document.getElementById("comment-rating");
const commentText = document.getElementById("comment-text");

const bookId = getBookIdFromLocation();
let currentUser = null;
let currentBook = null;
let favoriteIds = new Set();

initAuthUi(async (user) => {
    currentUser = user;
    favoriteIds = await loadFavoriteIds(user);
    commentForm.classList.toggle("hidden", !user);
    commentLoginNote.classList.toggle("hidden", Boolean(user));
    if (currentBook) renderBook(currentBook);
});

bookDetail.addEventListener("click", async (event) => {
    const favoriteButton = event.target.closest(".favorite-toggle");
    if (favoriteButton) {
        const active = favoriteButton.dataset.active === "true";
        const nextActive = await toggleFavorite(currentUser, favoriteButton.dataset.bookId, active);
        if (nextActive) favoriteIds.add(favoriteButton.dataset.bookId);
        else favoriteIds.delete(favoriteButton.dataset.bookId);
        updateFavoriteButton(favoriteButton, nextActive);
        return;
    }

    const readButton = event.target.closest("#btn-read-book");
    if (readButton) {
        loadContent();
    }
});

commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser || !bookId) return;

    const text = commentText.value.trim();
    if (!text) return;

    await addDoc(collection(db, "comments"), {
        bookId,
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || "Користувач",
        text,
        rating: Number(commentRating.value),
        createdAt: serverTimestamp(),
    });

    commentText.value = "";
    await loadComments();
});

loadBook();
loadComments();

async function loadBook() {
    if (!bookId) {
        bookStatus.textContent = "Книгу не знайдено.";
        return;
    }

    try {
        const snapshot = await getDoc(doc(db, "books", bookId));
        if (!snapshot.exists()) {
            bookStatus.textContent = "Книгу не знайдено.";
            return;
        }

        currentBook = { ...snapshot.data(), book_id: snapshot.id };
        document.title = `${currentBook.title || "Книга"} — ЧитAI`;
        bookStatus.textContent = "";
        renderBook(currentBook);
    } catch (error) {
        bookStatus.textContent = "Не вдалося завантажити книгу.";
        console.error(error);
    }
}

function renderBook(book) {
    const genres = Array.isArray(book.genres) ? book.genres.join(", ") : "";
    const tags = Array.isArray(book.tags) ? book.tags.join(", ") : "";
    const publicationDate = book.publication_date || book.publication_year || "";
    const cover = book.cover_url
        ? `<img class="book-detail-cover" src="${escapeHtml(book.cover_url)}" alt="${escapeHtml(book.title)}">`
        : `<div class="book-detail-cover book-card-cover--empty">Без обкладинки</div>`;
    const active = favoriteIds.has(book.book_id);

    bookDetail.innerHTML = `
        ${cover}
        <div>
            <h1>${escapeHtml(book.title || "Книга")}</h1>
            <p>${escapeHtml(book.author || "")}</p>
            <p>${escapeHtml(book.description || "")}</p>
            <p>${genres ? `Жанри: ${escapeHtml(genres)}` : ""}</p>
            <p>${tags ? `Теги: ${escapeHtml(tags)}` : ""}</p>
            <p>${publicationDate ? `Дата виходу: ${escapeHtml(publicationDate)}` : ""}</p>
            <p>${book.series ? `Серія: ${escapeHtml(book.series)}${book.series_number ? " #" + escapeHtml(book.series_number) : ""}` : ""}</p>
            <div class="card-actions">
                <button id="btn-read-book" class="primary-button" type="button">Читати</button>
                <button class="secondary-button favorite-toggle" type="button" data-book-id="${escapeHtml(book.book_id)}" data-active="${active ? "true" : "false"}">${active ? "♥ У вибраному" : "♡ До вибраного"}</button>
            </div>
        </div>
    `;
}

async function loadContent() {
    readerSection.classList.remove("hidden");
    readerStatus.textContent = "Завантаження тексту...";
    readerContent.textContent = "";

    try {
        const response = await fetch(`${BACKEND_URL}/api/books/${encodeURIComponent(bookId)}/content`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        readerStatus.textContent = "";
        readerContent.textContent = data.content || "Текст книги порожній.";
    } catch (error) {
        readerStatus.textContent = "Не вдалося завантажити текст. Бекенд має бути запущений.";
        console.error(error);
    }
}

async function loadComments() {
    if (!bookId) return;

    commentsStatus.textContent = "Завантаження коментарів...";
    commentsList.innerHTML = "";

    try {
        const commentsQuery = query(collection(db, "comments"), where("bookId", "==", bookId));
        const snapshot = await getDocs(commentsQuery);
        const comments = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        if (!comments.length) {
            commentsStatus.textContent = "Коментарів поки немає.";
            return;
        }

        const avg = comments.reduce((sum, item) => sum + Number(item.rating || 0), 0) / comments.length;
        commentsStatus.textContent = `Коментарів: ${comments.length}. Середня оцінка: ${avg.toFixed(1)}`;
        commentsList.innerHTML = comments.map(comment => `
            <article class="comment">
                <strong>${escapeHtml(comment.userName || "Користувач")}</strong>
                <span>Оцінка: ${escapeHtml(comment.rating || "")}</span>
                <p>${escapeHtml(comment.text || "")}</p>
            </article>
        `).join("");
    } catch (error) {
        commentsStatus.textContent = "Не вдалося завантажити коментарі.";
        console.error(error);
    }
}
