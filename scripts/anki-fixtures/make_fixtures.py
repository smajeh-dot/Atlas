"""Generate real .apkg fixtures with the official `anki` package.

The importer must read files that genuine Anki writes, so every fixture here
comes from Anki's own exporter rather than hand-built zips. Hostile and broken
archives are built in test code instead, where each one can sit next to the
rule it breaks.

Each `<name>.apkg` gets a `<name>.expected.json` written beside it. That file is
produced by opening the collection *inside the package* with Anki's own library,
so it records what Anki itself thinks the package contains. Importer tests
compare against it rather than against values copied by hand.

Anki stamps ids with the wall clock, so regenerating changes every id. Commit the
.apkg and .expected.json files together and never edit one without the other.

Usage (see tests/fixtures/anki/README.md):
    python make_fixtures.py <output-dir>
"""

from __future__ import annotations

import os
import sys
import time

# Anki computes day boundaries in local time. Pin the zone to the one the
# TypeScript tests use (tests/setup.ts) so "today" means the same thing to both.
os.environ["TZ"] = "Europe/London"
if hasattr(time, "tzset"):
    time.tzset()

import hashlib  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import struct  # noqa: E402
import tempfile  # noqa: E402
import zipfile  # noqa: E402
import zlib  # noqa: E402

import zstandard  # noqa: E402
from anki import import_export_pb2  # noqa: E402
from anki.buildinfo import version as anki_version  # noqa: E402
from anki.collection import Collection, ExportAnkiPackageOptions  # noqa: E402
from anki.scheduler_pb2 import CardAnswer  # noqa: E402

DAY_SECS = 86_400

RATINGS = {
    1: CardAnswer.AGAIN,
    2: CardAnswer.HARD,
    3: CardAnswer.GOOD,
    4: CardAnswer.EASY,
}


# --------------------------------------------------------------------------
# Small media files. Content only has to be valid enough to have a stable hash.
# --------------------------------------------------------------------------


def png_1x1(rgb: tuple[int, int, int]) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" + bytes(rgb))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


FAKE_MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 8


# --------------------------------------------------------------------------
# Collection building helpers
# --------------------------------------------------------------------------


class Builder:
    """Wraps a collection so history can be faked by moving the past backwards.

    Anki schedules relative to the real clock, so a multi-week review history
    is made by answering cards, then shifting every stored timestamp back by
    some days (`warp`), then answering again. Anki's own scheduler still makes
    every decision; only the calendar is moved.
    """

    def __init__(self, path: str) -> None:
        self.path = path
        self.col = Collection(path)
        self.answers = 0
        # Total ms the past has been shifted by. Card handles held by the
        # builder are "virtual" ids (real id + shift) so warping can't stale them.
        self.shifted_ms = 0

    def reopen(self) -> None:
        # Anki caches the day boundary; reopening is the reliable way to drop it.
        self.col.close()
        self.col = Collection(self.path)

    def deck(self, name: str) -> int:
        return int(self.col.decks.id(name))

    def add(self, notetype: str, fields: dict[str, str], deck: str, tags: list[str] | None = None) -> int:
        model = self.col.models.by_name(notetype)
        assert model is not None, notetype
        note = self.col.new_note(model)
        for key, value in fields.items():
            note[key] = value
        note.tags = tags or []
        self.col.add_note(note, self.deck(deck))
        return int(note.id)

    def cards_of(self, note_id: int) -> list[int]:
        rows = self.col.db.list("select id from cards where nid = ? order by ord", note_id)
        return [int(c) + self.shifted_ms for c in rows]

    def real(self, *handles: int) -> list[int]:
        return [h - self.shifted_ms for h in handles]

    def answer(self, handle: int, ease: int) -> None:
        card = self.col.get_card(self.real(handle)[0])
        card.start_timer()
        states = self.col._backend.get_scheduling_states(card.id)
        answer = self.col.sched.build_answer(card=card, states=states, rating=RATINGS[ease])
        # A fixed, varied duration makes `time` checkable instead of always ~0 ms.
        self.answers += 1
        answer.milliseconds_taken = 3_000 + (self.answers * 733) % 9_000
        self.col.sched.answer_card(answer)

    def warp(self, days: int) -> None:
        """Pretend `days` days pass: push every absolute timestamp into the past."""
        s = days * DAY_SECS
        ms = s * 1000
        db = self.col.db
        db.execute("update col set crt = crt - ?", s)
        db.execute("update notes set id = id - ?, mod = mod - ?", ms, s)
        db.execute("update cards set id = id - ?, nid = nid - ?, mod = mod - ?", ms, ms, s)
        self.shifted_ms += ms
        db.execute("update revlog set id = id - ?, cid = cid - ?", ms, ms)
        # Intraday learning and preview cards hold epoch seconds, not day numbers.
        db.execute("update cards set due = due - ? where queue in (1, 4)", s)
        # FSRS keeps the last review time in card data on recent versions.
        for cid, data in db.all("select id, data from cards where data like '%\"lrt\"%'"):
            parsed = json.loads(data)
            parsed["lrt"] = parsed["lrt"] - s
            db.execute("update cards set data = ? where id = ?", json.dumps(parsed, separators=(",", ":")), cid)
        self.reopen()

    def preset(self, name: str, **changes: object) -> int:
        conf = self.col.decks.add_config_returning_id(name)
        config = self.col.decks.get_config(conf)
        assert config is not None
        for path, value in changes.items():
            target = config
            keys = path.split("__")
            for key in keys[:-1]:
                target = target[key]
            target[keys[-1]] = value
        self.col.decks.update_config(config)
        return int(conf)

    def use_preset(self, deck: str, conf_id: int) -> None:
        d = self.col.decks.get(self.deck(deck))
        assert d is not None
        d["conf"] = conf_id
        self.col.decks.save(d)


def add_chem_reaction_type(col: Collection) -> None:
    mm = col.models
    m = mm.new("Chem Reaction")
    for name in ("Reactants", "Products", "Conditions"):
        mm.add_field(m, mm.new_field(name))
    forward = mm.new_template("Forward")
    forward["qfmt"] = "{{Reactants}} → ?{{#Conditions}}<br>{{hint:Conditions}}{{/Conditions}}"
    forward["afmt"] = "{{FrontSide}}<hr id=answer>{{Products}}<div class=ruby>{{furigana:Reactants}}</div>"
    mm.add_template(m, forward)
    reverse = mm.new_template("Reverse")
    reverse["qfmt"] = "{{^Conditions}}No special conditions. {{/Conditions}}? → {{Products}}"
    reverse["afmt"] = "{{FrontSide}}<hr id=answer>{{Reactants}}"
    mm.add_template(m, reverse)
    m["css"] = (
        ".card { font-family: Georgia, serif; text-align: center; }\n"
        ".ruby { background: url('_bg-tile.png') repeat; }\n"
    )
    mm.add(m)


# --------------------------------------------------------------------------
# The two source collections
# --------------------------------------------------------------------------


def build_rich(work: str) -> Builder:
    """Every note type, deck shape, media kind and card state the importer must handle."""
    b = Builder(os.path.join(work, "rich.anki2"))
    col = b.col
    col.add_image_occlusion_notetype()
    add_chem_reaction_type(col)

    media_dir = col.media.dir()
    for name, data in {
        "benzene.png": png_1x1((20, 120, 200)),
        "café.png": png_1x1((200, 120, 20)),
        "_bg-tile.png": png_1x1((240, 240, 240)),
        "benzene.mp3": FAKE_MP3,
    }.items():
        written = col.media.write_data(name, data)
        assert written == name, (name, written)

    interday = b.preset("Interday steps", new__delays=[10.0, 1440.0], lapse__delays=[10.0, 2880.0])
    exam = b.preset("Exam cram", new__perDay=50, rev__perDay=500, desiredRetention=0.85)

    alkanes = "Chem::Organic::Alkanes"
    inorganic = "Chem::Inorganic"
    for name in (alkanes, inorganic, "Chem::States", "Chem::Interday", "Chem::Empty"):
        b.deck(name)
    b.use_preset("Chem::Interday", interday)
    b.use_preset(inorganic, exam)

    # Content: one of each note type, plus the field quirks the report must spot.
    methane = b.add("Basic", {"Front": "Formula of methane", "Back": "CH<sub>4</sub>"}, alkanes, ["chem::organic", "alkanes", "cram"])
    b.add("Basic (and reversed card)", {"Front": "Na", "Back": "Sodium"}, inorganic, ["chem::inorganic", "elements"])
    b.add("Basic (optional reversed card)", {"Front": "Fe", "Back": "Iron", "Add Reverse": ""}, inorganic, ["elements"])
    b.add("Basic (optional reversed card)", {"Front": "Cu", "Back": "Copper", "Add Reverse": "y"}, inorganic, ["elements"])
    b.add("Cloze", {"Text": "{{c1::Ethane}} has {{c2::two}} carbon atoms", "Back Extra": "C<sub>2</sub>H<sub>6</sub>"}, alkanes, ["alkanes"])
    b.add("Cloze", {"Text": "Propane has {{c3::three}} carbon atoms", "Back Extra": ""}, alkanes, ["alkanes"])
    b.add("Basic (type in the answer)", {"Front": "Symbol for gold", "Back": "Au"}, inorganic, ["elements"])
    b.add("Chem Reaction", {"Reactants": "2H<sub>2</sub> + O<sub>2</sub>", "Products": "2H<sub>2</sub>O", "Conditions": "spark"}, inorganic, ["reactions"])
    b.add("Chem Reaction", {"Reactants": "HCl + NaOH", "Products": "NaCl + H<sub>2</sub>O", "Conditions": ""}, inorganic, ["reactions"])
    b.add("Basic", {"Front": '<img src="benzene.png"> Name this ring', "Back": "Benzene [sound:benzene.mp3]"}, alkanes, ["media"])
    b.add("Basic", {"Front": "<img src=café.png> Which compound?", "Back": 'Missing picture: <img src="missing-diagram.png">'}, alkanes, ["media"])
    b.add("Basic", {"Front": "[latex]H_2O[/latex]", "Back": r"\(x^2\) and \[E=mc^2\]"}, inorganic, ["latex"])
    b.add(
        "Basic",
        {
            "Front": 'Careful <img src="x.png" onerror="alert(1)">',
            "Back": '<script>alert(2)</script><a href="javascript:void(0)">link</a>',
        },
        inorganic,
        ["active"],
    )
    b.add("Basic", {"Front": "Säure", "Back": "Proton donor — ✓"}, inorganic, ["Säure", "chem::acids_and_bases", "Exam_2026"])

    io_type = col.models.by_name("Image Occlusion")
    assert io_type is not None
    io_image = os.path.join(work, "flask.png")
    with open(io_image, "wb") as fh:
        fh.write(png_1x1((10, 200, 90)))
    col.add_image_occlusion_note(
        notetype_id=io_type["id"],
        image_path=io_image,
        occlusions="{{c1::image-occlusion:rect:left=.1:top=.1:width=.3:height=.2:oi=1}}",
        header="Label the flask",
        back_extra="",
        tags=["io"],
    )
    io_deck = b.deck(inorganic)
    col.db.execute("update cards set did = ? where nid in (select id from notes where mid = ?)", io_deck, io_type["id"])

    # States: one note per card state, with real multi-week histories.
    states = [b.cards_of(b.add("Basic", {"Front": f"State card {i:02}", "Back": f"Answer {i:02}"}, "Chem::States", ["states"]))[0] for i in range(1, 15)]
    s = dict(zip(range(1, 15), states))
    col.db.execute("update notes set tags = ' states cram ' where id = (select nid from cards where id = ?)", b.real(s[7])[0])
    interday_card = b.cards_of(b.add("Basic", {"Front": "Interday learner", "Back": "Two-step"}, "Chem::Interday"))[0]

    reviewed = [s[i] for i in (1, 2, 3, 4, 5, 6, 7, 8, 14)]
    for cid in reviewed:
        b.answer(cid, 3)
        b.answer(cid, 3)  # graduates with the default 1m/10m steps
    b.warp(1)
    for cid in reviewed:
        b.answer(cid, 3)
    b.warp(3)
    for cid in reviewed:
        b.answer(cid, 3)
    b.answer(s[7], 1)  # lapse
    b.answer(s[7], 3)  # relearnt
    b.warp(8)
    for cid in (s[1], s[2], s[3], s[4], s[5], s[6]):
        b.answer(cid, 3)
    b.answer(s[8], 2)
    b.answer(s[14], 4)
    # A long gap so most review cards are overdue on the day of export.
    b.warp(30)

    b.answer(s[1], 3)  # reviewed today, due in the future
    b.answer(s[2], 1)  # relearning right now
    b.col.sched.suspend_cards(b.real(s[3]))
    b.col.set_user_flag_for_cards(1, b.real(s[4]))  # red, overdue
    b.col.sched.set_due_date(b.real(s[5]), "0")  # due exactly today, via a manual entry
    b.col.set_user_flag_for_cards(4, b.real(s[5]))  # blue
    b.col.set_user_flag_for_cards(7, b.real(s[6]))  # purple: the highest flag number
    b.col.sched.bury_cards(b.real(s[6]), manual=True)
    b.col.sched.set_due_date(b.real(s[8]), "5")  # pushed into the future by hand
    b.answer(s[9], 3)  # intraday learning
    b.col.sched.bury_cards(b.real(s[10]), manual=False)  # new card, buried as a sibling
    b.col.sched.suspend_cards(b.real(s[11]))
    b.col.sched.schedule_cards_as_new(b.real(s[14]))  # forgotten: new card that still has history
    b.answer(interday_card, 3)  # 1-day step: interday learning

    # A filtered deck pulls an overdue lapsed card and a new card out of their homes.
    cram = b.col.sched.get_or_create_filtered_deck(0)
    cram.name = "Cram"
    cram.config.search_terms[0].search = "tag:cram"
    cram.config.search_terms[0].limit = 50
    cram.config.reschedule = True
    b.col.sched.add_or_update_filtered_deck(cram)
    assert methane

    b.reopen()
    return b


def build_fsrs(work: str) -> Builder:
    """A small deck reviewed with FSRS on, so cards carry stability and difficulty."""
    b = Builder(os.path.join(work, "fsrs.anki2"))
    b.col.set_config("fsrs", True)
    conf = b.col.decks.get_config(1)
    assert conf is not None
    conf["desiredRetention"] = 0.9
    b.col.decks.update_config(conf)

    cards = [b.cards_of(b.add("Basic", {"Front": f"Ion {i}", "Back": f"Charge {i}"}, "Chem::Ions", ["ions"]))[0] for i in range(1, 7)]
    reviewed = cards[:4]
    for cid in reviewed:
        b.answer(cid, 3)
        b.answer(cid, 3)
    b.warp(2)
    for cid in reviewed:
        b.answer(cid, 3)
    b.answer(cards[3], 1)
    b.answer(cards[3], 3)
    b.warp(6)
    for cid in reviewed[:3]:
        b.answer(cid, 3 if cid != cards[2] else 4)
    b.warp(10)
    b.answer(cards[0], 3)
    b.answer(cards[1], 1)
    b.answer(cards[4], 3)
    b.reopen()
    return b


# --------------------------------------------------------------------------
# Exporting and describing packages
# --------------------------------------------------------------------------


def export(b: Builder, out: str, *, legacy: bool, scheduling: bool) -> None:
    b.col.export_anki_package(
        out_path=out,
        options=ExportAnkiPackageOptions(
            with_scheduling=scheduling,
            with_deck_configs=scheduling,
            with_media=True,
            legacy=legacy,
        ),
        limit=None,
    )


def rezip(src: str, dest: str, keep: dict[str, str]) -> None:
    """Copy selected entries of `src` into a new zip, optionally renaming them."""
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if info.filename in keep:
                zout.writestr(keep[info.filename], zin.read(info))


def make_legacy1(legacy2: str, dest: str) -> None:
    """Rebuild the pre-2.1.50 layout: the real collection is `collection.anki2`, no meta, no dummy.

    Current Anki can no longer write this layout, so it is reassembled from a
    real legacy export. Only the container differs; see README for what that
    does and does not test.
    """
    with zipfile.ZipFile(legacy2) as z:
        names = [i.filename for i in z.infolist()]
    keep = {n: n for n in names if n not in ("meta", "collection.anki2", "collection.anki21")}
    keep["collection.anki21"] = "collection.anki2"
    rezip(legacy2, dest, keep)


def make_dummy_only(legacy2: str, dest: str) -> None:
    """What a package looks like when only the placeholder survives: Atlas must refuse it."""
    rezip(legacy2, dest, {"collection.anki2": "collection.anki2"})
    with zipfile.ZipFile(dest, "a", zipfile.ZIP_DEFLATED) as z:
        z.writestr("media", "{}")


def read_media_manifest(z: zipfile.ZipFile, meta_version: int | None) -> list[dict[str, object]]:
    raw = z.read("media")
    if meta_version == 3:
        entries = import_export_pb2.MediaEntries.FromString(zstd(raw)).entries
        listed = [(str(i), e.name) for i, e in enumerate(entries)]
    else:
        listed = sorted(((k, v) for k, v in json.loads(raw).items()), key=lambda kv: int(kv[0]))
    media = []
    for index, name in listed:
        data = z.read(index)
        if meta_version == 3:
            data = zstd(data)
        media.append({"zip_entry": index, "name": name, "size": len(data), "sha1": hashlib.sha1(data).hexdigest()})
    return media


def zstd(data: bytes) -> bytes:
    return zstandard.ZstdDecompressor().decompressobj().decompress(data)


def describe(apkg: str, source: Builder | None, now_ms: int) -> dict[str, object]:
    with zipfile.ZipFile(apkg) as z:
        entries = [i.filename for i in z.infolist()]
        meta_version = import_export_pb2.PackageMetadata.FromString(z.read("meta")).version if "meta" in entries else None
        for candidate in ("collection.anki21b", "collection.anki21", "collection.anki2"):
            if candidate in entries:
                collection_entry = candidate
                break
        else:
            raise RuntimeError(f"{apkg} has no collection")
        raw = z.read(collection_entry)
        if collection_entry.endswith("b"):
            raw = zstd(raw)
        media = read_media_manifest(z, meta_version) if "media" in entries else []

    tmp = tempfile.mkdtemp(prefix="atlas-fixture-")
    try:
        path = os.path.join(tmp, "collection.anki2")
        with open(path, "wb") as fh:
            fh.write(raw)
        col = Collection(path)
        try:
            body = dump_collection(col)
        finally:
            col.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    generated: dict[str, object] = {"anki_version": anki_version, "tz": os.environ["TZ"], "now_ms": now_ms}
    if source is not None:
        # The package does not record "today", but due dates only mean something relative to it.
        generated["anki_today"] = source.col.sched.today
    return {
        "package": {
            "entries": entries,
            "meta_version": meta_version,
            "collection_entry": collection_entry,
            "has_dummy_collection": collection_entry != "collection.anki2" and "collection.anki2" in entries,
        },
        "generated": generated,
        **body,
        "media": media,
    }


def dump_collection(col: Collection) -> dict[str, object]:
    db = col.db
    decks = []
    for d in sorted(col.decks.all(), key=lambda d: d["id"]):
        decks.append({"id": d["id"], "name": d["name"], "filtered": bool(d["dyn"]), "config_id": d.get("conf")})
    configs = []
    for c in sorted(col.decks.all_config(), key=lambda c: c["id"]):
        configs.append(
            {
                "id": c["id"],
                "name": c["name"],
                "new_per_day": c["new"]["perDay"],
                "reviews_per_day": c["rev"]["perDay"],
                "learn_steps_min": c["new"]["delays"],
                "relearn_steps_min": c["lapse"]["delays"],
                "desired_retention": c.get("desiredRetention"),
            }
        )
    notetypes = []
    for m in sorted(col.models.all(), key=lambda m: m["id"]):
        notetypes.append(
            {
                "id": m["id"],
                "name": m["name"],
                "type": m["type"],
                "original_stock_kind": m.get("originalStockKind"),
                "sort_field_idx": m["sortf"],
                "css": m["css"],
                "fields": [f["name"] for f in m["flds"]],
                "templates": [{"name": t["name"], "qfmt": t["qfmt"], "afmt": t["afmt"]} for t in m["tmpls"]],
            }
        )
    notes = [
        {"id": nid, "guid": guid, "notetype_id": mid, "mod": mod, "tags": tags.split(), "fields": flds.split("\x1f")}
        for nid, guid, mid, mod, tags, flds in db.all("select id, guid, mid, mod, tags, flds from notes order by id")
    ]
    card_cols = "id, nid, did, odid, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, flags, data"
    cards = [
        dict(zip(["id", "note_id", "deck_id", "orig_deck_id", "ord", "type", "queue", "due", "ivl", "factor", "reps", "lapses", "left", "odue", "flags", "data"], row))
        for row in db.all(f"select {card_cols} from cards order by id")
    ]
    revlog = [
        dict(zip(["id", "card_id", "ease", "ivl", "last_ivl", "factor", "time", "type"], row))
        for row in db.all("select id, cid, ease, ivl, lastIvl, factor, time, type from revlog order by id")
    ]
    return {
        "collection": {
            "crt": col.crt,
            "rollover": col.get_config("rollover", 4),
            "sched_ver": col.sched_ver(),
            "fsrs": bool(col.get_config("fsrs", False)),
        },
        "decks": decks,
        "deck_configs": configs,
        "notetypes": notetypes,
        "notes": notes,
        "cards": cards,
        "revlog": revlog,
    }


def write_expected(apkg: str, source: Builder | None, now_ms: int) -> None:
    expected = describe(apkg, source, now_ms)
    with open(apkg[: -len(".apkg")] + ".expected.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(expected, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python make_fixtures.py <output-dir>")
    out = os.path.abspath(sys.argv[1])
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix="atlas-anki-")
    try:
        rich = build_rich(work)
        fsrs = build_fsrs(work)
        now_ms = int(time.time() * 1000)

        def p(name: str) -> str:
            return os.path.join(out, name)

        export(rich, p("rich-modern.apkg"), legacy=False, scheduling=True)
        export(rich, p("rich-legacy2.apkg"), legacy=True, scheduling=True)
        export(rich, p("rich-modern-nosched.apkg"), legacy=False, scheduling=False)
        export(fsrs, p("fsrs-modern.apkg"), legacy=False, scheduling=True)
        export(fsrs, p("fsrs-legacy2.apkg"), legacy=True, scheduling=True)
        make_legacy1(p("rich-legacy2.apkg"), p("rich-legacy1.apkg"))
        make_dummy_only(p("rich-legacy2.apkg"), p("dummy-only.apkg"))

        for name, source in (
            ("rich-modern", rich),
            ("rich-legacy2", rich),
            ("rich-legacy1", rich),
            ("rich-modern-nosched", rich),
            ("fsrs-modern", fsrs),
            ("fsrs-legacy2", fsrs),
            ("dummy-only", None),
        ):
            write_expected(p(f"{name}.apkg"), source, now_ms)
        rich.col.close()
        fsrs.col.close()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f"Wrote fixtures to {out}")


if __name__ == "__main__":
    main()
