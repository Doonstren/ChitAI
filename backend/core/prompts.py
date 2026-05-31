# backend/core/prompts.py
"""
System prompts and prompt-building utilities for the ЧитAI AI librarian.

All user-facing text is in Ukrainian.
Prompt design follows a Chain-of-Thought pattern:
  1. Проаналізуй запит
  2. Знайди відповідності в контексті
  3. Розшир рекомендації
"""

from __future__ import annotations

from typing import Any, Dict, List

# ── System prompt (Ukrainian) ───────────────────────────────────────────

SYSTEM_PROMPT = """\
Ти — розумний AI-бібліотекар платформи «ЧитAI».
Твоя головна ціль — допомогти користувачу знайти книги з наданого контексту, \
що найкраще відповідають його запиту, та надати корисну відповідь.

## Як ти маєш працювати (ланцюг міркувань):

1. **Аналіз запиту**: Визнач, що саме шукає користувач — жанр, тему, \
настрій, автора чи конкретну книгу. Зверни увагу на контекст і нюанси \
запиту.

2. **Пошук у контексті**: Уважно переглянь надані профілі та фрагменти книг. \
Визнач, наскільки кожна книга відповідає запиту. Оціни релевантність за шкалою \
від 0.0 до 1.0.

3. **Рекомендація**: Якщо серед наданого контексту є кілька підходящих книг — \
порекомендуй усі релевантні. Для кожної книги коротко поясни, про що вона і \
чому підходить саме під запит користувача.

## Правила:
- Відповідай ВИКЛЮЧНО українською мовою.
- Говори як нейробібліотекар: природно, доброзичливо, без технічних деталей.
- Не використовуй фрази на кшталт «у вашій базі», «у базі даних», «у контексті» \
або «знайдені фрагменти». Для користувача це має звучати як звичайна \
рекомендація бібліотекаря.
- Використовуй ТІЛЬКИ книги, які є в наданому контексті. Не додавай зовнішні \
знання як джерело рекомендацій і не вигадуй книги.
- Якщо релевантних книг немає — чесно скажи, що зараз не можеш підібрати точний \
варіант, і запропонуй уточнити жанр, настрій або тему.
- Не переказуй великі фрагменти тексту. Давай короткий корисний опис.
- Завжди поверни відповідь у JSON-форматі (без markdown-обгортки).

## Формат відповіді (JSON):
{
  "answer": "Коротка природна відповідь користувачу. Наприклад: «Звісно, я підібрав кілька варіантів під ваш запит...»",
  "books": [
    {
      "book_id": "ID книги з метаданих профілю або фрагменту",
      "description": "1–2 речення: про що книга і чому вона підходить під конкретний запит користувача.",
      "relevance_score": 0.95,
      "repeat_ok": false
    }
  ]
}

У масиві "books" не потрібно дублювати назву, автора, дату виходу, жанри чи \
обкладинку — система підтягне ці поля за `book_id`. Твоя відповідальність: \
вибрати правильний `book_id` і написати корисне пояснення в `description`.

Поле `repeat_ok` — необов'язкове (типово false). Постав true лише тоді, коли \
книгу вже показували раніше в цій розмові, але користувач прямо просить показати, \
знайти чи відкрити її знову. Для нових книг його можна не вказувати.

Якщо книг не знайдено, поверни порожній масив "books": [].
"""


# ── RAG prompt builder ──────────────────────────────────────────────────

def _meta_title(meta: Dict[str, Any]) -> str:
    return meta.get("book_title") or meta.get("title") or "—"


def _meta_author(meta: Dict[str, Any]) -> str:
    return meta.get("book_author") or meta.get("author") or "—"


def _format_meta_list(value: Any) -> str:
    if isinstance(value, (list, tuple, set)):
        return ", ".join(str(item) for item in value if str(item).strip())
    return str(value or "")

def _build_history_block(history: List[Dict[str, Any]] | None) -> str:
    """Render recent conversation turns as a context block (Ukrainian).

    Only ``user``/``assistant`` text turns are used; the last 8 are kept and
    each is truncated to keep the prompt compact.
    """
    if not history:
        return ""

    lines: list[str] = []
    for turn in history[-8:]:
        role = (turn.get("role") or "").strip()
        text = (turn.get("text") or "").strip()
        if not text:
            continue
        speaker = "Користувач" if role == "user" else "Бібліотекар"
        lines.append(f"{speaker}: {text[:1500]}")

    if not lines:
        return ""

    return (
        "## Попередній контекст цієї розмови (для зв'язності відповіді):\n\n"
        + "\n".join(lines)
        + "\n\n---\n\n"
    )


def _build_shown_block(shown_titles: List[str] | None) -> str:
    """Render the list of books whose cards were already shown earlier.

    Lets the librarian avoid repeating a card for a book the user has
    already seen, while still answering follow-up questions in text.
    """
    if not shown_titles:
        return ""

    items = "\n".join(f"- {title}" for title in shown_titles)
    return (
        "## Картки цих книг ти вже показував у цій розмові:\n\n"
        f"{items}\n\n"
        "Коли користувач просто ставить уточнююче питання про вже показану книгу — "
        "відповідай лише текстом і НЕ додавай цю книгу у \"books\" (картка вже є на "
        "екрані вище).\n"
        "Додай таку книгу в \"books\" знову лише якщо користувач прямо просить ще раз "
        "показати, знайти чи відкрити її — і тоді встанови для неї \"repeat_ok\": true.\n"
        "Нові книги, яких ще не було в розмові, додавай у \"books\" як зазвичай.\n\n"
        "---\n\n"
    )


def build_rag_prompt(
    query: str,
    chunks: List[Dict[str, Any]],
    history: List[Dict[str, Any]] | None = None,
    shown_titles: List[str] | None = None,
) -> str:
    """
    Assemble a full RAG prompt by injecting retrieved chunks as context.

    Args:
        query: The user's natural-language question / search query.
        chunks: List of dicts, each with at least ``text`` and optional
            metadata keys (``book_id``, ``title``, ``author``, ``chunk_index``).
        history: Optional recent conversation turns
            (``[{"role": "user"|"assistant", "text": str}, ...]``) so the
            librarian can handle follow-up questions coherently.

    Returns:
        A single string ready to be sent to the LLM along with
        :data:`SYSTEM_PROMPT`.
    """
    if not chunks:
        context_block = "(Контекст порожній — у базі не знайдено релевантних фрагментів.)"
    else:
        fragment_parts: list[str] = []
        for idx, chunk in enumerate(chunks, start=1):
            meta = chunk.get("metadata", {})
            header_parts = [f"Фрагмент {idx}"]
            title = _meta_title(meta)
            author = _meta_author(meta)
            if title != "—":
                header_parts.append(f"Книга: {title}")
            if author != "—":
                header_parts.append(f"Автор: {author}")
            if meta.get("doc_type"):
                header_parts.append(f"Тип: {meta['doc_type']}")
            genres = _format_meta_list(meta.get("genres"))
            if genres:
                header_parts.append(f"Жанри: {genres}")
            tags = _format_meta_list(meta.get("tags"))
            if tags:
                header_parts.append(f"Теги: {tags}")
            if meta.get("book_id"):
                header_parts.append(f"ID: {meta['book_id']}")
            if meta.get("chunk_index") is not None and meta.get("chunk_index") != -1:
                header_parts.append(f"Частина: {meta['chunk_index']}")

            header = " | ".join(header_parts)
            text = chunk.get("text", chunk.get("document", ""))
            fragment_parts.append(f"[{header}]\n{text}")

        context_block = "\n\n---\n\n".join(fragment_parts)

    prompt = (
        f"## Контекст із бази даних:\n\n"
        f"{context_block}\n\n"
        f"---\n\n"
        f"{_build_history_block(history)}"
        f"{_build_shown_block(shown_titles)}"
        f"## Поточний запит користувача:\n\n"
        f"{query}\n\n"
        f"Дай відповідь у JSON-форматі, як описано в системних інструкціях."
    )
    return prompt


def build_search_prompt(query: str, chunks: List[Dict[str, Any]]) -> str:
    """
    Build a simpler search-oriented prompt (for catalog search without chat).

    Returns the same JSON schema but with a shorter instruction.
    """
    if not chunks:
        context_block = "(Нічого не знайдено.)"
    else:
        fragment_parts: list[str] = []
        for idx, chunk in enumerate(chunks, start=1):
            meta = chunk.get("metadata", {})
            title = _meta_title(meta)
            author = _meta_author(meta)
            book_id = meta.get("book_id", "—")
            genres = _format_meta_list(meta.get("genres"))
            tags = _format_meta_list(meta.get("tags"))
            text = chunk.get("text", chunk.get("document", ""))
            details = " | ".join(part for part in (genres, tags) if part)
            fragment_parts.append(
                f"[{idx}] {title} ({author}) [ID: {book_id}] {details}\n{text}"
            )
        context_block = "\n\n".join(fragment_parts)

    return (
        f"Знайдені книги за запитом «{query}»:\n\n"
        f"{context_block}\n\n"
        f"Сформуй JSON-відповідь з полями answer та books."
    )
