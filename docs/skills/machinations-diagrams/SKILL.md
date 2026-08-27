---
name: machinations-diagrams
description: >-
  Build, read, and reason about Machinations diagrams — the visual language for
  modeling a game's internal economy (the flow of resources through sources,
  drains, pools, gates, converters, traders, and feedback loops). Use this skill
  whenever the user wants to model game mechanics or an economy, design or balance
  a feedback loop, diagram resource flow, sketch an engine/friction/escalation
  structure, prototype the systemic core of a game, or mentions "Machinations,"
  "internal economy," "resource flow," "feedback loop," "game economy," or names a
  design pattern like "dynamic engine," "attrition," or "arms race" — even if they
  don't say the word "Machinations." Also use it to translate an informal game
  description into a structured economy model, or to critique/balance an existing one.
license: MIT
---

# Machinations Diagrams

Machinations is a visual language for modeling the **internal economy** of a game:
how tangible, intangible, and abstract resources are produced, consumed, stored,
exchanged, and converted, and how feedback loops among those flows produce emergent
behavior. A diagram is a directed graph of **nodes** (which act on resources) joined
by two kinds of edges: **resource connections** (resources physically move along
these) and **state connections** (the current distribution of resources controls
something elsewhere).

The framework's core premise: gameplay is largely determined by resource flow, so if
you can draw the economy you can see — and tune — the feedback structures that drive
the game. Diagrams can be drawn at any level of abstraction; the natural default scope
is a single player's perspective.

## How to use this skill

When asked to model a game or mechanic:

1. **Identify the resources.** What flows? Money, ammo, health, threat, score,
   territory, action points. Classify each as tangible (physical, conserved),
   intangible (counted but not physical, e.g. score), or abstract (a designer's
   bookkeeping value, e.g. "threat level").
2. **Identify the economic functions.** Where is each resource *created* (source),
   *destroyed* (drain), *converted* into another (converter), or *exchanged*
   between owners (trader)?
3. **Model one mechanism at a time**, then connect them. Give each subsystem its own
   resource color for legibility.
4. **Wire the feedback** with state connections (modifiers, triggers, activators).
   Decide whether each loop is positive (amplifying) or negative (stabilizing).
5. **Add player agency** as interactive nodes; add automatic nodes for forces the
   game applies on its own.
6. **Add end conditions** and choose a **time mode**.
7. **Express the diagram** (see "Expressing a diagram" below) and, if balancing,
   reason about the feedback profile and dominant strategies.

For non-trivial economies, lean on the **design-pattern vocabulary** — engines,
friction, escalation, and the rest. Reach for `references/design-patterns.md` in the
original repository whenever you need the full intent / structure / consequences /
examples of a pattern, or are combining patterns into a genre-scale economy.

---

## Nodes

Every node has an **activation mode** (when it fires) drawn on top of its base shape.

### Pool — open circle
Stores resources (integers only; no fractions). The fundamental node. Resources are
drawn as small colored tokens stacked on the circle, or as a number past a display
threshold. Used to model entities that hold a quantity (a bank balance, a health bar).

- **Pull (default):** when it fires, it pulls resources *in* along its inputs, up to
  each input's rate.
- **Push mode (`p`):** when it fires, it pushes resources *out* along its outputs. A
  pool with only outputs is implicitly in push mode (the `p` is omitted).
- **Pull/push amount:** by default a node moves as many as are available up to the
  rate. In **all-or-none mode (`&`)** it moves resources only if the *full* amount
  is available, otherwise none.

### Source — triangle pointing up
Creates resources. Its output rate is its defining property. Behaves like an
input-less pool with an effectively infinite supply. For a genuinely *limited*
supply, use a pool seeded with a fixed number instead.

### Drain — triangle pointing down
Destroys resources permanently; whatever enters is gone. Rate set by its input
connection; label the input `all` to drain everything available at once. Use for
consumption, wear, friction, spent ammo.

### Gate — diamond
Does **not** store — it immediately redistributes whatever arrives. Outputs are
labeled, and all outputs of one gate must be the *same kind*:

- **Probable outputs:** percentages (`20%`) or integer weights (`1`, `3`). With
  weights, an output's chance = its weight ÷ sum of weights. Probabilities summing to
  < 100% leave a chance the resource is destroyed.
- **Conditional outputs:** conditions (`>3`, `==0`, ranges like `3..5`). Every
  condition is checked on each arrival; one resource is emitted on *every* satisfied
  output (overlapping conditions can duplicate a resource; no match destroys it).

Distribution mode: **deterministic** (open diamond — distributes evenly to match the
stated proportions; with conditional outputs it counts throughput, so think of it as a
*counting gate*) or **random** (die symbol — rolls to choose; conditional outputs roll
1–6 by default). Gates may have a single output. All state connections leaving a gate
are triggers (a gate stores nothing, so modifiers/activators from it are meaningless).

### Converter — triangle pointing right with a vertical bar
Consumes one resource type to produce another (a drain feeding a source). A sawmill:
1 tree → 50 boards. Input and output rates can differ. A **limited converter** =
drain + *limited* source (a pool of finite supply).

### Trader — vertical bar over two triangles pointing outward
**Exchanges** resources between owners without creating or destroying any — total
resources in the system stay constant. Shopping: money for goods at a fixed ratio
(the price). The trade simply doesn't happen if either side can't pay.

> Converter vs. trader: both look like "give X, get Y" to a player, but a converter
> *changes the total amount* of resources in the game (it consumes and produces); a
> trader only moves ownership. Choose based on whether the resource count should change.

### Register — solid square showing a number
Holds a *value*, not resources (don't run resource connections into it; use node-
modifier state connections). **Interactive** registers have an editable initial value
plus +/- buttons the player drives at runtime. **Passive** registers are computed from
their inputs and hold a **formula**. In Machinations.io these formulas use **math.js**
syntax (the full math.js function library is available — `min`/`max`, `floor`/`ceil`,
`round`, `random`, conditionals, etc.), referencing inputs by their assigned variables.
Use registers for calculations and player-set parameters.

### Delay — small circle with one hourglass
Holds each resource for N time steps, then passes it on (the output label is the
*number of steps*, not a rate). Processes many resources in parallel. Delay time can
be dynamic (driven by a label modifier) or random (dice notation).

### Queue — small circle with two hourglasses
Like a delay but serializes: one resource at a time. With a label of 5, it passes at
most one resource every 5 steps. Delays/queues can expose how many resources they're
currently holding via a state connection (useful for timed effects).

### End condition — square with a small filled square inside
Stops the simulation when reached. It has no rate; it is switched on by an
**activator** whose condition defines the winning/losing state (e.g. "score > 3").
A diagram can have several.

---

## Activation modes (the marker on a firing node)

| Mode | Marker | Fires… |
|------|--------|--------|
| Automatic | `*` (asterisk) | every iteration; all automatic nodes fire simultaneously |
| Interactive | double outline | when the player activates it (a click) |
| Starting action | `s` | exactly once, before the first iteration |
| Passive | (none) | only when fired by a trigger |

---

## Resource connections (solid arrows — resources travel along these)

The label is the **flow rate**: how many resources may move per time step.

- **No label → rate 1.** Label `all` → unlimited (moves everything available).
- **Random rates:**
  - `D` — an unspecified random factor (a die icon; "it varies, details unspecified").
  - **Dice notation:** `D6` (1–6), `D6+3`, `2D6` (sum of two d6 → 2–12), mixes like
    `2D4+D8+D12`, and arbitrary-sided dice (`D5`, `D7`, `D35`).
  - **Percentages:** `25%` = 25% chance of moving 1 this step. Values over 100% are
    allowed: `250%` = 2 guaranteed plus a 50% chance of a third.
- **Intervals (pipe):** `1|5` = 1 resource every 5 steps. `5|10` = a *burst* of 5
  every 10 steps. Random intervals: `1|(D4+2)`, or even `D6|D6`. (Intervals give finer
  control than a fractional rate like `0.2` and allow bursts.) **Note:** the 2012 book
  writes intervals with a slash (`1/5`); Machinations.io uses the **pipe** (`1|5`).

### Inputs / outputs / origin / target
A connection *into* a node is an **input**; *out of* a node, an **output**. The node a
connection starts from is its **origin**; where it ends is its **target**.

### Resolving simultaneous pulls
If two nodes pull from the same source with too little to satisfy both: in
**synchronous** time mode neither pulls until enough has accumulated for both; in
**asynchronous/turn-based** mode priority is initially random, then alternates each step.

---

## State connections (dotted arrows — the current state controls something)

A state connection runs from an **origin node** to a target that is a node, a resource
connection's label, or (rarely) another state connection. Behaviors are identified by
label:

### Label modifier — label begins with `+` or `-`
Targets a resource connection's **rate** and changes it as the origin's resource count
changes. A positive modifier makes the target *follow* the origin (up when it rises);
a negative modifier *inverts* it. With a unit suffix it retargets: `+1i` modifies an
**interval**.

### Node modifier — label is a number `M`
Targets another node's **resource count**: `N(t+1) = N(t) + Σ(M × ΔS)`. It can *create
or destroy* resources, so use it only for abstract bookkeeping values — for tangible
resources use real sources/drains. A node driven negative is in **shortage**: nothing
can be pulled from it, and incoming resources backfill the shortage first.

### Trigger — label is `*`
Fires its target when **all** the origin's inputs are *satisfied*. It transfers no
quantity — it just makes the target fire.

### Activator — label is a condition
Conditions are arithmetic (`==0`, `<3`, `>=4`, `!=2`) or ranges (`3..6`). While the
origin's state satisfies the condition, the target is **enabled** (allowed to fire);
otherwise it is **inhibited**. This is the standard way to gate a node on game state
and to switch on end conditions.

### Reverse trigger — label is `!`
Fires its target when the origin tries to pull but **cannot** satisfy all its inputs.
Models "the player ran out and something bad happens" (e.g. forced sell-offs when
upkeep can't be paid).

### Overwrite operator — modifier label is `=`
Sets the target's formula or node value *to* the origin's current value. Rule of
thumb: use `=` to clamp/overwrite a value outright; use `+`/`-` when the target should
respond incrementally to several driving inputs.

---

## Time modes

- **Synchronous** — automatic nodes fire on a fixed interval; clicked interactive nodes
  resolve on the next step alongside them; everything in a step happens at once.
- **Asynchronous** (default) — automatic nodes still fire on intervals, but interactive
  nodes resolve *immediately* on activation and may fire many times within a step.
- **Turn-based** — steps don't advance on a clock; each interactive node costs *action
  points*, players get a budget per turn, and when the budget is spent all automatic
  nodes fire and a new turn begins.

---

## Color coding

In a color-coded diagram, color is semantic. A resource connection whose color differs
from its origin pulls *only* resources of its own color; likewise a state connection
responds only to its color. This lets one pool hold several resource types cleanly.
A source/converter can emit a color different from itself; a gate can **sort**
resources by color or **recolor** them. Delays/queues can hold different colors for
different durations.

---

## Feedback (why any of this matters)

A closed loop of connections creates **feedback**. **Positive** feedback amplifies
(an arms race, runaway leader); **negative** feedback stabilizes (self-correcting
equilibrium, rubber-banding). Feedback can be **constructive** (it adds resources/
options) or **destructive** (it removes them). When characterizing a loop, consider
its *effect* (positive/negative), whether it's constructive/destructive, the
*investment* needed to trigger it, its *speed*, *range*, and *durability*. Most
balance problems are a loop that's too strong, too cheap, or unopposed — pair an
amplifying engine with some form of friction or escalation to keep it in check.

---

## Design-pattern vocabulary

These are recurring economy structures — use them as building blocks and shared vocabulary:

- **Engines** (produce resources): static engine, dynamic engine, converter engine, engine building.
- **Friction** (drain/throttle resources): static friction, dynamic friction, stopping mechanism (diminishing returns), attrition.
- **Escalation** (mounting pressure): escalating challenge, escalating complexity, arms race.
- **Other:** playing-style reinforcement, multiple feedback, trade, worker placement, slow cycle.

Patterns combine and nest. Genre cores are pattern combos — e.g. real-time strategy ≈ dynamic engine + attrition (+ arms race for depth); many RPGs ≈ playing-style reinforcement + escalating challenge. When you build an economy, name the patterns you're using and check that amplifying patterns are balanced by friction/escalation.

---

## Expressing a diagram

Emit two things per subsystem — intent + structure:

1. **An intent line** in the framework's vocabulary — e.g. "this is a *dynamic engine*:
   spend energy to buy upgrades that raise energy production (positive constructive loop)."
2. **A structural listing.** For each **node**: id, type, activation mode, any markers
   (`p`, `&`), and initial resources/value. For each **connection**: kind (resource vs.
   which state type), origin → target, and label (rate / probability / condition /
   modifier). Group by subsystem and note resource colors.

A worked sketch:

```
Intent: a DYNAMIC ENGINE — the player spends energy to buy upgrades that raise
energy production (positive constructive feedback loop), feeding a spend action.

Resources: energy (yellow), upgrades (green)

Nodes
  src_energy   : source,   automatic,   out-rate driven by upgrades
  energy       : pool,      passive
  invest       : interactive (player), all-or-none
  upgrades     : pool,      passive
  spend        : drain,     interactive (player)

Connections
  resource:  src_energy --( rate )-->  energy
  resource:  energy --( cost )-->      invest
  resource:  invest --( 1 )-->         upgrades
  resource:  energy --( n )-->         spend
  state(label-mod, +):  upgrades  -->  rate of [src_energy -> energy]
```

---

## Quick reference

| Element | Glyph / label | Meaning |
|---|---|---|
| Pool | open circle | stores resources |
| Source | up triangle | creates resources |
| Drain | down triangle | destroys resources |
| Gate | diamond | redistributes immediately (probable or conditional outputs) |
| Converter | right triangle + bar | consumes one resource to produce another |
| Trader | bar over two triangles | exchanges between owners |
| Register | solid square | holds a value / formula |
| Delay | circle, one hourglass | holds resources N steps (parallel) |
| Queue | circle, two hourglasses | holds resources, one at a time |
| End condition | square + inner square | stops the run |
| Automatic | `*` | fires every step |
| Interactive | double outline | fires on player action |
| Starting action | `s` | fires once at start |
| Passive | (none) | fires only when triggered |
| Push mode | `p` | pushes out instead of pulling in |
| All-or-none | `&` | move full amount or nothing |
| Resource conn. | solid arrow + rate | resources travel |
| Label modifier | dotted, `+`/`-`/`=` | changes a connection's rate |
| Node modifier | dotted, number | changes a node's resource count |
| Trigger | dotted, `*` | fires target when origin's inputs are satisfied |
| Activator | dotted, condition | enables/inhibits target by origin's state |
| Reverse trigger | dotted, `!` | fires when origin can't satisfy its inputs |

> 注：本存档为精简版；原仓库另有 token 级语法速查（`references/machinations-io-syntax.md`）
> 与 ~18 个经济模式详解（`references/design-patterns.md`），需要时到原仓库拉取。
