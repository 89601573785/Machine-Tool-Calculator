import shutil
import os
import sys

# Получаем путь к текущему скрипту
script_dir = os.path.dirname(os.path.abspath(__file__))
data_dir = os.path.join(script_dir, 'data')
os.makedirs(data_dir, exist_ok=True)

# Путь к исходной базе данных (относительно папки "работа курса")
# Находим папку "работа курса" - она на уровень выше "server popa"
parent_dir = os.path.dirname(script_dir)
source_db = os.path.join(parent_dir, 'работа курса', 'instance', 'factory.db')

# Путь к целевой базе данных
target_db = os.path.join(data_dir, 'factory.db')

print(f'Исходная БД: {source_db}')
print(f'Целевая БД: {target_db}')

if os.path.exists(source_db):
    shutil.copy2(source_db, target_db)
    print(f'✓ База данных скопирована в {target_db}')
    print(f'Размер файла: {os.path.getsize(target_db)} байт')
else:
    print(f'✗ Исходная база данных не найдена: {source_db}')
    print('Проверьте путь к базе данных')
    sys.exit(1)

