import {
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
} from "./firebase-config.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, serverTimestamp, setDoc, getDoc, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function initAuthUi(onUserChanged = () => {}) {
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const nicknameInput = document.getElementById("nickname");
    const btnLogin = document.getElementById("btn-login");
    const btnRegister = document.getElementById("btn-register");
    const btnLogout = document.getElementById("btn-logout");
    const authStatus = document.getElementById("auth-status");
    const authSection = document.getElementById("auth-section");
    let pendingRegistrationEmail = "";
    let pendingRegistrationNickname = "";
    let pendingProfileWrite = null;

    if (!emailInput || !passwordInput || !nicknameInput || !btnLogin || !btnRegister || !btnLogout || !authStatus || !authSection) {
        return onAuthStateChanged(auth, onUserChanged);
    }

    showCachedAuthState();

    function clearErrors() {
        document.querySelectorAll(".field-error").forEach(el => el.textContent = "");
        document.querySelectorAll(".is-error").forEach(el => el.classList.remove("is-error"));
        if (authStatus) authStatus.textContent = "";
    }

    function showError(inputId, message) {
        const input = document.getElementById(inputId);
        if (input) input.classList.add("is-error");
        const err = document.querySelector(`[data-error-for="${inputId}"]`);
        if (err) err.textContent = message;
        else if (authStatus) authStatus.textContent = message;
    }

    btnRegister.addEventListener("click", async () => {
        clearErrors();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const nickname = nicknameInput.value.trim();
        const normalizedNickname = nickname.toLowerCase();
        pendingRegistrationEmail = email;
        pendingRegistrationNickname = nickname;

        let hasError = false;

        if (!nickname) {
            showError("nickname", "Введіть нікнейм.");
            hasError = true;
        } else if (nickname.length < 3) {
            showError("nickname", "Нікнейм має містити мінімум 3 символи.");
            hasError = true;
        } else if (!/^[a-zA-Z0-9_а-яА-ЯіІїЇєЄґҐ-]+$/.test(nickname)) {
            showError("nickname", "Нікнейм може містити літери, цифри, дефіс і підкреслення.");
            hasError = true;
        }
        
        if (!email) {
            showError("email", "Введіть email.");
            hasError = true;
        }
        
        if (!password) {
            showError("password", "Введіть пароль.");
            hasError = true;
        }

        if (hasError) return;

        btnRegister.disabled = true;

        try {
            if (authStatus) authStatus.textContent = "Перевірка нікнейма...";
            const usernameRef = doc(db, "usernames", normalizedNickname);
            const usernameDoc = await getDoc(usernameRef);
            if (usernameDoc.exists()) {
                throw new Error("Цей нікнейм вже зайнятий.");
            }

            if (authStatus) authStatus.textContent = "Створення акаунта...";
            const result = await createUserWithEmailAndPassword(auth, email, password);

            if (authStatus) authStatus.textContent = "Збереження профілю...";
            await updateProfile(result.user, { displayName: nickname });
            await result.user.getIdToken(true);

            pendingProfileWrite = runTransaction(db, async (transaction) => {
                const currentUsernameDoc = await transaction.get(usernameRef);
                if (currentUsernameDoc.exists()) {
                    throw new Error("Цей нікнейм вже зайнятий.");
                }

                transaction.set(usernameRef, {
                    uid: result.user.uid,
                    createdAt: serverTimestamp(),
                });
            }).then(() => setDoc(doc(db, "users", result.user.uid), {
                email: result.user.email,
                displayName: nickname,
                createdAt: serverTimestamp(),
                lastLoginAt: serverTimestamp(),
            }, { merge: true }));

            await pendingProfileWrite;

            localStorage.setItem("isLoggedIn", "true");
            localStorage.setItem("profileDisplayNameUid", result.user.uid);
            localStorage.setItem("profileDisplayName", nickname);
            if (authStatus) authStatus.textContent = `Авторизовано як: ${nickname}`;
        } catch (error) {
            if (error.message === "Цей нікнейм вже зайнятий.") {
                showError("nickname", error.message);
            } else {
                showError("email", getFriendlyAuthError(error));
            }
        } finally {
            pendingProfileWrite = null;
            btnRegister.disabled = false;
        }
    });

    btnLogin.addEventListener("click", async () => {
        clearErrors();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        let hasError = false;
        
        if (!email) {
            showError("email", "Введіть email.");
            hasError = true;
        }
        if (!password) {
            showError("password", "Введіть пароль.");
            hasError = true;
        }
        
        if (hasError) return;
        
        try {
            await signInWithEmailAndPassword(auth, email, password);
        } catch (error) {
            showError("password", getFriendlyAuthError(error));
        }
    });

    btnLogout.addEventListener("click", async () => {
        await signOut(auth);
    });

    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            localStorage.setItem("isLoggedIn", "true");

            if (pendingProfileWrite && pendingRegistrationEmail === user.email) {
                await pendingProfileWrite.catch(() => {});
            }

            const userDoc = await getDoc(doc(db, "users", user.uid));
            let displayName = user.displayName || user.email;
            if (userDoc.exists() && userDoc.data().displayName) {
                displayName = userDoc.data().displayName;
            } else if (pendingRegistrationEmail === user.email && pendingRegistrationNickname) {
                displayName = pendingRegistrationNickname;
            } else if (localStorage.getItem("profileDisplayNameUid") === user.uid && localStorage.getItem("profileDisplayName")) {
                displayName = localStorage.getItem("profileDisplayName");
            }
            user.customDisplayName = displayName;

            if (authStatus) authStatus.textContent = `Авторизовано як: ${displayName}`;
            if (btnLogout) btnLogout.classList.remove("hidden");
            if (authSection) authSection.classList.add("hidden");

            await setDoc(doc(db, "users", user.uid), {
                email: user.email,
                lastLoginAt: serverTimestamp(),
            }, { merge: true });
        } else {
            localStorage.removeItem("isLoggedIn");
            localStorage.removeItem("profileDisplayNameUid");
            localStorage.removeItem("profileDisplayName");
            if (btnLogout) btnLogout.classList.add("hidden");
            if (authSection) authSection.classList.remove("hidden");
        }

        onUserChanged(user);
    });

    function showCachedAuthState() {
        if (localStorage.getItem("isLoggedIn") === "true") {
            if (btnLogout) btnLogout.classList.remove("hidden");
            if (authStatus) authStatus.textContent = "Завантаження профілю...";
            if (authSection) authSection.classList.add("hidden");
        } else {
            if (btnLogout) btnLogout.classList.add("hidden");
            if (authSection) authSection.classList.remove("hidden");
        }
        if (authSection) authSection.style.visibility = "visible";
    }
}

export function authPanelHtml() {
    return `
        <section id="auth-section" class="auth-section" style="visibility: hidden; min-height: 40px;">
            <div class="auth-controls">
                <input type="text" id="nickname" placeholder="Нікнейм (для реєстрації)" style="display:none;">
                <input type="email" id="email" placeholder="Email" style="display:none;">
                <input type="password" id="password" placeholder="Пароль" style="display:none;">
                <button id="btn-login" type="button" style="display:none;">Увійти</button>
                <button id="btn-register" type="button" style="display:none;">Зареєструватися</button>
                <button id="btn-logout" type="button" style="display:none;">Вийти</button>
            </div>
            <p id="auth-status">Завантаження...</p>
        </section>
    `;
}

function getFriendlyAuthError(error) {
    if (error?.code === "auth/email-already-in-use") return "Цей email вже зареєстрований.";
    if (error?.code === "auth/invalid-email") return "Некоректний email.";
    if (error?.code === "auth/weak-password") return "Слабкий пароль.";
    if (error?.code === "auth/operation-not-allowed") return "У Firebase Authentication потрібно увімкнути Email/Password provider.";
    if (error?.code === "permission-denied") return "Недостатньо прав для запису профілю. Перевірте Firestore Security Rules.";
    return error?.message || "Невідома помилка.";
}
