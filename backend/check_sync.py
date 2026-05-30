"""
Read-only consistency check between the local NumPy vector DB and the
Firestore ``books`` catalog.

Reports book_ids that exist in one store but not the other. Makes no changes.

Usage:
    python check_sync.py
"""

from __future__ import annotations

from core.retriever import get_retriever


def main() -> None:
    retriever = get_retriever()
    numpy_books = {b["book_id"] for b in retriever.get_all_books() if b.get("book_id")}

    from core.firestore_sync import _get_firestore_db

    db = _get_firestore_db()
    fs_books = {doc.id for doc in db.collection("books").stream()}

    only_numpy = sorted(numpy_books - fs_books)
    only_fs = sorted(fs_books - numpy_books)

    print(f"NumPy DB book_ids : {len(numpy_books)}")
    print(f"Firestore book_ids: {len(fs_books)}")
    print()

    if only_numpy:
        print("[!] Є в NumPy DB, але НЕМАЄ у Firestore")
        print("    (чат може порадити такі книги -> сторінка дасть 'Книгу не знайдено'):")
        for book_id in only_numpy:
            print("   -", book_id)
    else:
        print("[ok] Усі книги NumPy DB присутні у Firestore.")
    print()

    if only_fs:
        print("[i] Є у Firestore, але немає в NumPy DB (RAG їх не знає):")
        for book_id in only_fs:
            print("   -", book_id)
    else:
        print("[ok] Зайвих книг у Firestore немає.")


if __name__ == "__main__":
    main()
