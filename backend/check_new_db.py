import sys, os, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8')

from core.retriever import get_retriever
from core.config import get_settings
from core.engine import RAGEngine

def check_db():
    r = get_retriever()
    total = r.count
    profiles = sum(1 for c in r._chunks if (c.get("metadata", {}).get("doc_type") or "book_chunk") == "book_profile")
    chunks = total - profiles
    books = r.get_all_books()

    print(f"=== NEW DB STATS ===")
    print(f"Total records: {total}")
    print(f"  Book profiles: {profiles}")
    print(f"  Text chunks:   {chunks}")
    print(f"  Books:         {len(books)}")
    print()

    for b in books:
        genres = b.get("genres", [])
        tags = b.get("tags", [])
        series = b.get("series", "")
        rights = b.get("rights_status", "")
        print(f"  {b['title']}")
        print(f"    author={b['author']} | genres={genres} | tags={tags}")
        if series:
            print(f"    series={series} #{b.get('series_number','')}")
        print(f"    chunks={b['num_chunks']} | rights={rights}")
        print()

def test_rag():
    settings = get_settings()
    settings.LLM_MODELS = ["gemma-4-31b-it"]
    engine = RAGEngine(settings=settings)

    question = "Які кіберпанк книги з бази ти можеш порадити? Чому саме їх?"
    print(f"Q: {question}\n")

    result = engine.chat(question)
    print(f"=== ВІДПОВІДЬ ===")
    print(result.answer)
    print(f"\n=== КНИГИ ===")
    for b in result.books:
        print(f"  - {b.get('title')} (Relevance: {b.get('relevance_score')}) [ID: {b.get('book_id')}]")
    print(f"\nChunks retrieved: {result.chunks_retrieved}")

if __name__ == "__main__":
    check_db()
    print("=" * 60)
    print("TESTING DUAL-TIER RAG")
    print("=" * 60)
    test_rag()
