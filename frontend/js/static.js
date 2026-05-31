import { initAuthUi } from "./auth-ui.js?v=9";

const loginLink = document.querySelector(".hdr-login");
const registerLink = document.querySelector(".hdr-register");

initAuthUi((user) => {
    if (!loginLink || !registerLink) return;

    if (user) {
        loginLink.textContent = "Профіль";
        registerLink.style.display = "none";
        return;
    }

    loginLink.textContent = "Вхід";
    registerLink.textContent = "Реєстрація";
    registerLink.href = "/profile";
    registerLink.style.display = "";
});
