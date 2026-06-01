import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    EmailAuthProvider,
    reauthenticateWithCredential,
    updateEmail,
    updatePassword,
    updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initAuthUi } from "./auth-ui.js?v=9";
import { bookUrl, escapeHtml } from "./common.js?v=13";

const profileContent = document.getElementById("profile-content");
const profileLoginNote = document.getElementById("profile-login-note");
const reviewsStatus = document.getElementById("reviews-status");
const profileReviewsList = document.getElementById("profile-reviews-list");
const profileCurrentEmail = document.getElementById("profile-current-email");
const profileGreeting = document.getElementById("profile-greeting");
const logoutButton = document.getElementById("btn-logout");
const nameInput = document.getElementById("profile-input-name");
const emailInput = document.getElementById("profile-input-email");
const oldPasswordInput = document.getElementById("profile-input-old-pass");
const newPasswordInput = document.getElementById("profile-input-new-pass");
const confirmPasswordInput = document.getElementById("profile-input-confirm-pass");
const nameStatus = document.getElementById("profile-name-status");
const emailStatus = document.getElementById("profile-email-status");
const passwordStatus = document.getElementById("profile-password-status");
const nameButton = document.getElementById("profile-btn-name");
const emailButton = document.getElementById("profile-btn-email");
const passwordButton = document.getElementById("profile-btn-pass");

let currentUser = null;

initAuthUi(async (user) => {
    currentUser = user;

    if (!user) {
        window.location.replace("/login");
        return;
    }

    profileContent?.classList.remove("hidden");
    profileLoginNote?.classList.add("hidden");

    if (profileCurrentEmail) profileCurrentEmail.textContent = "Завантаження профілю...";
    const displayName = await resolveProfileDisplayName(user);
    currentUser.customDisplayName = displayName;
    if (profileGreeting) profileGreeting.textContent = `Вітаємо, ${displayName}`;
    if (profileCurrentEmail) profileCurrentEmail.textContent = user.email || "";
    if (nameInput) nameInput.value = displayName && displayName !== user.email ? displayName : "";

    await loadProfileReviews();
});

nameButton?.addEventListener("click", updateProfileName);
emailButton?.addEventListener("click", updateProfileEmail);
passwordButton?.addEventListener("click", updateProfilePassword);

profileReviewsList?.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest(".btn-delete-comment");
    if (!deleteBtn) return;

    if (!confirm("Ви впевнені, що хочете видалити свій відгук?")) return;

    try {
        await deleteDoc(doc(db, "comments", deleteBtn.dataset.id));
        await loadProfileReviews();
    } catch (error) {
        alert("Помилка видалення: " + error.message);
    }
});

logoutButton?.addEventListener("click", async () => {
    const { auth, signOut } = await import("./firebase-config.js");
    await signOut(auth);
    window.location.href = "/";
});

async function resolveProfileDisplayName(user) {
    if (user.customDisplayName && user.customDisplayName !== user.email) {
        return user.customDisplayName;
    }

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const profileName = userDoc.exists() ? String(userDoc.data().displayName || "").trim() : "";
        if (profileName) return profileName;
    } catch (error) {
        console.warn("Could not load profile name", error);
    }

    if (user.displayName && user.displayName !== user.email) return user.displayName;

    const cachedUid = localStorage.getItem("profileDisplayNameUid");
    const cachedName = localStorage.getItem("profileDisplayName");
    if (cachedUid === user.uid && cachedName) return cachedName;

    return user.email;
}

async function updateProfileName() {
    if (!currentUser || !nameInput) return;
    clearProfileForm(nameStatus, "profile-input-name");

    const name = nameInput.value.trim();
    if (name.length < 3) {
        showFieldError("profile-input-name", "Ім’я має містити щонайменше 3 символи.");
        return;
    }

    try {
        setBusy(nameButton, true);
        const normalizedName = name.toLocaleLowerCase("uk-UA");
        const usernameRef = doc(db, "usernames", normalizedName);

        await runTransaction(db, async (transaction) => {
            const usernameDoc = await transaction.get(usernameRef);
            if (usernameDoc.exists()) {
                if (usernameDoc.data().uid !== currentUser.uid) {
                    throw new Error("username-taken");
                }
                return;
            }
            transaction.set(usernameRef, {
                uid: currentUser.uid,
                createdAt: serverTimestamp(),
            }, { merge: true });
        });

        await updateProfile(currentUser, { displayName: name });
        await setDoc(doc(db, "users", currentUser.uid), {
            displayName: name,
            updatedAt: serverTimestamp(),
        }, { merge: true });

        localStorage.setItem("profileDisplayNameUid", currentUser.uid);
        localStorage.setItem("profileDisplayName", name);
        currentUser.customDisplayName = name;
        if (profileGreeting) profileGreeting.textContent = `Вітаємо, ${name}`;
        showStatus(nameStatus, "Ім’я користувача оновлено.");
    } catch (error) {
        if (error.message === "username-taken") {
            showFieldError("profile-input-name", "Це ім’я вже зайняте.");
        } else {
            showStatus(nameStatus, friendlyProfileError(error, "Не вдалося змінити ім’я."), true);
        }
    } finally {
        setBusy(nameButton, false);
    }
}

async function updateProfileEmail() {
    if (!currentUser || !emailInput) return;
    clearProfileForm(emailStatus, "profile-input-email");

    const email = emailInput.value.trim();
    if (!isValidEmail(email)) {
        showFieldError("profile-input-email", "Введіть коректний email.");
        return;
    }
    if (email === currentUser.email) {
        showFieldError("profile-input-email", "Це вже поточна пошта.");
        return;
    }

    try {
        setBusy(emailButton, true);
        await updateEmail(currentUser, email);
        await setDoc(doc(db, "users", currentUser.uid), {
            email,
            updatedAt: serverTimestamp(),
        }, { merge: true });
        if (profileCurrentEmail) profileCurrentEmail.textContent = email;
        emailInput.value = "";
        showStatus(emailStatus, "Пошту оновлено.");
    } catch (error) {
        showStatus(emailStatus, friendlyProfileError(error, "Не вдалося змінити пошту."), true);
    } finally {
        setBusy(emailButton, false);
    }
}

async function updateProfilePassword() {
    if (!currentUser || !oldPasswordInput || !newPasswordInput || !confirmPasswordInput) return;
    clearProfileForm(passwordStatus, "profile-input-old-pass", "profile-input-new-pass", "profile-input-confirm-pass");

    const oldPassword = oldPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    let hasError = false;

    if (!oldPassword) {
        showFieldError("profile-input-old-pass", "Введіть старий пароль.");
        hasError = true;
    }
    if (newPassword.length < 6) {
        showFieldError("profile-input-new-pass", "Новий пароль має містити щонайменше 6 символів.");
        hasError = true;
    }
    if (newPassword !== confirmPassword) {
        showFieldError("profile-input-confirm-pass", "Паролі не співпадають.");
        hasError = true;
    }
    if (hasError) return;

    try {
        setBusy(passwordButton, true);
        const credential = EmailAuthProvider.credential(currentUser.email, oldPassword);
        await reauthenticateWithCredential(currentUser, credential);
        await updatePassword(currentUser, newPassword);
        oldPasswordInput.value = "";
        newPasswordInput.value = "";
        confirmPasswordInput.value = "";
        showStatus(passwordStatus, "Пароль оновлено.");
    } catch (error) {
        showStatus(passwordStatus, friendlyProfileError(error, "Не вдалося змінити пароль."), true);
    } finally {
        setBusy(passwordButton, false);
    }
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

        const bookCache = {};
        for (const comment of comments) {
            if (bookCache[comment.bookId]) continue;
            const bookDoc = await getDoc(doc(db, "books", comment.bookId));
            bookCache[comment.bookId] = bookDoc.exists() ? (bookDoc.data().title || "Книга") : "Невідома книга";
        }

        reviewsStatus.textContent = `Відгуків: ${comments.length}`;
        profileReviewsList.innerHTML = comments.map(comment => renderProfileReview(comment, bookCache[comment.bookId])).join("");
    } catch (error) {
        reviewsStatus.textContent = "Не вдалося завантажити відгуки.";
        console.error(error);
    }
}

function renderProfileReview(comment, bookTitle) {
    const rating = Math.max(0, Math.min(5, Math.round(Number(comment.rating || 0))));
    const date = comment.createdAt?.toMillis
        ? new Date(comment.createdAt.toMillis()).toLocaleDateString("uk-UA")
        : "Невідомо";

    return `
        <article class="profile-review-card">
            <div>
                <strong class="h3">До ${escapeHtml(bookTitle)}</strong>
                <div class="small" style="color: var(--green-700); margin-top: 4px;">За: ${date}</div>
            </div>
            <p style="color: var(--green-900); font: var(--t-body); margin: 8px 0;">${escapeHtml(comment.text || "")}</p>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
                <strong class="h3">Оцінка:</strong>
                <span class="review-stars">${renderStars(rating)}</span>
            </div>
            <div class="profile-review-card-actions">
                <a href="${bookUrl(comment.bookId)}" class="link-go">Перейти</a>
                <button class="link-del btn-delete-comment" type="button" data-id="${escapeHtml(comment.id)}">Видалити</button>
            </div>
        </article>`;
}

function renderStars(rating) {
    return Array.from({ length: 5 }, (_, index) => (
        `<span class="${index < rating ? "active" : ""}">★</span>`
    )).join("");
}

function clearProfileForm(statusElement, ...inputIds) {
    showStatus(statusElement, "");
    inputIds.forEach((inputId) => {
        const input = document.getElementById(inputId);
        const error = document.getElementById(`${inputId}-error`);
        input?.classList.remove("is-error");
        if (error) error.textContent = "";
    });
}

function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(`${inputId}-error`);
    input?.classList.add("is-error");
    if (error) error.textContent = message;
}

function showStatus(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", Boolean(isError));
}

function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function friendlyProfileError(error, fallback) {
    if (error?.code === "auth/email-already-in-use") return "Цей email вже зареєстрований.";
    if (error?.code === "auth/invalid-email") return "Некоректний email.";
    if (error?.code === "auth/requires-recent-login") return "Для цієї дії потрібно вийти та увійти знову.";
    if (error?.code === "auth/wrong-password" || error?.code === "auth/invalid-credential") return "Старий пароль введено неправильно.";
    if (error?.code === "auth/weak-password") return "Новий пароль має містити щонайменше 6 символів.";
    if (error?.code === "permission-denied") return "Недостатньо прав для збереження змін.";
    return fallback;
}
