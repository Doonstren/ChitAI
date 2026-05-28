import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.retriever import get_retriever

retriever = get_retriever()
print(f"Total chunks: {retriever.get_collection_count()}")
for b in retriever.get_all_books():
    print(f"- {b['title']} (Chunks: {b['num_chunks']})")
