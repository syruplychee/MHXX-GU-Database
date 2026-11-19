# /// script
# dependencies = ["beautifulsoup4==4.15.0", "rapidfuzz==3.14.6"]
# ///
"""Build the quest supplement from a checkout of jestar719/mhgu."""

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import unicodedata

from bs4 import BeautifulSoup, NavigableString, Tag
from rapidfuzz.fuzz import ratio


WEBAPP = Path(__file__).resolve().parents[1]
PAGE_LEVELS = {page: [page - 1998] for page in range(2011, 2031)}
PAGE_LEVELS.update({2996: [33], 2036: [34], 2997: [34], 2031: [36, 37],
                    2032: [38, 39, 40, 41], 2033: [42, 43, 44, 45]})
TYPES = {'采集': 1, '讨伐': 2, '狩猎': 3, '捕获': 4, '特殊': 5,
         '连续狩猎': 6, '大连续狩猎': 7, '连续': 6, '大连续': 7}
ICON_KINDS = {'kariwaza': 'arts', 'meat': 'food', 'etc': 'facilities',
              'soubi': 'gear', 'otomo': 'companions', 'treasure': 'other'}
SOURCE_PATH = re.compile(r'^(?:\.\./)?((?:ida|data)/\d+\.html(?:#(?:id|quest)\d+)?)$')


def read_html(root, path):
    return BeautifulSoup((root / path).read_text(encoding='utf-8'), 'html.parser')


def text(node):
    return ' '.join(node.stripped_strings)


def normalized(value):
    value = unicodedata.normalize('NFKC', value or '').lower()
    replacements = {'的': '', '在': '', '古代林': '古代森林',
                    '納品': '缴纳', '交纳': '缴纳', '纳品': '缴纳', '交付': '缴纳',
                    '採集': '采集', '討伐': '讨伐', '狩獵': '狩猎', '個': '个', '頭': '头',
                    '鱗': '鳞', '竜': '龙', '龍': '龙'}
    for old, new in replacements.items():
        if old == '古代林':
            value = re.sub(r'古代林(?!森)', new, value)
        else:
            value = value.replace(old, new)
    return re.sub(r'[^\w]', '', value, flags=re.UNICODE)


def number(value):
    match = re.search(r'\d+', value.replace(',', ''))
    return int(match[0]) if match else 0


def objective(value):
    value = normalized(value)
    return re.sub(r'缴纳|狩猎|讨伐|击退|交付|捕获|破坏|头|只|个|根|王|\d', '', value)


def parts(node, mapping):
    result = []
    for child in node.children:
        if isinstance(child, NavigableString):
            value = re.sub(r'\s+', ' ', str(child)).strip()
            if value:
                result.append(value)
            continue
        if not isinstance(child, Tag) or child.name == 'img':
            continue
        if child.name == 'br':
            if result and result[-1] != '\n':
                result.append('\n')
            continue
        href = SOURCE_PATH.match(child.get('href', '')) if child.name == 'a' else None
        if href:
            path = href[1]
            link = {'label': text(child), 'path': path}
            if path in mapping:
                link['quest'] = mapping[path]
            result.append(link)
        else:
            result.extend(parts(child, mapping))
    return result


def clean_parts(values):
    while values and values[-1] == '\n':
        values.pop()
    return values


def fields_of(page):
    fields = {}
    for th in page.select('table.t2 th'):
        value = th.find_next_sibling()
        if value and value.name == 'td':
            fields.setdefault(text(th), text(value))
    return fields


def source_quests(root):
    quests = {}
    for page, levels in PAGE_LEVELS.items():
        listing = read_html(root, f'data/{page}.html')
        for panel in listing.select('.panel_grp[id^="quest"]'):
            heading = panel.select_one('.panel-heading')
            link = heading.select_one('a[href^="../ida/"]')
            if not link:
                continue
            path = link['href'][3:]
            if path in quests:
                continue
            detail = read_html(root, path)
            fields = fields_of(detail)
            if '主任务' not in fields:
                continue
            kinds = {ICON_KINDS[Path(img['src']).stem] for img in heading.select('img[src]')
                     if Path(img['src']).stem in ICON_KINDS}
            quests[path] = {'levels': levels, 'name': text(link), 'page': detail, 'fields': fields, 'kinds': kinds}
    return quests


def possible_matches(source, local):
    fields = source['fields']
    pool = [q for q in local if q['level'] in source['levels']]
    name = normalized(source['name'])
    exact = [q for q in pool if name and name == normalized(q['name'])]
    stat_names = {'制限时間': 'time', '制限时间': 'time', '报酬金': 'reward', '副任务报酬': 'sub', '契约金': 'fee'}
    stats = {key: number(fields[label]) for label, key in stat_names.items() if label in fields}
    kind = TYPES.get(fields.get('种类'))
    signature = [q for q in pool if len(stats) >= 3 and all(q[key] == val for key, val in stats.items())]
    goal = fields['主任务']
    subgoal = fields.get('副任务', '')
    target = objective(goal)
    map_name = normalized(fields.get('目的地', ''))
    ranked = []
    for q in signature:
        goal_score = max(ratio(normalized(goal), normalized(q['goal'])), ratio(target, objective(q['goal'])) if target else 0)
        name_score = ratio(name, normalized(q['name']))
        sub_score = max(ratio(normalized(subgoal), normalized(q['subgoal'])), ratio(objective(subgoal), objective(q['subgoal'])))
        map_score = 8 if map_name and map_name == normalized(q['location']) else 0
        if sorted(re.findall(r'\d+', normalized(goal))) != sorted(re.findall(r'\d+', normalized(q['goal']))):
            continue
        if goal_score < 64 and name_score < 76:
            continue
        ranked.append((goal_score * .55 + name_score * .35 + sub_score * .1 + map_score + (3 if kind == q['type'] else 0), q['id']))
    ranked.sort(reverse=True)
    if len(exact) == 1:
        q = exact[0]
        if not signature or q in signature or ratio(normalized(goal), normalized(q['goal'])) >= 75:
            return 200, q['id']
    if ranked and (len(ranked) == 1 or ranked[0][0] - ranked[1][0] >= 8):
        return ranked[0]
    return None


def supplement(source, mapping, food_names):
    result = {'flags': sorted(source['kinds'])}
    for panel in source['page'].select('.panel.text-center'):
        heading = panel.select_one(':scope > .panel-heading')
        body = panel.select_one(':scope > .panel-body')
        if not heading:
            continue
        title = text(heading)
        if body and title == '前置任务':
            result['conditions'] = clean_parts(parts(body, mapping))
        if body and '狩技' in title and '开放' in title:
            result['arts'] = clean_parts(parts(body, mapping))
        if body and '狩技' not in title and any(word in title for word in ('开放', '解放', '追加', '设施')):
            result.setdefault('extras', []).append({'title': title, 'parts': clean_parts(parts(body, mapping))})
        if title != '委托':
            continue
        for entry in panel.select(':scope > ul > li'):
            label = entry.find('span', recursive=False)
            if not label:
                continue
            label_text = text(label)
            label.extract()
            content = clean_parts(parts(entry, mapping))
            if '食材' in label_text:
                result.setdefault('food', []).extend(food_names.get(part, part) if isinstance(part, str) else part for part in content)
            elif '条件' in label_text or '受注' in label_text:
                result.setdefault('request', []).append({'title': label_text.strip('[]'), 'parts': content})
            else:
                result.setdefault('extras', []).append({'title': label_text, 'parts': content})
    return {key: value for key, value in result.items() if value}


def add_key_quest_links(quests, local):
    for quest in quests.values():
        condition = quest.get('conditions', [])
        if len(condition) != 1 or not isinstance(condition[0], str):
            continue
        match = re.fullmatch(r'(村|集|G)★(\d+)的?关键任务全部完成之后[。]?', condition[0])
        if not match:
            continue
        level = {'村': 12, '集': 22, 'G': 29}[match[1]] + int(match[2])
        keys = [q for q in local if q['level'] == level and q['key'] == 1]
        for key in keys:
            condition.extend(['\n', {'label': key['name'], 'quest': key['id']}])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkout', type=Path)
    args = parser.parse_args()
    ref = args.checkout
    commit = subprocess.check_output(['git', '-C', str(ref), 'rev-parse', 'HEAD'], text=True).strip()
    with sqlite3.connect((WEBAPP / 'data/mhxx_dex.sqlite').as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        local = db.execute('''SELECT Qst_ID id, Qst_Lv_ID level, Qst_Type_ID type, Time time, Fee fee,
            Reward reward, Reward2 sub, Qst_Name_1 name, Qst_Goal_1 goal, Qst_Goal2_1 subgoal,
            Loc_Name_1 location, Qst_Key_ID key
            FROM DB_Qst JOIN ID_Qst_Name USING(Qst_ID) JOIN ID_Qst_Goal USING(Qst_ID)
            JOIN ID_Qst_Goal2 USING(Qst_ID) LEFT JOIN ID_Loc_Name USING(Loc_ID)''').fetchall()
    sources = source_quests(ref / 'app/src/main/assets/mhxx')
    candidates = defaultdict(list)
    for path, source in sources.items():
        match = possible_matches(source, local)
        if match:
            score, quest = match
            candidates[quest].append((score, path))
    mapping = {}
    for quest, choices in candidates.items():
        choices.sort(reverse=True)
        if len(choices) == 1 or choices[0][0] - choices[1][0] >= 8:
            mapping[choices[0][1]] = quest
    food_names = json.loads((ref / 'temp/translated/food.json').read_text(encoding='utf-8'))['shicai']
    quests = {quest: {'path': path, **supplement(sources[path], mapping, food_names)} for path, quest in mapping.items()}
    add_key_quest_links(quests, local)
    lines = [f'    "{quest}": {json.dumps(note, ensure_ascii=False, separators=(",", ":"))}' for quest, note in sorted(quests.items())]
    output = '{\n  "commit": ' + json.dumps(commit) + ',\n  "quests": {\n' + ',\n'.join(lines) + '\n  }\n}\n'
    (WEBAPP / 'data/quest-reference.json').write_text(output, encoding='utf-8', newline='\n')
    print(f'{len(sources)} reference pages, {len(quests)} matched out of {len(local)} local quests')
    print(dict(Counter(key for quest in quests.values() for key in quest if key != 'path')))


if __name__ == '__main__':
    main()
