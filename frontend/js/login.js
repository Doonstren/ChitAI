import {
    auth,
    db,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
} from "./firebase-config.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    doc,
    getDoc,
    runTransaction,
    serverTimestamp,
    setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");
const authCrumb = document.getElementById("auth-crumb-current");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginError = document.getElementById("login-error");
const registerError = document.getElementById("register-error");
const loginTab = document.getElementById("show-login-tab");
const registerTab = document.getElementById("show-register-tab");
let authSubmitInProgress = false;

loginTab?.addEventListener("click", () => showMode("login"));
registerTab?.addEventListener("click", () => showMode("register"));

document.getElementById("show-register")?.addEventListener("click", (event) => {
    event.preventDefault();
    showMode("register");
});

document.getElementById("show-login")?.addEventListener("click", (event) => {
    event.preventDefault();
    showMode("login");
});

window.addEventListener("hashchange", syncModeFromHash);

document.getElementById("hdr-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = document.getElementById("hdr-search-input")?.value.trim();
    window.location.href = "/catalog" + (query ? `?search=${encodeURIComponent(query)}` : "");
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(loginForm, loginError);

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    let hasError = false;

    if (!isValidEmail(email)) {
        setFieldError("login-email", "Введіть коректний email.");
        hasError = true;
    }
    if (!password) {
        setFieldError("login-password", "Введіть пароль.");
        hasError = true;
    }
    if (hasError) return;

    try {
        authSubmitInProgress = true;
        await signInWithEmailAndPassword(auth, email, password);
        localStorage.setItem("isLoggedIn", "true");
        window.location.href = "/profile";
    } catch (error) {
        authSubmitInProgress = false;
        loginError.textContent = friendlyAuthError(error, "Не вдалося увійти. Перевірте email і пароль.");
    }
});

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(registerForm, registerError);

    const name = document.getElementById("register-name").value.trim();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const passwordConfirm = document.getElementById("register-password-confirm").value;
    let hasError = false;

    if (!name || name.length < 3) {
        setFieldError("register-name", "Ім’я має містити щонайменше 3 символи.");
        hasError = true;
    }
    if (!isValidEmail(email)) {
        setFieldError("register-email", "Введіть коректний email.");
        hasError = true;
    }
    if (password.length < 6) {
        setFieldError("register-password", "Пароль має містити щонайменше 6 символів.");
        hasError = true;
    }
    if (password !== passwordConfirm) {
        setFieldError("register-password-confirm", "Паролі не співпадають.");
        hasError = true;
    }
    if (hasError) return;

    try {
        const normalizedName = name.toLocaleLowerCase("uk-UA");
        const usernameRef = doc(db, "usernames", normalizedName);
        const usernameDoc = await getDoc(usernameRef);
        if (usernameDoc.exists()) {
            setFieldError("register-name", "Це ім’я вже зайняте.");
            return;
        }

        authSubmitInProgress = true;
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(result.user, { displayName: name });
        await runTransaction(db, async (transaction) => {
            const currentUsernameDoc = await transaction.get(usernameRef);
            if (currentUsernameDoc.exists()) {
                throw new Error("username-taken");
            }
            transaction.set(usernameRef, {
                uid: result.user.uid,
                createdAt: serverTimestamp(),
            });
        });
        await setDoc(doc(db, "users", result.user.uid), {
            email: result.user.email,
            displayName: name,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
        }, { merge: true });

        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("profileDisplayNameUid", result.user.uid);
        localStorage.setItem("profileDisplayName", name);
        window.location.href = "/profile";
    } catch (error) {
        authSubmitInProgress = false;
        if (error.message === "username-taken") {
            setFieldError("register-name", "Це ім’я вже зайняте.");
            return;
        }
        registerError.textContent = friendlyAuthError(error, "Не вдалося створити акаунт.");
    }
});

syncModeFromHash();

onAuthStateChanged(auth, (user) => {
    if (user && !authSubmitInProgress) window.location.href = "/profile";
});

function syncModeFromHash() {
    showMode(window.location.hash === "#register" ? "register" : "login");
}

function showMode(mode) {
    const isRegister = mode === "register";
    loginPanel.classList.toggle("hidden", isRegister);
    registerPanel.classList.toggle("hidden", !isRegister);
    loginTab?.classList.toggle("on", !isRegister);
    registerTab?.classList.toggle("on", isRegister);
    authCrumb.textContent = isRegister ? "Реєстрація" : "Вхід";
    document.title = isRegister ? "ЧитAI — Реєстрація" : "ЧитAI — Вхід";
    history.replaceState(null, "", isRegister ? "/login#register" : "/login");
}

function clearFormErrors(form, statusElement) {
    statusElement.textContent = "";
    form.querySelectorAll(".is-error").forEach(input => input.classList.remove("is-error"));
    form.querySelectorAll(".field-error").forEach(error => {
        error.textContent = "";
    });
}

function setFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    const error = document.getElementById(`${inputId}-error`);
    input?.classList.add("is-error");
    if (error) error.textContent = message;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function friendlyAuthError(error, fallback) {
    if (error?.code === "auth/email-already-in-use") return "Цей email вже зареєстрований.";
    if (error?.code === "auth/invalid-email") return "Некоректний email.";
    if (error?.code === "auth/invalid-credential") return "Неправильний email або пароль.";
    if (error?.code === "auth/weak-password") return "Пароль має містити щонайменше 6 символів.";
    if (error?.code === "auth/operation-not-allowed") return "У Firebase Authentication потрібно увімкнути Email/Password provider.";
    if (error?.code === "permission-denied") return "Недостатньо прав для запису профілю. Перевірте Firestore Security Rules.";
    return fallback;
}
