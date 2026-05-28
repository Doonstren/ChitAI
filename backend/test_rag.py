import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.retriever import get_retriever
from core.engine import RAGEngine
from core.config import get_settings

def print_db_stats():
    retriever = get_retriever()
    books = retriever.get_all_books()
    print(f"\n=== DB STATS ===")
    print(f"Total chunks: {retriever.get_collection_count()}")
    print(f"Total books: {len(books)}")
    for b in books:
        print(f" - {b['title']} (Chunks: {b['num_chunks']})")
    print("================\n")
    return books

async def run_tests():
    sys.stdout.reconfigure(encoding='utf-8')
    books = print_db_stats()
    if not books:
        print("No books in DB to test!")
        return

    settings = get_settings()
    
    question = "Які кіберпанк книги з бази ти можеш порадити? Чому саме їх?"

    model_id = "gemma-4-31b-it"

    print(f"\n{'='*50}\nTESTING MODEL: {model_id}\n{'='*50}")
    # Temporarily override the config model
    settings.LLM_MODELS = [model_id]
    engine = RAGEngine(settings=settings)
    
    print(f"\nQ: {question}")
    try:
        result = engine.chat(question)
        print(f"\n=== ВІДПОВІДЬ (Gemma) ===")
        print(result.answer)
        print("\n=== ДЖЕРЕЛА (Книги з бази) ===")
        for b in result.books:
            print(f"- {b.get('title')} (Relevance: {b.get('relevance_score')})")
    except Exception as e:
        print(f"Error with {model_id}: {e}")

if __name__ == "__main__":
    asyncio.run(run_tests())
