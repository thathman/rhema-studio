# ADR 0003 — Run-of-show timing: three schedules, start rules, pauses and the offset

- **Status:** Proposed (T0 of #196; describes the engine on `main` plus the R3 slice that adds fixed
  starts and pauses).
- **Scope:** how one Rhema host works out the main service's times, who may change them, and what a
  joined desk sees. Auxiliary timers, holds, the event clock and countdowns build on this; they are
  named here only where they touch it.
- **Code:** `src/lib/timing-engine.ts` (the engine), `src/lib/run-of-show.ts` (phases, groups, the
  planned timeline), `src/stores/service-offset-store.ts` (the shared offset), `src/lib/cuesheet.ts`
  (the table), `src/lib/live-state.ts` (what desks receive).

## 1. Context

A church service is planned to the minute and then runs as it runs: the pastor arrives late, worship
goes long, an item is dropped. Operators need to see three things at once without one overwriting the
others: what was agreed, what is now likely, and what actually happened. Some moments are tied to the
clock, not to the item before them (the livestream begins at 10:30 whatever happens; the sermon must
end by 11:00 for the second service). Some plans leave slack on purpose so that a late start can be
recovered. Before this slice Rhema had planned, expected and actual times, hard stops ("end by"),
skipped items and a shared ±5 offset, but every item simply followed the one before it.

## 2. Decision: one pure engine, three schedules

`serviceTiming(input)` is a pure function of an explicit snapshot: the rundown's items and headers,
when each item first went on air and for how long (from the service log), which event is happening
(the event clock), the shared offset and the time now. It returns, for each item of the main service:

| Schedule | Comes from | Ever rewritten by running late? |
|---|---|---|
| **Planned** | the main service's start time, each item's planned minutes, fixed starts and pauses | Never. Only typing in Prepare changes it. |
| **Expected** | what has happened so far, the live item's remaining time, the offset, then the plan's rules for what is still to come | It is recomputed every time anything changes. |
| **Actual** | the service log: when each item went on air and how long it stayed | Only by things really happening. |

Before anything has gone on air, expected is the plan (planning on Thursday evening does not make
Sunday "12 hours late"). Instants are wall-clock milliseconds; clock times ("HH:MM") are turned into
the instant nearest a reference (the service start, or the item before), using calendar days, so a
watchnight across midnight and the 23- or 25-hour day of a clock change land on the right local time.

## 3. Rules for each item

1. **Linked (the default).** An item starts when the item before it ends. Nothing needs to be set;
   every service saved before this slice is all linked and gives exactly the times it gave before.
2. **Fixed start** (`starts_at`, "HH:MM", in the item's payload). The item is planned, and expected,
   at that clock time however early or late what comes before runs. Its planned start is that time
   (the instant nearest the end of the item before). If the items before it are expected to run past
   that time, it starts when they finish, and the item is marked **Late for its fixed start**
   (`conflict`). The same mark appears when the plan itself runs past the fixed start. The free time
   between the item before and a fixed start is a pause (rule 4).
3. **End by / hard stop** (`end_by`). The time the item may take is cut so that it finishes by then
   (`squeezed`, "Cut short"); what follows carries on from the hard stop. A hard stop never moves the
   item's start.
4. **Pause / gap** (`gap_minutes` on an item = a planned pause before it, 0–600 minutes). It is in
   the plan (the item's planned start is the end of the one before plus the pause). Running late
   uses the pause up first: late by less than the pause, the item still starts on plan and the rest of
   the pause is waited out; late by more, only the lateness beyond the pause pushes the item. Running
   early keeps the whole pause, so the item moves up with what is before it. The table shows how much
   each pause is expected to take up ("absorbs 3 min"). A fixed start has no gap of its own: its free
   time is its pause. Once the item has begun, or was skipped, its pause is history.
5. **Skipped.** An item that never went on air while a later one did takes no expected time; the
   expected times carry on from the item that is on. Its plan stays.
6. **The shared offset (±5 min).** A relative correction ("we are running 5 late") to what is still
   to come. It is added once, before the first item still to come, and moves linked items. It is taken
   up by pauses like any other lateness. It **does not move a fixed start**: a fixed start waits only
   for what really runs late (the live item and the plan), never for the operator's estimate, and the
   items after a fixed start follow it. The offset is never written into the plan. Each change is in
   the service log with who made it; another service starts at zero.

Order of work for an item still to come: work out its planned start (rule 2 or 4), its expected start
(rules 1, 2, 4, 6 and the time now once the service has begun), its expected end (planned minutes,
then rule 3). Two cursors run through the items: one with the offset, one without; a fixed start
reads the second.

## 4. What the host owns

- The **host** (the main Rhema computer) is the only one that works out the times. It owns the rundown
  (planned minutes, fixed starts, pauses, end by), the service log (actual times), the event clock (which
  item is happening), the hold and the shared offset.
- A joined **Timekeeper** desk may move the offset and hold or resume; those are commands to the host,
  checked by its role, recorded in the service log with the desk's name. No desk keeps a timing engine
  of its own, so there is never a second, disagreeing clock.
- Timing never changes a screen. Starting an event, a fixed start arriving, a pause being used up or
  the offset moving do not take anything live; countdowns and the stage finish line only read the
  expected times.

## 5. What desks see

Every joined desk, whatever its role, receives the host's Live State. For each item of the main
service it carries `time`: the planned and expected start and end, the actual start (and how long it
ran, once done), the state (done, live, upcoming, skipped), the end by and whether it is cut short and,
from this slice, `fixed` (a fixed start; the planned start is that time), `conflict` (late for it) and
`pause` (the planned pause before it and how much lateness is expected to take up). The read-only
**Run of show** on a desk shows them: a pin on a fixed start, a thin row for a pause, and "Late for its
fixed start". An older desk ignores the new fields; an older host sends none, and the desk shows what
it did before. The stage display and the countdown clocks get the host's expected times, never their
own.

## 6. Not decided here (later slices of #196)

- Persisting a delay into the plan "after approval", and an absolute "running behind until 10:45"
  delay; R3 keeps one relative offset.
- Gap policy choices (a pause that must not absorb, or a fixed start that may slide); today every
  pause absorbs and every fixed start holds.
- Time-of-day automation (start an item by itself at its fixed start). A fixed start is a promise on
  paper; somebody still presses Start.
- Explicit church timezone and stored instants per service instance (two services in one day from
  one template). Clock times are still local to the host computer.

## 7. Comparison with Ontime (concepts, not code)

Ontime (getontime.no) is a free timing tool for events. Rhema does not use its code, interface or
data; this compares ideas so that a church technician who knows Ontime can find their way.

| Ontime idea | In Ontime, roughly | Rhema |
|---|---|---|
| Planned vs expected times | Each event has a scheduled time and a projected one from the current offset and the durations still to come. | The same split, plus a third: actual times from the service log. |
| Timer types (count down, count up, time of day, none) | Chosen per event. | The service timer counts down a budget and on into overtime; countdowns count to the next item or a milestone; clock layers show the time of day. Per-item timer types are not yet chosen in the rundown. |
| Lock duration / lock end | An event keeps its length or its end when times are edited. | Planned minutes keep the length; **end by** keeps the end as a hard stop that cuts the expected time. |
| Linked start | An event's start can follow the previous event's end, or be set on its own. | **Linked** is the default; a **fixed start** is the unlinked case and holds its clock time. |
| Added time | Time added to the running event changes the offset and the expected end, not the schedule. | Correcting the service timer (±1) and the shared **±5 offset** do the same: the plan does not change. |
| Scheduled delay blocks | A delay placed in the rundown pushes the events after it until a gap is large enough to absorb it; it can later be made permanent. | One shared offset rather than delay blocks; it is absorbed by pauses and stops at a fixed start. Making a delay permanent is a later slice. |
| Gaps absorb delays | Free time between scheduled events takes up delays. | Explicit **pauses** (`gap_minutes`) and the free time before a fixed start do; the table says how much. |
| Absolute vs relative offset mode | Offset is measured against the wall clock (absolute) or against the rundown's actual start (relative, for rehearsals and recordings). | Measured against the wall clock once the service has begun; before that expected is the plan, so rehearsing on another day is not "late". |
| Groups, milestones / flags | Groups total their events; flags mark moments to count to. | Phases and groups total their items; countdowns go to the next item, the service end or an item's end by. |
| Count to end | A timer that finishes at its scheduled end whatever the start. | A hard stop (end by) and the countdown to a milestone. |
