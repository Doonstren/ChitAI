import { auth, db } from "./firebase-config.js";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { initAuthUi } from "./auth-ui.js?v=9";
import { BACKEND_URL, escapeHtml, renderBookCard } from "./common.js?v=9";
import { loadFavoriteIds, toggleFavorite, updateFavoriteButton } from "./favorites.js?v=9";

const chatAuthNote = document.getElementById("chat-auth-note");
const chatApp = document.getElementById("chat-app");
const threadList = document.getElementById("chat-thread-list");
const btnNewThread = document.getElementById("btn-new-thread");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const chatStatus = document.getElementById("chat-status");

let currentUser = null;
let currentThreadId = "";
let currentMessages = [];
let favoriteIds = new Set();

initAuthUi(async (user) => {
    currentUser = user;
    chatAuthNote.classList.toggle("hidden", Boolean(user));
    chatApp.classList.toggle("hidden", !user);

    if (!user) {
        currentThreadId = "";
        currentMessages = [];
        favoriteIds = new Set();
        renderMessages();
        threadList.innerHTML = "";
        return;
    }

    favoriteIds = await loadFavoriteIds(user);
    await loadThreads();
    const requestedThreadId = new URLSearchParams(window.location.search).get("thread");
    if (requestedThreadId) {
        await openThread(requestedThreadId);
    }
});

btnNewThread.addEventListener("click", () => {
    currentThreadId = "";
    currentMessages = [];
    window.history.replaceState(null, "", `/chat`);
    renderMessages();
});

threadList.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest(".chat-thread-delete");
    if (deleteBtn) {
        if (confirm("Ви впевнені, що хочете видалити цей діалог?")) {
            const threadId = deleteBtn.dataset.threadId;
            await deleteDoc(doc(db, "users", currentUser.uid, "chatThreads", threadId));
            if (currentThreadId === threadId) {
                currentThreadId = "";
                currentMessages = [];
                window.history.replaceState(null, "", `/chat`);
                renderMessages();
            }
            await loadThreads();
        }
        return;
    }

    const openBtn = event.target.closest(".chat-thread-open");
    if (!openBtn) return;
    await openThread(openBtn.dataset.threadId);
});

btnSend.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") sendMessage();
});

chatMessages.addEventListener("click", async (event) => {
    const button = event.target.closest(".favorite-toggle");
    if (!button) return;

    const active = button.dataset.active === "true";
    const nextActive = await toggleFavorite(currentUser, button.dataset.bookId, active);
    if (nextActive) favoriteIds.add(button.dataset.bookId);
    else favoriteIds.delete(button.dataset.bookId);
    updateFavoriteButton(button, nextActive);
});

async function loadThreads() {
    if (!currentUser) return;

    const threadsQuery = query(
        collection(db, "users", currentUser.uid, "chatThreads"),
        orderBy("updatedAt", "desc")
    );
    const snapshot = await getDocs(threadsQuery);
    const threads = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));

    if (!threads.length) {
        threadList.innerHTML = "<p>Історія порожня.</p>";
        return;
    }

    threadList.innerHTML = threads.map(thread => `
        <article class="chat-thread" style="display: flex; gap: 8px;">
            <button class="chat-thread-open secondary-button" style="flex:1; text-align: left;" type="button" data-thread-id="${escapeHtml(thread.id)}">${escapeHtml(thread.title || "Розмова")}</button>
            <button class="chat-thread-delete secondary-button" type="button" data-thread-id="${escapeHtml(thread.id)}" title="Видалити">🗑️</button>
        </article>
    `).join("");
}

async function createThread() {
    if (!currentUser) return;

    const ref = await addDoc(collection(db, "users", currentUser.uid, "chatThreads"), {
        title: "Нова розмова",
        messages: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
    currentThreadId = ref.id;
    window.history.replaceState(null, "", `/chat?thread=${encodeURIComponent(currentThreadId)}`);
}

async function openThread(threadId) {
    if (!currentUser || !threadId) return;

    const snapshot = await getDoc(doc(db, "users", currentUser.uid, "chatThreads", threadId));
    if (!snapshot.exists()) {
        chatStatus.textContent = "Розмову не знайдено.";
        return;
    }

    currentThreadId = snapshot.id;
    currentMessages = snapshot.data().messages || [];
    window.history.replaceState(null, "", `/chat?thread=${encodeURIComponent(currentThreadId)}`);
    renderMessages();
}

async function sendMessage() {
    if (!currentUser) {
        chatStatus.textContent = "Увійдіть, щоб писати нейробібліотекарю.";
        return;
    }

    const message = chatInput.value.trim();
    if (!message) return;

    if (!currentThreadId) {
        await createThread();
    }

    chatInput.value = "";
    btnSend.disabled = true;
    chatStatus.textContent = "Нейробібліотекар відповідає...";

    // Останні репліки цього треда — щоб бот пам'ятав контекст розмови.
    const history = currentMessages
        .filter(item => item.role === "user" || item.role === "assistant")
        .slice(-8)
        .map(item => ({ role: item.role, text: String(item.text || "").slice(0, 2000) }));

    currentMessages.push({ role: "user", text: message });
    renderMessages();
    await saveThread(message);

    try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`${BACKEND_URL}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ message, history }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        currentMessages.push({
            role: "assistant",
            text: data.answer || "",
            books: data.books || [],
        });
        renderMessages();
        await saveThread(message);
        await loadThreads();
        chatStatus.textContent = "";
    } catch (error) {
        currentMessages.push({
            role: "system",
            text: "Не вдалося отримати відповідь. Перевірте, що бекенд запущений.",
        });
        renderMessages();
        await saveThread(message);
        chatStatus.textContent = "";
        console.error(error);
    } finally {
        btnSend.disabled = false;
    }
}

async function saveThread(latestUserMessage) {
    if (!currentUser || !currentThreadId) return;

    await setDoc(doc(db, "users", currentUser.uid, "chatThreads", currentThreadId), {
        title: currentMessages.find(item => item.role === "user")?.text?.slice(0, 60) || latestUserMessage.slice(0, 60),
        messages: currentMessages,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

function renderMessages() {
    if (!currentMessages.length) {
        chatMessages.innerHTML = "<p>Почніть нову розмову з нейробібліотекарем.</p>";
        return;
    }

    chatMessages.innerHTML = currentMessages.map(message => {
        const books = Array.isArray(message.books) && message.books.length
            ? `<div class="book-recommendations">${message.books.map(book => renderBookCard(book, favoriteIds)).join("")}</div>`
            : "";
        return `
            <article class="chat-message">
                <strong>${message.role === "user" ? "Ви" : message.role === "assistant" ? "ЧитAI" : "Система"}</strong>
                <p>${escapeHtml(message.text || "")}</p>
                ${books}
            </article>
        `;
    }).join("");
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
