import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from core.config import get_settings
from google import genai

settings = get_settings()
client = genai.Client(api_key=settings.GEMINI_API_KEY)

print("Listing models:")
for m in client.models.list():
    if "embed" in m.name.lower():
        print(f"- {m.name}")
