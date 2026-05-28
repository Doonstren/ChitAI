import {
    auth,
    db,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut,
} from "./firebase-config.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function initAuthUi(onUserChanged = () => {}) {
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const btnLogin = document.getElementById("btn-login");
    const btnRegister = document.getElementById("btn-register");
    const btnLogout = document.getElementById("btn-logout");
    const authStatus = document.getElementById("auth-status");

    btnRegister?.addEventListener("click", async () => {
        try {
            const result = await createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
            await setDoc(doc(db, "users", result.user.uid), {
                email: result.user.email,
                displayName: result.user.email,
                createdAt: serverTimestamp(),
            }, { merge: true });
        } catch (error) {
            alert("Помилка: " + error.message);
        }
    });

    btnLogin?.addEventListener("click", async () => {
        try {
            await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
        } catch (error) {
            alert("Помилка: " + error.message);
        }
    });

    btnLogout?.addEventListener("click", async () => {
        await signOut(auth);
    });

    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            authStatus.textContent = `Авторизовано як: ${user.email}`;
            emailInput.style.display = "none";
            passwordInput.style.display = "none";
            btnLogin.style.display = "none";
            btnRegister.style.display = "none";
            btnLogout.style.display = "inline-block";
            await setDoc(doc(db, "users", user.uid), {
                email: user.email,
                displayName: user.displayName || user.email,
                lastLoginAt: serverTimestamp(),
            }, { merge: true });
        } else {
            authStatus.textContent = "Не авторизовано";
            emailInput.style.display = "inline-block";
            passwordInput.style.display = "inline-block";
            btnLogin.style.display = "inline-block";
            btnRegister.style.display = "inline-block";
            btnLogout.style.display = "none";
        }

        onUserChanged(user);
    });
}

export function authPanelHtml() {
    return `
        <section id="auth-section" class="auth-section">
            <div class="auth-controls">
                <input type="email" id="email" placeholder="Email">
                <input type="password" id="password" placeholder="Пароль">
                <button id="btn-login" type="button">Увійти</button>
                <button id="btn-register" type="button">Зареєструватися</button>
                <button id="btn-logout" type="button" style="display:none;">Вийти</button>
            </div>
            <p id="auth-status">Не авторизовано</p>
        </section>
    `;
}
