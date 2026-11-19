"""Build the static save-ID catalog from the audited local reference tables."""
import csv
import json
from collections import defaultdict
from pathlib import Path


WEB = Path(__file__).resolve().parents[1]
REFERENCES = WEB.parent / "saveEditor"
XX = REFERENCES / "mhgu-xx-se/data/cn"
GU = REFERENCES / "MHGU-Save-editor/data"


def rows(directory, table):
    with (directory / f"{table}.csv").open(encoding="utf-8-sig", newline="") as file:
        yield from csv.DictReader(file)


def numbers(row, *fields):
    return [int(row[field]) for field in fields]


def names(table):
    return {int(row["id"]): row["name"] for row in rows(XX, table)}


def build():
    tables = [
        "armor_head", "armor_chest", "armor_arms", "armor_waist", "armor_legs", "talismans",
        "weapon_great_sword", "weapon_sword_and_shield", "weapon_hammer", "weapon_lance",
        "weapon_heavy_bowgun", None, "weapon_light_bowgun", "weapon_long_sword", "weapon_switch_axe",
        "weapon_gunlance", "weapon_bow", "weapon_dual_blades", "weapon_hunting_horn",
        "weapon_insect_glaive", "weapon_charge_blade", "palico_weapons", "palico_head", "palico_armor",
    ]
    gear = {}
    for kind, table in enumerate(tables, 1):
        if table is None:
            continue
        gear[kind] = {}
        for row in rows(XX, table):
            item_id = int(row["id"])
            if item_id == 0:
                continue
            entry = {"name": row["name"]}
            if kind <= 5:
                entry["slots"] = int(row["slots"])
            if kind == 6:
                entry["charm"] = numbers(row, "rarity", "max_slots")
            gear[kind][item_id] = entry

    for row in rows(XX, "weapon_level_slots"):
        kind, item_id, level, slots = numbers(row, "equipment_type", "weapon_id", "save_level", "slots")
        if item_id in gear[kind]:
            gear[kind][item_id].setdefault("levels", {})[level + 1] = slots
    for row in rows(XX, "armor_skill_points"):
        kind, item_id, skill, points = numbers(row, "equipment_type", "armor_id", "skill_id", "points")
        gear[kind][item_id].setdefault("skills", []).append([skill, points])
    for row in rows(XX, "armor_stats"):
        kind, item_id = numbers(row, "equipment_type", "armor_id")
        gear[kind][item_id]["status"] = numbers(
            row, "base_defense", "fire_res", "water_res", "thunder_res", "ice_res", "dragon_res"
        )

    jewels = {
        int(row["id"]): {"name": row["name"], "cost": int(row["slot_cost"])}
        for row in rows(XX, "decorations") if int(row["slot_cost"]) > 0
    }
    for row in rows(XX, "decoration_skill_points"):
        item_id, skill, points = numbers(row, "decoration_id", "skill_id", "points")
        if item_id in jewels:
            jewels[item_id].setdefault("skills", []).append([skill, points])

    limits = defaultdict(dict)
    for row in rows(XX, "talisman_skill_limits"):
        charm, skill, *bounds = numbers(row, "talisman_id", "skill_id", "skill1_min", "skill1_max", "skill2_min", "skill2_max")
        if skill and any(bounds):
            limits[charm][skill] = bounds
    charm_slots = defaultdict(dict)
    for row in rows(XX, "talisman_slot_thresholds"):
        marker, value, *thresholds = numbers(row, "rarity_marker", "fulfillment", "slot1_threshold", "slot2_threshold", "slot3_threshold")
        charm_slots[marker][value] = max([0] + [i for i, threshold in enumerate(thresholds, 1) if threshold < 100])
    thresholds = defaultdict(list)
    for row in rows(XX, "active_skills"):
        thresholds[int(row["skill_id"])].append([int(row["points"]), row["name"]])

    skill_cost = {int(row["id"]): int(row["cost"]) for row in rows(GU, "palico-actions") if row["kind"] == "skill" and row["cost"]}
    palico = {
        "fortes": names("palico_fortes"),
        "targets": names("palico_targets"),
        "levels": {int(row["level"]): numbers(row, "support_slots", "skill_slots") for row in rows(GU, "palico-levels")},
        "native": json.loads((REFERENCES / "mhgu-xx-se/tools/reference/palico_native_rules.json").read_text(encoding="utf-8")),
    }
    for kind, table in [("moves", "palico_support_moves"), ("skills", "palico_skills")]:
        palico[kind] = {
            int(row["id"]): [row["name"], row["generation_group"], int(row["teachable"]),
                             skill_cost.get(int(row["id"])) if kind == "skills" else None, row["role"]]
            for row in rows(XX, table)
        }

    return {
        "items": {int(row["id"]): [row["name"], bool("dummy" in (row["name"] + row["english"]).lower())]
                  for row in rows(XX, "items")},
        "gear": gear, "jewels": jewels, "skills": names("skills"), "thresholds": thresholds,
        "charmLimits": limits, "charmSlots": charm_slots,
        "palico": palico, "arts": {int(row["id"]): row["name"] for row in rows(GU, "hunter-arts")},
        "eventNames": {int(row["quest_id"]): row["name"] for row in rows(GU, "quest-index")
                       if row["category"] in ("Event Hub", "Event Arena")},
    }


if __name__ == "__main__":
    (WEB / "public/save-catalog.json").write_text(
        json.dumps(build(), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
