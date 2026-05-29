import os
import time

from core.config import get_settings

db_file = get_settings().numpy_db_abs_path / "numpy_db.pkl"

print(f"Monitoring {db_file}...")

if not os.path.exists(db_file):
    print("File doesn't exist yet, waiting...")
    while not os.path.exists(db_file):
        time.sleep(1)

initial_mtime = os.path.getmtime(db_file)
print(f"Initial mtime: {initial_mtime}")

while True:
    current_mtime = os.path.getmtime(db_file)
    if current_mtime != initial_mtime:
        print("DB file updated! The current book has finished saving.")
        # Kill python processes related to ingestion
        print("Killing ingestion script...")
        os.system("taskkill /f /im python.exe")
        break
    time.sleep(2)
