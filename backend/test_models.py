import asyncio
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.config import get_settings
from core.llm import GeminiLLM

models_to_test = [
    "gemma-4-31b-it",
]

questions = [
    "Які книги про кіберпростір або хакерів (зокрема Вільяма Гібсона) варто прочитати? Назви тільки авторів та назви."
]

async def run_tests():
    print("=== Model Testing ===")
    
    for i, model in enumerate(models_to_test):
        print(f"\n{'='*50}\nTesting Model: {model}\n{'='*50}")
        
        # Override settings for this run
        settings = get_settings()
        settings.LLM_MODELS = [model]
        
        llm = GeminiLLM(settings=settings)
        
        for j, q in enumerate(questions):
            print(f"\n--- Question {j+1} ---")
            print(f"Q: {q}")
            try:
                # Use generate instead of generate_json to get raw text
                response = llm.generate(
                    prompt=q,
                    system_prompt="Ти - розумний бібліотекар. Відповідай українською мовою. Твоя ціль - демонструвати свої знання літератури.",
                    temperature=0.7
                )
                print(f"A:\n{response}")
            except Exception as e:
                print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(run_tests())
