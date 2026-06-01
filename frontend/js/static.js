import { initAuthUi } from "./auth-ui.js?v=9";

const loginLink = document.querySelector(".hdr-login");
const registerLink = document.querySelector(".hdr-register");
const contactForm = document.querySelector(".contact-form");

initAuthUi((user) => {
    if (!loginLink || !registerLink) return;

    if (user) {
        loginLink.textContent = "Профіль";
        loginLink.href = "/profile";
        registerLink.style.display = "none";
        revealAuthLinks();
        return;
    }

    loginLink.textContent = "Вхід";
    registerLink.textContent = "Реєстрація";
    loginLink.href = "/login";
    registerLink.href = "/login#register";
    registerLink.style.display = "";
    revealAuthLinks();
});

contactForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const fields = [
        {
            id: "contact-name",
            message: "Введіть ім'я.",
            valid: value => value.trim().length > 0,
        },
        {
            id: "contact-email",
            message: "Введіть коректний Email.",
            valid: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
        },
        {
            id: "contact-subject",
            message: "Введіть тему повідомлення.",
            valid: value => value.trim().length > 0,
        },
        {
            id: "contact-message",
            message: "Введіть повідомлення.",
            valid: value => value.trim().length > 0,
        },
    ];

    let isValid = true;
    fields.forEach((field) => {
        const input = document.getElementById(field.id);
        const error = document.querySelector(`[data-error-for="${field.id}"]`);
        const ok = field.valid(input?.value || "");
        input?.classList.toggle("is-error", !ok);
        if (error) error.textContent = ok ? "" : field.message;
        if (!ok) isValid = false;
    });

    const status = document.getElementById("contact-form-status");
    if (!status) return;

    status.classList.toggle("is-error", !isValid);
    if (!isValid) {
        status.textContent = "Перевірте поля форми.";
        return;
    }

    status.textContent = "Дякуємо за зворотний зв'язок. Повідомлення надіслано.";
    contactForm.reset();
});

function revealAuthLinks() {
    loginLink?.classList.remove("auth-link-pending");
    registerLink?.classList.remove("auth-link-pending");
}

