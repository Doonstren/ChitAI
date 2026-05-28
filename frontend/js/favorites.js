import { db } from "./firebase-config.js";
import {
    deleteDoc,
    doc,
    getDocs,
    serverTimestamp,
    setDoc,
    collection,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function loadFavoriteIds(user) {
    if (!user) return new Set();

    const snapshot = await getDocs(collection(db, "users", user.uid, "favorites"));
    return new Set(snapshot.docs.map(item => item.id));
}

export async function toggleFavorite(user, bookId, active) {
    if (!user) {
        alert("Увійдіть, щоб додати книгу до вибраного.");
        return false;
    }

    const favoriteRef = doc(db, "users", user.uid, "favorites", bookId);
    if (active) {
        await deleteDoc(favoriteRef);
        return false;
    }

    await setDoc(favoriteRef, {
        bookId,
        addedAt: serverTimestamp(),
    });
    return true;
}

export function updateFavoriteButton(button, active) {
    button.dataset.active = active ? "true" : "false";
    button.textContent = active ? "♥ У вибраному" : "♡ До вибраного";
}
