#!/usr/bin/env python3
"""
Normalize DZS tourism datasets (Table 1.2, 1.3, 1.9) + Croatia counties GeoJSON
into D3.js-friendly files (UTF-8, tidy/long formats, stable join keys).

How to run (from repo root):
  python normalize_data.py

Expected input files (any of the two options below):

Option A) Put raw files in ./data/
  data/table1.2.csv
  data/table1.3.csv
  data/table1.9.csv
  data/zupanije_GeoJson.json   (or zupanije.geojson)

Option B) Provide zip (default ./data.zip or ./data/data.zip)
  data.zip contains the same 4 files above.

Outputs will be written to:
  data/normalized/
"""

from __future__ import annotations
import argparse
import io
import json
import os
import re
import unicodedata
from pathlib import Path

import pandas as pd


# ----------------------------- Helpers -----------------------------

MONTH_MAP = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12
}

def strip_diacritics(s: str) -> str:
    """Remove diacritics (čćžšđ -> c c z s d) and normalize to ASCII-ish."""
    if s is None:
        return ""
    # Normalize unicode -> decomposed form, drop combining marks
    s_norm = unicodedata.normalize("NFKD", s)
    s_no = "".join(ch for ch in s_norm if not unicodedata.combining(ch))
    # Handle đ/Đ (sometimes not decomposed)
    s_no = s_no.replace("đ", "d").replace("Đ", "D")
    return s_no

def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip())

def slugify_county(s: str) -> str:
    """
    Produce a stable 'county_key' usable to join CSV rows with GeoJSON.
    Works for:
      - GeoJSON ZUP_NAZIV: "Krapinsko-zagorska županija"
      - Table 1.3 spatial unit: "County of Krapina-Zagorje"
      - City of Zagreb
    """
    s0 = normalize_spaces(s)
    if not s0:
        return ""

    # Remember whether it was city/county
    is_city = s0.lower().startswith("city of ")

    low = s0.lower()
    low = re.sub(r"^(county of|city of)\s+", "", low)

    # Replace punctuation/hyphens with spaces
    low = low.replace("-", " ").replace("–", " ").replace("/", " ")
    low = re.sub(r"[().,]", " ", low)

    # Remove common suffixes in Croatian
    low = low.replace(" zupanija", " ")
    low = low.replace(" zupani", " ")   # handles truncated "župani"
    low = low.replace(" county", " ")

    low = strip_diacritics(low)

    low = normalize_spaces(low)

    # English -> Croatian county-name normalizations (to match GeoJSON)
    # After removing "County of", English forms are like "krapina zagorje".
    english_to_cro = {
        "zagreb": "zagrebacka",  # county of Zagreb
        "krapina zagorje": "krapinsko zagorska",
        "sisak moslavina": "sisacko moslavacka",
        "karlovac": "karlovacka",
        "varazdin": "varazdinska",
        "koprivnica krizevci": "koprivnicko krizevacka",
        "bjelovar bilogora": "bjelovarsko bilogorska",
        "primorje gorski kotar": "primorsko goranska",
        "lika senj": "licko senjska",
        "virovitica podravina": "viroviticko podravska",
        "pozega slavonia": "pozesko slavonska",
        "brod posavina": "brodsko posavska",
        "zadar": "zadarska",
        "osijek baranja": "osjecko baranjska",
        "sibenik knin": "sibensko kninska",
        "vukovar srijem": "vukovarsko srijemska",
        "split dalmatia": "splitsko dalmatinska",
        "istra": "istarska",
        "dubrovnik neretva": "dubrovacko neretvanska",
        "medimurje": "medimurska",
    }

    # Special case: City of Zagreb must join GeoJSON "Grad Zagreb"
    if is_city and low == "zagreb":
        return "grad zagreb"

    return english_to_cro.get(low, low)


def parse_number(x):
    """Parse numbers + handle '-', 'z', '....', '' safely."""
    if x is None:
        return None
    s = str(x).strip()
    if s == "" or s == "-" or s.lower() == "z" or s == "....":
        return None
    # handle European decimals if any
    s = s.replace("\u00a0", "")  # non-breaking space
    # "1.234,56" -> "1234.56"
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s and "." not in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def read_px_csv(path_or_bytes: bytes | str | Path, encoding_hint: str = "utf-8") -> pd.DataFrame:
    """
    DZS PXWeb exports often have:
      line 1: "Table ... title"
      line 2: empty
      line 3: actual header
    so we read CSV with skiprows=2.
    """
    if isinstance(path_or_bytes, (str, Path)):
        raw = Path(path_or_bytes).read_bytes()
    else:
        raw = path_or_bytes

    for enc in [encoding_hint, "utf-8", "cp1250", "latin1"]:
        try:
            txt = raw.decode(enc)
            df = pd.read_csv(io.StringIO(txt), skiprows=2)
            return df
        except Exception:
            continue
    # fallback: decode with replacement
    txt = raw.decode("utf-8", errors="replace")
    return pd.read_csv(io.StringIO(txt), skiprows=2)


# ------------------------ Normalization steps ------------------------

def normalize_table12(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Table 1.2 / 1.1: Croatia totals by month (rows) with columns like:
      2020 total arrivals, 2020 total nights, 2020 domestic ..., 2020 foreign ...
    Output:
      (1) tidy long: year, month, month_name, segment, metric, value
      (2) wide per month: year, month, total_arrivals, total_nights, domestic_arrivals, ...
    """
    df = df.copy()
    df["Month"] = df["Month"].astype(str)

    # Drop annual total row if present
    df = df[df["Month"].str.lower() != "total"].copy()

    df["month"] = df["Month"].map(MONTH_MAP).astype("Int64")
    df["month_name"] = df["Month"]

    # Melt columns with pattern "YYYY segment metric"
    value_cols = [c for c in df.columns if re.match(r"^\d{4}\s+(total|domestic|foreign)\s+(arrivals|nights)$", c)]
    id_vars = ["month", "month_name"]
    long = df[id_vars + value_cols].melt(id_vars=id_vars, var_name="key", value_name="value_raw")

    m = long["key"].str.extract(r"^(?P<year>\d{4})\s+(?P<segment>total|domestic|foreign)\s+(?P<metric>arrivals|nights)$")
    long = pd.concat([long.drop(columns=["key"]), m], axis=1)

    long["year"] = long["year"].astype(int)
    long["value"] = long["value_raw"].apply(parse_number)
    long = long.drop(columns=["value_raw"])

    # Wide: pivot back for convenience (one row per year-month)
    wide = (
        long.pivot_table(
            index=["year", "month", "month_name"],
            columns=["segment", "metric"],
            values="value",
            aggfunc="first"
        )
        .reset_index()
    )
    # Flatten multiindex columns
    wide.columns = [
        "_".join([c for c in col if c]).strip("_") if isinstance(col, tuple) else col
        for col in wide.columns
    ]

    # Ensure predictable order
    wide = wide.sort_values(["year", "month"]).reset_index(drop=True)
    long = long.sort_values(["year", "month", "segment", "metric"]).reset_index(drop=True)

    return long, wide


def normalize_table13(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Table 1.3: Spatial unit (Croatia/counties/cities) x Countries, wide monthly columns.

    Output:
      origin_long: county_key, county_label, spatial_unit, origin_country, year, month, arrivals, nights, avg_nights_per_arrival
      county_month_total: subset of origin_long where origin_country == 'Countries - total' and spatial unit is a county/city (not Croatia)
    """
    df = df.copy()
    df["Spatial unit"] = df["Spatial unit"].astype(str).apply(normalize_spaces)
    df["Countries"] = df["Countries"].astype(str).apply(normalize_spaces)

    # Identify only month columns like "YYYY MM Tourist arrivals" etc
    monthly_cols = []
    for c in df.columns:
        if re.match(r"^\d{4}\s+\d{2}\s+Tourist arrivals$", c):
            monthly_cols.append(c)
        elif re.match(r"^\d{4}\s+\d{2}\s+Tourist nights$", c):
            monthly_cols.append(c)
        elif re.match(r"^\d{4}\s+\d{2}\s+Average number of nights by arrival$", c):
            monthly_cols.append(c)

    id_vars = ["Spatial unit", "Countries"]
    base = df[id_vars + monthly_cols].copy()

    # Melt all monthly cols then split out year/month/metric
    melted = base.melt(id_vars=id_vars, var_name="var", value_name="value_raw")

    parts = melted["var"].str.extract(
        r"^(?P<year>\d{4})\s+(?P<month>\d{2})\s+(?P<metric>Tourist arrivals|Tourist nights|Average number of nights by arrival)$"
    )
    melted = pd.concat([melted.drop(columns=["var"]), parts], axis=1)
    melted["year"] = melted["year"].astype(int)
    melted["month"] = melted["month"].astype(int)
    melted["value"] = melted["value_raw"].apply(parse_number)
    melted = melted.drop(columns=["value_raw"])

    # Map metric strings -> column names
    metric_map = {
        "Tourist arrivals": "arrivals",
        "Tourist nights": "nights",
        "Average number of nights by arrival": "avg_nights_per_arrival"
    }
    melted["metric"] = melted["metric"].map(metric_map)

    # Pivot to one row per spatial_unit+country+year+month
    origin_long = (
        melted.pivot_table(
            index=["Spatial unit", "Countries", "year", "month"],
            columns="metric",
            values="value",
            aggfunc="first"
        )
        .reset_index()
    )

    origin_long = origin_long.rename(columns={
        "Spatial unit": "spatial_unit",
        "Countries": "origin_country"
    })

    # Add county_key and labels
    origin_long["county_key"] = origin_long["spatial_unit"].apply(slugify_county)
    origin_long["county_label"] = origin_long["spatial_unit"]

    # Identify counties/cities (exclude "Croatia")
    origin_long["spatial_level"] = origin_long["spatial_unit"].apply(
        lambda s: "country" if s.strip().lower() == "croatia"
        else ("county" if s.lower().startswith("county of ") else ("city" if s.lower().startswith("city of ") else "other"))
    )

    # County-month totals for choropleth (only total origins)
    county_month_total = origin_long[
        (origin_long["origin_country"] == "Countries - total") &
        (origin_long["spatial_level"].isin(["county", "city"]))
    ].copy()

    origin_long = origin_long.sort_values(["county_key", "origin_country", "year", "month"]).reset_index(drop=True)
    county_month_total = county_month_total.sort_values(["county_key", "year", "month"]).reset_index(drop=True)

    return origin_long, county_month_total


def normalize_table19(df: pd.DataFrame) -> pd.DataFrame:
    """
    Table 1.9: Tourism Intensity in towns and municipalities (wide per year)

    Output:
      intensity_long with one row per (spatial_unit, year) and numeric columns:
        population_census, area_km2, pop_per_km2, permanent_beds, arrivals, nights,
        arrivals_per_100, nights_per_100, arrivals_per_km2, nights_per_km2,
        beds_per_100, beds_per_km2, avg_nights_per_arrival, avg_nights_per_bed
    """
    df = df.copy()
    df["Spatial unit"] = df["Spatial unit"].astype(str).apply(normalize_spaces)

    year_cols = [c for c in df.columns if re.match(r"^\d{4}\s+", c)]

    melted = df.melt(id_vars=["Spatial unit"], value_vars=year_cols, var_name="var", value_name="value_raw")
    parts = melted["var"].str.extract(r"^(?P<year>\d{4})\s+(?P<label>.+)$")
    melted = pd.concat([melted.drop(columns=["var"]), parts], axis=1)

    melted["year"] = melted["year"].astype(int)
    melted["value"] = melted["value_raw"].apply(parse_number)
    melted = melted.drop(columns=["value_raw"])

    # Map labels -> short column keys
    label_map = {
        "Number of Population, Census 2021": "population_census",
        "Surface Area, km2": "area_km2",
        "Number of Population 2021, per km2": "pop_per_km2",
        "Number of Permanent Beds": "permanent_beds",
        "Tourist Arrivals": "arrivals",
        "Tourist Nights": "nights",
        "Number of Tourist Arrivals per 100 inhabitants": "arrivals_per_100",
        "Number of Tourist Nights per 100 inhabitants": "nights_per_100",
        "Number of Tourist Arrivals per km2": "arrivals_per_km2",
        "Number of Tourist Nights per km2": "nights_per_km2",
        "Number of Permanent beds per 100 inhabitants": "beds_per_100",
        "Number of Permanent beds per km2": "beds_per_km2",
        "Average Number of Tourist Nights per Arrival": "avg_nights_per_arrival",
        "Average Number of Tourist Nights per Permanent Beds": "avg_nights_per_bed",
    }

    # Normalize label strings (some exports vary in capitalization/spaces)
    def map_label(lbl: str) -> str:
        lbl0 = normalize_spaces(lbl)
        return label_map.get(lbl0, lbl0)

    melted["label_key"] = melted["label"].apply(map_label)

    intensity = (
        melted.pivot_table(
            index=["Spatial unit", "year"],
            columns="label_key",
            values="value",
            aggfunc="first"
        )
        .reset_index()
    )

    intensity = intensity.rename(columns={"Spatial unit": "spatial_unit"})

    # Add level flags
    def level(s: str) -> str:
        sl = s.lower()
        if sl == "republik of croatia" or sl == "republic of croatia":
            return "country"
        if sl.endswith("croatia") and sl != "republic of croatia":
            return "region"
        if sl.startswith("county of "):
            return "county"
        return "municipality"

    intensity["spatial_level"] = intensity["spatial_unit"].apply(level)
    intensity["county_key"] = intensity["spatial_unit"].apply(slugify_county)

    # Sort
    intensity = intensity.sort_values(["spatial_level", "spatial_unit", "year"]).reset_index(drop=True)
    return intensity


def simplify_geojson(geo: dict) -> dict:
    """Keep only minimal properties + add county_key for stable joins."""
    out = {"type": "FeatureCollection", "features": []}
    for feat in geo.get("features", []):
        props = feat.get("properties", {}) or {}
        zup_naziv = props.get("ZUP_NAZIV", "")
        name = props.get("name", "")
        nuts = props.get("NUTS", None)

        # Prefer ZUP_NAZIV, fallback to name
        label = zup_naziv if zup_naziv else name
        county_key = slugify_county(label)

        new_feat = {
            "type": "Feature",
            "properties": {
                "county_key": county_key,
                "county_label": strip_diacritics(label),
            },
            "geometry": feat.get("geometry")
        }
        if nuts is not None:
            new_feat["properties"]["NUTS"] = nuts
        out["features"].append(new_feat)
    return out


# ----------------------------- IO layer -----------------------------

def load_inputs(data_dir: Path, zip_path: Path | None) -> dict:
    """
    Load raw bytes for each required file either from ./data/ or from zip.
    Returns dict: { 'table1.2.csv': bytes, ... }
    """
    required = ["table1.2.csv", "table1.3.csv", "table1.9.csv", "zupanije_GeoJson.json"]
    blobs = {}

    if zip_path and zip_path.exists():
        import zipfile
        with zipfile.ZipFile(zip_path, "r") as zf:
            names = set(zf.namelist())
            missing = [r for r in required if r not in names]
            if missing:
                raise FileNotFoundError(f"Zip exists but is missing: {missing}")
            for r in required:
                blobs[r] = zf.read(r)
        return blobs

    # otherwise load from data_dir
    for r in required:
        p = data_dir / r
        # allow alternative geojson names
        if r == "zupanije_GeoJson.json" and not p.exists():
            alt = data_dir / "zupanije.geojson"
            if alt.exists():
                p = alt
        if not p.exists():
            raise FileNotFoundError(f"Missing input file: {p}")
        blobs[r] = p.read_bytes()
    return blobs


def write_outputs(out_dir: Path, **frames_and_geo):
    out_dir.mkdir(parents=True, exist_ok=True)

    # DataFrames
    for name, obj in frames_and_geo.items():
        if isinstance(obj, pd.DataFrame):
            obj.to_csv(out_dir / name, index=False, encoding="utf-8")
        elif isinstance(obj, dict):
            (out_dir / name).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        else:
            raise TypeError(f"Unsupported output type for {name}: {type(obj)}")


def main():
    parser = argparse.ArgumentParser(description="Normalize DZS tourism datasets for D3.js")
    parser.add_argument("--data-dir", default="data", help="Directory that contains raw data files")
    parser.add_argument("--zip", default=None, help="Optional path to data.zip (if you want to read from zip)")
    parser.add_argument("--out-dir", default="data/normalized", help="Output directory for normalized files")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    out_dir = Path(args.out_dir)

    zip_path = Path(args.zip) if args.zip else None
    if zip_path is None:
        # default candidates
        for cand in [Path("data.zip"), Path("data") / "data.zip"]:
            if cand.exists():
                zip_path = cand
                break

    blobs = load_inputs(data_dir=data_dir, zip_path=zip_path)

    # Read CSVs with proper skiprows and encoding
    t12 = read_px_csv(blobs["table1.2.csv"], encoding_hint="utf-8")
    t13 = read_px_csv(blobs["table1.3.csv"], encoding_hint="cp1250")
    t19 = read_px_csv(blobs["table1.9.csv"], encoding_hint="cp1250")

    # GeoJSON
    geo_txt = blobs["zupanije_GeoJson.json"].decode("utf-8", errors="replace")
    geo = json.loads(geo_txt)

    # Normalize
    t12_long, t12_wide = normalize_table12(t12)
    origin_long, county_month_total = normalize_table13(t13)
    intensity_long = normalize_table19(t19)
    geo_simplified = simplify_geojson(geo)

    # A small metadata file (handy for UI dropdowns)
    meta = {
        "years_table12": sorted(t12_long["year"].unique().tolist()),
        "years_table13": sorted(origin_long["year"].unique().tolist()),
        "years_table19": sorted(intensity_long["year"].unique().tolist()),
        "months": list(range(1, 13)),
        "note": "All outputs are UTF-8 and already normalized for D3.js."
    }

    write_outputs(
        out_dir,
        **{
            "tourism_hr_monthly_long.csv": t12_long,
            "tourism_hr_monthly_wide.csv": t12_wide,
            "tourism_origin_long.csv": origin_long,
            "tourism_counties_monthly_total.csv": county_month_total,
            "tourism_intensity_long.csv": intensity_long,
            "zupanije_simplified.geojson": geo_simplified,
            "meta.json": meta,
        }
    )

    print("\n✅ Normalization complete! Outputs written to:", out_dir.resolve())
    print("  - tourism_hr_monthly_long.csv")
    print("  - tourism_hr_monthly_wide.csv")
    print("  - tourism_origin_long.csv")
    print("  - tourism_counties_monthly_total.csv")
    print("  - tourism_intensity_long.csv")
    print("  - zupanije_simplified.geojson")
    print("  - meta.json\n")


if __name__ == "__main__":
    main()
