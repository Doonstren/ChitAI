import { db } from "./firebase-config.js";
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=6";
import { BACKEND_URL, escapeHtml, getBookIdFromLocation, renderStars } from "./common.js?v=6";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js?v=6";

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
let userCommentDocId = null;

initAuthUi(async (user) => {
    currentUser = user;
    favoriteIds = await loadFavoriteIds(user);
    commentForm.classList.toggle("hidden", !user);
    commentLoginNote.classList.toggle("hidden", Boolean(user));
    if (currentBook) renderBook(currentBook);
    await loadComments();
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

    if (userCommentDocId) {
        alert("Ви вже залишили відгук. Спочатку видаліть старий, якщо хочете написати новий.");
        return;
    }

    const rating = Number(commentRating.value);

    try {
        const displayName = currentUser.customDisplayName || currentUser.displayName || currentUser.email || "Користувач";

        await addDoc(collection(db, "comments"), {
            bookId,
            userId: currentUser.uid,
            userName: displayName,
            text,
            rating,
            createdAt: serverTimestamp(),
        });

        commentText.value = "";
        await loadComments();
    } catch (error) {
        alert("Помилка при додаванні коментаря: " + error.message);
        console.error(error);
    }
});

commentsList.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest(".btn-delete-comment");
    if (deleteBtn) {
        const commentId = deleteBtn.dataset.id;

        if (confirm("Ви впевнені, що хочете видалити свій відгук?")) {
            await deleteComment(commentId);
        }
        return;
    }

    const editBtn = event.target.closest(".btn-edit-comment");
    if (editBtn) {
        const commentId = editBtn.dataset.id;
        const rating = Number(editBtn.dataset.rating);
        const text = editBtn.dataset.text;

        if (confirm("Відгук буде видалено, і ви зможете опублікувати його оновлену версію. Продовжити?")) {
            await deleteComment(commentId);
            commentText.value = text;
            commentRating.value = rating;
            commentForm.scrollIntoView({ behavior: 'smooth' });
        }
    }
});

async function deleteComment(commentId) {
    try {
        await deleteDoc(doc(db, "comments", commentId));
        await loadComments();
    } catch (error) {
        alert("Помилка видалення: " + error.message);
    }
}

loadBook();

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

    const ratingCount = Number(book.ratingCount || 0);
    const ratingSum = Number(book.ratingSum || 0);
    const ratingHtml = renderStars(ratingCount > 0 ? ratingSum / ratingCount : 0, ratingCount);

    // Breadcrumbs UI
    const breadcrumbs = `
        <nav class="breadcrumbs" aria-label="Breadcrumb" style="grid-column: 1 / -1;">
            <ol style="list-style: none; padding: 0; display: flex; gap: 8px; font-size: 0.9em; color: #888; margin-bottom: 0px;">
                <li><a href="/" style="color: #4CAF50; text-decoration: none;">Головна</a> /</li>
                <li><a href="/" style="color: #4CAF50; text-decoration: none;">Книги</a> /</li>
                <li aria-current="page">${escapeHtml(book.title || "Книга")}</li>
            </ol>
        </nav>
    `;

    bookDetail.innerHTML = `
        ${breadcrumbs}
        ${cover}
        <div>
            <h1 style="margin-top:0;">${escapeHtml(book.title || "Книга")}</h1>
            <p><strong>Автори:</strong> ${escapeHtml(book.author || "")}</p>
            ${ratingHtml}
            <p style="margin-top: 16px;">${escapeHtml(book.description || "")}</p>
            <p>${genres ? `<strong>Жанри:</strong> ${escapeHtml(genres)}` : ""}</p>
            <p>${tags ? `<strong>Теги:</strong> ${escapeHtml(tags)}` : ""}</p>
            <p>${publicationDate ? `<strong>Дата виходу:</strong> ${escapeHtml(publicationDate)}` : ""}</p>
            <p>${book.series ? `<strong>Серія:</strong> ${escapeHtml(book.series)}${book.series_number ? " #" + escapeHtml(book.series_number) : ""}` : ""}</p>
            <div class="card-actions" style="margin-top: 24px;">
                <button id="btn-read-book" class="primary-button" type="button">Читати</button>
                <button class="secondary-button favorite-toggle" type="button" data-book-id="${escapeHtml(book.book_id)}" data-active="${active ? "true" : "false"}">${active ? "♥ У вибраному" : "♡ До вибраного"}</button>
            </div>
        </div>
    `;

    injectJsonLd(book);
}

function injectJsonLd(book) {
    let oldScript = document.getElementById("json-ld-book");
    if (oldScript) oldScript.remove();
    let oldBreadcrumbs = document.getElementById("json-ld-breadcrumbs");
    if (oldBreadcrumbs) oldBreadcrumbs.remove();
    const ratingCount = Number(book.ratingCount || 0);
    const ratingSum = Number(book.ratingSum || 0);

    const breadcrumbsLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [{
            "@type": "ListItem",
            "position": 1,
            "name": "Головна",
            "item": window.location.origin
        },{
            "@type": "ListItem",
            "position": 2,
            "name": "Книги",
            "item": window.location.origin
        },{
            "@type": "ListItem",
            "position": 3,
            "name": book.title || "Книга"
        }]
    };

    const bookLd = {
        "@context": "https://schema.org",
        "@type": "Book",
        "name": book.title,
        "author": {
            "@type": "Person",
            "name": book.author || "Невідомо"
        },
        "url": window.location.href,
        "image": book.cover_url || undefined,
        "description": book.description || undefined,
    };

    if (ratingCount > 0) {
        bookLd.aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": (ratingSum / ratingCount).toFixed(1),
            "reviewCount": ratingCount
        };
    }

    const script1 = document.createElement("script");
    script1.id = "json-ld-breadcrumbs";
    script1.type = "application/ld+json";
    script1.textContent = JSON.stringify(breadcrumbsLd);
    document.head.appendChild(script1);

    const script2 = document.createElement("script");
    script2.id = "json-ld-book";
    script2.type = "application/ld+json";
    script2.textContent = JSON.stringify(bookLd);
    document.head.appendChild(script2);
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
    userCommentDocId = null;

    try {
        const commentsQuery = query(collection(db, "comments"), where("bookId", "==", bookId));
        const snapshot = await getDocs(commentsQuery);
        const comments = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

        const ratingStats = comments.reduce((stats, comment) => {
            const rating = Number(comment.rating || 0);
            if (rating >= 1 && rating <= 5) {
                stats.ratingSum += rating;
                stats.ratingCount += 1;
            }
            return stats;
        }, { ratingSum: 0, ratingCount: 0 });

        if (currentBook) {
            currentBook = { ...currentBook, ...ratingStats };
            renderBook(currentBook);
        }

        if (currentUser) {
            const userComment = comments.find(c => c.userId === currentUser.uid);
            if (userComment) {
                userCommentDocId = userComment.id;
                commentForm.style.display = "none";
                const message = document.createElement("p");
                message.id = "already-commented-note";
                message.textContent = "Ви вже залишили відгук до цієї книги.";
                if (!document.getElementById("already-commented-note")) {
                    commentForm.parentNode.insertBefore(message, commentForm);
                }
            } else {
                commentForm.style.display = "block";
                const msg = document.getElementById("already-commented-note");
                if (msg) msg.remove();
            }
        }

        if (!comments.length) {
            commentsStatus.textContent = "Коментарів поки немає.";
            return;
        }

        commentsStatus.textContent = `Коментарів: ${comments.length}`;
        commentsList.innerHTML = comments.map(comment => {
            const isMine = currentUser && comment.userId === currentUser.uid;
            return `
            <article class="comment">
                <strong>${escapeHtml(comment.userName || "Користувач")}</strong>
                <span class="stars-rating" style="margin-left: 8px; color: #f5c518;">${"★".repeat(Number(comment.rating || 0))}${"☆".repeat(5 - Number(comment.rating || 0))}</span>
                <p>${escapeHtml(comment.text || "")}</p>
                ${isMine ? `
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                    <button class="secondary-button btn-edit-comment" data-id="${escapeHtml(comment.id)}" data-rating="${comment.rating}" data-text="${escapeHtml(comment.text || "")}" style="font-size: 12px; padding: 4px 8px;">Редагувати</button>
                    <button class="secondary-button btn-delete-comment" data-id="${escapeHtml(comment.id)}" data-rating="${comment.rating}" style="font-size: 12px; padding: 4px 8px;">Видалити</button>
                </div>
                ` : ""}
            </article>
        `}).join("");
    } catch (error) {
        commentsStatus.textContent = "Не вдалося завантажити коментарі.";
        console.error(error);
    }
}
