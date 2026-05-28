import { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase-config.js';

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
                    const genres = Array.isArray(b.genres) ? b.genres.join(", ") : "";
                    const publicationDate = b.publication_date || b.publication_year || "";
                    const year = publicationDate ? `<span>${escapeHtml(publicationDate)}</span>` : "";
                    const series = b.series ? `<span>${escapeHtml(b.series)}${b.series_number ? " #" + escapeHtml(b.series_number) : ""}</span>` : "";
                    const cover = b.cover_url
                        ? `<img class="book-card-cover" src="${escapeHtml(b.cover_url)}" alt="${escapeHtml(b.title)}">`
                        : `<div class="book-card-cover book-card-cover--empty">📖</div>`;

                    booksHtml += `
                        <article class="book-card" data-book-id="${escapeHtml(b.book_id)}">
                            ${cover}
                            <div class="book-card-body">
                                <h3>${escapeHtml(b.title)}</h3>
                                <p class="book-card-author">${escapeHtml(b.author)}</p>
                                <p class="book-card-description">${escapeHtml(b.description || "")}</p>
                                <div class="book-card-meta">
                                    ${genres ? `<span>${escapeHtml(genres)}</span>` : ""}
                                    ${year}
                                    ${series}
                                </div>
                                <button class="book-card-read" type="button" data-book-id="${escapeHtml(b.book_id)}">Читати</button>
                            </div>
                        </article>
                    `;
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

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }
});
