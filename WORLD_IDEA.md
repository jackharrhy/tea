# World

World is a future Tea game at `world.harrhy.xyz`. Burger, Gurgur, and Pool are experiments whose strongest ideas and working code can become parts of one canonical game. The aim is a continuous place and player experience, not a menu that links three standalone games.

## The experience

A player can walk through an overview inspired by Burger, enter a space with Gurgur's character movement and physical interactions, approach a pool table, play with Pool's rules and physics, and return to the surrounding world. Their identity, location, permissions, and relevant possessions should remain coherent across those activities. The camera and controls may change with the activity; the player should not have to start a separate product or account.

The overview remains editable with Burger's Atlas and admin tools. Three-dimensional spaces should be authored in Tea Maps, building on its Valve 220 editor and Gurgur's map compiler. These are distinct authoring surfaces for distinct kinds of content; World should give their outputs stable places, connections, and identities rather than force them into one map file format.

## Direction

- Build `tea/world` as the destination, with one authoritative model for player identity, locations, interactions, permissions, and persistent world state. Pool matches and physical spaces can use specialized simulation systems inside that model.
- Reuse proven controllers, physics, rendering, rules, and editor behavior from the existing apps. Move a capability when World needs it, then simplify or retire its standalone owner once the useful behavior is represented and verified.
- Keep the existing Burger, Gurgur, Pool, and Maps products usable while World develops. Their current deployments and stored data should not be treated as disposable during an experiment.
- Share concepts because two real consumers need the same behavior. A common ECS, wire format, or network stack is not a prerequisite. Compare measured behavior before replacing a working implementation.

## First playable slice

Create a small overview with Burger-style walking and editing, one room authored in Tea Maps and played with Gurgur-style movement and props, and one usable pool table. A player enters the room, plays, and returns within the same World session. This slice should establish how authored locations connect, how controls and camera modes change, and which system owns persistent edits and game state.

Before building that slice, improve Tea Maps' editor so authoring a room is pleasant. In particular, compare it with the original Worldview editor and restore its useful layout, visual character, and editing ergonomics in the Remix app. This Maps work is the current focus; World remains a direction to revisit when the authoring experience is ready.

## Questions to settle through the slice

- What is a stable location or object ID across the overview, a physical room, and a pool match?
- Which edits happen live, which require a build, and how does a player enter an updated space safely?
- Which movement, presence, and network measurements are genuinely shared across activities?
- How do administration and authoring permissions follow content from Burger's Atlas and Tea Maps into World?

These questions should be answered by a playable implementation and its data, not by committing to a broad framework first.
