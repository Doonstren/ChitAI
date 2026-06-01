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
import { initAuthUi } from "./auth-ui.js?v=9";
import { BACKEND_URL, applyRatingStats, bookUrl, coverUrl, escapeHtml, getBookIdFromLocation } from "./common.js?v=13";
import { loadFavoriteIds, toggleFavorite } from "./favorites.js?v=9";

const bookStatus = document.getElementById("book-status");
const bookDetail = document.getElementById("book-detail");
const relatedStatus = document.getElementById("related-status");
const relatedBooks = document.getElementById("related-books");
const relatedPrev = document.getElementById("related-prev");
const relatedNext = document.getElementById("related-next");
const commentsTitle = document.getElementById("comments-title");
const commentsStatus = document.getElementById("comments-status");
const commentsList = document.getElementById("comments-list");
const commentForm = document.getElementById("comment-form");
const commentLoginNote = document.getElementById("comment-login-note");
const commentRating = document.getElementById("comment-rating");
const commentText = document.getElementById("comment-text");
const commentTextError = document.getElementById("comment-text-error");
const commentStars = document.getElementById("comment-stars");
const bookBreadcrumbCurrent = document.getElementById("book-breadcrumb-current");
const loginLink = document.querySelector(".hdr-login");
const registerLink = document.querySelector(".hdr-register");

const bookId = getBookIdFromLocation();
let currentUser = null;
let currentBook = null;
let favoriteIds = new Set();
let userCommentDocId = null;
let editingCommentId = null;
let loadedComments = [];
let relatedDrag = null;
let relatedCanSwipe = false;
let relatedSuppressClick = false;
let relatedPointerStartedOnInteractive = false;

initAuthUi(async (user) => {
    currentUser = user;
    if (currentUser) {
        currentUser.customDisplayName = await resolveUserDisplayName(currentUser);
    }
    updateHeaderAuth(user);
    favoriteIds = await loadFavoriteIds(user);
    commentForm.classList.toggle("hidden", !user);
    commentLoginNote.classList.toggle("hidden", Boolean(user));
    if (currentBook) renderBook(currentBook);
    if (currentBook) await loadRelatedBooks(currentBook);
    await loadComments();
});

bookDetail.addEventListener("click", async (event) => {
    if (event.target.closest("#btn-read-book")) {
        window.open(`/reader?id=${encodeURIComponent(bookId)}`, "_blank", "noopener");
        return;
    }

    if (event.target.closest("#btn-download-book")) {
        window.open(`${BACKEND_URL}/api/books/${encodeURIComponent(bookId)}/file`, "_blank", "noopener");
    }
});

relatedBooks.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;
    event.preventDefault();

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    setRelatedFavoriteButton(button, nextActive);
});

relatedBooks.addEventListener("pointerdown", (event) => {
    if (!relatedCanSwipe || event.button !== 0) return;
    relatedPointerStartedOnInteractive = Boolean(event.target.closest("a,button"));
    relatedDrag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        scrollLeft: relatedBooks.scrollLeft,
        moved: false,
    };
});

window.addEventListener("pointermove", (event) => {
    if (!relatedDrag || event.pointerId !== relatedDrag.pointerId) return;
    const delta = event.clientX - relatedDrag.startX;
    if (Math.abs(delta) > 6) {
        relatedDrag.moved = true;
        relatedSuppressClick = true;
        relatedBooks.classList.add("is-dragging");
        if (relatedPointerStartedOnInteractive) {
            event.preventDefault();
        }
    }
    if (!relatedDrag.moved) return;
    event.preventDefault();
    relatedBooks.scrollLeft = relatedDrag.scrollLeft - delta;
});

function endRelatedDrag(event) {
    if (!relatedDrag || event.pointerId !== relatedDrag.pointerId) return;
    relatedBooks.classList.remove("is-dragging");
    relatedDrag = null;
}

window.addEventListener("pointerup", endRelatedDrag);
window.addEventListener("pointercancel", endRelatedDrag);

relatedBooks.addEventListener("click", (event) => {
    if (!relatedSuppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    relatedSuppressClick = false;
}, true);

commentStars.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rating]");
    if (!button) return;
    commentRating.value = button.dataset.rating;
    renderStarInput(Number(commentRating.value));
});

commentText.addEventListener("input", () => {
    if (commentText.value.trim()) showCommentTextError("");
});

commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser || !bookId) return;

    const text = commentText.value.trim();
    if (!text) {
        showCommentTextError("Напишіть відгук перед публікацією.");
        return;
    }
    showCommentTextError("");

    const rating = Number(commentRating.value);
    const displayName = currentUser.customDisplayName
        || currentUser.displayName
        || currentUser.email
        || "Користувач";

    try {
        if (editingCommentId) {
            await deleteDoc(doc(db, "comments", editingCommentId));
        }
        await addDoc(collection(db, "comments"), {
            bookId,
            userId: currentUser.uid,
            userName: displayName,
            text,
            rating,
            createdAt: serverTimestamp(),
        });

        commentText.value = "";
        editingCommentId = null;
        updateSubmitLabel();
        await loadComments();
    } catch (error) {
        alert("Помилка при додаванні відгуку: " + error.message);
        console.error(error);
    }
});

commentsList.addEventListener("click", async (event) => {
    const editBtn = event.target.closest(".btn-edit-comment");
    if (editBtn) {
        startEditComment(editBtn.dataset.id);
        return;
    }

    const deleteBtn = event.target.closest(".btn-delete-comment");
    if (!deleteBtn) return;

    if (confirm("Ви впевнені, що хочете видалити свій відгук?")) {
        await deleteComment(deleteBtn.dataset.id);
    }
});

relatedPrev?.addEventListener("click", () => {
    relatedBooks.scrollBy({ left: -460, behavior: "smooth" });
});
relatedNext?.addEventListener("click", () => {
    relatedBooks.scrollBy({ left: 460, behavior: "smooth" });
});

renderStarInput(Number(commentRating.value || 5));
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
        bookBreadcrumbCurrent.textContent = currentBook.title || "Книга";
        bookStatus.textContent = "";
        renderBook(currentBook);
        await loadRelatedBooks(currentBook);
    } catch (error) {
        bookStatus.textContent = "Не вдалося завантажити книгу.";
        console.error(error);
    }
}

function renderBook(book) {
    const title = book.title || "Книга";
    const genres = Array.isArray(book.genres) ? book.genres : [];
    const ratingCount = Number(book.ratingCount || 0);
    const ratingSum = Number(book.ratingSum || 0);
    const average = ratingCount > 0 ? ratingSum / ratingCount : 0;
    const ratingText = ratingCount > 0 ? `${average.toFixed(1)}/5 (${ratingCount} ${voteWord(ratingCount)})` : "Оцінок поки немає";
    const publicationYear = book.publication_year || extractYear(book.publication_date) || "—";
    const seriesText = formatSeries(book);
    const license = book.license || book.rights_status || "";
    const cover = book.cover_url
        ? `<img class="book-hero-cover" src="${escapeHtml(coverUrl(book.cover_url, 500))}" alt="${escapeHtml(title)}">`
        : `<div class="book-hero-cover book-cover-empty">Без обкладинки</div>`;

    bookDetail.innerHTML = `
        <aside class="book-hero-media">
            ${cover}
            <div class="book-actions">
                <button id="btn-read-book" class="btn btn-primary" type="button">Читати онлайн</button>
                <button id="btn-download-book" class="btn btn-secondary" type="button">Завантажити</button>
            </div>
        </aside>
        <section class="book-hero-info">
            <h1 class="serif">${escapeHtml(title)}</h1>
            ${bookRow("Автор:", book.author || "—")}
            ${bookRow("Оцінка:", ratingText)}
            <div class="book-info-row">
                <strong>Жанр:</strong>
                <div class="book-tags">${genres.map(genre => `<span class="tag">${escapeHtml(genre)}</span>`).join("") || "—"}</div>
            </div>
            ${seriesText ? bookRow("Серія:", seriesText) : ""}
            ${bookRow("Рік видання:", publicationYear)}
            ${license ? bookRow("Ліцензія:", license) : ""}
            <h2 class="serif">Анотація</h2>
            <p class="book-description">${escapeHtml(book.description || "Анотація для цієї книги поки не додана.")}</p>
        </section>
    `;

    injectJsonLd(book);
}

function bookRow(label, value) {
    return `
        <div class="book-info-row">
            <strong>${label}</strong>
            <span>${escapeHtml(value)}</span>
        </div>
    `;
}

async function loadRelatedBooks(book) {
    try {
        const [booksSnapshot, commentsSnapshot] = await Promise.all([
            getDocs(collection(db, "books")),
            getDocs(collection(db, "comments")),
        ]);
        const books = applyRatingStats(
            booksSnapshot.docs.map(item => ({ ...item.data(), book_id: item.id })),
            commentsSnapshot.docs.map(item => item.data())
        );
        const currentGenres = new Set(Array.isArray(book.genres) ? book.genres : []);
        const currentSeries = normalizeText(book.series);
        const related = books
            .filter(item => item.book_id !== book.book_id)
            .map(item => ({
                ...item,
                score: Array.isArray(item.genres) ? item.genres.filter(genre => currentGenres.has(genre)).length : 0,
                sameSeries: Boolean(currentSeries && normalizeText(item.series) === currentSeries),
            }))
            .filter(item => item.sameSeries || item.score > 0)
            .sort((a, b) => Number(b.sameSeries) - Number(a.sameSeries) || b.score - a.score || String(a.title || "").localeCompare(String(b.title || ""), "uk"))
            .slice(0, 12);

        if (!related.length) {
            relatedStatus.textContent = "Схожих книг зі спільною серією або жанрами поки немає.";
            relatedBooks.innerHTML = "";
            setRelatedNavVisible(false);
            return;
        }

        relatedStatus.textContent = "";
        relatedBooks.innerHTML = related.map(renderRelatedCard).join("");
        setRelatedNavVisible(related.length > 5);
    } catch (error) {
        relatedStatus.textContent = "Не вдалося завантажити схожі книги.";
        setRelatedNavVisible(false);
        console.error(error);
    }
}

function setRelatedNavVisible(visible) {
    relatedCanSwipe = visible;
    if (!visible) {
        relatedBooks.classList.remove("is-dragging");
        relatedSuppressClick = false;
        relatedDrag = null;
    }
    relatedBooks.classList.toggle("can-swipe", visible);
    relatedPrev?.classList.toggle("hidden", !visible);
    relatedNext?.classList.toggle("hidden", !visible);
}

function renderRelatedCard(book) {
    const id = book.book_id || "";
    const title = book.title || "Книга";
    const author = book.author || "";
    const genres = Array.isArray(book.genres) ? book.genres.slice(0, 4) : [];
    const count = Number(book.ratingCount || 0);
    const rating = count > 0 ? (Number(book.ratingSum || 0) / count).toFixed(1) : "—";
    const fav = favoriteIds.has(id);
    const cover = book.cover_url
        ? `<a class="cover" href="${bookUrl(id)}" draggable="false" style="background-image:url('${escapeHtml(coverUrl(book.cover_url, 300))}')"></a>`
        : `<a class="cover" href="${bookUrl(id)}" draggable="false"><div class="cover-gen"><div class="ct serif">${escapeHtml(title)}</div><div class="ca">${escapeHtml(author)}</div></div></a>`;

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
            <div class="tags">${genres.map(g => `<span class="tag">${escapeHtml(g)}</span>`).join("")}</div>
            <div class="cta"><a class="btn btn-primary btn-block" draggable="false" href="${bookUrl(id)}">Детальніше</a></div>
        </article>`;
}

async function loadComments() {
    if (!bookId) return;

    commentsStatus.textContent = "Завантаження відгуків...";
    commentsList.innerHTML = "";
    userCommentDocId = null;
    loadedComments = [];

    try {
        const commentsQuery = query(collection(db, "comments"), where("bookId", "==", bookId));
        const snapshot = await getDocs(commentsQuery);
        const comments = snapshot.docs
            .map(item => ({ id: item.id, ...item.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        loadedComments = comments;

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

        updateCommentFormState(comments);
        commentsTitle.textContent = `Відгуки читачів (${comments.length})`;

        if (!comments.length) {
            commentsStatus.textContent = "Відгуків поки немає.";
            return;
        }

        commentsStatus.textContent = "";
        commentsList.innerHTML = comments.map(renderComment).join("");
    } catch (error) {
        commentsStatus.textContent = "Не вдалося завантажити відгуки.";
        console.error(error);
    }
}

function updateCommentFormState(comments) {
    document.getElementById("already-commented-note")?.remove();
    if (!currentUser) return;

    const userComment = comments.find(comment => comment.userId === currentUser.uid);
    if (userComment && editingCommentId !== userComment.id) {
        userCommentDocId = userComment.id;
        commentForm.style.display = "none";
        const message = document.createElement("p");
        message.id = "already-commented-note";
        message.className = "book-muted";
        message.textContent = "Ви вже залишили відгук до цієї книги. Його можна відредагувати нижче.";
        commentForm.parentNode.insertBefore(message, commentForm);
        return;
    }

    commentForm.style.display = "flex";
    updateSubmitLabel();
}

function renderComment(comment) {
    const isMine = currentUser && comment.userId === currentUser.uid;
    const rating = Number(comment.rating || 0);
    const date = formatDate(comment.createdAt);
    const userName = isMine
        ? (currentUser.customDisplayName || currentUser.displayName || comment.userName || "Користувач")
        : (comment.userName || "Користувач");

    return `
        <article class="review-card" data-comment-id="${escapeHtml(comment.id)}">
            <header>
                <div><strong>${escapeHtml(userName)}</strong><span>пише:</span></div>
                <time>${escapeHtml(date)}</time>
            </header>
            <p>${escapeHtml(comment.text || "")}</p>
            <footer>
                <strong>Оцінка:</strong>
                <span class="review-stars">${renderStars(rating)}</span>
                ${isMine ? `<button class="btn-edit-comment" type="button" data-id="${escapeHtml(comment.id)}">Редагувати</button><button class="btn-delete-comment" type="button" data-id="${escapeHtml(comment.id)}">Видалити</button>` : ""}
            </footer>
        </article>
    `;
}

function startEditComment(commentId) {
    const comment = loadedComments.find(item => item.id === commentId);
    if (!comment || !currentUser || comment.userId !== currentUser.uid) return;

    document.getElementById("already-commented-note")?.remove();
    editingCommentId = commentId;
    commentsList.querySelectorAll(".review-card").forEach(card => {
        card.classList.toggle("hidden", card.dataset.commentId === commentId);
    });
    commentText.value = comment.text || "";
    commentRating.value = String(Math.max(1, Math.min(5, Number(comment.rating || 5))));
    renderStarInput(Number(commentRating.value));
    showCommentTextError("");
    commentForm.classList.remove("hidden");
    commentForm.style.display = "flex";
    updateSubmitLabel();
    commentForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateSubmitLabel() {
    const submit = commentForm.querySelector(".review-submit");
    if (submit) submit.textContent = editingCommentId ? "Оновити" : "Опублікувати";
}

function showCommentTextError(message) {
    if (!commentText || !commentTextError) return;
    commentText.classList.toggle("is-error", Boolean(message));
    commentTextError.textContent = message;
}

async function deleteComment(commentId) {
    try {
        await deleteDoc(doc(db, "comments", commentId));
        if (editingCommentId === commentId) {
            editingCommentId = null;
            commentText.value = "";
            updateSubmitLabel();
        }
        await loadComments();
    } catch (error) {
        alert("Помилка видалення: " + error.message);
    }
}

function setRelatedFavoriteButton(button, active) {
    button.dataset.active = active ? "true" : "false";
    const icon = button.querySelector(".material-symbols-outlined");
    if (icon) icon.textContent = active ? "check_circle" : "add_circle";
    button.style.color = active ? "var(--orange)" : "";
    button.title = active ? "У вибраному" : "До вибраного";
}

function renderStarInput(activeRating) {
    [...commentStars.querySelectorAll("button")].forEach((button) => {
        button.classList.toggle("active", Number(button.dataset.rating) <= activeRating);
    });
}

function renderStars(rating) {
    const safeRating = Math.max(0, Math.min(5, Math.round(rating)));
    return Array.from({ length: 5 }, (_, index) => (
        `<span class="${index < safeRating ? "active" : ""}">★</span>`
    )).join("");
}

function voteWord(count) {
    const abs = Math.abs(Number(count));
    const lastTwo = abs % 100;
    const last = abs % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return "голосів";
    if (last === 1) return "голос";
    if (last >= 2 && last <= 4) return "голоси";
    return "голосів";
}

function formatSeries(book) {
    const series = String(book.series || "").trim();
    if (!series) return "";
    const number = String(book.series_number || "").trim();
    return number ? `${series} #${number}` : series;
}

function normalizeText(value) {
    return String(value || "").trim().toLocaleLowerCase("uk-UA");
}

async function resolveUserDisplayName(user) {
    if (!user) return "";
    if (user.customDisplayName && user.customDisplayName !== user.email) return user.customDisplayName;

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const profileName = userDoc.exists() ? String(userDoc.data().displayName || "").trim() : "";
        if (profileName) return profileName;
    } catch (error) {
        console.warn("Could not load user displayName", error);
    }

    if (user.displayName && user.displayName !== user.email) return user.displayName;
    const cachedUid = localStorage.getItem("profileDisplayNameUid");
    const cachedName = localStorage.getItem("profileDisplayName");
    if (cachedUid === user.uid && cachedName) return cachedName;
    return user.email || "Користувач";
}

function formatDate(timestamp) {
    const date = timestamp?.toDate?.();
    if (!date) return "";
    return new Intl.DateTimeFormat("uk-UA", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(date);
}

function extractYear(value) {
    const match = String(value || "").match(/\d{4}/);
    return match ? match[0] : "";
}

function updateHeaderAuth(user) {
    if (!loginLink || !registerLink) return;
    if (user) {
        loginLink.textContent = "Профіль";
        loginLink.href = "/profile";
        registerLink.style.display = "none";
    } else {
        loginLink.textContent = "Вхід";
        registerLink.textContent = "Реєстрація";
        loginLink.href = "/login";
        registerLink.href = "/login#register";
        registerLink.style.display = "";
    }
    loginLink.classList.remove("auth-link-pending");
    registerLink.classList.remove("auth-link-pending");
}

function injectJsonLd(book) {
    document.getElementById("json-ld-book")?.remove();
    document.getElementById("json-ld-breadcrumbs")?.remove();

    const ratingCount = Number(book.ratingCount || 0);
    const ratingSum = Number(book.ratingSum || 0);
    const breadcrumbsLd = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [{
            "@type": "ListItem",
            "position": 1,
            "name": "Головна",
            "item": window.location.origin,
        }, {
            "@type": "ListItem",
            "position": 2,
            "name": "Каталог",
            "item": `${window.location.origin}/catalog`,
        }, {
            "@type": "ListItem",
            "position": 3,
            "name": book.title || "Книга",
        }],
    };
    const bookLd = {
        "@context": "https://schema.org",
        "@type": "Book",
        "name": book.title,
        "author": {
            "@type": "Person",
            "name": book.author || "Невідомо",
        },
        "url": window.location.href,
        "image": book.cover_url || undefined,
        "description": book.description || undefined,
    };

    if (ratingCount > 0) {
        bookLd.aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": (ratingSum / ratingCount).toFixed(1),
            "reviewCount": ratingCount,
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

