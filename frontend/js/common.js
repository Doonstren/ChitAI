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

// Domains wsrv.nl refuses to fetch ("Domain or TLD blocked by policy").
// Covers from these hosts are served directly, without the proxy.
const COVER_PROXY_BLOCKLIST = ["knigoed.club"];

/**
 * Proxy an external cover image through wsrv.nl to resize + convert to WebP.
 * Covers are hot-linked from third-party sites, so we can't resize at source.
 * wsrv.nl downloads, caches (CDN), resizes and re-encodes them on the fly.
 *
 * Hosts in COVER_PROXY_BLOCKLIST are returned untouched because wsrv.nl
 * rejects them by policy.
 *
 * @param {string} url   Original cover URL.
 * @param {number} width Target width in px (height auto, aspect kept).
 * @returns {string} Optimised URL, or "" if no source url.
 */
export function coverUrl(url, width = 300) {
    if (!url) return "";
    // Already-relative / same-origin assets don't need proxying.
    if (!/^https?:\/\//i.test(url)) return url;

    // Skip proxying for hosts wsrv.nl blocks — return the original URL.
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (COVER_PROXY_BLOCKLIST.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) {
            return url;
        }
    } catch {
        return url; // malformed URL — don't risk proxying
    }

    const params = new URLSearchParams({
        url,
        w: String(width),
        output: "webp",
        q: "80",
        we: "", // "without enlargement" — never upscale small covers
    });
    return `https://wsrv.nl/?${params.toString()}`;
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
    const author = book.author || "";
    const genres = Array.isArray(book.genres) ? book.genres.slice(0, 4) : [];
    const publicationDate = book.publication_date || book.publication_year || "";
    const cover = book.cover_url
        ? `<a class="wide-cover" href="${bookUrl(bookId)}"><img src="${escapeHtml(coverUrl(book.cover_url, 372))}" alt="${escapeHtml(title)}" loading="lazy" width="186" height="292"></a>`
        : `<a class="wide-cover wide-cover-empty" href="${bookUrl(bookId)}"><span>${escapeHtml(title)}</span></a>`;
    const favoriteActive = favoriteIds.has(bookId) ? "true" : "false";
    const description = book.description || book.reason || book.recommendation || "";
    const ratingCount = Number(book.ratingCount || 0);
    const ratingSum = Number(book.ratingSum || 0);
    const rating = ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : "";
    const ratingLine = rating ? `${rating}/5 (${pluralizeReviews(ratingCount)})` : "Оцінок поки немає";

    return `
        <article class="bcard-wide" data-book-id="${escapeHtml(bookId)}">
            ${cover}
            <div class="bw-body">
                <div class="bw-head">
                    <h3><a href="${bookUrl(bookId)}">${escapeHtml(title)}</a></h3>
                    <button class="addbtn favorite-toggle" type="button" data-book-id="${escapeHtml(bookId)}" data-active="${favoriteActive}" title="${favoriteActive === "true" ? "У вибраному" : "До вибраного"}" style="${favoriteActive === "true" ? "color:var(--orange)" : ""}">
                        <span class="material-symbols-outlined">${favoriteActive === "true" ? "check_circle" : "add_circle"}</span>
                    </button>
                </div>
                <dl class="bw-meta">
                    ${author ? `<div><dt>Автор:</dt><dd>${escapeHtml(author)}</dd></div>` : ""}
                    ${genres.length ? `<div><dt>Жанр:</dt><dd class="bw-tags">${genres.map(genre => `<span class="tag">${escapeHtml(genre)}</span>`).join("")}</dd></div>` : ""}
                    ${publicationDate ? `<div><dt>Рік видання:</dt><dd>${escapeHtml(publicationDate)}</dd></div>` : ""}
                    <div><dt>Оцінка:</dt><dd>${escapeHtml(ratingLine)}</dd></div>
                </dl>
                <p class="bw-desc">${escapeHtml(description)}</p>
                <div class="bw-cta">
                    <a class="btn btn-primary" href="${bookUrl(bookId)}">Детальніше</a>
                </div>
            </div>
        </article>`;
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
