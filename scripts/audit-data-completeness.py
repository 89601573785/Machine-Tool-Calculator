#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Аудит полноты данных equipment в factory.db. Запуск: python scripts/audit-data-completeness.py"""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "factory.db"

KEY_FIELDS = [
    "productivity", "cost", "power_consumption", "width", "height", "length",
    "efficiency", "input_materials", "output_materials", "installation_cost",
    "daily_operation_cost", "daily_maintenance_cost", "cycle_time",
    "operator_count", "speed", "price", "equipment_type", "category",
]

DERIVED_CANDIDATES = [
    ("efficiency", "дефолт 0.85 по категории, если NULL"),
    ("input_materials", "из шаблона категории: input_type + unit"),
    ("output_materials", "из шаблона категории: output_type + unit"),
    ("cycle_time", "360 / productivity при известной смене, или константа категории"),
    ("cost", "оставить NULL / «Цена по запросу», не выдумывать"),
]


def is_filled(field: str, value) -> bool:
    if value is None or value == "":
        return False
    if field in ("input_materials", "output_materials"):
        try:
            arr = json.loads(value) if isinstance(value, str) else value
            return bool(arr)
        except (json.JSONDecodeError, TypeError):
            return False
    if field == "cost" and value == 0:
        return False
    if field in ("efficiency", "cycle_time", "speed", "operator_count") and value == 0:
        return False
    return True


def main() -> int:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    if not DB.exists():
        print(f"Не найден: {DB}")
        return 1

    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(equipment)")
    cols = [r[1] for r in cur.fetchall()]
    cur.execute("SELECT * FROM equipment")
    rows = cur.fetchall()
    col_idx = {name: i for i, name in enumerate(cols)}
    total = len(rows)

    print(f"Записей: {total}\n")
    print("=== Общая заполненность ===")
    for field in KEY_FIELDS:
        if field not in col_idx:
            continue
        filled = sum(1 for row in rows if is_filled(field, row[col_idx[field]]))
        pct = 100 * filled / total if total else 0
        flag = " ⚠" if pct < 80 else ""
        print(f"  {field:26s} {pct:5.1f}% ({filled}/{total}){flag}")

    by_cat: dict[str, list] = {}
    for row in rows:
        cat = row[col_idx["category"]] or row[col_idx["equipment_type"]] or "?"
        by_cat.setdefault(cat, []).append(row)

    print("\n=== По категориям (пробелы < 100%) ===")
    for cat, items in sorted(by_cat.items(), key=lambda x: -len(x[1])):
        n = len(items)
        gaps = []
        for field in KEY_FIELDS:
            if field not in col_idx:
                continue
            filled = sum(1 for row in items if is_filled(field, row[col_idx[field]]))
            pct = 100 * filled / n
            if pct < 100:
                gaps.append(f"{field}:{pct:.0f}%")
        gap_str = ", ".join(gaps[:8]) if gaps else "все отслеживаемые поля 100%"
        print(f"  {n:2d} | {cat[:42]:42s} | {gap_str}")

    print("\n=== Что можно вычислить, а не придумывать ===")
    for field, rule in DERIVED_CANDIDATES:
        print(f"  • {field}: {rule}")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
