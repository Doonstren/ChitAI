import { auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase-config.js';
import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Змініть на домен Cloudflare, коли підключите його до Proxmox
const BACKEND_URL = 'http://localhost:8000';

document.addEventListener("DOMContentLoaded", () => {
    // Елементи Auth
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const btnLogin = document.getElementById("btn-login");
    const btnRegister = document.getElementById("btn-register");
    const btnLogout = document.getElementById("btn-logout");
    const authStatus = document.getElementById("auth-status");

    // Елементи Чату
    const chatInput = document.getElementById("chat-input");
    const btnSend = document.getElementById("btn-send");
    const chatHistory = document.getElementById("chat-history");
    const chatSection = document.getElementById("chat-section");

    // Елементи каталогу
    const catalogSection = document.getElementById("catalog-section");
    const catalogStatus = document.getElementById("catalog-status");
    const catalogBooks = document.getElementById("catalog-books");

    // Елементи читалки
    const readerSection = document.getElementById("reader-section");
    const btnReaderBack = document.getElementById("btn-reader-back");
    const readerTitle = document.getElementById("reader-title");
    const readerAuthor = document.getElementById("reader-author");
    const readerStatus = document.getElementById("reader-status");
    const readerContent = document.getElementById("reader-content");

    let currentUser = null;

    // Стан авторизації
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            authStatus.textContent = `Авторизовано як: ${user.email}`;
            emailInput.style.display = 'none';
            passwordInput.style.display = 'none';
            btnLogin.style.display = 'none';
            btnRegister.style.display = 'none';
            btnLogout.style.display = 'inline-block';
        } else {
            currentUser = null;
            authStatus.textContent = 'Не авторизовано';
            emailInput.style.display = 'inline-block';
            passwordInput.style.display = 'inline-block';
            btnLogin.style.display = 'inline-block';
            btnRegister.style.display = 'inline-block';
            btnLogout.style.display = 'none';
        }
    });

    // Реєстрація
    btnRegister.addEventListener("click", async () => {
        try {
            await createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
            alert("Реєстрація успішна!");
        } catch (error) {
            alert("Помилка: " + error.message);
        }
    });

    // Вхід
    btnLogin.addEventListener("click", async () => {
        try {
            await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
        } catch (error) {
            alert("Помилка: " + error.message);
        }
    });

    // Вихід
    btnLogout.addEventListener("click", async () => {
        await signOut(auth);
    });

    btnReaderBack.addEventListener("click", () => {
        showChat();
    });

    chatHistory.addEventListener("click", handleBookReadClick);
    catalogBooks.addEventListener("click", handleBookReadClick);

    loadCatalog();

    function handleBookReadClick(event) {
        const readButton = event.target.closest(".book-card-read");
        if (!readButton) return;

        const bookId = readButton.dataset.bookId;
        if (!bookId) return;

        openReader(bookId);
    }

    // Відправка повідомлення в чат
    btnSend.addEventListener("click", async () => {
        const query = chatInput.value.trim();
        if (!query) return;

        // Додаємо запит користувача в історію
        appendMessage("Ви", query);
        chatInput.value = "";

        try {
            // Отримуємо токен, якщо користувач авторизований (на майбутнє для захисту API)
            let token = "";
            if (currentUser) {
                token = await currentUser.getIdToken();
            }

            const response = await fetch(`${BACKEND_URL}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: query
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Додаємо відповідь в історію
            appendMessage("ЧитAI", data.answer);
            
            // Якщо є рекомендації книг
            if (data.books && data.books.length > 0) {
                let booksHtml = '<div class="book-recommendations">';
                data.books.forEach(b => {
                    booksHtml += renderBookCard(b);
                });
                booksHtml += "</div>";
                appendMessage("Рекомендації", booksHtml, true);
            }

        } catch (error) {
            appendMessage("Помилка", "Не вдалося з'єднатися з бекендом. Переконайтесь, що FastAPI працює.");
            console.error(error);
        }
    });

    function appendMessage(sender, text, isHtml = false) {
        const msgDiv = document.createElement("div");
        msgDiv.className = "chat-message";
        msgDiv.style.marginBottom = "10px";
        if (isHtml) {
            msgDiv.innerHTML = `<strong>${sender}:</strong> ${text}`;
        } else {
            msgDiv.innerHTML = `<strong>${sender}:</strong> ${escapeHtml(text)}`;
        }
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    async function loadCatalog() {
        catalogStatus.textContent = "Завантаження каталогу...";
        catalogBooks.innerHTML = "";

        try {
            const booksQuery = query(collection(db, "books"), orderBy("title"));
            const snapshot = await getDocs(booksQuery);
            const books = snapshot.docs.map(doc => ({
                ...doc.data(),
                book_id: doc.id,
            }));

            if (!books.length) {
                catalogStatus.textContent = "Каталог поки порожній.";
                return;
            }

            catalogBooks.innerHTML = books.map(renderBookCard).join("");
            catalogStatus.textContent = `Книг у каталозі: ${books.length}`;
        } catch (error) {
            catalogStatus.textContent = "Не вдалося завантажити каталог.";
            console.error(error);
        }
    }

    function renderBookCard(book) {
        const genres = Array.isArray(book.genres) ? book.genres.join(", ") : "";
        const publicationDate = book.publication_date || book.publication_year || "";
        const year = publicationDate ? `<span>${escapeHtml(publicationDate)}</span>` : "";
        const series = book.series ? `<span>${escapeHtml(book.series)}${book.series_number ? " #" + escapeHtml(book.series_number) : ""}</span>` : "";
        const title = book.title || "Книга";
        const bookId = book.book_id || "";
        const cover = book.cover_url
            ? `<img class="book-card-cover" src="${escapeHtml(book.cover_url)}" alt="${escapeHtml(title)}">`
            : `<div class="book-card-cover book-card-cover--empty">Без обкладинки</div>`;

        return `
            <article class="book-card" data-book-id="${escapeHtml(bookId)}">
                ${cover}
                <div class="book-card-body">
                    <h3>${escapeHtml(title)}</h3>
                    <p class="book-card-author">${escapeHtml(book.author || "")}</p>
                    <p class="book-card-description">${escapeHtml(book.description || "")}</p>
                    <div class="book-card-meta">
                        ${genres ? `<span>${escapeHtml(genres)}</span>` : ""}
                        ${year}
                        ${series}
                    </div>
                    <button class="book-card-read" type="button" data-book-id="${escapeHtml(bookId)}">Читати</button>
                </div>
            </article>
        `;
    }

    async function openReader(bookId) {
        showReader();
        readerTitle.textContent = "Завантаження...";
        readerAuthor.textContent = "";
        readerStatus.textContent = "Завантажуємо текст книги...";
        readerContent.textContent = "";

        try {
            const response = await fetch(`${BACKEND_URL}/api/books/${encodeURIComponent(bookId)}/content`);
            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error("Книгу не знайдено.");
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            readerTitle.textContent = data.title || "Книга";
            readerAuthor.textContent = data.author ? `Автор: ${data.author}` : "";
            readerStatus.textContent = "";
            readerContent.textContent = data.content || "Текст книги порожній.";
        } catch (error) {
            readerTitle.textContent = "Не вдалося відкрити книгу";
            readerAuthor.textContent = "";
            readerStatus.textContent = error.message || "Спробуйте пізніше.";
            readerContent.textContent = "";
            console.error(error);
        }
    }

    function showReader() {
        chatSection.style.display = "none";
        catalogSection.style.display = "none";
        readerSection.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function showChat() {
        readerSection.style.display = "none";
        chatSection.style.display = "block";
        catalogSection.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }
});
