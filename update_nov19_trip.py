#!/usr/bin/env python3
"""LOCAL-ONLY review patch: add 2026-11-19 Cars Land neon moment.

Runs from the user's local Disney trip repository folder. Requires that its
original November 19 day/stop layout is still in place. Backs up four JSON
files to a sibling directory OUTSIDE the repository before changing anything.

Does not alter walking-routes-2026.json: its last leg needs manual retracing.
Does not make git commits or push to GitHub.
"""
from __future__ import annotations

import copy
from datetime import datetime
import json
from pathlib import Path
import shutil
import sys

DAY = "2026-11-19"
EVENT_ID = "cal-experience-cars-land-sh-boom"
FILES = ["itinerary-2026.json", "route-2026.json", "places.json", "walking-routes-2026.json"]


def main() -> int:
    folder = Path(__file__).resolve().parent
    for name in FILES:
        if not (folder / name).is_file():
            print(f"ERROR: Missing {name} beside this script. Place it in your local app folder.")
            return 1

    def load(name):
        with (folder / name).open("r", encoding="utf-8-sig") as f:
            return json.load(f)

    try:
        itinerary = load(FILES[0])
        route = load(FILES[1])
        places = load(FILES[2])
        walking = load(FILES[3])
        day = next(d for d in itinerary["days"] if d["date"] == DAY)
        stops = route["routes"][DAY]
        day_walk = walking["routes"][DAY]["segments"]
        directory = {p["id"]: p for p in places["places"]}
    except (KeyError, ValueError, StopIteration, TypeError, json.JSONDecodeError) as exc:
        print(f"ERROR: Source JSON does not have the expected structure: {exc}")
        return 1

    if EVENT_ID in directory or any("Sh-Boom" in x.get("activity", "") for x in day["timeline"]):
        print("ERROR: Cars Land lighting entry already exists. Nothing changed. Do not run twice.")
        return 1
    if len(day["timeline"]) != 16 or len(stops) != 11 or len(day_walk) != 10:
        print("ERROR: Expected 16 timeline rows, 11 stops and 10 walking legs for Nov 19.")
        print(f"Found {len(day['timeline'])}, {len(stops)} and {len(day_walk)}. Nothing changed.")
        return 1
    if (day["timeline"][12].get("activity", "").find("Christmas Fantasy") < 0 or
            stops[-1] != {"timelineIndex": 14, "placeId": "dow-dining-centrico"} or
            day_walk[-1].get("legFrom") != 10 or day_walk[-1].get("legTo") != 11):
        print("ERROR: November 19's parade, dinner stop or final walking leg differs from the reviewed version.")
        print("No files changed; inspect your local files before retrying.")
        return 1
    for required in ("cal-dining-flo-s-v8-cafe", "cal-dining-cozy-cone-motel"):
        if required not in directory:
            print(f"ERROR: Expected Cars Land reference location is missing: {required}")
            return 1

    # Prepare everything in memory before writing a single source file.
    next_it = copy.deepcopy(itinerary)
    next_route = copy.deepcopy(route)
    next_places = copy.deepcopy(places)
    d = next(x for x in next_it["days"] if x["date"] == DAY)

    next_it["sourceVersion"] = "v5 + Nov 19 sunset and Céntrico amendment"
    next_it["displayTimeRule"] = (
        "Based on itinerary v5 DOCX, with November 19 afternoon and dinner adjusted "
        "for the Cars Land sunset lighting moment and 6:30 PM Céntrico reservation. "
        "Parade and lighting times are subject to operational changes."
    )
    for row in next_it.get("atAGlance", []):
        if row.get("date") == "Thu, Nov 19":
            row["plan"] = (
                "Cars, Guardians, Pixar Pier, Indiana, 3:15 parade, "
                "Cars Land sunset lights; Céntrico 6:30 PM"
            )
    for row in next_it.get("mealReservations", []):
        if row.get("reservation") == "Céntrico" and row.get("when", "").startswith("Thu 11/19"):
            row["when"] = "Thu 11/19 • 6:30 PM"

    d["subtitle"] = "Starting park: California Adventure  •  Family of 6  •  Céntrico at 6:30 PM"
    d["priority"] = (
        "Revisit Cars Land and Pixar Pier, ride Guardians, then park hop for Indiana Jones, "
        "two coffees and the 3:15 PM Christmas Fantasy Parade. Return to California Adventure "
        "for the Cars Land neon-lighting moment (arrive 4:30 PM), before 6:30 PM Céntrico. "
        "Indiana is adult-only (46-inch minimum); protect the afternoon departure."
    )

    # Keep indices 0–11 (morning, lunch, Indiana, and parade positioning) unchanged.
    timeline = d["timeline"][:12]
    parade = copy.deepcopy(d["timeline"][12])
    parade["time"] = "3:15–3:55"
    parade["activity"] = "A Christmas Fantasy Parade (subject to schedule)"
    parade["notes"] = (
        "3:15 PM advertised start; Disney lists about 40 minutes. Watch near an exit-friendly "
        "Main Street/Town Square position. Aim to depart by 3:55 PM to make Cars Land by 4:30; "
        "the parade may arrive or finish later at your specific position."
    )
    timeline.append(parade)  # 12
    timeline += [
        {  # 13
            "time": "3:55–4:30",
            "activity": "Exit Disneyland; park hop back to California Adventure; reach Cars Land",
            "notes": (
                "Time-sensitive transfer with stroller/group: leave Main Street promptly, cross the "
                "Esplanade, reenter California Adventure and head directly to Route 66. "
                "35 minutes is a goal, not a guaranteed walking time."
            ),
            "mapIds": ["cal-landmark-california-adventure-main-entrance", EVENT_ID],
        },
        {  # 14; newly routeable Stop 11
            "time": "4:30–5:05",
            "activity": "Cars Land “Sh-Boom” sunset neon-lighting moment",
            "notes": (
                "Be in position by 4:30 PM along Route 66 between Flo's V8 Cafe and Cozy Cone Motel. "
                "Sunset is about 4:46–4:48 PM; neon lighting often occurs around sunset or a few "
                "minutes later (~4:42–4:53, not a posted showtime). The moment lasts a few "
                "minutes. Holiday-season music may differ from Sh-Boom; stay for neon photos."
            ),
            "mapIds": [EVENT_ID, "cal-dining-flo-s-v8-cafe", "cal-dining-cozy-cone-motel"],
        },
        {  # 15
            "time": "5:05–6:15",
            "activity": "Leave Cars Land; exit California Adventure; walk to Céntrico",
            "notes": (
                "Allow comfortable time to leave the park and walk through Downtown Disney, "
                "with stroller, rest and reservation check-in buffer. Enjoy the district if early."
            ),
            "mapIds": ["dow-dining-centrico"],
        },
        {  # 16; existing Céntrico becomes Stop 12
            "time": "6:30–7:45",
            "activity": "Céntrico dinner",
            "notes": "Confirmed reservation update: 6:30 PM, party of 6.",
            "mapIds": ["dow-dining-centrico"],
        },
        {  # 17
            "time": "After 7:45",
            "activity": "Optional Downtown Disney stroll / return to hotel",
            "notes": (
                "The Cars Land neon moment has already been planned before dinner, "
                "so no extra park reentry is necessary."
            ),
            "mapIds": [],
        },
    ]
    d["timeline"] = timeline
    d["walking"] = (
        "Walking blocks: Cars Land→Guardians 7–12 min; Guardians→Pixar Pier 12–18 min; "
        "Pixar Pier→DCA exit 12–18 min; DCA→Disneyland hop 10–20 min; "
        "Disneyland entry→Bengal 10–15 min; Bengal→Indiana 2–5 min; Indiana→Rancho 5–8 min; "
        "Rancho→Town Square 8–15 min. NEW: Main Street→Cars Land via park hop "
        "3:55–4:30 target (allow for queues/crowds); Cars Land→Céntrico via DCA exit and "
        "Downtown Disney after the neon lighting. These are planning buffers, not navigation ETAs."
    )
    d["skipFirst"] = (
        "Skip optional Toy Story character lines, Green Army Patrol, or extra rides if afternoon "
        "timing slips. Prioritize the 3:15 parade, returning to Cars Land by 4:30 for the neon "
        "moment, and the 6:30 dinner. The parade may not finish at your viewing spot by 3:55; "
        "be ready to leave early if the lighting moment is the priority."
    )
    if d.get("extraNotes"):
        d["extraNotes"][0] = (
            "Cars Land's sunset neon lighting is now a planned Thursday stop, not an after-dinner "
            "option. The music may be seasonal during the holidays. Check sunset and ask a "
            "Cars Land Cast Member about timing; the moment is not a fixed advertised show."
        )
    else:
        d["extraNotes"] = [
            "Cars Land sunset lighting is now a planned Thursday stop; timing and music may vary."
        ]
    for item in d.get("lightningLane", []):
        if "5:00 PM Céntrico reservation" in item.get("notes", ""):
            item["notes"] = (
                "Protect the 3:15 PM parade, the 4:30 PM Cars Land arrival for sunset "
                "neon lighting, and the 6:30 PM Céntrico reservation; no late detours."
            )
    for row in d.get("mealReservations", []):
        if row.get("reservation") == "Céntrico":
            row["when"] = "Thu 11/19 • 6:30 PM"

    f = directory["cal-dining-flo-s-v8-cafe"]
    c = directory["cal-dining-cozy-cone-motel"]
    midpoint_lat = round((f["lat"] + c["lat"]) / 2, 6)
    midpoint_lon = round((f["lon"] + c["lon"]) / 2, 6)
    new_poi = {
        "id": EVENT_ID,
        "name": "Cars Land Sh-Boom Neon Lighting",
        "park": "california",
        "area": "Cars Land",
        "type": "Experience",
        "lat": midpoint_lat,
        "lon": midpoint_lon,
        "zoom": 19.05,
        "aliases": ["Sh-Boom", "Cars Land lighting ceremony", "Radiator Springs neon lighting"],
        "accuracy": "PROVISIONAL — midpoint of existing Flo's and Cozy Cone pins; calibrate on your map",
        "listing_status": "trip-planned seasonal moment; time not guaranteed",
        "source_url": "https://disneyparksblog.com/dlr/10-ways-to-celebrate-cars-lands-10th-anniversary-at-disneyland-resort/",
    }
    # Insert in alphabetical position without rearranging any existing 316 POIs.
    pos = next((i for i, p in enumerate(next_places["places"])
                if p["name"].casefold() > new_poi["name"].casefold()), len(next_places["places"]))
    next_places["places"].insert(pos, new_poi)
    next_places["notice"] = (
        "316 existing reviewed/calibrated locations plus one provisional, manually "
        "verifiable Cars Land sunset-lighting viewing point; all coordinates are map "
        "landmarks and not guaranteed entrances or viewpoints."
    )

    # Preserve all other days and all existing route stop indices until Main Street.
    new_stops = copy.deepcopy(stops[:-1])
    new_stops.append({"timelineIndex": 14, "placeId": EVENT_ID})
    new_stops.append({"timelineIndex": 16, "placeId": "dow-dining-centrico"})
    next_route["routes"][DAY] = new_stops

    # Cross-reference validation before any write.
    all_pois = {p["id"] for p in next_places["places"]}
    for row in d["timeline"]:
        for map_id in row.get("mapIds", []):
            if map_id not in all_pois:
                print("ERROR: Unresolved mapId:", map_id)
                return 1
    for row in new_stops:
        if row["placeId"] not in all_pois or not (0 <= row["timelineIndex"] < len(d["timeline"])):
            print("ERROR: Route stop reference does not resolve:", row)
            return 1
    assert len(d["timeline"]) == 18 and len(new_stops) == 12
    assert [x["timelineIndex"] for x in new_stops][-3:] == [11, 14, 16]

    backup = folder.parent / (folder.name + "-BACKUP-before-Nov19-update-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    if backup.exists():
        print("ERROR: Backup directory already exists:", backup)
        return 1
    backup.mkdir()
    for name in FILES:
        shutil.copy2(folder / name, backup / name)

    for name, data in ((FILES[0], next_it), (FILES[1], next_route), (FILES[2], next_places)):
        with (folder / name).open("w", encoding="utf-8", newline="\n") as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.write("\n")

    print("UPDATED: itinerary-2026.json (Nov19 only + summary/reservation references)")
    print("UPDATED: route-2026.json (Nov19 now 12 stops)")
    print("UPDATED: places.json (one PROVISIONAL point for lighting — verify visually)")
    print("NOT TOUCHED: walking-routes-2026.json")
    print("Original versions of all four files backed up to:", backup)
    print("\nNEXT: Open route-editor locally, import current walking-routes-2026.json,")
    print("then CLEAR and retrace Nov19 leg 10→11 and trace new leg 11→12.")
    print("Do not push until the walking route has been updated and exported.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
