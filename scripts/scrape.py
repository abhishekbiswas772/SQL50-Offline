"""Scrape LeetCode SQL50 study plan and build a PostgreSQL practice script.

Usage:  python scrape.py
Output: sql50.sql (one schema per problem, e.g. q1757) and problems/*.md descriptions.
"""
import html, json, re, time, urllib.request
from pathlib import Path

GQL = "https://leetcode.com/graphql"
OUT = Path(__file__).resolve().parent.parent / "data"


def gql(query, variables, referer="https://leetcode.com/"):
    req = urllib.request.Request(GQL, json.dumps({"query": query, "variables": variables}).encode(),
                                 {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0", "Referer": referer})
    return json.load(urllib.request.urlopen(req))["data"]


def to_pg(stmt):
    """Convert one LeetCode MySQL schema statement to PostgreSQL."""
    s = stmt.replace("`", "")
    s = re.sub(r"\benum\s*\([^)]*\)", "varchar(32)", s, flags=re.I)
    s = re.sub(r"\bdatetime\b", "timestamp", s, flags=re.I)
    s = re.sub(r"\bfloat\s*\(\s*\d+\s*,\s*\d+\s*\)", "float", s, flags=re.I)
    s = re.sub(r"'None'", "NULL", s)  # LeetCode writes NULLs as 'None'
    return s.rstrip(";") + ";"


def strip_html(c):
    c = re.sub(r"<br\s*/?>|</p>|</li>|</pre>", "\n", c or "")
    c = re.sub(r"<li>", "- ", c)
    c = re.sub(r"<[^>]+>", "", c)
    return re.sub(r"\n{3,}", "\n\n", html.unescape(c)).strip()


def main():
    plan = gql("query($s:String!){studyPlanV2Detail(planSlug:$s){planSubGroups{name questions{titleSlug}}}}",
               {"s": "top-sql-50"})["studyPlanV2Detail"]["planSubGroups"]
    qs = []
    for g in plan:
        for q in g["questions"]:
            d = gql("query($s:String!){question(titleSlug:$s){questionFrontendId title titleSlug difficulty content mysqlSchemas}}",
                    {"s": q["titleSlug"]}, f"https://leetcode.com/problems/{q['titleSlug']}/")["question"]
            d["group"] = g["name"]
            qs.append(d)
            print(d["questionFrontendId"], d["title"])
            time.sleep(0.4)

    (OUT / "problems").mkdir(exist_ok=True)
    sql = ["-- LeetCode SQL50 practice DB. Each problem lives in its own schema: SET search_path TO q<id>;",
           "DROP TABLE IF EXISTS public.problems;",
           "CREATE TABLE public.problems (seq int PRIMARY KEY, id int, title text, difficulty text, topic text, schema_name text, url text, description text);"]
    for i, d in enumerate(qs, 1):
        sch, url = f"q{d['questionFrontendId']}", f"https://leetcode.com/problems/{d['titleSlug']}/"
        desc = strip_html(d["content"])
        sql += [f"\n-- {d['questionFrontendId']}. {d['title']} ({d['difficulty']}, {d['group']})",
                f"DROP SCHEMA IF EXISTS {sch} CASCADE;", f"CREATE SCHEMA {sch};", f"SET search_path TO {sch};"]
        sql += [to_pg(s) for s in d["mysqlSchemas"]]
        sql.append("INSERT INTO public.problems VALUES (%d, %s, %s, '%s', '%s', '%s', '%s', %s);" % (
            i, d["questionFrontendId"], "'" + d["title"].replace("'", "''") + "'", d["difficulty"], d["group"], sch, url,
            "$desc$" + desc + "$desc$"))
        (OUT / "problems" / f"{i:02d}-{d['questionFrontendId']}-{d['titleSlug']}.md").write_text(
            f"# {d['questionFrontendId']}. {d['title']}\n\n{d['difficulty']} | {d['group']} | {url}\n\n"
            f"Practice: `SET search_path TO {sch};`\n\n{desc}\n", encoding="utf-8")
    sql.append("SET search_path TO public;")
    (OUT / "sql50.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
    print(f"wrote sql50.sql with {len(qs)} problems")


if __name__ == "__main__":
    main()
