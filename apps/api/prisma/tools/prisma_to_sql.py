#!/usr/bin/env python3
"""
Best-effort Prisma-schema -> PostgreSQL DDL translator, written for exactly
one purpose: this cloud sandbox cannot reach binaries.prisma.sh (org policy
— confirmed by testing `prisma generate`, `prisma format`, and `prisma
validate`, all three fail identically), so there is no way to run any real
Prisma tooling against schema.prisma here. This script is NOT a general
Prisma compiler — it's a small, direct regex parser tuned to the exact
conventions this one schema.prisma file already uses (every model already
follows the same handful of patterns), so it can turn the schema into real
CREATE TABLE / CREATE TYPE statements and hand them to an actual PostgreSQL
server. That's a genuinely useful structural check — reserved words, FK
target validity, duplicate constraint names, type validity — even though
it is not a substitute for Prisma's own schema engine, and its default
onDelete inference (RESTRICT when a relation doesn't specify one) is an
approximation, not a guarantee of matching Prisma's exact default
referential action.

Usage: python3 prisma_to_sql.py ../schema.prisma > /tmp/potg_schema.sql
"""
import re
import sys

def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "schema.prisma"
    with open(path) as f:
        text = f.read()

    # Strip line comments (// ...) — none of this schema's field lines
    # contain a literal "//" inside a string default, so this is safe here.
    text = re.sub(r"//.*", "", text)

    enums = {}  # name -> [values]
    for m in re.finditer(r"enum\s+(\w+)\s*\{([^}]*)\}", text):
        name = m.group(1)
        values = [v.strip() for v in m.group(2).split() if v.strip()]
        enums[name] = values

    models = []  # (model_name, table_name, fields, model_level_attrs)
    for m in re.finditer(r"model\s+(\w+)\s*\{([^}]*)\}", text):
        model_name = m.group(1)
        body = m.group(2)
        lines = [l.strip() for l in body.splitlines() if l.strip()]
        table_name = model_name
        fields = []  # dicts
        composite_id = None
        unique_constraints = []
        for line in lines:
            map_m = re.match(r'@@map\("([^"]+)"\)', line)
            if map_m:
                table_name = map_m.group(1)
                continue
            id_m = re.match(r"@@id\(\[([^\]]+)\]\)", line)
            if id_m:
                composite_id = [x.strip() for x in id_m.group(1).split(",")]
                continue
            uniq_m = re.match(r"@@unique\(\[([^\]]+)\]\)", line)
            if uniq_m:
                unique_constraints.append([x.strip() for x in uniq_m.group(1).split(",")])
                continue
            if line.startswith("@@"):
                continue  # other block attrs (e.g. @@index) — none in this schema today

            # A field line: name Type[?][] attr1 attr2 ...
            fm = re.match(r"(\w+)\s+([\w\.]+)(\[\])?(\?)?\s*(.*)", line)
            if not fm:
                continue
            fname, ftype, is_array, is_optional, rest = fm.groups()
            is_relation = "@relation" in rest or (
                ftype[0].isupper() and ftype not in enums and ftype not in
                ("String", "Int", "Float", "Boolean", "DateTime", "Decimal", "Json")
            )
            fields.append({
                "name": fname,
                "type": ftype,
                "array": bool(is_array),
                "optional": bool(is_optional),
                "rest": rest,
                "is_relation": is_relation,
            })
        models.append({
            "model": model_name,
            "table": table_name,
            "fields": fields,
            "composite_id": composite_id,
            "unique": unique_constraints,
        })

    model_by_name = {m["model"]: m for m in models}

    def scalar_sql_type(f):
        t = f["type"]
        if t in enums:
            base = f'"{t}"'
        elif t == "String":
            base = "TEXT"
        elif t == "Int":
            base = "INTEGER"
        elif t == "Float":
            base = "DOUBLE PRECISION"
        elif t == "Boolean":
            base = "BOOLEAN"
        elif t == "DateTime":
            base = "TIMESTAMP(3)"
        elif t == "Json":
            base = "JSONB"
        elif t == "Decimal":
            dec_m = re.search(r"@db\.Decimal\((\d+),\s*(\d+)\)", f["rest"])
            base = f"NUMERIC({dec_m.group(1)},{dec_m.group(2)})" if dec_m else "NUMERIC(65,30)"
        else:
            base = "TEXT"
        if f["array"]:
            base += "[]"
        return base

    def default_clause(f):
        rest = f["rest"]
        if "@updatedAt" in rest:
            # Prisma-generated migrations give an @updatedAt column a real
            # DB-level DEFAULT CURRENT_TIMESTAMP too (the application then
            # overwrites it on every update) — without it, any INSERT that
            # doesn't set it explicitly fails NOT NULL.
            return " DEFAULT now()"
        dm = re.search(r"@default\(((?:[^()]|\([^()]*\))*)\)", rest)
        if not dm:
            return ""
        val = dm.group(1).strip()
        if val == "now()":
            return " DEFAULT now()"
        if val == "uuid()" or val == "cuid()":
            return " DEFAULT gen_random_uuid()::text"
        if val == "[]":
            return " DEFAULT '{}'"
        if val in ("true", "false"):
            return f" DEFAULT {val}"
        if re.match(r"^-?\d+(\.\d+)?$", val):
            return f" DEFAULT {val}"
        if val.startswith('"') and val.endswith('"'):
            return f" DEFAULT '{val[1:-1]}'"
        # Bare identifier default, e.g. an enum member like INDIVIDUAL
        return f" DEFAULT '{val}'"

    out = []
    out.append('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
    out.append("")

    for name, values in enums.items():
        vals = ", ".join(f"'{v}'" for v in values)
        out.append(f'CREATE TYPE "{name}" AS ENUM ({vals});')
    out.append("")

    # Pass 1: tables + columns + inline constraints (PK, per-field UNIQUE).
    for m in models:
        cols = []
        pk_cols = m["composite_id"]
        for f in m["fields"]:
            if f["is_relation"]:
                continue
            col_sql = f'  "{f["name"]}" {scalar_sql_type(f)}'
            if "@id" in f["rest"]:
                col_sql += " PRIMARY KEY"
            if not f["optional"] and not f["array"]:
                col_sql += " NOT NULL"
            if "@unique" in f["rest"] and "@@unique" not in f["rest"]:
                col_sql += " UNIQUE"
            col_sql += default_clause(f)
            cols.append(col_sql)

        constraints = []
        if pk_cols:
            quoted = ", ".join(f'"{c}"' for c in pk_cols)
            constraints.append(f"  PRIMARY KEY ({quoted})")
        for uniq in m["unique"]:
            quoted = ", ".join(f'"{c}"' for c in uniq)
            constraints.append(f"  UNIQUE ({quoted})")

        body = ",\n".join(cols + constraints)
        out.append(f'CREATE TABLE "{m["table"]}" (\n{body}\n);')
        out.append("")

    # Pass 2: foreign keys, added after every table exists so FK target
    # ordering never matters.
    on_delete_map = {"Cascade": "CASCADE", "SetNull": "SET NULL", "Restrict": "RESTRICT", "NoAction": "NO ACTION"}
    for m in models:
        for f in m["fields"]:
            if not f["is_relation"]:
                continue
            rel_m = re.search(r"@relation\(([^)]*)\)", f["rest"])
            if not rel_m:
                continue  # the back-reference side of a relation has no @relation(fields:...) — nothing to emit
            rel_args = rel_m.group(1)
            fields_m = re.search(r"fields:\s*\[([^\]]+)\]", rel_args)
            refs_m = re.search(r"references:\s*\[([^\]]+)\]", rel_args)
            if not fields_m or not refs_m:
                continue
            local_cols = [x.strip() for x in fields_m.group(1).split(",")]
            ref_cols = [x.strip() for x in refs_m.group(1).split(",")]
            target_model = model_by_name.get(f["type"])
            if not target_model:
                print(f"-- WARNING: relation target model {f['type']} not found for {m['model']}.{f['name']}", file=sys.stderr)
                continue
            on_delete_m = re.search(r"onDelete:\s*(\w+)", rel_args)
            on_delete = on_delete_map.get(on_delete_m.group(1), "RESTRICT") if on_delete_m else "RESTRICT"
            local_quoted = ", ".join(f'"{c}"' for c in local_cols)
            ref_quoted = ", ".join(f'"{c}"' for c in ref_cols)
            fk_name = f'fk_{m["table"]}_{"_".join(local_cols)}'
            out.append(
                f'ALTER TABLE "{m["table"]}" ADD CONSTRAINT "{fk_name}" '
                f'FOREIGN KEY ({local_quoted}) REFERENCES "{target_model["table"]}" ({ref_quoted}) '
                f'ON DELETE {on_delete};'
            )

    print("\n".join(out))


if __name__ == "__main__":
    main()
