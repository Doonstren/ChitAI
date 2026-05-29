import {
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
} from "./firebase-config.js";
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

    if (!emailInput || !passwordInput || !nicknameInput || !btnLogin || !btnRegister || !btnLogout || !authStatus || !authSection) {
        return onAuthStateChanged(auth, onUserChanged);
    }

    showCachedAuthState();

    btnRegister.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const nickname = nicknameInput.value.trim();
        const normalizedNickname = nickname.toLowerCase();

        if (!nickname) {
            alert("Введіть нікнейм.");
            return;
        }
        if (nickname.length < 3) {
            alert("Нікнейм має містити мінімум 3 символи.");
            return;
        }
        if (!/^[a-zA-Z0-9_а-яА-ЯіІїЇєЄґҐ-]+$/.test(nickname)) {
            alert("Нікнейм може містити літери, цифри, дефіс і підкреслення.");
            return;
        }

        btnRegister.disabled = true;

        try {
            authStatus.textContent = "Перевірка нікнейма...";
            const usernameRef = doc(db, "usernames", normalizedNickname);
            const usernameDoc = await getDoc(usernameRef);
            if (usernameDoc.exists()) {
                throw new Error("Цей нікнейм вже зайнятий.");
            }

            authStatus.textContent = "Створення акаунта...";
            const result = await createUserWithEmailAndPassword(auth, email, password);

            authStatus.textContent = "Збереження профілю...";
            await result.user.getIdToken(true);

            await runTransaction(db, async (transaction) => {
                const currentUsernameDoc = await transaction.get(usernameRef);
                if (currentUsernameDoc.exists()) {
                    throw new Error("Цей нікнейм вже зайнятий.");
                }

                transaction.set(usernameRef, {
                    uid: result.user.uid,
                    createdAt: serverTimestamp(),
                });
            });

            await setDoc(doc(db, "users", result.user.uid), {
                email: result.user.email,
                displayName: nickname,
                createdAt: serverTimestamp(),
                lastLoginAt: serverTimestamp(),
            }, { merge: true });

            localStorage.setItem("isLoggedIn", "true");
            authStatus.textContent = `Авторизовано як: ${nickname}`;
        } catch (error) {
            alert("Помилка: " + getFriendlyAuthError(error));
            authStatus.textContent = "Помилка реєстрації";
        } finally {
            btnRegister.disabled = false;
        }
    });

    btnLogin.addEventListener("click", async () => {
        try {
            await signInWithEmailAndPassword(auth, emailInput.value.trim(), passwordInput.value);
        } catch (error) {
            alert("Помилка: " + getFriendlyAuthError(error));
        }
    });

    btnLogout.addEventListener("click", async () => {
        await signOut(auth);
    });

    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            localStorage.setItem("isLoggedIn", "true");

            const userDoc = await getDoc(doc(db, "users", user.uid));
            let displayName = user.email;
            if (userDoc.exists() && userDoc.data().displayName) {
                displayName = userDoc.data().displayName;
            }
            user.customDisplayName = displayName;

            authStatus.textContent = `Авторизовано як: ${displayName}`;
            emailInput.style.display = "none";
            passwordInput.style.display = "none";
            nicknameInput.style.display = "none";
            btnLogin.style.display = "none";
            btnRegister.style.display = "none";
            btnLogout.style.display = "inline-block";

            await setDoc(doc(db, "users", user.uid), {
                email: user.email,
                lastLoginAt: serverTimestamp(),
            }, { merge: true });
        } else {
            localStorage.removeItem("isLoggedIn");
            authStatus.textContent = "Не авторизовано";
            emailInput.style.display = "inline-block";
            passwordInput.style.display = "inline-block";
            nicknameInput.style.display = "inline-block";
            btnLogin.style.display = "inline-block";
            btnRegister.style.display = "inline-block";
            btnLogout.style.display = "none";
        }

        onUserChanged(user);
    });

    function showCachedAuthState() {
        if (localStorage.getItem("isLoggedIn") === "true") {
            emailInput.style.display = "none";
            passwordInput.style.display = "none";
            nicknameInput.style.display = "none";
            btnLogin.style.display = "none";
            btnRegister.style.display = "none";
            btnLogout.style.display = "inline-block";
            authStatus.textContent = "Завантаження профілю...";
        } else {
            emailInput.style.display = "inline-block";
            passwordInput.style.display = "inline-block";
            nicknameInput.style.display = "inline-block";
            btnLogin.style.display = "inline-block";
            btnRegister.style.display = "inline-block";
            btnLogout.style.display = "none";
            authStatus.textContent = "Не авторизовано";
        }
        authSection.style.visibility = "visible";
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
    if (error?.code === "auth/weak-password") return "Пароль має містити щонайменше 6 символів.";
    if (error?.code === "auth/operation-not-allowed") return "У Firebase Authentication потрібно увімкнути Email/Password provider.";
    if (error?.code === "permission-denied") return "Недостатньо прав для запису профілю. Перевірте Firestore Security Rules.";
    return error?.message || "Невідома помилка.";
}
