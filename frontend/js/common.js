export const BACKEND_URL = "http://localhost:8000";

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

    return `
        <article class="book-card" data-book-id="${escapeHtml(bookId)}">
            <a href="${bookUrl(bookId)}">${cover}</a>
            <div class="book-card-body">
                <h3><a href="${bookUrl(bookId)}">${escapeHtml(title)}</a></h3>
                <p class="book-card-author">${escapeHtml(book.author || "")}</p>
                <p class="book-card-description">${escapeHtml(book.description || "")}</p>
                <div class="book-card-meta">
                    ${genres ? `<span>${escapeHtml(genres)}</span>` : ""}
                    ${publicationDate ? `<span>${escapeHtml(publicationDate)}</span>` : ""}
                    ${series ? `<span>${escapeHtml(series)}</span>` : ""}
                </div>
                <div class="card-actions">
                    <a class="primary-button" href="${bookUrl(bookId)}">Відкрити</a>
                    <button class="secondary-button favorite-toggle" type="button" data-book-id="${escapeHtml(bookId)}" data-active="${favoriteActive}">${favoriteLabel}</button>
                </div>
            </div>
        </article>
    `;
}

export function normalizeBook(docSnapshot) {
    return {
        ...docSnapshot.data(),
        book_id: docSnapshot.id,
    };
}
