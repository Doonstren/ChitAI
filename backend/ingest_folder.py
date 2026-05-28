import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ingestion.loader import BookLoader

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ingest_folder.py <directory_path>")
        sys.exit(1)
        
    dir_path = sys.argv[1]
    print(f"Starting ingestion from: {dir_path}")
    
    loader = BookLoader()
    results = loader.ingest_directory(dir_path)
    
    print(f"\nIngestion complete. Processed {len(results)} books.")
