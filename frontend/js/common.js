export const BACKEND_URL = "https://chitai.adun.cc";

export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function bookUrl(bookId) {
    return `/books/${encodeURIComponent(bookId)}`;
}

export function getBookIdFromLocation() {
    const params = new URLSearchParams(window.location.search);
    const explicitId = params.get("id");
    if (explicitId) return explicitId;

    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] === "books" && parts[1]) {
        return decodeURIComponent(parts[1]);
    }
    return "";
}

export function renderBookCard(book, favoriteIds = new Set()) {
    const bookId = book.book_id || "";
    const title = book.title || "Книга";
    const genres = Array.isArray(book.genres) ? book.genres.join(", ") : "";
    const publicationDate = book.publication_date || book.publication_year || "";
    const series = book.series
        ? `${book.series}${book.series_number ? " #" + book.series_number : ""}`
        : "";
    const cover = book.cover_url
        ? `<img class="book-card-cover" src="${escapeHtml(book.cover_url)}" alt="${escapeHtml(title)}">`
        : `<div class="book-card-cover book-card-cover--empty">Без обкладинки</div>`;
    const favoriteActive = favoriteIds.has(bookId) ? "true" : "false";
    const favoriteLabel = favoriteIds.has(bookId) ? "♥ У вибраному" : "♡ До вибраного";

    const ratingCount = Number(book.ratingCount || 0);
    const ratingSum = Number(book.ratingSum || 0);
    const ratingHtml = renderStars(ratingCount > 0 ? ratingSum / ratingCount : 0, ratingCount);

    return `
        <article class="book-card" data-book-id="${escapeHtml(bookId)}">
            <a href="${bookUrl(bookId)}">${cover}</a>
            <div class="book-card-body">
                <h3><a href="${bookUrl(bookId)}">${escapeHtml(title)}</a></h3>
                <p class="book-card-author">${escapeHtml(book.author || "")}</p>
                <div class="book-card-meta">
                    ${genres ? `<span>${escapeHtml(genres)}</span>` : ""}
                    ${publicationDate ? `<span>${escapeHtml(publicationDate)}</span>` : ""}
                    ${series ? `<span>${escapeHtml(series)}</span>` : ""}
                </div>
                ${ratingHtml}
                <p class="book-card-description">${escapeHtml(book.description || "")}</p>
                <div class="card-actions">
                    <a class="primary-button" href="${bookUrl(bookId)}">Відкрити</a>
                    <button class="secondary-button favorite-toggle" type="button" data-book-id="${escapeHtml(bookId)}" data-active="${favoriteActive}">${favoriteLabel}</button>
                </div>
            </div>
        </article>
    `;
}

export function pluralizeReviews(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return `${count} відгук`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} відгуки`;
    return `${count} відгуків`;
}

export function renderStars(average, count) {
    if (count === 0) {
        return `<div class="stars-rating">☆☆☆☆☆ <span class="rating-text">Оцінок поки немає</span></div>`;
    }
    const rounded = Math.max(0, Math.min(5, Math.round(average)));
    const stars = "★".repeat(rounded) + "☆".repeat(5 - rounded);
    const formattedAvg = average.toFixed(1);
    const countText = pluralizeReviews(count);

    return `<div class="stars-rating">${stars} <span class="rating-text">${formattedAvg} (${countText})</span></div>`;
}

export function applyRatingStats(books, comments) {
    const statsByBook = new Map();
    comments.forEach((comment) => {
        const rating = Number(comment.rating || 0);
        if (!comment.bookId || rating < 1 || rating > 5) return;

        const stats = statsByBook.get(comment.bookId) || { ratingSum: 0, ratingCount: 0 };
        stats.ratingSum += rating;
        stats.ratingCount += 1;
        statsByBook.set(comment.bookId, stats);
    });

    return books.map((book) => ({
        ...book,
        ...(statsByBook.get(book.book_id) || { ratingSum: 0, ratingCount: 0 }),
    }));
}

export function normalizeBook(docSnapshot) {
    return {
        ...docSnapshot.data(),
        book_id: docSnapshot.id,
    };
}
