#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Экспорт всех данных из SQLite в JavaScript с картинками
Работает без сервера - все встроено в JS
"""
import os
import json
import sqlite3
import shutil

# Пути
basedir = os.path.abspath(os.path.dirname(__file__))
# Ищем папку "работа курса" - может быть на уровень выше
possible_project_dirs = [
    os.path.join(os.path.dirname(basedir), "работа курса"),
    os.path.join(basedir, "..", "работа курса"),
    r"C:\Users\па\Desktop\работа курса"
]

project_dir = None
for pd in possible_project_dirs:
    abs_pd = os.path.abspath(pd)
    if os.path.exists(abs_pd):
        project_dir = abs_pd
        break

if not project_dir:
    print("ОШИБКА: Не найдена папка 'работа курса'")
    print("Проверенные пути:")
    for pd in possible_project_dirs:
        print(f"  - {os.path.abspath(pd)}")
    input("Нажмите Enter для выхода...")
    exit(1)

db_path = os.path.join(project_dir, "instance", "factory.db")
catalog_path = os.path.join(project_dir, "catalog")
output_js = os.path.join(basedir, "js", "equipment-data.js")
images_dir = os.path.join(basedir, "images", "equipment")

print("=" * 60)
print("Экспорт данных из SQLite с картинками")
print("=" * 60)

if not os.path.exists(db_path):
    print(f"ОШИБКА: База данных не найдена: {db_path}")
    print("Сначала запустите load_catalog_to_db.py для загрузки данных")
    input("Нажмите Enter для выхода...")
    exit(1)

# Подключаемся к базе
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

try:
    cursor.execute("SELECT * FROM equipment")
    rows = cursor.fetchall()
    
    print(f"\nНайдено оборудования: {len(rows)}")
    
    if len(rows) == 0:
        print("База данных пуста!")
        input("Нажмите Enter для выхода...")
        exit(1)
    
    # Создаем папку для картинок
    os.makedirs(images_dir, exist_ok=True)
    
    equipment_list = []
    copied_images = set()
    
    for idx, row in enumerate(rows, 1):
        eq = dict(row)
        
        # Нормализуем размеры
        width = eq.get('width', 1.5) or 1.5
        height = eq.get('height', 2.0) or 2.0
        length = eq.get('length', 3.0) or 3.0
        
        max_reasonable = 50.0
        if width > max_reasonable:
            width = width / 1000.0
        if height > max_reasonable:
            height = height / 1000.0
        if length > max_reasonable:
            length = length / 1000.0
        
        # Обрабатываем картинки
        photo_path = None
        gallery_images = []
        
        folder_path = eq.get('folder_path', '')
        photo_name = eq.get('photo', '')
        
        # Копируем главное фото
        if photo_name and folder_path:
            source_photo = os.path.join(catalog_path, folder_path, photo_name)
            if os.path.exists(source_photo):
                # Создаем уникальное имя для картинки
                safe_name = f"{eq.get('id', idx)}_{photo_name}"
                dest_photo = os.path.join(images_dir, safe_name)
                if safe_name not in copied_images:
                    shutil.copy2(source_photo, dest_photo)
                    copied_images.add(safe_name)
                photo_path = f"images/equipment/{safe_name}"
        
        # Обрабатываем галерею
        gallery_json = eq.get('gallery', '')
        if gallery_json:
            try:
                gallery_data = json.loads(gallery_json)
                for img in gallery_data:
                    if isinstance(img, dict) and 'src' in img:
                        img_name = img['src']
                        source_img = os.path.join(catalog_path, folder_path, img_name)
                        if os.path.exists(source_img):
                            safe_name = f"{eq.get('id', idx)}_{img_name}"
                            dest_img = os.path.join(images_dir, safe_name)
                            if safe_name not in copied_images:
                                shutil.copy2(source_img, dest_img)
                                copied_images.add(safe_name)
                            gallery_images.append(f"images/equipment/{safe_name}")
            except:
                pass
        
        # Парсим JSON поля
        input_materials = []
        output_materials = []
        
        if eq.get('input_materials'):
            try:
                input_materials = json.loads(eq['input_materials']) if isinstance(eq['input_materials'], str) else eq['input_materials']
            except:
                input_materials = [{"name": "Сырье", "quantity": 1.0, "unit": "м³"}]
        else:
            input_materials = [{"name": "Сырье", "quantity": 1.0, "unit": "м³"}]
        
        if eq.get('output_materials'):
            try:
                output_materials = json.loads(eq['output_materials']) if isinstance(eq['output_materials'], str) else eq['output_materials']
            except:
                output_materials = [{"name": "Продукция", "quantity": 0.9, "unit": "м³"}]
        else:
            output_materials = [{"name": "Продукция", "quantity": 0.9, "unit": "м³"}]
        
        # Формируем объект оборудования
        equipment = {
            "id": eq.get('id'),
            "name": eq.get('name', ''),
            "equipment_type": eq.get('equipment_type', ''),
            "category": eq.get('category', ''),
            "price": eq.get('price', ''),
            "url": eq.get('url', ''),
            "description": eq.get('description', ''),
            "photo": photo_path,
            "gallery": gallery_images,
            "specifications": json.loads(eq.get('specifications', '[]') or '[]') if eq.get('specifications') else [],
            "advantages": json.loads(eq.get('advantages', '[]') or '[]') if eq.get('advantages') else [],
            "fast_info": json.loads(eq.get('fast_info', '[]') or '[]') if eq.get('fast_info') else [],
            "folder_path": folder_path,
            "productivity": float(eq.get('productivity', 10.0) or 10.0),
            "cost": float(eq.get('cost', 0.0) or 0.0),
            "installation_cost": float(eq.get('installation_cost', 150000.0) or 150000.0),
            "power_consumption": float(eq.get('power_consumption', 7.0) or 7.0),
            "width": width,
            "height": height,
            "length": length,
            "accuracy": float(eq.get('accuracy', 0.5) or 0.5),
            "speed": float(eq.get('speed', 1.0) or 1.0),
            "reliability": float(eq.get('reliability', 0.95) or 0.95),
            "maintenance_interval": float(eq.get('maintenance_interval', 480.0) or 480.0),
            "noise_level": float(eq.get('noise_level', 75.0) or 75.0),
            "vibration_level": float(eq.get('vibration_level', 3.0) or 3.0),
            "temperature_range": eq.get('temperature_range', '15-25°C') or '15-25°C',
            "humidity_range": eq.get('humidity_range', '40-60%') or '40-60%',
            "operator_count": int(eq.get('operator_count', 1) or 1),
            "setup_time": float(eq.get('setup_time', 30.0) or 30.0),
            "cycle_time": float(eq.get('cycle_time', 60.0) or 60.0),
            "efficiency": float(eq.get('efficiency', 0.85) or 0.85),
            "input_materials": input_materials,
            "output_materials": output_materials,
            "daily_operation_cost": float(eq.get('daily_operation_cost', 700.0) or 700.0),
            "daily_maintenance_cost": float(eq.get('daily_maintenance_cost', 200.0) or 200.0)
        }
        
        equipment_list.append(equipment)
        
        if idx % 10 == 0:
            print(f"Обработано: {idx}/{len(rows)}")
    
    # Сохраняем в JavaScript файл
    js_content = "// Данные оборудования с картинками - загружаются напрямую в JavaScript\n"
    js_content += "// Этот файл автоматически обновляется при экспорте данных\n"
    js_content += "window.EQUIPMENT_DATA = " + json.dumps(equipment_list, ensure_ascii=False, indent=2) + ";\n"
    
    os.makedirs(os.path.dirname(output_js), exist_ok=True)
    with open(output_js, 'w', encoding='utf-8') as f:
        f.write(js_content)
    
    print(f"\n{'=' * 60}")
    print(f"✓ УСПЕШНО экспортировано {len(equipment_list)} единиц оборудования")
    print(f"  JavaScript файл: {output_js}")
    print(f"  Скопировано картинок: {len(copied_images)}")
    print(f"  Папка с картинками: {images_dir}")
    print(f"{'=' * 60}")
    
    print("\nПримеры экспортированного оборудования:")
    for eq in equipment_list[:5]:
        print(f"  - {eq['name']} ({eq['equipment_type']})")
        if eq.get('photo'):
            print(f"    Фото: {eq['photo']}")
    if len(equipment_list) > 5:
        print(f"  ... и еще {len(equipment_list) - 5} станков")
    
except Exception as e:
    print(f"Ошибка: {e}")
    import traceback
    traceback.print_exc()
finally:
    conn.close()

input("\nНажмите Enter для выхода...")

